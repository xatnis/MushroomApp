import { useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MushroomWeatherSummary } from '../domain/types';
import { colors, radii, spacing } from '../theme';
import { WeatherGraphs } from './WeatherGraphs';
import type { WeatherGraphMetric, WeatherGraphNavigation, WeatherGraphPreset } from './weatherGraphPresentation';

const presets: Array<{ preset: WeatherGraphPreset; label: string }> = [
  { preset: 'history7', label: '7 dni nazaj' }, { preset: 'history30', label: '30 dni nazaj' }, { preset: 'forecast7', label: 'Napoved 7 dni' },
];

export interface WeatherGraphsLocation { latitude: number; longitude: number; name: string }
export function hasGraphLocation(location?: WeatherGraphsLocation): location is WeatherGraphsLocation {
  return !!location && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
}

/** Discovery only: mounting this entry never acquires weather data. */
export function WeatherGraphsEntry({ onPress, compact = false }: { onPress: () => void; compact?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Vremenski grafi: padavine in temperatura, 30 dni zgodovine in 7 dni napovedi"
    accessibilityHint="Odpre celozaslonski pregled grafov za izbrano lokacijo."
    onPress={onPress} style={({ pressed }) => [styles.entry, compact && styles.compactEntry, pressed && styles.pressed]}>
    <View style={styles.entryHeading}><Ionicons name="bar-chart-outline" size={23} color={colors.primary} />
      <Text style={styles.entryTitle}>Vremenski grafi</Text><Text style={styles.action}>Odpri grafe →</Text></View>
    {!compact ? <Text style={styles.subtitle}>Padavine in temperatura</Text> : null}
    <Text style={styles.secondary}>30 dni zgodovine · 7 dni napovedi</Text>
  </Pressable>;
}

/** Native modal keeps its origin mounted: no navigation blur, map remount or scroll reset. */
export function WeatherGraphsModal({ visible, location, summary, weatherCellId, onClose }: {
  visible: boolean; location?: WeatherGraphsLocation; summary?: MushroomWeatherSummary; weatherCellId?: string; onClose: () => void;
}) {
  const heading = useRef<Text>(null);
  const scroll = useRef<ScrollView>(null), content = useRef<View>(null);
  const contentTop = useRef(0);
  const sections = useRef<Partial<Record<WeatherGraphMetric, View>>>({});
  const pending = useRef<WeatherGraphMetric | null>(null), generation = useRef(0), frame = useRef<number | null>(null);
  const [navigation, setNavigation] = useState<WeatherGraphNavigation>();
  const [anchor, setAnchor] = useState<WeatherGraphMetric | null>(null);
  const locationKey = `${visible}:${location?.latitude}:${location?.longitude}`;
  const currentKey = useRef(locationKey); currentKey.current = locationKey;
  const cancelAnchor = () => { generation.current++; pending.current = null; if (frame.current != null) cancelAnimationFrame(frame.current); frame.current = null; };
  // Reset before native onLayout registrations, not in a later passive effect
  // which could accidentally discard already-measured sections on entry.
  useLayoutEffect(() => {
    cancelAnchor(); sections.current = {}; setNavigation(undefined); setAnchor(null);
    return cancelAnchor;
  }, [locationKey]);
  const alignSection = () => {
    const metric = pending.current, target = metric && sections.current[metric];
    if (!metric || !target || !content.current) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    const token = generation.current, key = locationKey;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (token !== generation.current || currentKey.current !== key || !visible) return;
      target.measureLayout(content.current!, (_x, y) => {
        if (token !== generation.current || currentKey.current !== key || pending.current !== metric || sections.current[metric] !== target) return;
        // The fixed native header and safe area are already outside this ScrollView.
        // Include the measured wrapper origin in scroll-content coordinates, then
        // leave the existing design padding as breathing room. No header subtraction twice.
        pending.current = null;
        scroll.current?.scrollTo({ y: Math.max(0, contentTop.current + y - spacing.md), animated: true });
      }, () => { /* A later section layout may retry a still-pending request. */ });
    });
  };
  const navigateSection = (metric: WeatherGraphMetric) => { cancelAnchor(); pending.current = metric; setAnchor(metric); alignSection(); };
  const onSectionLayout = (metric: WeatherGraphMetric, node: View | null) => {
    if (!visible || currentKey.current !== locationKey) return;
    if (node) sections.current[metric] = node;
    if (pending.current) alignSection();
  };
  const close = () => { cancelAnchor(); onClose(); };
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent
    onRequestClose={close} onShow={() => {
      const handle = heading.current && findNodeHandle(heading.current);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }}>
    {visible ? <SafeAreaProvider><SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.screen} accessibilityViewIsModal>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Nazaj iz vremenskih grafov" accessibilityHint="Vrne se na prejšnji prikaz."
          onPress={close} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={25} color={colors.primary} /></Pressable>
        <View style={styles.headerText}><Text ref={heading} accessibilityRole="header" style={styles.title}>Vremenski grafi</Text>
          <Text style={styles.subtitle}>{location?.name || 'Lokacija ni določena'}</Text></View>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} onScrollBeginDrag={cancelAnchor} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}>
        <View ref={content} collapsable={false} style={styles.body} onLayout={event => { contentTop.current = event.nativeEvent.layout.y; if (pending.current) alignSection(); }}>
        {hasGraphLocation(location) ? <>
          <View style={styles.navigation} accessibilityLabel="Časovno obdobje grafov">
            {presets.map(item => <Pressable key={item.preset} accessibilityRole="button" accessibilityLabel={item.label}
              accessibilityState={{ selected: navigation?.preset === item.preset }} accessibilityHint="Premakne oba grafa na to obdobje in izbere njegov prvi dan. Brez novih vremenskih zahtev."
              onPress={() => setNavigation(previous => ({ preset: item.preset, generation: (previous?.generation ?? 0) + 1 }))}
              style={({ pressed }) => [styles.preset, navigation?.preset === item.preset && styles.activeControl, pressed && styles.pressed]}>
              <Text style={[styles.controlText, navigation?.preset === item.preset && styles.activeText]}>{item.label}</Text>
            </Pressable>)}
          </View>
          <View style={styles.navigation} accessibilityLabel="Premik do grafa">
            {(['rain', 'temperature'] as const).map(metric => <Pressable key={metric} accessibilityRole="button"
              accessibilityLabel={metric === 'rain' ? 'Padavine' : 'Temperatura'} accessibilityHint="Pomakne stran do tega grafa. Oba grafa ostaneta na strani."
              accessibilityState={{ selected: anchor === metric }} onPress={() => navigateSection(metric)}
              style={({ pressed }) => [styles.sectionControl, anchor === metric && styles.activeControl, pressed && styles.pressed]}>
              <Text style={[styles.controlText, anchor === metric && styles.activeText]}>{metric === 'rain' ? 'Padavine' : 'Temperatura'} ↓</Text>
            </Pressable>)}
          </View>
          <WeatherGraphs location={location} summary={summary} navigation={navigation} onSectionLayout={onSectionLayout}
            weatherCellId={summary?.latitude === location.latitude && summary?.longitude === location.longitude ? weatherCellId : undefined} />
          </>
          : <Text accessibilityRole="text" style={styles.subtitle}>Za prikaz grafov najprej izberi lokacijo. Vremenski podatki za drugo lokacijo niso prikazani.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView></SafeAreaProvider> : null}
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerText: { flex: 1, minWidth: 0, gap: spacing.xs }, title: { fontSize: 22, fontWeight: '700', color: colors.primary },
  back: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', borderRadius: radii.sm },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  body: { gap: spacing.sm }, navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: { flexBasis: 96, flexGrow: 1, flexShrink: 1, minHeight: 48, padding: spacing.sm, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  sectionControl: { flexGrow: 1, flexBasis: 120, minHeight: 48, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  activeControl: { backgroundColor: colors.primary, borderColor: colors.primary }, controlText: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center' }, activeText: { color: colors.surface },
  entry: { minHeight: 48, padding: spacing.md, gap: spacing.xs, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.secondary, backgroundColor: colors.surfaceSoft },
  compactEntry: { borderRadius: radii.sm, padding: spacing.sm },
  entryHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }, entryTitle: { flexGrow: 1, flexShrink: 1, color: colors.primary, fontSize: 18, fontWeight: '600' },
  subtitle: { color: colors.text, fontSize: 16 }, secondary: { color: colors.muted, fontSize: 14 },
  action: { color: colors.primary, fontSize: 16, fontWeight: '600' }, pressed: { opacity: .78 },
});
