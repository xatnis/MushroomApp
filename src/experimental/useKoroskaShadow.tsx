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
import { useKoroskaLive } from './useKoroskaLive';
import { liveRegionalPaint, regionalPreviewResult, shadowWeatherGroups } from './koroskaLivePresentation';
import { shiftLocalDate } from '../services/weather';
import { KOROSKA_SHADOW_ENABLED, validateShadowArtifact, shadowGeometry, shadowPaint,
  shadowDateLabel, shadowIsStale, pointForecastDate, type ShadowArtifact } from './koroskaShadowData';

export interface ShadowViewport { center: [number, number]; zoom: number; bounds?: [number, number, number, number] }
const noSnapshot = () => {};
/** Isolated local preview state: never writes global profile/day, production source data or weather caches. */
export function useKoroskaShadow({ available, pogojiAvailable = false, initialProfile, database, fillPaint, borderPaint, selectedPaint, onShowRegion, onConsumeTap }: {
  available: boolean; initialProfile: MushroomWeatherProfileId; database: SQLiteDatabase;
  pogojiAvailable?: boolean;
  fillPaint: FillLayerSpecification['paint']; borderPaint: LineLayerSpecification['paint']; selectedPaint: LineLayerSpecification['paint'];
  onShowRegion: (request: ShadowRegionRequest) => void; onConsumeTap: () => void;
}) {
  const [requested, setRequested] = useState(false), [artifact, setArtifact] = useState<ShadowArtifact>(), [error, setError] = useState<string>();
  const [profile, setProfile] = useState(initialProfile), [day, setDay] = useState(0);
  const [selection, setSelection] = useState<{ id: string; point: [number, number] }>(), [more, setMore] = useState(false);
  const [controls, setControls] = useState(false), [regionMessage, setRegionMessage] = useState<string>();
  const [pointOpen, setPointOpen] = useState(false), [pointDate, setPointDate] = useState<string>(), [pointProfile, setPointProfile] = useState(initialProfile);
  const [researchOrigin, setResearchOrigin] = useState<ResearchForecastOrigin>();
  const [sourceMode, setSourceMode] = useState<'frozen' | 'live'>('frozen');
  // Presentation intent only: unified Pogoji always uses live data, never frozen fallback.
  const [unified, setUnified] = useState(false);
  const viewport = useRef<ShadowViewport | undefined>(undefined), state = useRef({ pointOpen, selection, more, controls });
  const frames = useRef<{ viewport: { width: number; height: number }; top?: ShadowFrame; bottom?: ShadowFrame }>({ viewport: { width: 0, height: 0 } });
  state.current = { pointOpen, selection, more, controls };
  const active = KOROSKA_SHADOW_ENABLED && available && requested && (!unified || pogojiAvailable);
  const live = useKoroskaLive(database, artifact, active && sourceMode === 'live');
  const windowDates = sourceMode === 'frozen' ? artifact?.dates ?? [] : live.snapshot?.dates ?? Array.from({ length: 7 }, (_, i) => shiftLocalDate(localDateFor(), i));
  const reset = useCallback(() => {
    setSelection(undefined); setMore(false); setControls(false); setPointOpen(false); setPointDate(undefined); setResearchOrigin(undefined); setRegionMessage(undefined);
    setSourceMode('frozen'); setUnified(false);
    frames.current.top = undefined; frames.current.bottom = undefined;
  }, []);
  useEffect(() => { if (!available || (unified && !pogojiAvailable)) { setRequested(false); reset(); } }, [available, pogojiAvailable, unified, reset]);
  useEffect(() => {
    if (!active || artifact || error) return;
    try { setArtifact(validateShadowArtifact(require('../data/koroskaShadow/snapshot.json'))); }
    catch { setError('Raziskovalni posnetek ni na voljo ali ni veljaven. Produkcijska heatmapa ni spremenjena.'); }
  }, [active, artifact, error]);
  const geometry = useMemo(() => artifact ? shadowGeometry(artifact) : undefined, [artifact]);
  const bounds = useMemo(() => artifact ? shadowGeometryBounds(artifact) : undefined, [artifact]);
  const weatherGroups = useMemo(() => artifact ? shadowWeatherGroups(artifact) : [], [artifact]);
  const profileIndex = artifact?.profiles.indexOf(profile) ?? 0;
  const paint = useMemo(() => sourceMode === 'frozen' ? shadowPaint(fillPaint, profileIndex, day)
    : liveRegionalPaint(fillPaint, weatherGroups, live.snapshot, profileIndex, day), [fillPaint, profileIndex, day, sourceMode, weatherGroups, live.snapshot]);
  const result = artifact && selection ? regionalPreviewResult(artifact, sourceMode, live.snapshot, selection.id, profileIndex, day, windowDates, live.message) : undefined;
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
  const enterPogoji = () => { if (KOROSKA_SHADOW_ENABLED && available && pogojiAvailable) {
    reset(); setUnified(true); setSourceMode('live'); setDay(0); setProfile(initialProfile); setRequested(true);
  } };
  const dates = useSelectedStrip(windowDates[day], `${sourceMode}:${windowDates[0] ?? ''}:${controls}`);
  const profiles = useSelectedStrip(profile, `${artifact?.snapshotId ?? ''}:${controls}`);
  const chooseSource = (next: 'frozen' | 'live') => {
    if (unified || next === sourceMode || !artifact) return;
    const nextDates = next === 'frozen' ? artifact.dates : live.knownDates ?? Array.from({ length: 7 }, (_, i) => shiftLocalDate(localDateFor(), i));
    setDay(Math.max(0, nextDates.indexOf(windowDates[day]))); setSourceMode(next);
  };
  const showRegion = () => {
    // Unified controls are ABOVE the map in its existing controls slot: no duplicated top inset.
    const f = frames.current, request = bounds && shadowRegionRequest(bounds, f.viewport, unified ? { y: 0, height: 0 } : f.top, selection ? f.bottom : undefined, spacing.sm);
    if (request && (!selection || f.bottom)) { setRegionMessage(undefined); onShowRegion(request); }
    else setRegionMessage('Za prikaz območja počakaj na postavitev ali zapri izbrano celico.');
  };
  const pointLocation: SevenDayLocation | undefined = selection ? { longitude: selection.point[0], latitude: selection.point[1],
    name: 'Izbrana točka · točkovna napoved', source: 'map-point' } : undefined;
  const openPoint = () => {
    if (!selection || !artifact || !result) return;
    setResearchOrigin({ date: windowDates[day], cellId: selection.id, profileId: profile, habitat: result.habitat,
      snapshotId: sourceMode === 'frozen' ? artifact.snapshotId : live.snapshot?.snapshotId ?? 'regional-live-not-published', contract: artifact.contract,
      ...(sourceMode === 'live' ? { mode: 'live' as const, retrievedAt: live.snapshot?.retrievedAt } : {}) });
    setControls(false); setMore(false);
    setPointDate(pointForecastDate(windowDates[day], localDateFor())); setPointProfile(profile); setPointOpen(true);
  };
  const button = (label: string, onPress: () => void, selected = false, accessibilityLabel = label, expanded?: boolean) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={expanded === undefined ? { selected } : { expanded }} onPress={onPress} style={[styles.button, selected && styles.active]}><Text style={[styles.buttonText, selected && styles.activeText]}>{label}</Text></Pressable>;
  const entry = KOROSKA_SHADOW_ENABLED && available ? <Pressable accessibilityRole="button" accessibilityLabel="Odpri razvojni predogled Koroška, sedem dni"
    onPress={enter} style={styles.entry}><Text style={styles.buttonText}>Koroška · 7-dnevni test →</Text></Pressable> : null;
  const pogojiEntry = KOROSKA_SHADOW_ENABLED && available && pogojiAvailable ? <Pressable accessibilityRole="button"
    accessibilityLabel="Odpri interni sedemdnevni način Pogoji za Koroško" onPress={enterPogoji} style={styles.entry}>
    <Text style={styles.buttonText}>7 dni · Koroška (test)</Text></Pressable> : null;
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
  const summary = artifact ? `${shadowDateLabel(windowDates[day])} · ${MUSHROOM_WEATHER_PROFILES[profile].label}` : 'Nalagam posnetek';
  const sourceLabel = sourceMode === 'frozen' ? 'Raziskovalni posnetek — ni aktualna napoved' : 'Sveža napoved — razvojni pilot';
  const freshness = <Text accessibilityLiveRegion="polite" style={styles.copy}>{live.message}{live.snapshot ? ` · pridobljeno ${new Intl.DateTimeFormat('sl-SI', { timeZone: 'Europe/Ljubljana', dateStyle: 'short', timeStyle: 'short' }).format(new Date(live.snapshot.retrievedAt))}` : ''}</Text>;
  const dateStrip = <ScrollView key={`dates:${dates.stripKey}`} horizontal {...dates.scrollProps} contentContainerStyle={styles.strip}>
    {windowDates.map((date, i) => <View key={date} onLayout={dates.itemLayout(date)}>{button(shadowDateLabel(date), () => setDay(i), day === i)}</View>)}
  </ScrollView>;
  // Rendered in MapScreen's existing Pogoji controls slot, not a second floating toolbar.
  const pogojiControls = active && unified ? <View style={styles.integrated}>
    <View style={styles.toolbar}><Text accessibilityRole="header" style={[styles.heading, styles.grow]}>Pogoji · 7 dni · RAZVOJNI TEST</Text>
      {button('Danes / Jutri', exit, false, 'Vrni običajne Pogoje Danes in Jutri')}</View>
    <Text style={styles.warning}>Samo Koroška · 696 celic · urna vremenska pogodba</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Izberi vrsto v internem načinu Pogoji" accessibilityState={{ expanded: controls }}
      onPress={() => { setMore(false); setControls(true); }} style={styles.button}><Text accessibilityLiveRegion="polite" style={styles.buttonText}>{summary} ▾</Text></Pressable>
    {dateStrip}
    <View style={styles.toolbar}>{button('Pridobi svežo napoved', () => { void live.refresh(); })}{button('Območje', showRegion, false, 'Prikaži Koroško')}</View>
    {freshness}
    {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
    {regionMessage ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{regionMessage}</Text> : null}
  </View> : null;
  const overlay = active ? <View pointerEvents="box-none" style={StyleSheet.absoluteFill}
    onLayout={event => { frames.current.viewport = event.nativeEvent.layout; }}>
    {!unified ? <View style={[styles.top, styles.topContent]} onLayout={event => { frames.current.top = event.nativeEvent.layout; }}>
      <Text accessibilityRole="header" style={styles.heading}>RAZVOJNI PREDOGLED · Koroška</Text>
      <Text style={styles.warning}>{sourceLabel}</Text>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={sourceMode === 'frozen' ? 'Izberi raziskovalni datum in vrsto' : 'Izberi datum, vrsto in vir napovedi'} accessibilityState={{ expanded: controls }} onPress={() => { setMore(false); setControls(true); }} style={[styles.button, styles.grow]}>
          <Text accessibilityLiveRegion="polite" style={styles.buttonText}>{summary} ▾</Text></Pressable>
        {button('Območje', showRegion, false, 'Prikaži Koroško')}{button('Izhod', exit, false, 'Izhod iz razvojnega predogleda')}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : !artifact ? <ActivityIndicator color={colors.primary} /> : null}
      {sourceMode === 'live' ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{live.message}{live.snapshot ? ` · pridobljeno ${new Intl.DateTimeFormat('sl-SI', { timeZone: 'Europe/Ljubljana', dateStyle: 'short', timeStyle: 'short' }).format(new Date(live.snapshot.retrievedAt))}` : ''}</Text> : null}
      {regionMessage ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{regionMessage}</Text> : null}
    </View> : null}
    {result && artifact ? <View style={[styles.bottom, styles.topContent]} onLayout={event => { frames.current.bottom = event.nativeEvent.layout; }}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.score}>Regionalna ocena: {result.score == null ? 'Ocena ni na voljo' : `${result.score}/100 · ${result.label}`}</Text>
      <Text style={styles.copy}>{sourceMode === 'live' ? 'Habitat območja · statični podatki: ' : 'Raziskovalni habitat: '}{result.habitat === 'unknown' ? 'ni potrjen' : result.habitat === 'outside-model' ? 'zunaj modela' : 'potencialno primeren'}</Text>
      {result.habitat === 'candidate' && result.vector.score == null ? <Text style={styles.copy}>{result.vector.missing[0] || 'Manjkajo veljavni vremenski vhodi'}</Text> : null}
      <View style={styles.toolbar}>{button('Točkovna napoved', openPoint, false, 'Odpri sedemdnevno napoved za kliknjene koordinate')}{button('Viri', () => { setControls(false); setMore(true); }, false, 'Viri in omejitve regionalnega posnetka', more)}{button('×', clearSelection, false, 'Zapri izbrano regionalno celico')}</View>
    </View> : null}
    {controls && artifact ? sheet('Izberi datum in vrsto', () => setControls(false), <>
      <Text style={styles.copy}>{summary}</Text><Text style={styles.warning}>{sourceLabel}</Text>
      {!unified ? <>{button('Raziskovalni posnetek', () => chooseSource('frozen'), sourceMode === 'frozen')}
      {button('Sveža napoved — razvojni pilot', () => chooseSource('live'), sourceMode === 'live')}</> : <Text style={styles.copy}>Pogoji · samo Koroška. regional-civil-week-v1; običajni Danes/Jutri ostaja na ločeni dnevni pogodbi pilot-weather-v1. Zunaj 696 pilotnih celic ni pokritosti, ne slabi pogoji.</Text>}
      {sourceMode === 'live' ? <>
        {button('Pridobi svežo napoved', () => { void live.refresh(); })}
        <Text accessibilityLiveRegion="polite" style={styles.copy}>{live.message}</Text>
        {live.error ? <Text accessibilityRole="alert" style={styles.copy}>{live.error}</Text> : null}
        {live.loading ? <ActivityIndicator color={colors.primary} /> : null}
      </> : null}
      {!unified ? dateStrip : null}
      <ScrollView key={`profiles:${profiles.stripKey}`} horizontal {...profiles.scrollProps} contentContainerStyle={styles.strip}>
        {artifact.profiles.map(id => <View key={id} onLayout={profiles.itemLayout(id)}>{button(MUSHROOM_WEATHER_PROFILES[id].label, () => setProfile(id), profile === id)}</View>)}
      </ScrollView>
    </>) : null}
    {more && result && artifact ? sheet('Viri raziskovalne celice', () => setMore(false), <>
      <Text style={styles.heading}>{summary} · {result.cell.id}</Text>
      <Text style={styles.warning}>{sourceLabel}</Text>
      {sourceMode === 'frozen' ? <>
      <Text selectable style={styles.copy}>{artifact.contract} · {artifact.captureId}</Text><Text selectable style={styles.copy}>Posnetek: {artifact.snapshotId}</Text>
      <Text style={styles.copy}>Vzorec: {result.weather.id} · pridobljeno {artifact.capturedAt}{shadowIsStale(artifact) ? ' · potekla veljavnost' : ' · zamrznjen raziskovalni zajem'}; modelski zagon ni preverjen.</Text>
      </> : <>
        <Text style={styles.copy}>{live.message}</Text>
        {live.error ? <Text accessibilityRole="alert" style={styles.copy}>{live.error}</Text> : null}
        <Text selectable style={styles.copy}>{artifact.contract} · posnetek: {live.snapshot?.snapshotId ?? 'ni objavljen'}</Text>
        {live.snapshot ? <Text style={styles.copy}>Pridobljeno: {live.snapshot.retrievedAt} · sestavljeno: {live.snapshot.assembledAt} · iztek: {new Date(live.snapshot.expiresAt).toISOString()}. Konfiguracija scorerjev: {live.snapshot.scorerConfigurationId}.</Text> : null}
        <Text style={styles.copy}>Vreme: skupni regionalni vzorec {result.weather.id}; ne meritev pri kliknjeni točki. Habitat: nespremenjena raziskovalna celica {artifact.captureId}. Čas modelnega zagona ni preverjen; čas pridobitve ni čas izdaje.</Text>
        {live.snapshot?.sources.map(source => {
          const row = source.returned[result.cell.weatherIndex];
          return <Text key={source.endpoint} selectable style={styles.copy}>{source.endpoint} · {source.retrievedAt} · {source.sha256}. Zahtevano {row.requested.join(', ')}, mreža ponudnika {row.latitude}, {row.longitude}, višina {row.elevation ?? 'ni podatka'} m. Enote: {JSON.stringify(row.units)}.</Text>;
        })}
        {live.snapshot?.missing.map(reason => <Text key={reason} style={styles.copy}>{reason}</Text>)}
      </>}
      <Text style={styles.copy}>Zamrznjen habitat raziskovalne celice ni ista prostorska presoja kot habitat iz produkcijskega regionalnega indeksa v točkovni napovedi. Celice, meje, profil ali podatkovni kontekst se lahko razlikujejo; nobena presoja ne potrjuje rastja na točni koordinati.</Text>
      <Text style={styles.copy}>Točkovna napoved uporablja kliknjene koordinate in svoj aktualni vremenski posnetek. Raziskovalni datum zunaj aktualnega okna se ne prenese kot današnji datum.</Text>
      <Text style={styles.copy}>1 km habitat; skupni vremenski vzorec, ne meritev v gozdu. Ocena pomeni modelno primernost pogojev, ne prisotnosti gob. Majhna sprememba blizu praga lahko spremeni barvno kategorijo.</Text>
      {artifact.attribution.map(text => <Text key={text} style={styles.copy}>{text}</Text>)}
    </>) : null}
  </View> : null;
  const modal = active && pointOpen && pointLocation ? <SevenDayConditionsModal visible location={pointLocation} database={database}
    profileId={pointProfile} onProfileChange={setPointProfile} selectedDate={pointDate} onSelectDate={(_index, date) => setPointDate(date)}
    researchOrigin={researchOrigin} onSnapshot={noSnapshot} onClose={() => setPointOpen(false)} /> : null;
  return { active, unified: active && unified, entry, pogojiEntry, pogojiControls, layer, overlay, modal, exit, back, clearSelection, rememberViewport, consumeViewport };
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
  integrated: { gap: spacing.xs },
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
