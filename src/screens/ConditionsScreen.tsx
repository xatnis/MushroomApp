import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Chip, Field, Notice, Screen, SectionTitle, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import type { ConditionsData, ExploreLocation, Hotspot, MushroomConditionsScore, MushroomWeatherProfileId, MushroomWeatherSummary, ScoreResult } from '../domain/types';
import { useApp } from '../state/AppContext';
import { getConditions, getMushroomWeatherSummary, searchLocations, type PlaceSearchResult } from '../services/weather';
import { acquireForegroundPosition } from '../services/location';
import { calculateMushroomScore } from '../domain/scoring';
import { BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG, MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../domain/mushroomWeather';
import { haversineKm, slDateTime, slNumber } from '../domain/format';
import { speciesCatalogue } from '../domain/species';
import { colors, radii, spacing } from '../theme';

interface Ranked { hotspot: Hotspot; conditions?: ConditionsData; score: ScoreResult; distanceKm?: number; }

const coordinateLabel = (latitude: number, longitude: number) => `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
const cleanPlaceName = (value?: string | null) => value?.replace(/^(?:Upravna enota|Mestna občina|Občina)\s+/i, '').trim();
const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
  promise.then(
    (value) => { clearTimeout(timeout); resolve(value); },
    (error) => { clearTimeout(timeout); reject(error); },
  );
});

const reverseGeocodeLabel = async (latitude: number, longitude: number): Promise<string | undefined> => {
  try {
    const [address] = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), REVERSE_GEOCODE_TIMEOUT_MS);
    return [address?.city, address?.district, address?.subregion, address?.region, address?.name, address?.country]
      .map(cleanPlaceName).find(Boolean);
  } catch {
    return undefined;
  }
};

const placeDetails = (place: Pick<ExploreLocation, 'name' | 'admin1' | 'admin2' | 'country'>) => {
  const values = [place.admin2, place.admin1, place.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== place.name);
  return [...new Set(values)].join(', ');
};

export function ConditionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { hotspots, finds, repository, online, exploreLocation, setExploreLocation, requestHotspotFocus } = useApp();
  const [locationMode, setLocationMode] = useState<'gps' | 'manual'>(exploreLocation?.source === 'place' ? 'manual' : 'gps');
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | undefined>(exploreLocation?.source === 'gps' ? exploreLocation : undefined);
  const [currentLocationName, setCurrentLocationName] = useState<string | undefined>(exploreLocation?.source === 'gps' ? exploreLocation.name : undefined);
  const [selectedPlace, setSelectedPlace] = useState<ExploreLocation | undefined>(exploreLocation?.source === 'place' ? exploreLocation : undefined);
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [weatherSummary, setWeatherSummary] = useState<MushroomWeatherSummary>();
  const [weatherProfileId, setWeatherProfileId] = useState<MushroomWeatherProfileId>('generic');
  const [ranked, setRanked] = useState<Ranked[]>([]);
  const [speciesId, setSpeciesId] = useState<string>();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [locationNotice, setLocationNotice] = useState<string>();
  const [placeSearchError, setPlaceSearchError] = useState<string>();
  const [showWeatherDetails, setShowWeatherDetails] = useState(false);
  const locationRequestId = useRef(0);
  const initialLocationRequested = useRef(false);
  const mounted = useRef(true);
  const coords = locationMode === 'gps' ? currentLocation : selectedPlace;

  const acquireCurrent = useCallback(async () => {
    const requestId = ++locationRequestId.current;
    const isCurrentRequest = () => mounted.current && locationRequestId.current === requestId;
    setLocationMode('gps'); setPlaceSearchOpen(false); setGpsLoading(true); setError(undefined); setLocationNotice(undefined);
    try {
      const result = await acquireForegroundPosition(Location, Location.Accuracy.Balanced);
      if (!isCurrentRequest()) return;
      const next = { latitude: result.location.coords.latitude, longitude: result.location.coords.longitude };
      const fallbackName = coordinateLabel(next.latitude, next.longitude);
      setCurrentLocation(next);
      setCurrentLocationName(fallbackName);
      if (result.source === 'lastKnown') {
        const ageMinutes = Math.max(1, Math.round((Date.now() - result.location.timestamp) / 60_000));
        setLocationNotice(`GPS ni pravočasno odgovoril. Uporabljena je zadnja znana lokacija, stara približno ${ageMinutes} min.`);
      }
      const name = await reverseGeocodeLabel(next.latitude, next.longitude) ?? fallbackName;
      if (!isCurrentRequest()) return;
      setCurrentLocationName(name);
      setExploreLocation({ ...next, name, source: 'gps' });
    } catch (cause) {
      if (isCurrentRequest()) setError(cause instanceof Error ? cause.message : 'Lokacija ni na voljo.');
    } finally {
      if (isCurrentRequest()) setGpsLoading(false);
    }
  }, [setExploreLocation]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; locationRequestId.current += 1; };
  }, []);

  useEffect(() => {
    if (initialLocationRequested.current || exploreLocation) return;
    initialLocationRequested.current = true;
    void acquireCurrent();
  }, [acquireCurrent, exploreLocation]);

  useEffect(() => {
    if (!exploreLocation) return;
    locationRequestId.current += 1;
    setGpsLoading(false); setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); setError(undefined);
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
    if (!coords) { setWeatherSummary(undefined); return; }
    let active = true;
    setWeatherSummary(undefined); setWeatherLoading(true); setError(undefined); setShowWeatherDetails(false);
    void getMushroomWeatherSummary(repository.database, coords.latitude, coords.longitude)
      .then((data) => { if (active) setWeatherSummary(data); })
      .catch(() => { if (active) setError('Vremenskih podatkov trenutno ni mogoče pridobiti.'); })
      .finally(() => { if (active) setWeatherLoading(false); });
    return () => { active = false; };
  }, [coords?.latitude, coords?.longitude, repository]);

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

  useEffect(() => {
    if (!hotspots.length) { setRanked([]); return; }
    let active = true;
    void Promise.all(hotspots.slice(0, 30).map(async (hotspot): Promise<Ranked> => {
      try {
        const data = await getConditions(repository.database, hotspot.latitude, hotspot.longitude);
        const history = finds.filter((find) => find.hotspotId === hotspot.id);
        return { hotspot, conditions: data, score: calculateMushroomScore(data, history, speciesId), distanceKm: coords ? haversineKm(coords.latitude, coords.longitude, hotspot.latitude, hotspot.longitude) : undefined };
      } catch { return { hotspot, score: calculateMushroomScore(undefined, [], speciesId) }; }
    })).then((values) => { if (active) setRanked(values.sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1))); });
    return () => { active = false; };
  }, [finds, hotspots, repository, speciesId, coords?.latitude, coords?.longitude]);

  const score = useMemo(() => calculateMushroomWeatherScore(weatherSummary, weatherProfileId), [weatherProfileId, weatherSummary]);
  const weatherProfile = MUSHROOM_WEATHER_PROFILES[weatherProfileId];
  const forecastMaxRain = Math.max(1, ...(weatherSummary?.forecast?.days.map((day) => day.precipitationMm ?? 0) ?? []));

  return <Screen>
    <Text style={commonStyles.title}>Razmere</Text>
    {!online ? <Notice tone="warning">Ni povezave. Prikazani so lahko zadnji predpomnjeni podatki z označenim časom osvežitve.</Notice> : null}
    <Card>
      <SectionTitle>Lokacija</SectionTitle>
      <View style={commonStyles.wrap}>
        <Chip label="Moja lokacija" selected={locationMode === 'gps'} onPress={() => void acquireCurrent()} />
        <Chip label="Izberi lokacijo" selected={locationMode === 'manual'} onPress={() => { locationRequestId.current += 1; setGpsLoading(false); setLocationMode('manual'); setPlaceSearchOpen(!selectedPlace); setError(undefined); setLocationNotice(undefined); }} />
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
        <AppButton title="Prikaži na zemljevidu" variant="secondary" onPress={() => showOnMap(selectedPlace)} />
        <AppButton title="Spremeni lokacijo" variant="secondary" onPress={() => setPlaceSearchOpen(true)} />
      </View> : null}
      {locationMode === 'manual' && placeSearchOpen ? <View style={styles.searchArea}>
        <Field label="Poišči mesto ali kraj" placeholder="Npr. Črna na Koroškem" value={placeQuery} onChangeText={setPlaceQuery} autoCapitalize="words" autoCorrect={false} />
        {placeSearchLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {placeSearchError ? <Notice tone="warning">{placeSearchError}</Notice> : null}
        {placeResults.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => {
          locationRequestId.current += 1; setGpsLoading(false);
          const next: ExploreLocation = { name: place.name, latitude: place.latitude, longitude: place.longitude, admin1: place.admin1, admin2: place.admin2, country: place.country, source: 'place' };
          setSelectedPlace(next); setExploreLocation(next); setLocationMode('manual'); setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); setError(undefined);
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
    {locationNotice ? <Notice tone="info">{locationNotice}</Notice> : null}
    {weatherSummary?.errors.historical ? <Notice tone="warning">{weatherSummary.errors.historical}</Notice> : null}
    {weatherSummary?.errors.forecast ? <Notice tone="warning">{weatherSummary.errors.forecast}</Notice> : null}
    {weatherSummary ? <>
      {weatherSummary.current ? <Card><SectionTitle>Trenutno</SectionTitle>
        <View style={styles.currentRow}><Text style={styles.currentTemperature}>{weatherSummary.current.temperatureC == null ? '—' : `${slNumber(weatherSummary.current.temperatureC)} °C`}</Text><Text style={commonStyles.heading}>{weatherSummary.current.weatherDescription ?? 'Opis vremena ni na voljo'}</Text></View>
        {weatherSummary.current.soilMoisture0To7Cm != null ? <Text style={commonStyles.body}>Vlaga tal 0–7 cm: {slNumber(weatherSummary.current.soilMoisture0To7Cm, 3)} m³/m³</Text> : null}
        {weatherSummary.current.soilMoisture7To28Cm != null ? <Text style={commonStyles.body}>Vlaga tal 7–28 cm: {slNumber(weatherSummary.current.soilMoisture7To28Cm, 3)} m³/m³</Text> : null}
      </Card> : null}

      {weatherSummary.historical ? <>
        <Card><SectionTitle>Pretekle padavine</SectionTitle><View style={styles.metrics}>
          <Metric label="Zadnje 3 dni" value={weatherSummary.historical.rain3dMm == null ? '—' : `${slNumber(weatherSummary.historical.rain3dMm)} mm`} />
          <Metric label="Zadnjih 7 dni" value={weatherSummary.historical.rain7dMm == null ? '—' : `${slNumber(weatherSummary.historical.rain7dMm)} mm`} />
          <Metric label="Zadnjih 14 dni" value={weatherSummary.historical.rain14dMm == null ? '—' : `${slNumber(weatherSummary.historical.rain14dMm)} mm`} />
          <Metric label="Zadnjih 30 dni" value={weatherSummary.historical.rain30dMm == null ? '—' : `${slNumber(weatherSummary.historical.rain30dMm)} mm`} />
        </View><Text style={commonStyles.muted}>To so modelirani oziroma reanalizirani pretekli podatki. Prihodnja napoved ni vključena.</Text></Card>
        <Card><SectionTitle>Temperatura</SectionTitle><View style={styles.metrics}>
          <Metric label="Povprečje 7 dni" value={weatherSummary.historical.avgTemp7dC == null ? '—' : `${slNumber(weatherSummary.historical.avgTemp7dC)} °C`} />
          <Metric label="Povprečje 14 dni" value={weatherSummary.historical.avgTemp14dC == null ? '—' : `${slNumber(weatherSummary.historical.avgTemp14dC)} °C`} />
          <Metric label="Povprečje 20 dni" value={weatherSummary.historical.avgTemp20dC == null ? '—' : `${slNumber(weatherSummary.historical.avgTemp20dC)} °C`} />
          <Metric label="ET₀ zadnjih 7 dni" value={weatherSummary.historical.evapotranspiration7dMm == null ? '—' : `${slNumber(weatherSummary.historical.evapotranspiration7dMm)} mm`} />
        </View><Text style={commonStyles.muted}>ET₀ je referenčna evapotranspiracija in služi samo kot približen signal izsuševanja.</Text></Card>
      </> : null}

      {weatherSummary.forecast ? <Card><SectionTitle>Naslednjih 7 dni</SectionTitle>
        <View style={styles.metrics}><Metric label="Naslednji 3 dnevi" value={weatherSummary.forecast.rain3dMm == null ? '—' : `${slNumber(weatherSummary.forecast.rain3dMm)} mm`} /><Metric label="Naslednjih 7 dni" value={weatherSummary.forecast.rain7dMm == null ? '—' : `${slNumber(weatherSummary.forecast.rain7dMm)} mm`} /></View>
        <View style={styles.forecastList}>{weatherSummary.forecast.days.map((day, index) => <View key={day.date} style={styles.forecastDay}>
          <View style={styles.forecastLabel}><Text style={commonStyles.body}>{index === 0 ? 'Danes' : index === 1 ? 'Jutri' : new Date(`${day.date}T12:00:00`).toLocaleDateString('sl-SI', { weekday: 'short' })}</Text><Text style={commonStyles.muted}>{day.temperatureMinC == null || day.temperatureMaxC == null ? '—' : `${slNumber(day.temperatureMinC, 0)}–${slNumber(day.temperatureMaxC, 0)} °C`}</Text></View>
          <View style={styles.rainTrack}><View style={[styles.rainBar, { width: `${Math.max(3, 100 * (day.precipitationMm ?? 0) / forecastMaxRain)}%` }]} /></View>
          <Text style={styles.forecastRain}>{day.precipitationMm == null ? '—' : `${slNumber(day.precipitationMm)} mm`}</Text>
        </View>)}</View>
        <Text style={commonStyles.muted}>{weatherProfile.forecastNote}</Text>
      </Card> : null}

      <Card><Text style={commonStyles.body}>Vremenski profil</Text><View style={commonStyles.wrap}>
        <Chip label="Splošno" selected={weatherProfileId === 'generic'} onPress={() => setWeatherProfileId('generic')} />
        <Chip label="Jesenski goban" selected={weatherProfileId === 'boletusEdulis'} onPress={() => setWeatherProfileId('boletusEdulis')} />
        <Chip label="Navadna lisička" selected={weatherProfileId === 'cantharellusCibarius'} onPress={() => setWeatherProfileId('cantharellusCibarius')} />
        <Chip label="Užitna sirovka" selected={weatherProfileId === 'lactariusDeliciosus'} onPress={() => setWeatherProfileId('lactariusDeliciosus')} />
      </View><Text style={commonStyles.muted}>Vrsta spremeni samo način izračuna iz istih vremenskih podatkov.</Text></Card>

      <Card><SectionTitle>{weatherProfile.scoreTitle}</SectionTitle>
        {weatherProfile.scientificName ? <Text style={commonStyles.muted}>{weatherProfile.scientificName}</Text> : null}
        <View style={styles.scoreRow}><View><Text style={commonStyles.muted}>{weatherProfile.scoreCaption}</Text><Text style={styles.score}>{score.score != null ? `${score.score}` : '—'}</Text></View><View style={styles.scoreCopy}><Text style={commonStyles.heading}>{score.label}</Text><Text style={commonStyles.body}>Trend: {score.trend}</Text><Text style={commonStyles.muted}>{score.coverage}</Text></View></View>{score.reasons.map((reason) => <Text key={reason} style={commonStyles.body}>• {reason}</Text>)}{weatherProfile.seasonNote ? <Text style={commonStyles.muted}>{weatherProfile.seasonNote}</Text> : null}<Text style={commonStyles.muted}>Ocena temelji na vremenskih pogojih in ne zagotavlja pojava gob. Ni verjetnost uspeha ali znanstveno potrjen napovedni model.</Text></Card>

      <AppButton title={showWeatherDetails ? 'Skrij podrobnosti' : 'Podrobnosti'} variant="ghost" onPress={() => setShowWeatherDetails((visible) => !visible)} />
      {showWeatherDetails ? <WeatherProfileScoreDetails profileId={weatherProfileId} summary={weatherSummary} score={score} /> : null}
      <Text style={commonStyles.muted}>Open‑Meteo · posodobljeno {slDateTime(weatherSummary.updatedAt)}{weatherSummary.stale ? ' · predpomnjeni podatki' : ''}</Text>
    </> : null}
    {hotspots.length ? <><SectionTitle>Kam po gobe?</SectionTitle>
    <Card><Text style={commonStyles.body}>Ciljna vrsta (neobvezno)</Text><View style={commonStyles.wrap}><Chip label="Splošno" selected={!speciesId} onPress={() => setSpeciesId(undefined)} />{speciesCatalogue.filter((item) => item.kind === 'species').slice(0, 6).map((species) => <Chip key={species.id} label={species.nameSl} selected={speciesId === species.id} onPress={() => setSpeciesId(species.id)} />)}</View><Text style={commonStyles.muted}>Če ni dovolj osebne zgodovine za vrsto, ostane ocena splošna in tega ne šteje kot slabost.</Text></Card>
    {ranked.map((entry, index) => <Pressable key={entry.hotspot.id} onPress={() => { requestHotspotFocus(entry.hotspot); navigation.navigate('Tabs', { screen: 'Map' }); }}><Card><View style={styles.rankRow}><Text style={styles.rank}>{index + 1}</Text><View style={styles.rankCopy}><Text style={commonStyles.heading}>{entry.hotspot.title?.trim() || coordinateLabel(entry.hotspot.latitude, entry.hotspot.longitude)}</Text><Text style={commonStyles.body}>{entry.score.score != null ? `${entry.score.score}/100 · ${entry.score.label}` : entry.score.label}</Text><Text style={commonStyles.muted}>{entry.score.reasons[0] ?? entry.score.coverage}{entry.distanceKm != null ? ` · ${slNumber(entry.distanceKm)} km zračne razdalje` : ''}</Text></View></View></Card></Pressable>)}</> : null}
    <Notice tone="info">Open-Meteo je zamenljiv ponudnik. Pred komercialno uporabo preverite njegove aktualne pogoje uporabe in zahteve glede navedbe vira.</Notice>
  </Screen>;
}

const debugNumber = (value: number | undefined, unit: string, digits = 1) => value == null ? 'ni podatka' : `${slNumber(value, digits)} ${unit}`;

function WeatherProfileScoreDetails({ profileId, summary, score }: { profileId: MushroomWeatherProfileId; summary: MushroomWeatherSummary; score: MushroomConditionsScore }) {
  if (profileId === 'boletusEdulis') return <BoletusScoreDetails summary={summary} score={score} />;
  if (profileId === 'cantharellusCibarius') return <ChanterelleScoreDetails summary={summary} score={score} />;
  if (profileId === 'lactariusDeliciosus') return <LactariusScoreDetails summary={summary} score={score} />;
  return <GenericScoreDetails summary={summary} score={score} />;
}

function GenericScoreDetails({ summary, score }: { summary: MushroomWeatherSummary; score: MushroomConditionsScore }) {
  return <Card><SectionTitle>Vhodni podatki in score</SectionTitle>
    <Text style={commonStyles.body}>rain3d: {debugNumber(summary.historical?.rain3dMm, 'mm')}</Text><Text style={commonStyles.body}>rain7d: {debugNumber(summary.historical?.rain7dMm, 'mm')}</Text><Text style={commonStyles.body}>rain14d: {debugNumber(summary.historical?.rain14dMm, 'mm')}</Text><Text style={commonStyles.body}>rain30d: {debugNumber(summary.historical?.rain30dMm, 'mm')}</Text>
    <Text style={commonStyles.body}>avgTemp7d: {debugNumber(summary.historical?.avgTemp7dC, '°C')}</Text><Text style={commonStyles.body}>avgTemp14d: {debugNumber(summary.historical?.avgTemp14dC, '°C')}</Text><Text style={commonStyles.body}>avgTemp20d: {debugNumber(summary.historical?.avgTemp20dC, '°C')}</Text>
    <Text style={commonStyles.body}>soilMoisture 0–7 cm: {debugNumber(summary.current?.soilMoisture0To7Cm, 'm³/m³', 3)}</Text><Text style={commonStyles.body}>soilMoisture 7–28 cm: {debugNumber(summary.current?.soilMoisture7To28Cm, 'm³/m³', 3)}</Text>
    <Text style={commonStyles.body}>futureRain3d: {debugNumber(summary.forecast?.rain3dMm, 'mm')}</Text><Text style={commonStyles.body}>futureRain7d: {debugNumber(summary.forecast?.rain7dMm, 'mm')}</Text>
    {score.components.map((component) => <Text key={component.key} style={commonStyles.body}>{component.label}: {slNumber(component.value * 100, 0)} % × utež {component.weight} = {slNumber(component.weightedPoints, 1)}</Text>)}
    <Text style={commonStyles.muted}>Pokritost zgodovine: dež {summary.historical?.coverage.rain30dDays ?? 0}/30 dni, temperatura {summary.historical?.coverage.temp20dDays ?? 0}/20 dni.</Text>
  </Card>;
}

function BoletusScoreDetails({ summary, score }: { summary: MushroomWeatherSummary; score: MushroomConditionsScore }) {
  const contribution = (key: 'rain26' | 'temperature' | 'soilMoisture' | 'drying', maximum: number) => {
    const component = score.components.find((item) => item.key === key);
    return component ? `${slNumber(component.weightedPoints, 1)} / ${maximum}` : `ni podatka / ${maximum}`;
  };
  return <Card><SectionTitle>Kako je izračunana ocena?</SectionTitle>
    <Text style={commonStyles.heading}>Jesenski goban</Text><Text style={commonStyles.muted}>Boletus edulis</Text>
    <Text style={styles.detailHeading}>PADAVINE</Text>
    <DetailLine label="Zadnjih 26 dni" value={debugNumber(summary.historical?.rain26dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('rain26', BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.rain26)} />
    <Text style={styles.detailHeading}>TEMPERATURA</Text>
    <DetailLine label="Povprečje 20 dni" value={debugNumber(summary.historical?.avgTemp20dC, '°C')} />
    <DetailLine label="Optimalna referenca" value={`~${BOLETUS_EDULIS_SCORE_V1_CONFIG.temperature.optimumC} °C`} />
    <DetailLine label="Prispevek" value={contribution('temperature', BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.temperature)} />
    <Text style={styles.detailHeading}>VLAGA TAL</Text>
    <DetailLine label="0–7 cm" value={debugNumber(summary.current?.soilMoisture0To7Cm, 'm³/m³', 3)} />
    <DetailLine label="7–28 cm" value={debugNumber(summary.current?.soilMoisture7To28Cm, 'm³/m³', 3)} />
    <DetailLine label="Prispevek" value={contribution('soilMoisture', BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.soilMoisture)} />
    <Text style={styles.detailHeading}>IZSUŠEVANJE</Text>
    <DetailLine label="ET₀ zadnjih 7 dni" value={debugNumber(summary.historical?.evapotranspiration7dMm, 'mm')} />
    <DetailLine label="Padavine 7 dni" value={debugNumber(summary.historical?.rain7dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('drying', BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.drying)} />
    <Text style={styles.detailHeading}>SKUPAJ</Text>
    <DetailLine label="Eksperimentalna ocena" value={score.score == null ? 'ni podatka' : `${score.score} / 100`} />
    <Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES.boletusEdulis.tuningNote} Če signal manjka, se njegove uteži izločijo in preostale transparentno preračunajo na 100 %.</Text>
  </Card>;
}

function ChanterelleScoreDetails({ summary, score }: { summary: MushroomWeatherSummary; score: MushroomConditionsScore }) {
  const contribution = (key: 'rain30' | 'rain7' | 'temperature' | 'soilMoisture' | 'drying', maximum: number) => {
    const component = score.components.find((item) => item.key === key);
    return component ? `${slNumber(component.weightedPoints, 1)} / ${maximum}` : `ni podatka / ${maximum}`;
  };
  const config = CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG;
  return <Card><SectionTitle>Kako je izračunana ocena?</SectionTitle>
    <Text style={commonStyles.heading}>Navadna lisička</Text><Text style={commonStyles.muted}>Cantharellus cibarius</Text>
    <Text style={styles.detailHeading}>DALJŠA NAVLAŽENOST</Text>
    <DetailLine label="Padavine 30 dni" value={debugNumber(summary.historical?.rain30dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('rain30', config.componentWeights.rain30)} />
    <Text style={styles.detailHeading}>NEDAVNE PADAVINE</Text>
    <DetailLine label="Padavine 7 dni" value={debugNumber(summary.historical?.rain7dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('rain7', config.componentWeights.rain7)} />
    <Text style={styles.detailHeading}>TEMPERATURA</Text>
    <DetailLine label="Povprečje 14 dni" value={debugNumber(summary.historical?.avgTemp14dC, '°C')} />
    <DetailLine label="Raziskovalni kontekst" value={`${config.temperature.researchContextMinC}–${config.temperature.researchContextMaxC} °C · ena evropska študija`} />
    <DetailLine label="Prispevek" value={contribution('temperature', config.componentWeights.temperature)} />
    <Text style={styles.detailHeading}>VLAGA TAL</Text>
    <DetailLine label="0–7 cm" value={debugNumber(summary.current?.soilMoisture0To7Cm, 'm³/m³', 3)} />
    <DetailLine label="7–28 cm" value={debugNumber(summary.current?.soilMoisture7To28Cm, 'm³/m³', 3)} />
    <DetailLine label="Prispevek" value={contribution('soilMoisture', config.componentWeights.soilMoisture)} />
    <Text style={styles.detailHeading}>IZSUŠEVANJE</Text>
    <DetailLine label="ET₀ zadnjih 7 dni" value={debugNumber(summary.historical?.evapotranspiration7dMm, 'mm')} />
    <DetailLine label="Padavine 7 dni" value={debugNumber(summary.historical?.rain7dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('drying', config.componentWeights.drying)} />
    <Text style={styles.detailHeading}>SKUPAJ</Text>
    <DetailLine label="Vremenske razmere" value={score.score == null ? 'ni podatka' : `${score.score} / 100`} />
    <Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES.cantharellusCibarius.tuningNote} Če signal manjka, se njegove uteži izločijo in preostale transparentno preračunajo na 100 %.</Text>
  </Card>;
}

function LactariusScoreDetails({ summary, score }: { summary: MushroomWeatherSummary; score: MushroomConditionsScore }) {
  const contribution = (key: 'rain60' | 'rain14' | 'soilMoisture' | 'temperature' | 'drying', maximum: number) => {
    const component = score.components.find((item) => item.key === key);
    return component ? `${slNumber(component.weightedPoints, 1)} / ${maximum}` : `ni podatka / ${maximum}`;
  };
  const config = LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG;
  return <Card><SectionTitle>Kako je izračunana ocena?</SectionTitle>
    <Text style={commonStyles.heading}>Užitna sirovka</Text><Text style={commonStyles.muted}>Lactarius deliciosus</Text>
    <Text style={styles.detailHeading}>DOLGOROČNA NAVLAŽENOST</Text>
    <DetailLine label="Padavine 60 dni" value={debugNumber(summary.historical?.rain60dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('rain60', config.componentWeights.rain60)} />
    <Text style={styles.detailHeading}>NEDAVNE PADAVINE</Text>
    <DetailLine label="Padavine 14 dni" value={debugNumber(summary.historical?.rain14dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('rain14', config.componentWeights.rain14)} />
    <Text style={styles.detailHeading}>VLAGA TAL</Text>
    <DetailLine label="0–7 cm" value={debugNumber(summary.current?.soilMoisture0To7Cm, 'm³/m³', 3)} />
    <DetailLine label="7–28 cm" value={debugNumber(summary.current?.soilMoisture7To28Cm, 'm³/m³', 3)} />
    <DetailLine label="Prispevek" value={contribution('soilMoisture', config.componentWeights.soilMoisture)} />
    <Text style={styles.detailHeading}>TEMPERATURA</Text>
    <DetailLine label="Povprečje 20 dni" value={debugNumber(summary.historical?.avgTemp20dC, '°C')} />
    <DetailLine label="Prispevek" value={contribution('temperature', config.componentWeights.temperature)} />
    <Text style={commonStyles.muted}>Model uporablja široko jesensko temperaturno območje in postopno zmanjšuje signal ob dolgotrajno visokih temperaturah. Pragovi niso biološki optimum.</Text>
    <Text style={styles.detailHeading}>IZSUŠEVANJE</Text>
    <DetailLine label="ET₀ zadnjih 7 dni" value={debugNumber(summary.historical?.evapotranspiration7dMm, 'mm')} />
    <DetailLine label="Padavine 7 dni" value={debugNumber(summary.historical?.rain7dMm, 'mm')} />
    <DetailLine label="Prispevek" value={contribution('drying', config.componentWeights.drying)} />
    <Text style={styles.detailHeading}>SKUPAJ</Text>
    <DetailLine label="Vremenske razmere" value={score.score == null ? 'ni podatka' : `${score.score} / 100`} />
    <Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES.lactariusDeliciosus.tuningNote} Če opcijski signal manjka, se njegova utež izloči in preostale se transparentno preračunajo na 100 %.</Text>
  </Card>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={commonStyles.body}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={commonStyles.muted}>{label}</Text><Text style={commonStyles.heading}>{value}</Text></View>; }
const styles = StyleSheet.create({
  locationSummary: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  searchArea: { gap: spacing.sm },
  placeResult: { padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  placeResultPressed: { opacity: 0.75 },
  currentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing.md }, currentTemperature: { color: colors.primary, fontSize: 42, lineHeight: 48, fontWeight: '900' },
  scoreRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }, score: { fontSize: 54, lineHeight: 60, color: colors.primary, fontWeight: '900' }, scoreCopy: { flex: 1, gap: spacing.xs },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, flexBasis: '45%', padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceSoft },
  forecastList: { gap: spacing.sm }, forecastDay: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, forecastLabel: { width: 82 }, rainTrack: { flex: 1, height: 10, overflow: 'hidden', borderRadius: radii.round, backgroundColor: colors.surfaceSoft }, rainBar: { height: '100%', borderRadius: radii.round, backgroundColor: colors.info }, forecastRain: { width: 62, color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  detailHeading: { marginTop: spacing.sm, color: colors.primary, fontSize: 13, fontWeight: '800', letterSpacing: 0.8 }, detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md }, detailValue: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  rankRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' }, rank: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, color: colors.white, textAlign: 'center', textAlignVertical: 'center', fontSize: 20, fontWeight: '800' }, rankCopy: { flex: 1 },
});
