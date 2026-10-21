import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { SEVEN_DAY_REQUIREMENTS } from '../domain/sevenDayConditions';
import { WEATHER_TIMEZONE, validWeatherDate } from '../domain/weatherSeries';
import { slDateTime, slNumber } from '../domain/format';
import { advancedFactors, advancedExplanation } from './conditionsAdvancedPresentation';
import { useSevenDayConditions } from '../services/useSevenDayConditions';
import { AppButton, Card, commonStyles } from './ui';
import { colors, radii, spacing } from '../theme';
import { PointHabitatContext } from './PointHabitatContext';

export interface SevenDayLocation { latitude: number; longitude: number; name: string; source?: 'conditions' | 'map-point' | 'hotspot' }
const dateLabel = (date: string) => validWeatherDate(date) ? new Intl.DateTimeFormat('sl-SI', { timeZone: WEATHER_TIMEZONE, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(date + 'T12:00:00Z')) : date;
const number = (value: number | undefined, unit: string, digits = 1) => value == null || !Number.isFinite(value) ? 'Ni podatka' : `${slNumber(value, digits)} ${unit}`;

export function SevenDayConditionsEntry({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Napoved pogojev za izbrano lokacijo, 7 dni" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.entry}>
    <Text style={styles.action}>Napoved pogojev · 7 dni →</Text>
  </Pressable>;
}
export function SevenDayConditionsModal({ visible, location, profileId, onProfileChange, summary, database, onSnapshot, onClose, initialDay = 0, selectedDate, onSelectDate }: {
  visible: boolean; location?: SevenDayLocation; profileId: MushroomWeatherProfileId; onProfileChange: (profile: MushroomWeatherProfileId) => void;
  summary?: MushroomWeatherSummary; database: SQLiteDatabase; onSnapshot: (summary: MushroomWeatherSummary) => void; onClose: () => void; initialDay?: number;
  selectedDate?: string; onSelectDate?: (index: number, date: string) => void;
}) {
  const heading = useRef<Text>(null);
  const valid = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
  return <Modal visible={visible} presentationStyle="fullScreen" animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}
    onShow={() => { const handle = heading.current && findNodeHandle(heading.current); if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle); }}>
    {visible ? <SafeAreaProvider><SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} accessibilityViewIsModal>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Nazaj iz napovedi pogojev" onPress={onClose} style={styles.back}><Text style={styles.action}>←</Text></Pressable>
        <View style={styles.headerCopy}><Text ref={heading} accessibilityRole="header" style={commonStyles.heading}>Napoved pogojev · 7 dni</Text><Text style={commonStyles.body}>{location?.name || 'Lokacija ni določena'}</Text></View></View>
      {valid ? <SevenDayContent key={`${location.latitude}:${location.longitude}`} location={location} database={database} profileId={profileId}
        onProfileChange={onProfileChange} summary={summary} onSnapshot={onSnapshot} initialDay={initialDay} selectedDate={selectedDate} onSelectDate={onSelectDate} /> : <Text style={commonStyles.body}>Za napoved najprej izberi lokacijo.</Text>}
    </SafeAreaView></SafeAreaProvider> : null}
  </Modal>;
}
export function SevenDayContent({ location, database, profileId, onProfileChange, summary, onSnapshot, initialDay = 0, selectedDate, onSelectDate }: {
  location: SevenDayLocation; database: SQLiteDatabase; profileId: MushroomWeatherProfileId; onProfileChange: (profile: MushroomWeatherProfileId) => void;
  summary?: MushroomWeatherSummary; onSnapshot: (summary: MushroomWeatherSummary) => void; initialDay?: number;
  selectedDate?: string; onSelectDate?: (index: number, date: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(Number.isInteger(initialDay) && initialDay >= 0 && initialDay <= 6 ? initialDay : 0);
  const week = useSevenDayConditions(database, location, profileId, summary, onSnapshot);
  const selected = week.results?.find(day => day.targetLocalDate === selectedDate) ?? week.results?.[selectedIndex], profile = MUSHROOM_WEATHER_PROFILES[profileId];
  const factors = selected?.componentsVerified ? advancedFactors(selected.canonical) : [];
  return <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {Object.values(MUSHROOM_WEATHER_PROFILES).map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: profileId === item.id }}
        onPress={() => onProfileChange(item.id)} style={[styles.chip, profileId === item.id && styles.active]}><Text style={[styles.action, profileId === item.id && styles.activeText]}>{item.label}</Text></Pressable>)}
    </ScrollView>
    {!week.results ? <PointHabitatContext latitude={location.latitude} longitude={location.longitude} profileId={profileId} /> : null}
    {week.loading ? <View accessibilityLiveRegion="polite" style={styles.pending}><ActivityIndicator color={colors.primary} /><Text style={commonStyles.body}>Preračunavam sedemdnevne razmere ...</Text></View>
      : week.error ? <><Text accessibilityLiveRegion="polite" style={commonStyles.body}>{week.error}</Text><AppButton title="Poskusi znova" onPress={week.retry} /></> : null}
    {week.results ? <>
      {week.snapshot?.stale ? <Text style={commonStyles.body}>Starejša predpomnjena napoved · {week.snapshot.forecastRetrievedAt ? slDateTime(week.snapshot.forecastRetrievedAt) : 'čas ni na voljo'}</Text> : null}
      {week.results.some(day => day.status === 'error') ? <><Text accessibilityLiveRegion="polite" style={commonStyles.body}>Del vremenskih podatkov ni dosegljiv. Ocene z manjkajočimi vhodi niso na voljo.</Text><AppButton title="Poskusi znova" onPress={week.retry} /></> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {week.results.map((day, index) => <Pressable key={day.targetLocalDate} accessibilityRole="button"
          accessibilityLabel={`${dateLabel(day.targetLocalDate)}, ${day.score == null ? 'ocena ni na voljo' : `${day.score} od 100, ${day.label}`}${day.status === 'stale' ? ', starejši podatki' : ''}`}
          accessibilityState={{ selected: selected === day }} onPress={() => { setSelectedIndex(index); onSelectDate?.(index, day.targetLocalDate); }} style={[styles.day, selected === day && styles.active]}>
          <Text style={[styles.dayLabel, selected === day && styles.activeText]}>{index === 0 ? 'Danes' : index === 1 ? 'Jutri' : new Intl.DateTimeFormat('sl-SI', { weekday: 'short', timeZone: WEATHER_TIMEZONE }).format(new Date(day.targetLocalDate + 'T12:00:00Z'))}</Text>
          <Text style={[styles.dayLabel, selected === day && styles.activeText]}>{dateLabel(day.targetLocalDate)}</Text>
          <Text style={[styles.dayScore, selected === day && styles.activeText]}>{day.score == null ? 'Ni ocene' : `${day.score}/100`}</Text>
          <Text style={[styles.dayLabel, selected === day && styles.activeText]}>{day.label ?? (day.status === 'error' ? 'Napaka pri podatkih' : 'Omejeni podatki')}</Text>
        </Pressable>)}
      </ScrollView>
      {selected ? <Card>
        <Text accessibilityRole="header" style={commonStyles.heading}>{dateLabel(selected.targetLocalDate)} · {profile.label}</Text>
        <Text style={styles.score}>{selected.score == null ? 'Ocena ni na voljo' : `Vremenski pogoji: ${selected.score}/100 · ${selected.label}`}</Text>
        <PointHabitatContext latitude={location.latitude} longitude={location.longitude} profileId={profileId} />
        {selected.score != null ? <Text style={commonStyles.body}>{advancedExplanation(selected.canonical)}</Text> : selected.missing.map(reason => <Text key={reason} style={commonStyles.body}>{reason}</Text>)}
        <Text style={commonStyles.muted}>{selected.componentsVerified ? 'Razpoložljivi prispevki modela; ne nadomeščajo manjkajoče ocene.' : 'Prispevkov iz neusklajenega snapshota ne prikazujemo kot potrjenih.'}</Text>
        {factors.map(factor => <View key={factor.key} accessible accessibilityLabel={`${factor.label}. Prispevek ${factor.contribution}. ${factor.status}`} style={styles.factor}>
          <Text style={commonStyles.body}>{factor.label} · {factor.contribution}</Text>
          {factor.ratio != null ? <View accessible={false} style={styles.track}><View style={[styles.fill, { width: `${factor.ratio * 100}%` }]} /></View> : null}
          <Text style={commonStyles.muted}>{factor.status}</Text>
        </View>)}
        <Text accessibilityRole="header" style={commonStyles.heading}>Vremenski kontekst</Text>
        <Text style={commonStyles.body}>Napoved ciljnega dne: {number(selected.targetWeather?.precipitationMm, 'mm')} · povprečje {number(selected.targetWeather?.temperatureMeanC, '°C')}</Text>
        <Text style={commonStyles.muted}>Ciljni dan je še napoved; njegove dnevne padavine niso del okna, ki se konča pred tem datumom.</Text>
        {SEVEN_DAY_REQUIREMENTS[profileId].rain.map(days => <Text key={days} style={commonStyles.body}>Padavine {days} dni pred datumom: {number(selected.inputs.historical?.[`rain${days}dMm`], 'mm')}</Text>)}
        <Text style={commonStyles.body}>Povprečna temperatura {SEVEN_DAY_REQUIREMENTS[profileId].temperature} dni: {number(selected.inputs.historical?.[`avgTemp${SEVEN_DAY_REQUIREMENTS[profileId].temperature}dC`], '°C')}</Text>
        <Text style={commonStyles.body}>Vlaga tal 0–7 cm: {number(selected.targetSoil?.soilMoisture0To7Cm, 'm³/m³', 3)}</Text>
        <Text style={commonStyles.body}>Vlaga tal 7–28 cm: {number(selected.targetSoil?.soilMoisture7To28Cm, 'm³/m³', 3)}</Text>
        <Text style={commonStyles.muted}>Modelirana talna vlaga: {selected.soilTime ?? 'Ni podatka'}. Prihodnji dnevi uporabljajo lastno jutranjo napoved.</Text>
        <Text style={commonStyles.body}>ET₀ 7 dni: {number(selected.inputs.historical?.evapotranspiration7dMm, 'mm')} · Padavine 7 dni: {number(selected.inputs.historical?.rain7dMm, 'mm')}</Text>
        {selected.warnings.map(warning => <Text key={warning} style={commonStyles.muted}>{warning}</Text>)}
      </Card> : null}
      <Text style={commonStyles.muted}>Open-Meteo · napoved pridobljena {week.snapshot?.forecastRetrievedAt ? slDateTime(week.snapshot.forecastRetrievedAt) : 'čas ni na voljo'}{week.snapshot?.stale ? ' · starejši predpomnjeni podatki' : ''}.</Text>
      <Text style={commonStyles.muted}>Pregled sestavljen {week.snapshot?.assembledAt ? slDateTime(week.snapshot.assembledAt) : 'čas ni na voljo'}. Izdajni čas modelnega zagona ni na voljo; čas pridobitve ni čas izdaje.</Text>
      <Text style={commonStyles.muted}>Napoved predstavlja primernost pogojev glede na vremenske modele, ne prisotnosti gob. Pretekli modelski/reanalizirani podatki niso lokalne meritve. Popolnost vhodov ni statistična gotovost. Padavine lahko vključujejo sneg.</Text>
    </> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm }, headerCopy: { flex: 1 },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  entry: { minHeight: 48, justifyContent: 'center' }, action: { fontSize: 16, fontWeight: '600', color: colors.primary },
  chips: { gap: spacing.sm }, chip: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.round, borderWidth: 1, borderColor: colors.border },
  day: { width: 148, minHeight: 48, padding: spacing.sm, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  active: { backgroundColor: colors.primary }, activeText: { color: colors.white }, dayLabel: { fontSize: 14, color: colors.text }, dayScore: { fontSize: 22, fontWeight: '700', color: colors.primary },
  score: { fontSize: 24, fontWeight: '700', color: colors.primary }, pending: { gap: spacing.sm }, factor: { gap: spacing.xs },
  track: { height: 6, borderRadius: radii.round, overflow: 'hidden', backgroundColor: colors.surfaceSoft }, fill: { height: '100%', backgroundColor: colors.primary },
});
