import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { useSevenDayConditions } from '../services/useSevenDayConditions';
import type { SevenDayLocation } from './SevenDayConditionsView';
import { compactForecastHasDateStrip, forecastComparison, forecastDateLabel } from './mapForecastPresentation';
import { slDateTime } from '../domain/format';
import { colors, radii, spacing } from '../theme';
import { markPointTiming } from '../services/pointTiming';

const ignoreSnapshot = () => {}; // Map detail must never synchronize the unrelated Razmere location.
export function MapForecastEntry({ onPress, expanded = false, compact = false }: { onPress: () => void; expanded?: boolean; compact?: boolean }) {
  const { width, fontScale } = useWindowDimensions();
  return <Pressable accessibilityRole="button" accessibilityLabel="Napoved pogojev, 7 dni" accessibilityState={{ expanded }}
    accessibilityHint="Odpre napoved izbrane točke ali omogoči izbiro točke na zemljevidu" onPress={onPress}
    style={({ pressed }) => [styles.entry, { minWidth: compact ? 48 : Math.min(124 * fontScale, width - 2 * spacing.lg) }, compact && styles.iconEntry, pressed && styles.pressed]}>
    <Ionicons name="calendar-outline" size={20} color={colors.primary} />{!compact ? <Text style={styles.action}>Napoved · 7 dni</Text> : null}
  </Pressable>;
}

export function MapForecastPicker({ onClose, maxHeight }: { onClose: () => void; maxHeight?: number }) {
  return <View style={[styles.panel, { maxHeight }]} accessibilityLiveRegion="polite"><ScrollView style={styles.scroll} contentContainerStyle={styles.content}><View style={styles.heading}>
    <Text accessibilityRole="header" style={styles.title}>Izberi točko na zemljevidu za sedemdnevno napoved.</Text>
    <Close onClose={onClose} />
  </View><Text style={styles.secondary}>Tapni točko ali svoje rastišče. Premikanje zemljevida ne izbere lokacije.</Text></ScrollView></View>;
}

