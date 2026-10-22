import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GeoJSONSource, Layer, type FillLayerSpecification, type LineLayerSpecification } from '@maplibre/maplibre-react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { localDateFor } from '../domain/heatmap/assessment';
import { SevenDayConditionsModal, type SevenDayLocation } from '../components/SevenDayConditionsView';
import { colors, radii, spacing } from '../theme';
import { useSelectedStrip } from '../components/useSelectedStrip';
import type { ResearchForecastOrigin } from '../components/forecastSourceContext';
import { shadowGeometryBounds, shadowRegionRequest, type ShadowFrame, type ShadowRegionRequest } from './shadowLayout';
import { KOROSKA_SHADOW_ENABLED, validateShadowArtifact, shadowGeometry, shadowPaint, shadowCellResult,
  shadowDateLabel, shadowIsStale, pointForecastDate, type ShadowArtifact } from './koroskaShadowData';

export interface ShadowViewport { center: [number, number]; zoom: number; bounds?: [number, number, number, number] }
const noSnapshot = () => {};
/** Isolated local preview state: never writes global profile/day, production source data or weather caches. */
export function useKoroskaShadow({ available, initialProfile, database, fillPaint, borderPaint, selectedPaint, onShowRegion, onConsumeTap }: {
  available: boolean; initialProfile: MushroomWeatherProfileId; database: SQLiteDatabase;
  fillPaint: FillLayerSpecification['paint']; borderPaint: LineLayerSpecification['paint']; selectedPaint: LineLayerSpecification['paint'];
  onShowRegion: (request: ShadowRegionRequest) => void; onConsumeTap: () => void;
}) {
  const [requested, setRequested] = useState(false), [artifact, setArtifact] = useState<ShadowArtifact>(), [error, setError] = useState<string>();
  const [profile, setProfile] = useState(initialProfile), [day, setDay] = useState(0);
  const [selection, setSelection] = useState<{ id: string; point: [number, number] }>(), [more, setMore] = useState(false);
  const [controls, setControls] = useState(false), [regionMessage, setRegionMessage] = useState<string>();
  const [pointOpen, setPointOpen] = useState(false), [pointDate, setPointDate] = useState<string>(), [pointProfile, setPointProfile] = useState(initialProfile);
  const [researchOrigin, setResearchOrigin] = useState<ResearchForecastOrigin>();
  const viewport = useRef<ShadowViewport | undefined>(undefined), state = useRef({ pointOpen, selection, more, controls });
  const frames = useRef<{ viewport: { width: number; height: number }; top?: ShadowFrame; bottom?: ShadowFrame }>({ viewport: { width: 0, height: 0 } });
  state.current = { pointOpen, selection, more, controls };
  const active = KOROSKA_SHADOW_ENABLED && available && requested;
  const reset = useCallback(() => {
    setSelection(undefined); setMore(false); setControls(false); setPointOpen(false); setPointDate(undefined); setResearchOrigin(undefined); setRegionMessage(undefined);
    frames.current.top = undefined; frames.current.bottom = undefined;
  }, []);
  useEffect(() => { if (!available) { setRequested(false); reset(); } }, [available, reset]);
  useEffect(() => {
    if (!active || artifact || error) return;
    try { setArtifact(validateShadowArtifact(require('../data/koroskaShadow/snapshot.json'))); }
    catch { setError('Raziskovalni posnetek ni na voljo ali ni veljaven. Produkcijska heatmapa ni spremenjena.'); }
  }, [active, artifact, error]);
  const geometry = useMemo(() => artifact ? shadowGeometry(artifact) : undefined, [artifact]);
  const bounds = useMemo(() => artifact ? shadowGeometryBounds(artifact) : undefined, [artifact]);
  const profileIndex = artifact?.profiles.indexOf(profile) ?? 0;
  const paint = useMemo(() => shadowPaint(fillPaint, profileIndex, day), [fillPaint, profileIndex, day]);
  const result = artifact && selection ? shadowCellResult(artifact, selection.id, profileIndex, day) : undefined;
  const exit = useCallback(() => { setRequested(false); reset(); }, [reset]);
  const clearSelection = useCallback(() => { setSelection(undefined); setMore(false); frames.current.bottom = undefined; }, []);
  const back = useCallback(() => {
    if (state.current.pointOpen) setPointOpen(false);
    else if (state.current.controls) setControls(false);
    else if (state.current.more) setMore(false);
    else if (state.current.selection) clearSelection();
    else exit();
    return true;
  }, [clearSelection, exit]);
  const rememberViewport = useCallback((v: ShadowViewport) => { viewport.current = v; }, []);
  const consumeViewport = useCallback(() => { const v = viewport.current; viewport.current = undefined; return v; }, []);
  const enter = () => { if (KOROSKA_SHADOW_ENABLED && available) { reset(); setDay(0); setProfile(initialProfile); setRequested(true); } };
  const dates = useSelectedStrip(artifact?.dates[day], `${artifact?.snapshotId ?? ''}:${controls}`);
  const profiles = useSelectedStrip(profile, `${artifact?.snapshotId ?? ''}:${controls}`);
  const showRegion = () => {
    const f = frames.current, request = bounds && shadowRegionRequest(bounds, f.viewport, f.top, selection ? f.bottom : undefined, spacing.sm);
    if (request && (!selection || f.bottom)) { setRegionMessage(undefined); onShowRegion(request); }
    else setRegionMessage('Za prikaz območja počakaj na postavitev ali zapri izbrano celico.');
  };
  const pointLocation: SevenDayLocation | undefined = selection ? { longitude: selection.point[0], latitude: selection.point[1],
    name: 'Izbrana točka · točkovna napoved', source: 'map-point' } : undefined;
  const openPoint = () => {
    if (!selection || !artifact || !result) return;
    setResearchOrigin({ date: artifact.dates[day], cellId: selection.id, profileId: profile, habitat: result.habitat, snapshotId: artifact.snapshotId, contract: artifact.contract });
    setControls(false); setMore(false);
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
      setSelection({ id, point: [point[0], point[1]] }); setMore(false); setControls(false); setRegionMessage(undefined); frames.current.bottom = undefined;
    }
  }}>
    <Layer id="koroska-shadow-fill" type="fill" afterId="mushroom-heatmap-selected" paint={paint} />
    <Layer id="koroska-shadow-border" type="line" afterId="koroska-shadow-fill" paint={borderPaint} />
    <Layer id="koroska-shadow-selection" type="line" afterId="koroska-shadow-border" paint={selectedPaint} filter={['==', ['get', 'id'], selection?.id ?? '']} />
  </GeoJSONSource> : null;
  const summary = artifact ? `${shadowDateLabel(artifact.dates[day])} · ${MUSHROOM_WEATHER_PROFILES[profile].label}` : 'Nalagam posnetek';
  const overlay = active ? <View pointerEvents="box-none" style={StyleSheet.absoluteFill}
    onLayout={event => { frames.current.viewport = event.nativeEvent.layout; }}>
    <View style={[styles.top, styles.topContent]} onLayout={event => { frames.current.top = event.nativeEvent.layout; }}>
      <Text accessibilityRole="header" style={styles.heading}>RAZVOJNI PREDOGLED · Koroška</Text>
      <Text style={styles.warning}>Raziskovalni posnetek — ni aktualna napoved</Text>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Izberi raziskovalni datum in vrsto" accessibilityState={{ expanded: controls }} onPress={() => { setMore(false); setControls(true); }} style={[styles.button, styles.grow]}>
          <Text accessibilityLiveRegion="polite" style={styles.buttonText}>{summary} ▾</Text></Pressable>
        {button('Območje', showRegion, false, 'Prikaži Koroško')}{button('Izhod', exit, false, 'Izhod iz razvojnega predogleda')}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : !artifact ? <ActivityIndicator color={colors.primary} /> : null}
      {regionMessage ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{regionMessage}</Text> : null}
    </View>
    {result && artifact ? <View style={[styles.bottom, styles.topContent]} onLayout={event => { frames.current.bottom = event.nativeEvent.layout; }}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.score}>Regionalna ocena: {result.score == null ? 'Ocena ni na voljo' : `${result.score}/100 · ${result.label}`}</Text>
      <Text style={styles.copy}>{result.habitat === 'unknown' ? 'Raziskovalni habitat: ni potrjen' : result.habitat === 'outside-model' ? 'Raziskovalni habitat: zunaj modela' : result.vector.score == null ? result.vector.missing.join(' · ') || 'Manjkajo veljavni vremenski vhodi' : 'Raziskovalni habitat: potencialno primeren'}</Text>
      <View style={styles.toolbar}>{button('Točkovna napoved', openPoint, false, 'Odpri sedemdnevno napoved za kliknjene koordinate')}{button('Viri', () => { setControls(false); setMore(true); }, false, 'Viri in omejitve regionalnega posnetka', more)}{button('×', clearSelection, false, 'Zapri izbrano regionalno celico')}</View>
    </View> : null}
    {controls && artifact ? sheet('Izberi datum in vrsto', () => setControls(false), <>
      <Text style={styles.copy}>{summary}</Text><Text style={styles.warning}>Raziskovalni posnetek — ni aktualna napoved</Text>
      <ScrollView key={`dates:${dates.stripKey}`} horizontal {...dates.scrollProps} contentContainerStyle={styles.strip}>
        {artifact.dates.map((date, i) => <View key={date} onLayout={dates.itemLayout(date)}>{button(shadowDateLabel(date), () => setDay(i), day === i)}</View>)}
      </ScrollView>
      <ScrollView key={`profiles:${profiles.stripKey}`} horizontal {...profiles.scrollProps} contentContainerStyle={styles.strip}>
        {artifact.profiles.map(id => <View key={id} onLayout={profiles.itemLayout(id)}>{button(MUSHROOM_WEATHER_PROFILES[id].label, () => setProfile(id), profile === id)}</View>)}
      </ScrollView>
    </>) : null}
    {more && result && artifact ? sheet('Viri raziskovalne celice', () => setMore(false), <>
      <Text style={styles.heading}>{summary} · {result.cell.id}</Text>
      <Text selectable style={styles.copy}>{artifact.contract} · {artifact.captureId}</Text><Text selectable style={styles.copy}>Posnetek: {artifact.snapshotId}</Text>
      <Text style={styles.copy}>Vzorec: {result.weather.id} · pridobljeno {artifact.capturedAt}{shadowIsStale(artifact) ? ' · potekla veljavnost' : ' · zamrznjen raziskovalni zajem'}; modelski zagon ni preverjen.</Text>
      <Text style={styles.copy}>Zamrznjen habitat raziskovalne celice ni ista prostorska presoja kot habitat iz produkcijskega regionalnega indeksa v točkovni napovedi. Celice, meje, profil ali podatkovni kontekst se lahko razlikujejo; nobena presoja ne potrjuje rastja na točni koordinati.</Text>
      <Text style={styles.copy}>Točkovna napoved uporablja kliknjene koordinate in svoj aktualni vremenski posnetek. Raziskovalni datum zunaj aktualnega okna se ne prenese kot današnji datum.</Text>
      <Text style={styles.copy}>1 km habitat; skupni vremenski vzorec, ne meritev v gozdu. Ocena pomeni modelno primernost pogojev, ne prisotnosti gob. Majhna sprememba blizu praga lahko spremeni barvno kategorijo.</Text>
      {artifact.attribution.map(text => <Text key={text} style={styles.copy}>{text}</Text>)}
    </>) : null}
  </View> : null;
  const modal = active && pointOpen && pointLocation ? <SevenDayConditionsModal visible location={pointLocation} database={database}
    profileId={pointProfile} onProfileChange={setPointProfile} selectedDate={pointDate} onSelectDate={(_index, date) => setPointDate(date)}
    researchOrigin={researchOrigin} onSnapshot={noSnapshot} onClose={() => setPointOpen(false)} /> : null;
  return { active, entry, layer, overlay, modal, exit, back, clearSelection, rememberViewport, consumeViewport };
}
/** Unmounted when closed: technical scroll offset cannot survive collapse or hide the fixed map score. */
function sheet(title: string, onClose: () => void, children: React.ReactNode) {
  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.sheetBackdrop}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={[styles.toolbar, styles.topContent]}><Text accessibilityRole="header" style={[styles.heading, styles.grow]}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Zapri ${title.toLowerCase()}`} style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Nazaj</Text></Pressable></View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.topContent}>{children}</ScrollView>
      </View>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  entry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.sm },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.warning },
  bottom: { position: 'absolute', bottom: spacing.lg, left: spacing.sm, right: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  scroll: { flexShrink: 1 }, topContent: { padding: spacing.sm, gap: spacing.xs }, strip: { gap: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, grow: { flex: 1, minWidth: 0 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', padding: spacing.sm, backgroundColor: colors.overlay },
  sheet: { maxHeight: '100%', backgroundColor: colors.surface, borderRadius: radii.md, flexShrink: 1 },
  button: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, backgroundColor: colors.surfaceSoft, flexShrink: 1 },
  active: { backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.text }, buttonText: { color: colors.primary, fontSize: 14, fontWeight: '700', flexShrink: 1 }, activeText: { color: colors.white },
  heading: { color: colors.primary, fontSize: 13, fontWeight: '800', flexShrink: 1 }, copy: { color: colors.text, fontSize: 13, flexShrink: 1 },
  warning: { color: colors.warning, fontSize: 13, fontWeight: '700' }, score: { color: colors.text, fontSize: 16, fontWeight: '800' },
});
