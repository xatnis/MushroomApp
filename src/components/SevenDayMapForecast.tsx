import { useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { useSevenDayConditions } from '../services/useSevenDayConditions';
import type { SevenDayLocation } from './SevenDayConditionsView';
import { forecastComparison, forecastDateLabel, forecastFactorInsights } from './mapForecastPresentation';
import { slDateTime } from '../domain/format';
import { colors, radii, spacing } from '../theme';

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
  const week = useSevenDayConditions(database, location, profileId, undefined, ignoreSnapshot);
  const dateIndex = week.results?.findIndex(day => day.targetLocalDate === selectedDate) ?? -1;
  const selectedDay = dateIndex >= 0 ? dateIndex : Number.isInteger(initialDay) && initialDay >= 0 && initialDay <= 6 ? initialDay : 0;
  const selected = week.results?.[selectedDay], current = week.results?.[mapDay === 'tomorrow' ? 1 : 0];
  const mapDayLabel = mapDay === 'tomorrow' ? 'Jutri' : 'Danes';
  const factors = selected ? forecastFactorInsights(selected) : [];
  return <View style={[styles.panel, { maxHeight }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}><View style={styles.grow}>
        <Text ref={heading} accessibilityRole="header" onLayout={() => {
          const handle = heading.current && findNodeHandle(heading.current);
          if (!announced.current && handle != null) { announced.current = true; AccessibilityInfo.setAccessibilityFocus(handle); }
        }} style={styles.title}>Napoved pogojev · 7 dni</Text>
        <Text style={styles.name}>{location.name}</Text>
      </View><Close onClose={onClose} /></View>
      <Text style={styles.secondary}>Napoved: {MUSHROOM_WEATHER_PROFILES[profileId].label} · {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</Text>
      <Text style={styles.secondary}>{conditionsEnabled ? `Zemljevid: ${mapDayLabel} · ${MUSHROOM_WEATHER_PROFILES[mapProfileId].label}` : 'Zemljevid: Rastišča'}</Text>
      {current && current !== selected ? <Text style={styles.context}>Pogoji te točke · {mapDayLabel}: {current.score == null ? 'Ocena ni na voljo' : `${current.score}/100 · ${current.label}`}</Text> : null}
      {week.loading ? <View style={styles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} />
        <Text style={[styles.secondary, styles.grow]}>Preračunavam sedemdnevne razmere ...</Text></View> : null}
      {week.error ? <Text style={styles.secondary} accessibilityLiveRegion="polite">{week.error}</Text> : null}
      {week.snapshot?.stale ? <Text style={styles.secondary}>Starejša predpomnjena napoved</Text> : null}
      {week.results ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} nestedScrollEnabled>
        {week.results.map((day, index) => {
          const date = new Intl.DateTimeFormat('sl-SI', { timeZone: WEATHER_TIMEZONE, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(day.targetLocalDate + 'T12:00:00Z'));
          return <Pressable key={day.targetLocalDate} accessibilityRole="button" accessibilityState={{ selected: selectedDay === index }}
            accessibilityLabel={`${date}, ${day.score == null ? 'ocena ni na voljo' : `${day.score} od 100, ${day.label}`}${day.status === 'stale' ? ', starejši podatki' : ''}`}
            accessibilityHint="Pokaže oceno in dejavnike tega dne za isto točko. Ne spremeni dneva regionalnega zemljevida."
            onPress={() => onSelectDate(index, day.targetLocalDate)} style={[styles.day, selectedDay === index && styles.selected]}>
            <Text style={styles.date}>{date}</Text><Text style={styles.score}>{day.score == null ? 'Ocena ni na voljo' : `${day.score}/100`}</Text>
          </Pressable>;
        })}
      </ScrollView> : null}
      {selected ? <View style={styles.detail} accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" style={styles.name}>Napoved za točko: {forecastDateLabel(selected.targetLocalDate)}</Text>
        <Text style={styles.score}>{selected.score == null ? 'Ocena ni na voljo' : `${selected.score}/100 · ${selected.label}`}</Text>
        <Text style={styles.context}>{forecastComparison(selected, week.results?.[0], week.snapshot)}</Text>
        {selected.score == null ? <Text style={styles.secondary}>{selected.missing[0] ?? (selected.status === 'error' ? 'Vremenski podatki niso dosegljivi.' : 'Manjkajo potrebni modelni vhodi.')}</Text> : null}
        {factors.map(factor => <Text key={factor.key} style={styles.secondary}>{factor.label}: {factor.status} · {factor.contribution}</Text>)}
        {!factors.length && selected.score != null ? <Text style={styles.secondary}>Podrobni prispevki niso na voljo.</Text> : null}
      </View> : null}
      {week.error || week.results?.some(day => day.status === 'error') ? <Pressable accessibilityRole="button" onPress={week.retry} style={styles.entry}>
        <Text style={styles.action}>Poskusi znova</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Vseh 7 dni za ${location.name}`} accessibilityHint="Odpre podrobno napoved na izbranem datumu."
        onPress={() => onFull(selectedDay, selected?.targetLocalDate)} style={styles.entry}>
        <Text style={styles.action}>Podrobna napoved →</Text></Pressable>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onWeatherGraphs} style={styles.entry}><Text style={styles.action}>Vremenski grafi</Text></Pressable>
        {onHotspotDetail ? <Pressable accessibilityRole="button" onPress={onHotspotDetail} style={styles.entry}><Text style={styles.action}>Odpri rastišče</Text></Pressable> : null}
        {onSavePoint ? <Pressable accessibilityRole="button" onPress={onSavePoint} style={styles.entry}><Text style={styles.action}>Shrani rastišče</Text></Pressable> : null}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.entry}><Text style={styles.action}>{hasPointDetails ? 'Pogoji in dejanja točke' : 'Nazaj na zemljevid'}</Text></Pressable>
      </View>
      <Text style={styles.secondary}>Napoved velja za točko; regionalni zemljevid ostaja {conditionsEnabled ? `v načinu ${mapDayLabel}` : 'v načinu Rastišča'}.</Text>
      {week.snapshot?.forecastRetrievedAt ? <Text style={styles.secondary}>Open-Meteo · pridobljeno {slDateTime(week.snapshot.forecastRetrievedAt)}{week.snapshot.stale ? ' · starejši podatki' : ''}</Text> : null}
      <Text style={styles.secondary}>Modelna primernost pogojev, ne verjetnost najdbe.</Text>
    </ScrollView>
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
  context: { fontSize: 14, color: colors.text }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  days: { gap: spacing.xs, paddingVertical: spacing.xs }, day: { minHeight: 64, width: 116, padding: spacing.sm, gap: spacing.xs,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }, selected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surfaceSoft },
  date: { fontSize: 14, color: colors.text }, score: { fontSize: 17, fontWeight: '700', color: colors.primary },
});
