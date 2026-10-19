import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GeoJSONSource, Layer, type FillLayerSpecification, type LineLayerSpecification } from '@maplibre/maplibre-react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { localDateFor } from '../domain/heatmap/assessment';
import { SevenDayConditionsModal, type SevenDayLocation } from '../components/SevenDayConditionsView';
import { colors, radii, spacing } from '../theme';
import { KOROSKA_SHADOW_ENABLED, validateShadowArtifact, shadowGeometry, shadowPaint, shadowCellResult,
  shadowDateLabel, shadowIsStale, pointForecastDate, type ShadowArtifact } from './koroskaShadowData';

export interface ShadowViewport { center: [number, number]; zoom: number; bounds?: [number, number, number, number] }
const noSnapshot = () => {};
/** Isolated local preview state: never writes global profile/day, production source data or weather caches. */
export function useKoroskaShadow({ available, initialProfile, database, fillPaint, borderPaint, selectedPaint, onShowRegion, onConsumeTap }: {
  available: boolean; initialProfile: MushroomWeatherProfileId; database: SQLiteDatabase;
  fillPaint: FillLayerSpecification['paint']; borderPaint: LineLayerSpecification['paint']; selectedPaint: LineLayerSpecification['paint'];
  onShowRegion: () => void; onConsumeTap: () => void;
}) {
  const [requested, setRequested] = useState(false), [artifact, setArtifact] = useState<ShadowArtifact>(), [error, setError] = useState<string>();
  const [profile, setProfile] = useState(initialProfile), [day, setDay] = useState(0);
  const [selection, setSelection] = useState<{ id: string; point: [number, number] }>(), [more, setMore] = useState(false);
  const [pointOpen, setPointOpen] = useState(false), [pointDate, setPointDate] = useState<string>(), [pointProfile, setPointProfile] = useState(initialProfile);
  const viewport = useRef<ShadowViewport | undefined>(undefined), state = useRef({ pointOpen, selection });
  state.current = { pointOpen, selection };
  const active = KOROSKA_SHADOW_ENABLED && available && requested, { fontScale } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => { if (!available) { setRequested(false); setPointOpen(false); } }, [available]);
  useEffect(() => {
    if (!active || artifact || error) return;
    try { setArtifact(validateShadowArtifact(require('../data/koroskaShadow/snapshot.json'))); }
    catch { setError('Raziskovalni posnetek ni na voljo ali ni veljaven. Produkcijska heatmapa ni spremenjena.'); }
  }, [active, artifact, error]);
  const geometry = useMemo(() => artifact ? shadowGeometry(artifact) : undefined, [artifact]);
  const profileIndex = artifact?.profiles.indexOf(profile) ?? 0;
  const paint = useMemo(() => shadowPaint(fillPaint, profileIndex, day), [fillPaint, profileIndex, day]);
  const result = artifact && selection ? shadowCellResult(artifact, selection.id, profileIndex, day) : undefined;
  const exit = useCallback(() => { setRequested(false); setPointOpen(false); }, []);
  const clearSelection = useCallback(() => { setSelection(undefined); setMore(false); }, []);
  const back = useCallback(() => {
    if (state.current.pointOpen) setPointOpen(false);
    else if (state.current.selection) { setSelection(undefined); setMore(false); }
    else setRequested(false);
    return true;
  }, []);
  const rememberViewport = useCallback((v: ShadowViewport) => { viewport.current = v; }, []);
  const consumeViewport = useCallback(() => { const v = viewport.current; viewport.current = undefined; return v; }, []);
  const enter = () => { if (KOROSKA_SHADOW_ENABLED && available) { setProfile(initialProfile); setRequested(true); } };
  const pointLocation: SevenDayLocation | undefined = selection ? { longitude: selection.point[0], latitude: selection.point[1],
    name: 'Izbrana točka · točkovna napoved', source: 'map-point' } : undefined;
  const openPoint = () => {
    if (!selection || !artifact) return;
    setPointDate(pointForecastDate(artifact.dates[day], localDateFor())); setPointProfile(profile); setPointOpen(true);
  };
  const button = (label: string, onPress: () => void, selected = false, accessibilityLabel = label, expanded?: boolean) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={expanded === undefined ? { selected } : { expanded }} onPress={onPress} style={[styles.button, selected && styles.active]}><Text style={[styles.buttonText, selected && styles.activeText]}>{label}</Text></Pressable>;
  const entry = KOROSKA_SHADOW_ENABLED && available ? <Pressable accessibilityRole="button" accessibilityLabel="Odpri razvojni predogled Koroška, sedem dni"
    onPress={enter} style={styles.entry}><Text style={styles.buttonText}>Koroška · 7-dnevni test →</Text></Pressable> : null;
  const layer = active && artifact && geometry ? <GeoJSONSource id="koroska-shadow-source" data={geometry} onPress={event => {
    event.stopPropagation(); onConsumeTap();
    const id = event.nativeEvent.features[0]?.properties?.id, point = event.nativeEvent.lngLat;
    if (typeof id === 'string' && artifact.cells.some(c => c.id === id) && point?.length === 2 && point.every(Number.isFinite)
      && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) {
      setSelection({ id, point: [point[0], point[1]] }); setMore(false);
    }
  }}>
    <Layer id="koroska-shadow-fill" type="fill" afterId="mushroom-heatmap-selected" paint={paint} />
    <Layer id="koroska-shadow-border" type="line" afterId="koroska-shadow-fill" paint={borderPaint} />
    <Layer id="koroska-shadow-selection" type="line" afterId="koroska-shadow-border" paint={selectedPaint} filter={['==', ['get', 'id'], selection?.id ?? '']} />
  </GeoJSONSource> : null;
  const overlay = active ? <View pointerEvents="box-none" style={StyleSheet.absoluteFill}
    onLayout={event => { const height = event.nativeEvent.layout.height; setViewportHeight(previous => Math.abs(height - previous) > 1 ? height : previous); }}>
    <View style={[styles.top, { maxHeight: Math.max(96, viewportHeight * .4) }]}>
      <View style={[styles.row, styles.topContent]}><Text accessibilityRole="header" style={styles.heading}>RAZVOJNI PREDOGLED</Text>{button('Območje', onShowRegion, false, 'Prikaži Koroško')}{button('Izhod', exit, false, 'Izhod iz razvojnega predogleda')}</View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.topContent} nestedScrollEnabled>
        <Text style={styles.copy}>Koroška · regionalna napoved · samo 696 celic</Text>
        <Text accessibilityLiveRegion="polite" style={styles.warning}>Raziskovalni posnetek — ni aktualna napoved</Text>
        {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : !artifact ? <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={styles.copy}>Nalagam lokalni posnetek …</Text></View> : <>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.strip}>
            {artifact.dates.map((date, i) => button(shadowDateLabel(date), () => setDay(i), day === i))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.strip}>
            {artifact.profiles.map(id => button(MUSHROOM_WEATHER_PROFILES[id].label, () => setProfile(id), profile === id))}
          </ScrollView>
        </>}
      </ScrollView>
    </View>
    {result && artifact ? <View style={[styles.bottom, { maxHeight: Math.max(96, viewportHeight * (fontScale > 1.4 ? .32 : .28)) }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.topContent} nestedScrollEnabled>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.heading}>{shadowDateLabel(result.date)} · {MUSHROOM_WEATHER_PROFILES[result.profile].label}</Text>
        <Text style={styles.score}>Regionalna ocena: {result.score == null ? 'Ocena ni na voljo' : `${result.score}/100 · ${result.label}`}</Text>
        <Text style={styles.copy}>{result.cell.id} · {result.habitat === 'unknown' ? 'Habitat ni potrjen' : result.habitat === 'outside-model' ? 'Zunaj habitatnega modela' : result.vector.score == null ? result.vector.missing.join(' · ') || 'Manjkajo veljavni vremenski vhodi' : '1 km habitat; skupni vremenski vzorec, ne meritev v gozdu.'}</Text>
        {button(more ? 'Manj' : 'Viri', () => setMore(v => !v), false, 'Viri in omejitve regionalnega posnetka', more)}
        {more ? <>
          <Text selectable style={styles.copy}>{artifact.contract} · {artifact.captureId}</Text>
          <Text selectable style={styles.copy}>Posnetek: {artifact.snapshotId}</Text>
          <Text style={styles.copy}>Vzorec: {result.weather.id} · pridobljeno {artifact.capturedAt}{shadowIsStale(artifact) ? ' · potekla veljavnost' : ' · zamrznjen raziskovalni zajem'}; modelski zagon ni preverjen.</Text>
          <Text style={styles.copy}>Regionalna ocena ni napoved za točno točko. Točkovna napoved uporablja kliknjene koordinate in aktualne vire; njen datum je neodvisen.</Text>
          <Text style={styles.copy}>Ocena pomeni modelno primernost pogojev, ne prisotnosti gob ali količine pridelka. Majhna sprememba blizu praga lahko spremeni barvno kategorijo.</Text>
          {artifact.attribution.map(text => <Text key={text} style={styles.copy}>{text}</Text>)}
        </> : null}
      </ScrollView>
      <View style={[styles.row, styles.topContent, { flexWrap: 'nowrap' }]}>{button('Točkovna napoved', openPoint, false, 'Odpri sedemdnevno napoved za kliknjene koordinate')}{button('×', clearSelection, false, 'Zapri izbrano regionalno celico')}</View>
    </View> : null}
  </View> : null;
  const modal = active && pointOpen && pointLocation ? <SevenDayConditionsModal visible location={pointLocation} database={database}
    profileId={pointProfile} onProfileChange={setPointProfile} selectedDate={pointDate} onSelectDate={(_index, date) => setPointDate(date)}
    onSnapshot={noSnapshot} onClose={() => setPointOpen(false)} /> : null;
  return { active, entry, layer, overlay, modal, exit, back, clearSelection, rememberViewport, consumeViewport };
}
const styles = StyleSheet.create({
  entry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.sm },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.warning },
  bottom: { position: 'absolute', bottom: spacing.lg, left: spacing.sm, right: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  scroll: { flexShrink: 1 }, topContent: { padding: spacing.sm, gap: 6 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', flexShrink: 0 }, strip: { gap: spacing.sm },
  button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surfaceSoft, flexShrink: 1 },
  active: { backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.text }, buttonText: { color: colors.primary, fontSize: 14, fontWeight: '700', flexShrink: 1 }, activeText: { color: colors.white },
  heading: { color: colors.primary, fontSize: 15, fontWeight: '800', flexShrink: 1 }, copy: { color: colors.text, fontSize: 13, flexShrink: 1 },
  warning: { color: colors.warning, fontSize: 13, fontWeight: '700' }, score: { color: colors.text, fontSize: 17, fontWeight: '800' },
});
