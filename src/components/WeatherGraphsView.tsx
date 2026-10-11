import { useRef } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MushroomWeatherSummary } from '../domain/types';
import { colors, radii, spacing } from '../theme';
import { WeatherGraphs } from './WeatherGraphs';

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
      <Text style={styles.entryTitle}>Vremenski grafi</Text></View>
    {!compact ? <Text style={styles.subtitle}>Padavine in temperatura</Text> : null}
    <Text style={styles.secondary}>30 dni zgodovine · 7 dni napovedi</Text>
    <Text style={styles.action}>Odpri grafe →</Text>
  </Pressable>;
}

/** Native modal keeps its origin mounted: no navigation blur, map remount or scroll reset. */
export function WeatherGraphsModal({ visible, location, summary, weatherCellId, onClose }: {
  visible: boolean; location?: WeatherGraphsLocation; summary?: MushroomWeatherSummary; weatherCellId?: string; onClose: () => void;
}) {
  const heading = useRef<Text>(null);
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent
    onRequestClose={onClose} onShow={() => {
      const handle = heading.current && findNodeHandle(heading.current);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }}>
    {visible ? <SafeAreaProvider><SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.screen} accessibilityViewIsModal>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Nazaj iz vremenskih grafov" accessibilityHint="Vrne se na prejšnji prikaz."
          onPress={onClose} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={25} color={colors.primary} /></Pressable>
        <View style={styles.headerText}><Text ref={heading} accessibilityRole="header" style={styles.title}>Vremenski grafi</Text>
          <Text style={styles.subtitle}>{location?.name || 'Lokacija ni določena'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}>
        {hasGraphLocation(location) ? <WeatherGraphs location={location} summary={summary}
          weatherCellId={summary?.latitude === location.latitude && summary?.longitude === location.longitude ? weatherCellId : undefined} />
          : <Text accessibilityRole="text" style={styles.subtitle}>Za prikaz grafov najprej izberi lokacijo. Vremenski podatki za drugo lokacijo niso prikazani.</Text>}
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
  entry: { minHeight: 48, padding: spacing.md, gap: spacing.xs, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.secondary, backgroundColor: colors.surfaceSoft },
  compactEntry: { borderRadius: radii.sm, padding: spacing.sm },
  entryHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, entryTitle: { flexShrink: 1, color: colors.primary, fontSize: 18, fontWeight: '600' },
  subtitle: { color: colors.text, fontSize: 16 }, secondary: { color: colors.muted, fontSize: 14 },
  action: { color: colors.primary, fontSize: 16, fontWeight: '600', marginTop: spacing.xs }, pressed: { opacity: .78 },
});