function Close({ onClose }: { onClose: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Zapri predogled napovedi" onPress={onClose} style={styles.close}>
    <Ionicons name="close" size={22} color={colors.primary} /></Pressable>;
}

/** Explicitly mounted for one location only. The existing hook owns all acquisition, generations and safety gates. */
export function SevenDayMapForecastPreview({ location, database, profileId, initialDay, selectedDate, mapDay = 'today', mapProfileId = profileId, conditionsEnabled = true,
  maxHeight, onClose, onFull, onSelectDate, onWeatherGraphs, onHotspotDetail, onSavePoint, hasPointDetails = false }: {
  location: SevenDayLocation; database: SQLiteDatabase; profileId: MushroomWeatherProfileId; initialDay: number;
  selectedDate?: string; mapDay?: 'today' | 'tomorrow'; mapProfileId?: MushroomWeatherProfileId; conditionsEnabled?: boolean;
  maxHeight: number; onClose: () => void; onFull: (day: number, date?: string) => void;
  onSelectDate: (day: number, date: string) => void; onWeatherGraphs: () => void; onHotspotDetail?: () => void; onSavePoint?: () => void;
  hasPointDetails?: boolean;
}) {
  const heading = useRef<Text>(null), announced = useRef(false);
  const { fontScale } = useWindowDimensions();
  const week = useSevenDayConditions(database, location, profileId, undefined, ignoreSnapshot);
  const dateIndex = week.results?.findIndex(day => day.targetLocalDate === selectedDate) ?? -1;
  const selectedDay = dateIndex >= 0 ? dateIndex : Number.isInteger(initialDay) && initialDay >= 0 && initialDay <= 6 ? initialDay : 0;
  const selected = week.results?.[selectedDay], current = week.results?.[mapDay === 'tomorrow' ? 1 : 0];
  const mapDayLabel = mapDay === 'tomorrow' ? 'Jutri' : 'Danes';
  const showDates = compactForecastHasDateStrip(maxHeight, fontScale);
  const displayName = location.source === 'map-point' ? 'Izbrana točka' : location.name;
  return <View style={[styles.panel, { maxHeight }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}><View style={styles.grow}>
        <Text ref={heading} accessibilityRole="header" onLayout={() => {
          if (!announced.current) markPointTiming(location, week.today, 'T1 header layout');
          const handle = heading.current && findNodeHandle(heading.current);
          if (!announced.current && handle != null) { announced.current = true; AccessibilityInfo.setAccessibilityFocus(handle); }
        }} accessibilityLabel={`Napoved pogojev za ${displayName}, 7 dni`} numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{displayName}</Text>
        <Text numberOfLines={1} style={styles.secondary}>{MUSHROOM_WEATHER_PROFILES[profileId].label}</Text>
        <Text numberOfLines={1} style={styles.secondary}>{conditionsEnabled ? `Zemljevid: ${mapDayLabel}${mapProfileId !== profileId ? ` · ${MUSHROOM_WEATHER_PROFILES[mapProfileId].label}` : ''}` : 'Zemljevid: Rastišča'}</Text>
      </View><Close onClose={onClose} /></View>
      {week.loading ? <View style={styles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} />
        <Text style={[styles.secondary, styles.grow]}>Preračunavam sedemdnevne razmere ... Pridobivam vremenske podatke.</Text></View> : null}
      {week.error ? <Text style={styles.secondary} accessibilityLiveRegion="polite">{week.error}</Text> : null}
      {week.snapshot?.stale ? <Text style={styles.secondary}>Starejša predpomnjena napoved</Text> : null}
      {week.results && showDates ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} nestedScrollEnabled>
        {week.results.map((day, index) => {
          const date = new Intl.DateTimeFormat('sl-SI', { timeZone: WEATHER_TIMEZONE, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(day.targetLocalDate + 'T12:00:00Z'));
          return <Pressable key={day.targetLocalDate} accessibilityRole="button" accessibilityState={{ selected: selectedDay === index }}
            accessibilityLabel={`${date}, ${day.score == null ? 'ocena ni na voljo' : `${day.score} od 100, ${day.label}`}${day.status === 'stale' ? ', starejši podatki' : ''}`}
            accessibilityHint="Posodobi datum, oceno in primerjavo spodaj. Ne spremeni dneva regionalnega zemljevida."
            onPress={() => onSelectDate(index, day.targetLocalDate)} style={[styles.day, selectedDay === index && styles.selected]}>
            <Text style={styles.date}>{date}</Text>
          </Pressable>;
        })}
      </ScrollView> : null}
      {selected ? <View style={styles.detail} accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" accessibilityLabel={`Napoved točke: ${forecastDateLabel(selected.targetLocalDate)}`} style={styles.name}>Napoved: {forecastDateLabel(selected.targetLocalDate)}</Text>
        <Text style={styles.score}>{selected.score == null ? 'Ocena ni na voljo' : `${selected.score}/100 · ${selected.label}`}</Text>
        <Text style={styles.context}>{forecastComparison(selected, week.results?.[0], week.snapshot)}</Text>
        {selected.score == null ? <Text style={styles.secondary}>{selected.missing[0] ?? (selected.status === 'error' ? 'Vremenski podatki niso dosegljivi.' : 'Manjkajo potrebni modelni vhodi.')}</Text> : null}
      </View> : null}
      {week.error || week.results?.some(day => day.status === 'error') ? <Pressable accessibilityRole="button" onPress={week.retry} style={styles.entry}>
        <Text style={styles.action}>Poskusi znova</Text></Pressable> : null}
    </ScrollView>
    <View style={styles.footer}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Vseh 7 dni za ${location.name}`}
        accessibilityHint={showDates ? 'Odpre dejavnike in vreme izbranega dne.' : 'Odpre vseh sedem dni in njihove podrobnosti. Na manjšem prostoru dneve izbereš v celotnem pogledu.'}
        onPress={() => onFull(selectedDay, selected?.targetLocalDate ?? selectedDate)} style={[styles.entry, styles.primaryAction]}>
        <Text style={styles.action}>Podrobnosti napovedi →</Text></Pressable>
      <ForecastPointActions location={location} profileLabel={MUSHROOM_WEATHER_PROFILES[profileId].label} currentLabel={current ? `Pogoji točke · ${mapDayLabel}: ${current.score == null ? 'Ocena ni na voljo' : `${current.score}/100 · ${current.label}`}` : undefined}
        retrievedAt={week.snapshot?.forecastRetrievedAt} stale={week.snapshot?.stale} onWeatherGraphs={onWeatherGraphs}
        onHotspotDetail={onHotspotDetail} onSavePoint={onSavePoint} onClose={onClose} hasPointDetails={hasPointDetails} />
    </View>
  </View>;
}

/** Context actions only; detailed forecast analysis stays in the existing full-screen view. */
export function ForecastPointActions({ location, profileLabel, currentLabel, retrievedAt, stale, onWeatherGraphs, onHotspotDetail, onSavePoint, onClose, hasPointDetails }: {
  location: SevenDayLocation; profileLabel?: string; currentLabel?: string; retrievedAt?: string | null; stale?: boolean;
  onWeatherGraphs: () => void; onHotspotDetail?: () => void; onSavePoint?: () => void; onClose: () => void; hasPointDetails: boolean;
}) {
  const [open, setOpen] = useState(false), heading = useRef<Text>(null);
  const choose = (action: () => void) => { setOpen(false); action(); };
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Dejanja točke" accessibilityState={{ expanded: open }}
      accessibilityHint="Pogoji točke, vremenski grafi in dejanja rastišča." onPress={() => setOpen(true)} style={styles.close}>
      <Ionicons name="ellipsis-horizontal" size={23} color={colors.primary} /></Pressable>
    <Modal visible={open} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}
      onShow={() => { const handle = heading.current && findNodeHandle(heading.current); if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle); }}>
      {open ? <SafeAreaProvider><SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.menuScreen}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Zapri dejanja točke" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text ref={heading} accessibilityRole="header" style={styles.title}>Dejanja točke</Text>
          <Text style={styles.name}>{location.name}</Text>
          {profileLabel ? <Text style={styles.secondary}>{profileLabel}</Text> : null}
          {currentLabel ? <Text style={styles.context}>{currentLabel}</Text> : null}
          <Text style={styles.secondary}>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</Text>
          <Pressable accessibilityRole="button" onPress={() => choose(onWeatherGraphs)} style={styles.entry}><Text style={styles.action}>Vremenski grafi</Text></Pressable>
          {onHotspotDetail ? <Pressable accessibilityRole="button" onPress={() => choose(onHotspotDetail)} style={styles.entry}><Text style={styles.action}>Odpri rastišče</Text></Pressable> : null}
          {onSavePoint ? <Pressable accessibilityRole="button" onPress={() => choose(onSavePoint)} style={styles.entry}><Text style={styles.action}>Shrani rastišče</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={() => choose(onClose)} style={styles.entry}><Text style={styles.action}>{hasPointDetails ? 'Pogoji in dejanja točke' : 'Nazaj na zemljevid'}</Text></Pressable>
          {retrievedAt ? <Text style={styles.secondary}>Open-Meteo · pridobljeno {slDateTime(retrievedAt)}{stale ? ' · starejši podatki' : ''}</Text> : stale ? <Text style={styles.secondary}>Starejša predpomnjena napoved</Text> : null}
          <Text style={styles.secondary}>Modelna primernost pogojev, ne verjetnost najdbe.</Text>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.entry}><Text style={styles.action}>Zapri dejanja</Text></Pressable>
        </ScrollView></View>
      </SafeAreaView></SafeAreaProvider> : null}
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  entry: { minHeight: 48, minWidth: 124, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, flexShrink: 1 },
  action: { fontSize: 14, fontWeight: '600', color: colors.primary, flexShrink: 1 }, pressed: { backgroundColor: colors.surfaceSoft },
  iconEntry: { width: 48, paddingHorizontal: 0, justifyContent: 'center', flexShrink: 0 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, overflow: 'hidden' },
  scroll: { flexShrink: 1, minHeight: 0 }, content: { padding: spacing.sm, gap: spacing.xs },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }, grow: { flex: 1, minWidth: 0 },
  close: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  title: { fontSize: 17, fontWeight: '700', color: colors.primary, flexShrink: 1 }, name: { fontSize: 15, fontWeight: '600', color: colors.text },
  secondary: { fontSize: 13, color: colors.muted, flexShrink: 1 }, loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detail: { gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  context: { fontSize: 14, color: colors.text }, footer: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  primaryAction: { flex: 1, minWidth: 0 }, menuScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: colors.overlay },
  menu: { width: '100%', maxWidth: 360, maxHeight: '100%', flexShrink: 1, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  days: { gap: spacing.xs, paddingVertical: spacing.xs }, day: { minHeight: 48, width: 104, padding: spacing.sm, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }, selected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surfaceSoft },
  date: { fontSize: 14, color: colors.text }, score: { fontSize: 17, fontWeight: '700', color: colors.primary },
});
