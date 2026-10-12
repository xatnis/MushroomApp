import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Chip, Field, Notice, Screen, SectionTitle, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import type { ExploreLocation, MushroomWeatherProfileId, MushroomWeatherSummary } from '../domain/types';
import { useApp } from '../state/AppContext';
import { getMushroomWeatherSummary, searchLocations, type PlaceSearchResult } from '../services/weather';
import { acquireForegroundPosition, LocationAcquisitionError } from '../services/location';
import { buildGpsExploreLocation, debugGpsLocality, resolveGpsLocality } from '../services/locality';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../domain/mushroomWeather';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { topThreeHotspots } from '../domain/hotspotTopThree';
import { conditionsNavigationPatch } from '../domain/hotspotHeatmap';
import { buildWeatherDailySeries, summarySeriesInputs, weatherLocalDate } from '../domain/weatherSeries';
import { graphPeriodSummary } from '../components/weatherGraphPresentation';
import { ConditionsAdvancedDetails } from '../components/ConditionsAdvancedDetails';
import { createAdvancedDetailsFocus } from '../components/advancedDetailsFocus';
import { WeatherGraphsEntry, WeatherGraphsModal } from '../components/WeatherGraphsView';
import { slDateTime, slNumber } from '../domain/format';
import { colors, radii, spacing } from '../theme';

const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
  promise.then(
    (value) => { clearTimeout(timeout); resolve(value); },
    (error) => { clearTimeout(timeout); reject(error); },
  );
});

const placeDetails = (place: Pick<ExploreLocation, 'name' | 'admin1' | 'admin2' | 'country'>) => {
  const values = [place.admin2, place.admin1, place.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== place.name);
  return [...new Set(values)].join(', ');
};

