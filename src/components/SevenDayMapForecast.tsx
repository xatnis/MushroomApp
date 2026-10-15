import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { useSevenDayConditions } from '../services/useSevenDayConditions';
import type { SevenDayLocation } from './SevenDayConditionsView';
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
export function SevenDayMapForecastPreview({ location, database, profileId, initialDay, maxHeight, onClose, onFull }: {
  location: SevenDayLocation; database: SQLiteDatabase; profileId: MushroomWeatherProfileId; initialDay: number;
  maxHeight: number; onClose: () => void; onFull: (day: number) => void;
}) {
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const heading = useRef<Text>(null), announced = useRef(false);
  const week = useSevenDayConditions(database, location, profileId, undefined, ignoreSnapshot);
  return <View style={[styles.panel, { maxHeight }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}><View style={styles.grow}>
        <Text ref={heading} accessibilityRole="header" onLayout={() => {
          const handle = heading.current && findNodeHandle(heading.current);
          if (!announced.current && handle != null) { announced.current = true; AccessibilityInfo.setAccessibilityFocus(handle); }
        }} style={styles.title}>Napoved pogojev · 7 dni</Text>
        <Text numberOfLines={2} style={styles.name}>{location.name}</Text>
      </View><Close onClose={onClose} /></View>
      <Text style={styles.secondary}>{MUSHROOM_WEATHER_PROFILES[profileId].label}</Text>
      {week.loading ? <View style={styles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} />
        <Text style={[styles.secondary, styles.grow]}>Preračunavam sedemdnevne razmere ...</Text></View> : null}
      {week.error ? <Text style={styles.secondary} accessibilityLiveRegion="polite">{week.error}</Text> : null}
      {week.snapshot?.stale ? <Text style={styles.secondary}>Starejša predpomnjena napoved</Text> : null}
      {week.results ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} nestedScrollEnabled>
        {week.results.map((day, index) => {
          const date = new Intl.DateTimeFormat('sl-SI', { timeZone: WEATHER_TIMEZONE, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(day.targetLocalDate + 'T12:00:00Z'));
          return <Pressable key={day.targetLocalDate} accessibilityRole="button" accessibilityState={{ selected: selectedDay === index }}
            accessibilityLabel={`${date}, ${day.score == null ? 'ocena ni na voljo' : `${day.score} od 100, ${day.label}`}${day.status === 'stale' ? ', starejši podatki' : ''}`}
            onPress={() => setSelectedDay(index)} style={[styles.day, selectedDay === index && styles.selected]}>
            <Text style={styles.date}>{date}</Text><Text style={styles.score}>{day.score == null ? 'Ocena ni na voljo' : `${day.score}/100`}</Text>
            {day.label ? <Text style={styles.secondary}>{day.label}</Text> : null}
          </Pressable>;
        })}
      </ScrollView> : null}
      {week.error || week.results?.some(day => day.status === 'error') ? <Pressable accessibilityRole="button" onPress={week.retry} style={styles.entry}>
        <Text style={styles.action}>Poskusi znova</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Vseh 7 dni za ${location.name}`} onPress={() => onFull(selectedDay)} style={styles.entry}>
        <Text style={styles.action}>Vseh 7 dni →</Text></Pressable>
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
  days: { gap: spacing.xs, paddingVertical: spacing.xs }, day: { minHeight: 80, width: 116, padding: spacing.sm, gap: spacing.xs,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }, selected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surfaceSoft },
  date: { fontSize: 14, color: colors.text }, score: { fontSize: 17, fontWeight: '700', color: colors.primary },
});