export function ConditionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { hotspots, repository, online, exploreLocation, setExploreLocation, requestHotspotFocus } = useApp();
  const [locationMode, setLocationMode] = useState<'gps' | 'manual'>(exploreLocation?.source === 'gps' ? 'gps' : 'manual');
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | undefined>(exploreLocation?.source === 'gps' ? exploreLocation : undefined);
  const [currentLocationName, setCurrentLocationName] = useState<string | undefined>(exploreLocation?.source === 'gps' ? exploreLocation.name : undefined);
  const [selectedPlace, setSelectedPlace] = useState<ExploreLocation | undefined>(exploreLocation?.source !== 'gps' ? exploreLocation : undefined);
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [weatherSummary, setWeatherSummary] = useState<MushroomWeatherSummary>();
  const [weatherProfileId, setWeatherProfileId] = useState<MushroomWeatherProfileId>('generic');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string>();
  const [weatherRetry, setWeatherRetry] = useState(0);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [locationSettingsRequired, setLocationSettingsRequired] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string>();
  const [placeSearchError, setPlaceSearchError] = useState<string>();
  const [showWeatherDetails, setShowWeatherDetails] = useState(false);
  const [graphsOpen, setGraphsOpen] = useState(false);
  const locationRequestId = useRef(0);
  const locationAbortController = useRef<AbortController | undefined>(undefined);
  const weatherRequestId = useRef(0);
  const initialLocationRequested = useRef(false);
  const mounted = useRef(true);
  const coords = locationMode === 'gps' ? currentLocation : selectedPlace;
  const screenScroll = useRef<ScrollView>(null);
  const advancedFocus = useRef<ReturnType<typeof createAdvancedDetailsFocus> | null>(null);
  if (!advancedFocus.current) advancedFocus.current = createAdvancedDetailsFocus(
    y => screenScroll.current?.scrollTo({ y, animated: true }), spacing.lg,
    callback => requestAnimationFrame(callback), id => cancelAnimationFrame(id));
  const focus = advancedFocus.current;
  // Capture a new generation before the new context's native onLayout callbacks are created.
  focus.setContext(`${coords?.latitude}:${coords?.longitude}:${weatherProfileId}`);
  useEffect(() => () => focus.cancel(), [focus]);
  useEffect(() => { if (!showWeatherDetails) focus.cancel(); }, [focus, showWeatherDetails]);
  const openExplanation = () => { focus.request(showWeatherDetails); setShowWeatherDetails(true); };
  const toggleAdvanced = () => {
    if (showWeatherDetails) { focus.cancel(); setShowWeatherDetails(false); }
    else openExplanation();
  };
  const layoutGeneration = focus.generation;

  const acquireCurrent = useCallback(async () => {
    locationAbortController.current?.abort();
    const controller = new AbortController();
    locationAbortController.current = controller;
    const requestId = ++locationRequestId.current;
    const isCurrentRequest = () => mounted.current && locationRequestId.current === requestId;
    setLocationMode('gps'); setPlaceSearchOpen(false); setGpsLoading(true); setError(undefined); setLocationNotice(undefined); setLocationSettingsRequired(false);
    try {
      const result = await acquireForegroundPosition(Location, Location.Accuracy.High, undefined, controller.signal);
      if (!isCurrentRequest()) return;
      const next = { latitude: result.location.coords.latitude, longitude: result.location.coords.longitude };
      const accuracy = result.location.coords.accuracy;
      const accuracyLabel = accuracy == null ? 'neznana' : `${Math.max(1, Math.round(accuracy))} m`;
      if (result.source === 'lastKnown') {
        const ageMinutes = Math.max(0, Math.round((Date.now() - result.location.timestamp) / 60_000));
        const ageLabel = ageMinutes < 1 ? 'stara manj kot minuto' : `stara približno ${ageMinutes} min`;
        setLocationNotice(`Uporabljena je zadnja znana lokacija, natančnost približno ${accuracyLabel}, ${ageLabel}.`);
      } else {
        setLocationNotice(`Pridobljena je sveža lokacija, natančnost približno ${accuracyLabel}.`);
      }
      let addresses: Location.LocationGeocodedAddress[] = [];
      try {
        addresses = await withTimeout(Location.reverseGeocodeAsync(next), REVERSE_GEOCODE_TIMEOUT_MS);
      } catch {
        // Accepted GPS coordinates remain authoritative even when reverse geocoding is unavailable.
      }
      const resolution = await resolveGpsLocality({ ...next, addresses, signal: controller.signal });
      if (!isCurrentRequest()) return;
      debugGpsLocality(result.source, accuracy, addresses, resolution);
      const resolvedLocation = buildGpsExploreLocation(next.latitude, next.longitude, resolution);
      setCurrentLocation(next);
      setCurrentLocationName(resolvedLocation.name);
      setExploreLocation(resolvedLocation);
    } catch (cause) {
      if (isCurrentRequest()) {
        setLocationSettingsRequired(cause instanceof LocationAcquisitionError && cause.settingsRequired);
        setError(cause instanceof Error ? cause.message : 'Lokacija ni na voljo.');
      }
    } finally {
      if (locationAbortController.current === controller) locationAbortController.current = undefined;
      if (isCurrentRequest()) setGpsLoading(false);
    }
  }, [setExploreLocation]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      locationRequestId.current += 1;
      locationAbortController.current?.abort();
      locationAbortController.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (initialLocationRequested.current || exploreLocation) return;
    initialLocationRequested.current = true;
    void acquireCurrent();
  }, [acquireCurrent, exploreLocation]);

  useEffect(() => {
    if (!exploreLocation) return;
    locationRequestId.current += 1;
    locationAbortController.current?.abort(); locationAbortController.current = undefined;
    setGpsLoading(false); setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); setError(undefined); setLocationSettingsRequired(false);
    if (exploreLocation.source === 'gps') {
      setLocationMode('gps');
      setCurrentLocation({ latitude: exploreLocation.latitude, longitude: exploreLocation.longitude });
      setCurrentLocationName(exploreLocation.name);
    } else {
      setLocationMode('manual'); setSelectedPlace(exploreLocation);
    }
  }, [exploreLocation]);

  const showOnMap = (location: ExploreLocation) => {
    setExploreLocation(location);
    navigation.navigate('Tabs', { screen: 'Map', params: { focusExploreLocationAt: Date.now() } });
  };

  useEffect(() => {
    if (!coords) {
      weatherRequestId.current += 1;
      setWeatherSummary(undefined); setWeatherLoading(false); setWeatherError(undefined);
      return;
    }
    const requestId = ++weatherRequestId.current;
    const isCurrentRequest = () => mounted.current && weatherRequestId.current === requestId;
    setWeatherSummary(undefined); setWeatherLoading(true); setWeatherError(undefined); setShowWeatherDetails(false);
    void getMushroomWeatherSummary(repository.database, coords.latitude, coords.longitude)
      .then((data) => { if (isCurrentRequest()) setWeatherSummary(data); })
      .catch((cause) => {
        console.warn('Weather summary request failed', cause);
        if (isCurrentRequest()) setWeatherError('Vremenskih podatkov trenutno ni bilo mogoče pridobiti.');
      })
      .finally(() => { if (isCurrentRequest()) setWeatherLoading(false); });
    return () => {
      if (weatherRequestId.current === requestId) weatherRequestId.current += 1;
    };
  }, [coords?.latitude, coords?.longitude, repository, weatherRetry]);

  useEffect(() => {
    if (!placeSearchOpen || placeQuery.trim().length < 2) {
      setPlaceResults([]); setPlaceSearchError(undefined); setPlaceSearchLoading(false); return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => {
      setPlaceSearchLoading(true); setPlaceSearchError(undefined);
      void searchLocations(placeQuery, controller.signal)
        .then((results) => { if (active) setPlaceResults(results); })
        .catch((cause) => {
          if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
          setPlaceSearchError(cause instanceof Error ? cause.message : 'Lokacij ni bilo mogoče poiskati.');
        })
        .finally(() => { if (active) setPlaceSearchLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [placeQuery, placeSearchOpen]);

  // Do not display the previous location's values while the existing loader changes generation.
  const displaySummary = weatherSummary && coords && weatherSummary.latitude === coords.latitude && weatherSummary.longitude === coords.longitude ? weatherSummary : undefined;
  const score = useMemo(() => calculateMushroomWeatherScore(displaySummary, weatherProfileId), [weatherProfileId, displaySummary]);
  const weatherProfile = MUSHROOM_WEATHER_PROFILES[weatherProfileId];
  const rankingContext = { targetProfile: weatherProfileId, dayMode: 'today' as const };
  const { assessments, complete, error: rankingError, retry: retryRanking } = useLocationConditions(hotspots, weatherProfileId, 'today', true, 250);
  const topHotspots = topThreeHotspots(hotspots, assessments, complete);
  const forecastSummary = useMemo(() => {
    const today = weatherLocalDate();
    return graphPeriodSummary(buildWeatherDailySeries(coords?.latitude ?? NaN, coords?.longitude ?? NaN, today,
      displaySummary ? summarySeriesInputs(displaySummary, today) : []), 'rain', 'forecast7');
  }, [displaySummary]);
  const showAllHotspots = () => navigation.navigate('Tabs', { screen: 'Map', params: {
    conditionsListRequest: { requestedAt: Date.now(), context: rankingContext },
  } });

  return <Screen style={styles.screenContent} scrollRef={screenScroll} onScrollBeginDrag={() => focus.cancel(false)}>
    <Text style={commonStyles.title}>Razmere</Text>
    {!online ? <Notice tone="warning">Ni povezave. Prikazani so lahko zadnji predpomnjeni podatki z označenim časom osvežitve.</Notice> : null}
    <Card style={styles.introCard}>
      <SectionTitle>Lokacija</SectionTitle>
      <View style={commonStyles.wrap}>
        <Chip label="Moja lokacija" selected={locationMode === 'gps'} onPress={() => void acquireCurrent()} />
        <Chip label="Izberi lokacijo" selected={locationMode === 'manual'} onPress={() => { locationRequestId.current += 1; locationAbortController.current?.abort(); locationAbortController.current = undefined; setGpsLoading(false); setLocationMode('manual'); setPlaceSearchOpen(!selectedPlace); setError(undefined); setLocationNotice(undefined); setLocationSettingsRequired(false); }} />
      </View>
      {locationMode === 'gps' ? <View style={styles.locationSummary}>
        <Text style={commonStyles.muted}>Aktivna lokacija</Text>
        <Text style={commonStyles.heading}>{gpsLoading ? 'Pridobivam lokacijo …' : currentLocationName ?? 'Lokacija še ni določena'}</Text>
        {currentLocation && currentLocationName ? <AppButton title="Prikaži na zemljevidu" variant="secondary" onPress={() => showOnMap({ ...currentLocation, name: currentLocationName, source: 'gps' })} /> : null}
      </View> : null}
      {locationMode === 'manual' && selectedPlace && !placeSearchOpen ? <View style={styles.locationSummary}>
        <Text style={commonStyles.muted}>Izbrana lokacija</Text>
        <Text style={commonStyles.heading}>{selectedPlace.name}</Text>
        {placeDetails(selectedPlace) ? <Text style={commonStyles.muted}>{placeDetails(selectedPlace)}</Text> : null}
        <View style={styles.locationActions}>
          <AppButton title="Prikaži na zemljevidu" variant="secondary" style={styles.locationAction} onPress={() => showOnMap(selectedPlace)} />
          <AppButton title="Spremeni lokacijo" variant="secondary" style={styles.locationAction} onPress={() => setPlaceSearchOpen(true)} />
        </View>
      </View> : null}
      {locationMode === 'manual' && placeSearchOpen ? <View style={styles.searchArea}>
        <Field label="Poišči mesto ali kraj" placeholder="Npr. Črna na Koroškem" value={placeQuery} onChangeText={setPlaceQuery} autoCapitalize="words" autoCorrect={false} />
        {placeSearchLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {placeSearchError ? <Notice tone="warning">{placeSearchError}</Notice> : null}
        {placeResults.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => {
          locationRequestId.current += 1; locationAbortController.current?.abort(); locationAbortController.current = undefined; setGpsLoading(false);
          const next: ExploreLocation = { name: place.name, latitude: place.latitude, longitude: place.longitude, admin1: place.admin1, admin2: place.admin2, country: place.country, source: 'place' };
          setSelectedPlace(next); setExploreLocation(next); setLocationMode('manual'); setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); setError(undefined); setLocationSettingsRequired(false);
        }} style={({ pressed }) => [styles.placeResult, pressed && styles.placeResultPressed]}>
          <Text style={commonStyles.heading}>{place.name}</Text>
          {placeDetails(place) ? <Text style={commonStyles.muted}>{placeDetails(place)}</Text> : null}
        </Pressable>)}
        {placeQuery.trim().length >= 2 && !placeSearchLoading && !placeSearchError && !placeResults.length ? <Text style={commonStyles.muted}>Ni najdenih lokacij.</Text> : null}
        <Text style={commonStyles.muted}>Iskanje lokacij: Open‑Meteo / GeoNames</Text>
        {selectedPlace ? <AppButton title="Prekliči" variant="ghost" onPress={() => { setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); }} /> : null}
      </View> : null}
    </Card>
    {gpsLoading || weatherLoading ? <ActivityIndicator size="large" color={colors.primary} /> : null}
    {error ? <Notice tone="warning">{error}</Notice> : null}
    {locationSettingsRequired ? <AppButton title="Odpri nastavitve aplikacije" variant="secondary" onPress={() => void Linking.openSettings().catch(() => setError('Nastavitev aplikacije ni bilo mogoče odpreti.'))} /> : null}
    {weatherError ? <Notice tone="warning">{weatherError}</Notice> : null}
    {locationNotice ? <Notice tone="info">{locationNotice}</Notice> : null}
    {weatherSummary?.errors.historical ? <Notice tone="warning">{weatherSummary.errors.historical}</Notice> : null}
    {weatherSummary?.errors.forecast ? <Notice tone="warning">{weatherSummary.errors.forecast}</Notice> : null}
    {!weatherLoading && coords && (weatherError || weatherSummary?.errors.historical || weatherSummary?.errors.forecast)
      ? <AppButton title="Poskusi znova" variant="secondary" onPress={() => setWeatherRetry((value) => value + 1)} />
      : null}
    <Card style={styles.suitabilityCard}>
      <SectionTitle action={<Text style={commonStyles.muted}>Danes</Text>}>Gobarski signal</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={styles.profileRow}>
        {Object.entries(MUSHROOM_WEATHER_PROFILES).map(([id, profile]) => <Pressable key={id} accessibilityRole="button"
          accessibilityState={{ selected: weatherProfileId === id }} accessibilityLabel={profile.label}
          onPress={() => setWeatherProfileId(id as MushroomWeatherProfileId)} style={[styles.profileChip, weatherProfileId === id && styles.profileSelected]}>
          <Text style={[styles.profileText, weatherProfileId === id && styles.profileSelectedText]}>{profile.label}</Text>
        </Pressable>)}
      </ScrollView>
      <View style={styles.scoreRow}><Text style={styles.score}>{score.score != null ? score.score + '/100' : '—'}</Text>
        <View style={styles.scoreCopy}><Text style={commonStyles.heading}>{score.label}</Text><Text style={commonStyles.body}>Trend: {score.trend}</Text></View>
      </View>
      {score.reasons.slice(0, 2).map(reason => <Text key={reason} style={commonStyles.body}>{reason}</Text>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showWeatherDetails }}
        accessibilityHint="Odpre in prikaže razlago trenutne ocene." onPress={openExplanation} style={styles.detailsAction}>
        <Text style={styles.actionText}>Zakaj ta ocena?</Text>
      </Pressable>
      <Text style={commonStyles.muted}>Ocena vremenskih razmer ne zagotavlja najdbe gob.</Text>
    </Card>
    <WeatherGraphsEntry onPress={() => setGraphsOpen(true)} />
    <WeatherGraphsModal visible={graphsOpen} location={coords ? { latitude: coords.latitude, longitude: coords.longitude,
      name: (locationMode === 'gps' ? currentLocationName : selectedPlace?.name) ?? 'Izbrana lokacija' } : undefined}
      summary={weatherSummary} onClose={() => setGraphsOpen(false)} />
    <Card style={styles.introCard}><SectionTitle>Vreme na kratko</SectionTitle>
      <Text style={commonStyles.body}>Trenutno: {debugNumber(displaySummary?.current?.temperatureC, '°C')} · {displaySummary?.current?.weatherDescription ?? 'Opis vremena ni na voljo'}</Text>
      <Text style={commonStyles.body}>Padavine zadnjih 14 dni: {debugNumber(displaySummary?.historical?.rain14dMm, 'mm')}</Text>
      <Text style={commonStyles.body}>Padavine naslednjih 7 dni: {forecastSummary.text}</Text>
      <Text style={commonStyles.muted}>Napoved vključuje danes, ki je še nedokončan dan.</Text>
      {displaySummary?.stale ? <Text style={commonStyles.muted}>Starejši podatki iz predpomnilnika · {slDateTime(displaySummary.updatedAt)}</Text> : null}
    </Card>
    <Card style={styles.introCard}><SectionTitle>Najboljša rastišča</SectionTitle>
      <Text style={commonStyles.muted}>{weatherProfile.label} · Danes · po modelnih pogojih</Text>
      {!hotspots.length ? <Text style={commonStyles.body}>Za primerjavo najprej shrani rastišče.</Text>
        : !complete ? <Text style={commonStyles.body}>Izračunavam pogoje za moja rastišča …</Text>
        : topHotspots.length ? topHotspots.map((hotspot, index) => <Pressable key={hotspot.id} accessibilityRole="button"
          accessibilityLabel={'Prikaži ' + (hotspot.title || 'rastišče') + ' na zemljevidu'}
          onPress={() => { requestHotspotFocus(hotspot, conditionsNavigationPatch(rankingContext)); navigation.navigate('Tabs', { screen: 'Map' }); }}
          style={styles.overviewHotspot}>
          <Text style={styles.overviewRank}>#{index + 1}</Text><View style={styles.rankCopy}>
            <Text style={commonStyles.heading}>{hotspot.title?.trim() || 'Rastišče brez naslova'}</Text>
            <Text style={commonStyles.body}>{assessments[hotspot.id]!.score}/100 · {assessments[hotspot.id]!.classLabel}</Text>
          </View>
        </Pressable>) : <Text style={commonStyles.body}>Trenutno ni mogoče izračunati pogojev za shranjena rastišča.</Text>}
      {complete && rankingError ? <AppButton title="Poskusi znova" variant="ghost" onPress={retryRanking} /> : null}
      <AppButton title="Poglej vsa rastišča" variant="secondary" onPress={showAllHotspots} />
    </Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showWeatherDetails }}
      onPress={toggleAdvanced} style={styles.detailsAction}>
      <Text style={styles.actionText}>Napredni podatki in razlaga modela {showWeatherDetails ? '⌃' : '⌄'}</Text>
    </Pressable>
    {showWeatherDetails ? <View onLayout={event => focus.layout(event.nativeEvent.layout.y, layoutGeneration)}>
      <ConditionsAdvancedDetails key={`${coords?.latitude}:${coords?.longitude}`} summary={displaySummary} score={score}
        forecastText={forecastSummary.text} onOpenGraphs={() => setGraphsOpen(true)} />
    </View> : null}
  </Screen>;
}

const debugNumber = (value: number | undefined, unit: string, digits = 1) => value == null ? 'ni podatka' : `${slNumber(value, digits)} ${unit}`;


const styles = StyleSheet.create({
  screenContent: { gap: spacing.sm }, introCard: { padding: spacing.md, gap: spacing.sm },
  suitabilityCard: { borderColor: colors.secondary, padding: spacing.md },
  profileRow: { gap: spacing.sm }, profileChip: { minHeight: 48, paddingHorizontal: spacing.md, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.round },
  profileSelected: { backgroundColor: colors.primary }, profileText: { fontSize: 14, color: colors.primary }, profileSelectedText: { color: colors.white },
  detailsAction: { minHeight: 48, justifyContent: 'center', paddingVertical: spacing.sm }, actionText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  overviewHotspot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, overviewRank: { color: colors.primary, fontSize: 16 },
  locationSummary: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  locationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  locationAction: { flexGrow: 1, flexShrink: 1, flexBasis: 132, paddingHorizontal: spacing.sm },
  searchArea: { gap: spacing.sm },
  placeResult: { padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  placeResultPressed: { opacity: 0.75 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }, score: { fontSize: 42, color: colors.primary, fontWeight: '800' }, scoreCopy: { flexGrow: 1, flexBasis: 140, gap: spacing.xs },
  rankCopy: { flex: 1 },
});
