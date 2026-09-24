import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, Marker, UserLocation, type CameraRef, type FillLayerSpecification, type LineLayerSpecification } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Chip, EmptyState, Field, Notice, Screen, StatusPill, commonStyles } from '../components/ui';
import { useApp } from '../state/AppContext';
import type { RootStackParamList, TabsParamList } from '../navigation/types';
import { colors, radii, spacing } from '../theme';
import { normalizeSearch } from '../domain/species';
import { listFriendHotspots, type FriendHotspot } from '../services/friends';
import { searchLocations, type PlaceSearchResult } from '../services/weather';
import type { MushroomWeatherProfileId } from '../domain/types';
import type { HeatmapAreaAssessment, HeatmapTargetDay } from '../domain/heatmap/types';
import { buildHeatmapRenderCollection, HEATMAP_HABITAT, HEATMAP_PILOT_METADATA } from '../domain/heatmap/pilot';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { slNumber } from '../domain/format';
import { createHeatmapRequestGate, loadHeatmapPilot, weatherAssessmentsFor, type HeatmapPilotBundle } from '../services/heatmap/pilotHeatmap';
import { resolveHeatmapAreaLocality, type HeatmapAreaLocalityResolution } from '../services/heatmap/areaLocality';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const SLOVENIA_CENTER: [number, number] = [14.82, 46.12];

const HEATMAP_FILL_PAINT: FillLayerSpecification['paint'] = {
  'fill-color': ['match', ['get', 'renderState'],
    'poor', '#A96B50',
    'average', '#C7A85A',
    'good', '#7EA46E',
    'very-good', '#3F7C57',
    'excellent', '#174E3D',
    'limited', '#B7AE90',
    'unknown', '#8B9190',
    'outside', '#D8D2C5',
    '#A6A6A6'],
  'fill-opacity': ['match', ['get', 'renderState'],
    'outside', 0.22,
    'unknown', 0.38,
    'limited', 0.45,
    'insufficient', 0.3,
    0.62],
};

const HEATMAP_BORDER_PAINT: LineLayerSpecification['paint'] = {
  'line-color': '#FFFDF7',
  'line-width': 0.6,
  'line-opacity': 0.65,
};

const HEATMAP_SELECTED_PAINT: LineLayerSpecification['paint'] = {
  'line-color': '#173F35',
  'line-width': 3,
  'line-opacity': 1,
};

const placeDetails = (place: PlaceSearchResult) => {
  const values = [place.admin2, place.admin1, place.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== place.name);
  return [...new Set(values)].join(', ');
};

export function MapScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<TabsParamList, 'Map'>>();
  const {
    hotspots, finds, session, exploreLocation, setExploreLocation, pendingHotspotFocus, clearHotspotFocus,
    heatmapNavigation, updateHeatmapNavigation,
  } = useApp();
  const camera = useRef<CameraRef>(null);
  const suppressMapPressUntil = useRef(0);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<'mine' | 'friends'>('mine');
  const [friendHotspots, setFriendHotspots] = useState<FriendHotspot[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string>();
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string>();
  const [cameraTarget, setCameraTarget] = useState<{ center: [number, number]; zoom: number; focusRequestId?: string }>();
  const { enabled: heatmapEnabled, profileId: heatmapProfileId, targetDay: heatmapTargetDay, selectedAreaId: selectedHeatmapAreaId } = heatmapNavigation;
  const [heatmapBundle, setHeatmapBundle] = useState<HeatmapPilotBundle>();
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string>();
  const [heatmapRetry, setHeatmapRetry] = useState(0);
  const [heatmapControlsVisible, setHeatmapControlsVisible] = useState(true);
  const [mapViewportHeight, setMapViewportHeight] = useState(0);
  const heatmapRequestGate = useRef(createHeatmapRequestGate()).current;
  useEffect(() => {
    if (!session) { setFriendHotspots([]); return; }
    void listFriendHotspots().then(setFriendHotspots).catch((error) => setLocationMessage(error instanceof Error ? error.message : 'Rastišč prijateljev ni mogoče naložiti.'));
  }, [session?.user.id]);
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then(({ granted }) => setLocationGranted(granted));
  }, []);
  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    return hotspots.filter((hotspot) => {
      const species = finds.filter((find) => find.hotspotId === hotspot.id).flatMap((find) => find.items.map((item) => item.customName ?? item.speciesId ?? ''));
      return !q || normalizeSearch(`${hotspot.title ?? ''} ${species.join(' ')}`).includes(q);
    });
  }, [finds, hotspots, query]);
  const selected = hotspots.find((item) => item.id === selectedId);
  const searchOpen = query.trim().length >= 2;
  const heatmapView = useMemo(() => {
    if (!heatmapBundle) return undefined;
    return buildHeatmapRenderCollection(
      weatherAssessmentsFor(heatmapBundle, heatmapProfileId, heatmapTargetDay),
    );
  }, [heatmapBundle, heatmapProfileId, heatmapTargetDay]);
  const selectedHeatmapArea = selectedHeatmapAreaId ? heatmapView?.assessments[selectedHeatmapAreaId] : undefined;
  const selectedHeatmapFeature = selectedHeatmapAreaId
    ? HEATMAP_HABITAT.features.find((feature) => feature.properties.id === selectedHeatmapAreaId)
    : undefined;
  const heatmapAreaLocality = useMemo<HeatmapAreaLocalityResolution | undefined>(() => {
    if (!selectedHeatmapFeature) return undefined;
    const { id, centerLatitude, centerLongitude } = selectedHeatmapFeature.properties;
    return resolveHeatmapAreaLocality(id, centerLatitude, centerLongitude);
  }, [selectedHeatmapFeature?.properties.id]);

  useEffect(() => () => heatmapRequestGate.invalidate(), [heatmapRequestGate]);

  useEffect(() => {
    if (!heatmapEnabled || heatmapBundle) return;
    const requestId = heatmapRequestGate.next();
    setHeatmapLoading(true);
    setHeatmapError(undefined);
    void loadHeatmapPilot(db, { force: heatmapRetry > 0 })
      .then((bundle) => {
        if (heatmapRequestGate.isCurrent(requestId)) setHeatmapBundle(bundle);
      })
      .catch((error) => {
        if (heatmapRequestGate.isCurrent(requestId)) {
          setHeatmapError(error instanceof Error ? error.message : 'Pogojev za območja trenutno ni mogoče naložiti.');
        }
      })
      .finally(() => {
        if (heatmapRequestGate.isCurrent(requestId)) setHeatmapLoading(false);
      });
  }, [db, heatmapBundle, heatmapEnabled, heatmapRequestGate, heatmapRetry]);

  useEffect(() => {
    if (!searchOpen) {
      setPlaceResults([]); setPlaceSearchError(undefined); setPlaceSearchLoading(false); return;
    }
    const controller = new AbortController();
    let active = true;
    setPlaceResults([]); setPlaceSearchLoading(true); setPlaceSearchError(undefined);
    const timeout = setTimeout(() => {
      void searchLocations(query, controller.signal)
        .then((results) => { if (active) setPlaceResults(results); })
        .catch((cause) => {
          if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
          setPlaceResults([]);
          setPlaceSearchError(cause instanceof Error ? cause.message : 'Krajev ni bilo mogoče poiskati.');
        })
        .finally(() => { if (active) setPlaceSearchLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [query, searchOpen]);

  useEffect(() => {
    if (mode !== 'map') setMapReady(false);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'map' || !mapReady || !cameraTarget || !camera.current) return;
    camera.current.easeTo({ center: cameraTarget.center, zoom: cameraTarget.zoom, duration: 700 });
    if (cameraTarget.focusRequestId) clearHotspotFocus(cameraTarget.focusRequestId);
    setCameraTarget(undefined);
  }, [cameraTarget, clearHotspotFocus, mapReady, mode]);

  useEffect(() => {
    if (!pendingHotspotFocus) return;
    setSelectedId(pendingHotspotFocus.hotspotId); setOwnerFilter('mine'); setMode('map');
    setCameraTarget({
      center: [pendingHotspotFocus.longitude, pendingHotspotFocus.latitude],
      zoom: 15,
      focusRequestId: pendingHotspotFocus.requestId,
    });
  }, [pendingHotspotFocus]);

  useEffect(() => {
    if (!route.params?.focusExploreLocationAt || !exploreLocation) return;
    setSelectedId(undefined); setMode('map');
    if (exploreLocation.source === 'heatmap') updateHeatmapNavigation({ enabled: true });
    setCameraTarget({ center: [exploreLocation.longitude, exploreLocation.latitude], zoom: exploreLocation.source === 'gps' ? 15 : 12 });
  }, [exploreLocation, route.params?.focusExploreLocationAt, updateHeatmapNavigation]);

  const focusHotspot = (hotspot: (typeof hotspots)[number]) => {
    setSelectedId(hotspot.id); setOwnerFilter('mine'); setMode('map');
    setCameraTarget({ center: [hotspot.longitude, hotspot.latitude], zoom: 15 });
  };

  const selectPlace = (place: PlaceSearchResult) => {
    Keyboard.dismiss(); setSelectedId(undefined); setMode('map'); setQuery('');
    setPlaceResults([]); setPlaceSearchError(undefined);
    setExploreLocation({ name: place.name, latitude: place.latitude, longitude: place.longitude, admin1: place.admin1, admin2: place.admin2, country: place.country, source: 'place' });
    setCameraTarget({ center: [place.longitude, place.latitude], zoom: 12 });
  };

  const selectHotspot = (hotspot: (typeof hotspots)[number]) => {
    Keyboard.dismiss(); focusHotspot(hotspot); setQuery('');
    setPlaceResults([]); setPlaceSearchError(undefined);
  };

  const recenter = async () => {
    setLocating(true); setLocationMessage(undefined);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled && Platform.OS === 'android') await Location.enableNetworkProviderAsync();
      else if (!servicesEnabled) { setLocationMessage('Vključite lokacijske storitve in poskusite znova.'); return; }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { setLocationMessage('Lokacija ni dovoljena. Rastišča lahko še vedno izberete na seznamu ali ročno.'); return; }
      setLocationGranted(true);
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 250 });
      const current = last ?? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Lokacije ni bilo mogoče hitro pridobiti.')), 12_000)),
      ]);
      setSelectedId(undefined);
      camera.current?.easeTo({ center: [current.coords.longitude, current.coords.latitude], zoom: 15, duration: 700 });
      setExploreLocation({ name: 'Moja lokacija', latitude: current.coords.latitude, longitude: current.coords.longitude, source: 'gps' });
      if ((current.coords.accuracy ?? 0) > 100) setLocationMessage(`Lokacija je manj natančna (±${Math.round(current.coords.accuracy ?? 0)} m).`);
    } catch (error) { setLocationMessage(error instanceof Error ? error.message : 'Lokacija ni na voljo.'); }
    finally { setLocating(false); }
  };

  return <Screen scroll={false} style={styles.screen}>
    <View style={styles.header}>
      <View><Text style={commonStyles.title}>Rastišča</Text><Text style={commonStyles.muted}>{hotspots.length} shranjenih lokacij</Text></View>
      <View style={commonStyles.row}><Chip label="Zemljevid" selected={mode === 'map'} onPress={() => setMode('map')} /><Chip label="Seznam" selected={mode === 'list'} onPress={() => setMode('list')} /></View>
    </View>
    <View style={styles.controls}>
      <Field label="Poišči" placeholder="Poišči kraj, rastišče ali vrsto" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
      <View style={styles.mapModeSwitch} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: !heatmapEnabled }}
          accessibilityLabel="Način Rastišča"
          onPress={() => updateHeatmapNavigation({ enabled: false })}
          style={({ pressed }) => [styles.mapModeOption, !heatmapEnabled && styles.mapModeOptionActive, pressed && styles.mapModeOptionPressed]}
        >
          <Ionicons name="map-outline" size={18} color={!heatmapEnabled ? colors.white : colors.primary} />
          <Text style={[styles.mapModeText, !heatmapEnabled && styles.mapModeTextActive]}>Rastišča</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: heatmapEnabled }}
          accessibilityLabel="Način Pogoji"
          onPress={() => {
            setHeatmapControlsVisible(true);
            updateHeatmapNavigation({ enabled: true });
            setSelectedId(undefined);
            setCameraTarget(heatmapNavigation.viewport ?? {
              center: [HEATMAP_PILOT_METADATA.center.longitude, HEATMAP_PILOT_METADATA.center.latitude],
              zoom: 9,
            });
          }}
          style={({ pressed }) => [styles.mapModeOption, heatmapEnabled && styles.mapModeOptionActive, pressed && styles.mapModeOptionPressed]}
        >
          <Ionicons name="layers-outline" size={18} color={heatmapEnabled ? colors.white : colors.primary} />
          <Text style={[styles.mapModeText, heatmapEnabled && styles.mapModeTextActive]}>Pogoji</Text>
        </Pressable>
      </View>
      {searchOpen ? <View style={styles.searchPanel}>
        <ScrollView style={styles.searchScroll} contentContainerStyle={styles.searchContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {placeSearchLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {placeResults.length ? <><Text style={styles.searchSectionTitle}>Kraji</Text>{placeResults.map((place) => <Pressable key={`place-${place.id}`} accessibilityRole="button" onPress={() => selectPlace(place)} style={({ pressed }) => [styles.searchResult, pressed && styles.searchResultPressed]}>
            <Ionicons name="location-outline" size={21} color={colors.primary} />
            <View style={styles.grow}><Text style={styles.searchResultTitle}>{place.name}</Text>{placeDetails(place) ? <Text style={commonStyles.muted}>{placeDetails(place)}</Text> : null}</View>
          </Pressable>)}</> : null}
          {filtered.length ? <><Text style={styles.searchSectionTitle}>Moja rastišča</Text>{filtered.slice(0, 6).map((hotspot) => <Pressable key={`hotspot-${hotspot.id}`} accessibilityRole="button" onPress={() => selectHotspot(hotspot)} style={({ pressed }) => [styles.searchResult, pressed && styles.searchResultPressed]}>
            <Image source={require('../../assets/mushroom-icon.png')} style={styles.searchResultIcon} />
            <View style={styles.grow}><Text style={styles.searchResultTitle}>{hotspot.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{hotspot.latitude.toFixed(4)}, {hotspot.longitude.toFixed(4)} · {finds.filter((find) => find.hotspotId === hotspot.id).length} obiskov</Text></View>
          </Pressable>)}</> : null}
          {placeSearchError ? <Notice tone="warning">Iskanje krajev trenutno ni na voljo. Med svojimi rastišči lahko še vedno iščete.</Notice> : null}
          {!placeSearchLoading && !placeSearchError && !placeResults.length && !filtered.length ? <Text style={commonStyles.muted}>Ni rezultatov.</Text> : null}
        </ScrollView>
      </View> : null}
      {friendHotspots.length ? <View style={commonStyles.wrap}><Chip label="Moja rastišča" selected={ownerFilter === 'mine'} onPress={() => setOwnerFilter('mine')} /><Chip label="Rastišča prijateljev" selected={ownerFilter === 'friends'} onPress={() => setOwnerFilter('friends')} /></View> : null}
      {locationMessage ? <Notice tone="warning">{locationMessage}</Notice> : null}
    </View>
    {mode === 'map' ? <View
      style={styles.mapWrap}
      onLayout={({ nativeEvent }) => {
        const nextHeight = nativeEvent.layout.height;
        setMapViewportHeight((currentHeight) => Math.abs(currentHeight - nextHeight) > 1 ? nextHeight : currentHeight);
      }}
    >
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        androidView="texture"
        attribution
        attributionPosition={{ bottom: spacing.sm, left: spacing.sm }}
        logo={false}
        scaleBar={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionDidChange={(event) => {
          if (!heatmapEnabled) return;
          const [longitude, latitude] = event.nativeEvent.center;
          const { zoom } = event.nativeEvent;
          if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(zoom)) {
            updateHeatmapNavigation({ viewport: { center: [longitude, latitude], zoom } });
          }
        }}
        onPress={() => {
          if (Date.now() <= suppressMapPressUntil.current) return;
          setSelectedId(undefined);
          updateHeatmapNavigation({ selectedAreaId: undefined });
        }}
        onLongPress={(event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat;
          navigation.navigate('Record', { latitude, longitude });
        }}
      >
        <Camera ref={camera} initialViewState={heatmapNavigation.viewport ?? { center: SLOVENIA_CENTER, zoom: 7 }} />
        {heatmapEnabled && heatmapView ? <GeoJSONSource
          id="mushroom-heatmap-pilot"
          data={heatmapView.collection}
          onPress={(event) => {
            event.stopPropagation();
            const areaId = event.nativeEvent.features[0]?.properties?.id;
            if (typeof areaId === 'string') {
              setSelectedId(undefined);
              updateHeatmapNavigation({ selectedAreaId: areaId });
            }
          }}
        >
          <Layer id="mushroom-heatmap-fill" type="fill" paint={HEATMAP_FILL_PAINT} />
          <Layer id="mushroom-heatmap-borders" type="line" paint={HEATMAP_BORDER_PAINT} />
          {selectedHeatmapAreaId ? <Layer
            id="mushroom-heatmap-selected"
            type="line"
            filter={['==', ['get', 'id'], selectedHeatmapAreaId]}
            paint={HEATMAP_SELECTED_PAINT}
          /> : null}
        </GeoJSONSource> : null}
        {locationGranted ? <UserLocation animated accuracy minDisplacement={3} /> : null}
        {ownerFilter === 'mine' ? filtered.map((hotspot) => <Marker key={hotspot.id} id={hotspot.id} lngLat={[hotspot.longitude, hotspot.latitude]} anchor="bottom" onPress={(event) => {
          event.stopPropagation();
          suppressMapPressUntil.current = Date.now() + 300;
          updateHeatmapNavigation({ selectedAreaId: undefined });
          focusHotspot(hotspot);
        }}>
          <View style={[styles.markerShell, selectedId === hotspot.id && styles.markerSelected]}>
            <Image source={require('../../assets/mushroom-icon.png')} style={styles.marker} />
          </View>
        </Marker>) : friendHotspots.map((hotspot) => <Marker key={hotspot.id} id={hotspot.id} lngLat={[hotspot.longitude, hotspot.latitude]} anchor="bottom">
          <View style={styles.friendMarker}><Ionicons name="people" size={20} color={colors.white} /></View>
        </Marker>)}
      </Map>
      <Pressable accessibilityLabel="Prikaži mojo lokacijo" onPress={() => void recenter()} style={styles.recenter}><Ionicons name="locate" size={25} color={colors.primary} /></Pressable>
      {heatmapEnabled && heatmapControlsVisible ? <View style={styles.heatmapControls}>
        <View style={styles.heatmapControlsHeader}>
          <Text style={styles.heatmapControlLabel}>VRSTA</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skrij izbiro pogojev"
            hitSlop={8}
            onPress={() => setHeatmapControlsVisible(false)}
            style={({ pressed }) => [styles.closeButton, styles.heatmapControlsClose, pressed && styles.closeButtonPressed]}
          >
            <Ionicons name="close" size={21} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatmapChipRow}>
          {(Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map((profileId) => <Chip key={profileId} label={MUSHROOM_WEATHER_PROFILES[profileId].label} selected={heatmapProfileId === profileId} onPress={() => updateHeatmapNavigation({ profileId })} />)}
        </ScrollView>
        <View style={styles.heatmapDateRow}><Text style={styles.heatmapControlLabel}>DATUM</Text><Chip label="Danes" selected={heatmapTargetDay === 'today'} onPress={() => updateHeatmapNavigation({ targetDay: 'today' })} /><Chip label="Jutri" selected={heatmapTargetDay === 'tomorrow'} onPress={() => updateHeatmapNavigation({ targetDay: 'tomorrow' })} /></View>
        <View style={styles.heatmapLegend}><View style={[styles.legendDot, { backgroundColor: '#A96B50' }]} /><Text style={styles.legendText}>slabe</Text><View style={[styles.legendDot, { backgroundColor: '#C7A85A' }]} /><View style={[styles.legendDot, { backgroundColor: '#7EA46E' }]} /><View style={[styles.legendDot, { backgroundColor: '#3F7C57' }]} /><View style={[styles.legendDot, { backgroundColor: '#174E3D' }]} /><Text style={styles.legendText}>odlične</Text><View style={[styles.legendDot, { backgroundColor: '#8B9190' }]} /><Text style={styles.legendText}>omejeno/neznano</Text></View>
        <Text style={styles.heatmapAttribution}>Habitat: ESA WorldCover 2021 + Zavod za gozdove Slovenije – podatki o sestojih · Vreme: Open-Meteo</Text>
        {heatmapLoading ? <View style={styles.heatmapStatus}><ActivityIndicator size="small" color={colors.primary} /><Text style={commonStyles.muted}>Nalagam realne habitatne in vremenske podatke …</Text></View> : null}
        {heatmapError ? <View style={styles.heatmapStatus}><Text style={styles.heatmapErrorText}>{heatmapError}</Text><Pressable accessibilityRole="button" onPress={() => { setHeatmapBundle(undefined); setHeatmapRetry((value) => value + 1); }}><Text style={styles.retryText}>Poskusi znova</Text></Pressable></View> : null}
      </View> : null}
      {exploreLocation && !selected && !heatmapEnabled ? <Pressable accessibilityRole="button" accessibilityLabel={`Poglej razmere za ${exploreLocation.name}`} onPress={() => navigation.navigate('Tabs', { screen: 'Conditions' })} style={({ pressed }) => [styles.conditionsAction, pressed && styles.searchResultPressed]}>
        <Ionicons name="cloud-outline" size={21} color={colors.primary} />
        <View style={styles.grow}><Text numberOfLines={1} style={styles.conditionsLocation}>{exploreLocation.name}</Text><Text style={styles.conditionsActionText}>Poglej razmere</Text></View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable> : null}
      {selected ? <Card style={styles.preview}>
        <View style={styles.previewTop}><View style={styles.grow}><Text style={commonStyles.heading}>{selected.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{finds.filter((find) => find.hotspotId === selected.id).length} obiskov</Text></View><StatusPill state={selected.syncState} /><Pressable accessibilityRole="button" accessibilityLabel="Zapri kartico rastišča" hitSlop={8} onPress={() => setSelectedId(undefined)} style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}><Ionicons name="close" size={21} color={colors.muted} /></Pressable></View>
        <AppButton title="Podrobnosti" variant="secondary" onPress={() => navigation.navigate('HotspotDetail', { hotspotId: selected.id })} />
      </Card> : null}
      {!selected && heatmapEnabled && selectedHeatmapArea && selectedHeatmapFeature ? <HeatmapAreaCard
        assessment={selectedHeatmapArea}
        targetDay={heatmapTargetDay}
        maxHeight={mapViewportHeight > 0 ? Math.floor(mapViewportHeight * 0.8) : undefined}
        areaLabel={heatmapAreaLocality?.location.name ?? 'Izbrano območje'}
        areaDetails={heatmapAreaLocality?.location.admin1 && heatmapAreaLocality?.location.country
          ? `${heatmapAreaLocality.location.admin1}, ${heatmapAreaLocality.location.country}`
          : undefined}
        onClose={() => updateHeatmapNavigation({ selectedAreaId: undefined })}
        onTargetDayChange={(targetDay) => updateHeatmapNavigation({ targetDay })}
        onOpenConditions={() => {
          const areaLocation = heatmapAreaLocality?.location ?? {
            name: 'Izbrano območje',
            latitude: selectedHeatmapFeature.properties.centerLatitude,
            longitude: selectedHeatmapFeature.properties.centerLongitude,
            source: 'heatmap',
          };
          setExploreLocation({ ...areaLocation, source: 'heatmap' });
          navigation.navigate('Tabs', { screen: 'Conditions' });
        }}
      /> : null}
      {locating ? <View style={styles.locating}><Text style={commonStyles.muted}>Pridobivam lokacijo …</Text></View> : null}
    </View> : <View style={styles.list}>{ownerFilter === 'friends' ? friendHotspots.map((hotspot) => <Pressable key={hotspot.id} onPress={() => void Linking.openURL(`geo:${hotspot.latitude},${hotspot.longitude}?q=${hotspot.latitude},${hotspot.longitude}`)}><Card><Text style={commonStyles.heading}>{hotspot.title || 'Deljeno rastišče'}</Text><Text style={commonStyles.muted}>@{hotspot.owner_username} · točna lokacija, izrecno deljena s prijatelji</Text></Card></Pressable>) : filtered.length ? filtered.map((hotspot) => <Pressable key={hotspot.id} onPress={() => navigation.navigate('HotspotDetail', { hotspotId: hotspot.id })}><Card><View style={styles.previewTop}><View style={styles.grow}><Text style={commonStyles.heading}>{hotspot.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{hotspot.latitude.toFixed(4)}, {hotspot.longitude.toFixed(4)} · {finds.filter((find) => find.hotspotId === hotspot.id).length} obiskov</Text></View><StatusPill state={hotspot.syncState} /></View></Card></Pressable>) : <EmptyState title={query.trim() ? 'Ni zadetkov med rastišči' : 'Še ni rastišč'} message={query.trim() ? 'Poskusite z drugim nazivom ali vrsto.' : 'Dodajte prvo rastišče z gumbom + ali z dolgim pritiskom na zemljevid.'} />}</View>}
  </Screen>;
}

const heatmapValue = (value: number | undefined, unit: string, digits = 1) =>
  value == null ? 'ni podatka' : `${slNumber(value, digits)} ${unit}`;

function heatmapInfluences(assessment: HeatmapAreaAssessment): Array<{ label: string; value: string }> {
  const history = assessment.summary.historical;
  const current = assessment.summary.current;
  const contribution = (key: string, maximum: number) => {
    const component = assessment.scoreDetails.components.find((item) => item.key === key);
    return component ? `${slNumber(component.weightedPoints, 1)} / ${maximum}` : `ni podatka / ${maximum}`;
  };
  if (assessment.speciesId === 'boletusEdulis') return [
    { label: 'Padavine 26 dni', value: `${heatmapValue(history?.rain26dMm, 'mm')} · ${contribution('rain26', 50)}` },
    { label: 'Temperatura 20 dni', value: `${heatmapValue(history?.avgTemp20dC, '°C')} · ${contribution('temperature', 30)}` },
    { label: 'Vlaga tal 0–7 / 7–28 cm', value: `${heatmapValue(current?.soilMoisture0To7Cm, 'm³/m³', 3)} / ${heatmapValue(current?.soilMoisture7To28Cm, 'm³/m³', 3)} · ${contribution('soilMoisture', 15)}` },
    { label: 'ET₀ / dež 7 dni', value: `${heatmapValue(history?.evapotranspiration7dMm, 'mm')} / ${heatmapValue(history?.rain7dMm, 'mm')} · ${contribution('drying', 5)}` },
  ];
  if (assessment.speciesId === 'cantharellusCibarius') return [
    { label: 'Padavine 30 dni', value: `${heatmapValue(history?.rain30dMm, 'mm')} · ${contribution('rain30', 40)}` },
    { label: 'Padavine 7 dni', value: `${heatmapValue(history?.rain7dMm, 'mm')} · ${contribution('rain7', 10)}` },
    { label: 'Temperatura 14 dni', value: `${heatmapValue(history?.avgTemp14dC, '°C')} · ${contribution('temperature', 25)}` },
    { label: 'Vlaga tal 0–7 / 7–28 cm', value: `${heatmapValue(current?.soilMoisture0To7Cm, 'm³/m³', 3)} / ${heatmapValue(current?.soilMoisture7To28Cm, 'm³/m³', 3)} · ${contribution('soilMoisture', 20)}` },
    { label: 'Izsuševanje', value: contribution('drying', 5) },
  ];
  if (assessment.speciesId === 'lactariusDeliciosus') return [
    { label: 'Padavine 60 dni', value: `${heatmapValue(history?.rain60dMm, 'mm')} · ${contribution('rain60', 35)}` },
    { label: 'Padavine 14 dni', value: `${heatmapValue(history?.rain14dMm, 'mm')} · ${contribution('rain14', 10)}` },
    { label: 'Temperatura 20 dni', value: `${heatmapValue(history?.avgTemp20dC, '°C')} · ${contribution('temperature', 25)}` },
    { label: 'Vlaga tal 0–7 / 7–28 cm', value: `${heatmapValue(current?.soilMoisture0To7Cm, 'm³/m³', 3)} / ${heatmapValue(current?.soilMoisture7To28Cm, 'm³/m³', 3)} · ${contribution('soilMoisture', 25)}` },
    { label: 'Izsuševanje', value: contribution('drying', 5) },
  ];
  return [
    { label: 'Padavine 7 / 14 / 30 dni', value: `${heatmapValue(history?.rain7dMm, 'mm')} / ${heatmapValue(history?.rain14dMm, 'mm')} / ${heatmapValue(history?.rain30dMm, 'mm')} · ${contribution('rain', 45)}` },
    { label: 'Temperatura 20 dni', value: `${heatmapValue(history?.avgTemp20dC, '°C')} · ${contribution('temperature', 25)}` },
    { label: 'Vlaga tal 0–7 / 7–28 cm', value: `${heatmapValue(current?.soilMoisture0To7Cm, 'm³/m³', 3)} / ${heatmapValue(current?.soilMoisture7To28Cm, 'm³/m³', 3)} · ${contribution('soilMoisture', 20)}` },
    { label: 'ET₀ / dež 7 dni', value: `${heatmapValue(history?.evapotranspiration7dMm, 'mm')} / ${heatmapValue(history?.rain7dMm, 'mm')} · ${contribution('drying', 10)}` },
  ];
}

function HeatmapAreaCard({ assessment, targetDay, maxHeight, areaLabel, areaDetails, onClose, onTargetDayChange, onOpenConditions }: { assessment: HeatmapAreaAssessment; targetDay: HeatmapTargetDay; maxHeight?: number; areaLabel: string; areaDetails?: string; onClose: () => void; onTargetDayChange: (targetDay: HeatmapTargetDay) => void; onOpenConditions: () => void }) {
  const profile = MUSHROOM_WEATHER_PROFILES[assessment.speciesId];
  const quality = assessment.dataQuality === 'complete' ? 'Popolni podatki' : assessment.dataQuality === 'limited' ? 'Omejeni podatki' : 'Ni dovolj podatkov';
  const habitat = assessment.habitatState === 'candidate'
    ? ['lactariusDeliciosus', 'boletusEdulis'].includes(assessment.speciesId) ? 'Potencialno ustrezno gozdno območje' : 'Potencialno habitatno območje'
    : assessment.habitatState === 'unknown'
      ? assessment.speciesId === 'lactariusDeliciosus' ? 'Bor ni dovolj potrjen'
        : assessment.speciesId === 'boletusEdulis' ? 'Gostiteljska drevesa niso dovolj potrjena' : 'Habitat ni potrjen'
      : 'Zunaj habitatnega modela';
  return <Card style={StyleSheet.flatten([styles.heatmapPreview, maxHeight ? { maxHeight } : undefined])}>
    <View style={styles.heatmapPreviewHeader}><View style={styles.grow}><Text style={commonStyles.heading}>{areaLabel}</Text>{areaDetails ? <Text style={commonStyles.muted}>{areaDetails}</Text> : null}<Text style={commonStyles.muted}>{profile.label}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Zapri podrobnosti območja" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}><Ionicons name="close" size={21} color={colors.muted} /></Pressable></View>
    <View style={styles.heatmapCardDateSwitch} accessibilityRole="tablist">
      {([['today', 'Danes'], ['tomorrow', 'Jutri']] as const).map(([day, label]) => <Pressable
        key={day}
        accessibilityRole="tab"
        accessibilityState={{ selected: targetDay === day }}
        accessibilityLabel={`Prikaži razmere za ${label.toLocaleLowerCase('sl')}`}
        onPress={() => onTargetDayChange(day)}
        style={({ pressed }) => [styles.heatmapCardDateOption, targetDay === day && styles.heatmapCardDateOptionActive, pressed && styles.mapModeOptionPressed]}
      >
        <Text style={[styles.heatmapCardDateText, targetDay === day && styles.heatmapCardDateTextActive]}>{label}</Text>
      </Pressable>)}
    </View>
    <View style={styles.heatmapScoreLine}><Text style={styles.heatmapAreaScore}>{assessment.score == null ? '—' : `${assessment.score} / 100`}</Text><Text style={styles.heatmapClassLabel}>{assessment.classLabel}</Text></View>
    <ScrollView
      style={styles.heatmapDetailsScroll}
      contentContainerStyle={styles.heatmapDetailsContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator
    >
      <Text style={styles.heatmapDetailTitle}>HABITAT</Text><Text style={commonStyles.body}>{habitat}</Text>
      {assessment.treeCompositionSource ? <Text style={commonStyles.muted}>Vir drevesne sestave: {assessment.treeCompositionSource}</Text> : null}
      <Text style={styles.heatmapDetailTitle}>KAKOVOST PODATKOV</Text><Text style={commonStyles.body}>{quality}</Text>
      <Text style={styles.heatmapDetailTitle}>GLAVNI VPLIVI</Text>
      {heatmapInfluences(assessment).map((row) => <View key={row.label} style={styles.heatmapInfluence}><Text style={styles.heatmapInfluenceLabel}>{row.label}</Text><Text style={styles.heatmapInfluenceValue}>{row.value}</Text></View>)}
      {assessment.limitations.slice(0, 3).map((limitation) => <Text key={limitation} style={commonStyles.muted}>• {limitation}</Text>)}
      <Text style={commonStyles.muted}>Eksperimentalna ocena vremenskih razmer in primernosti habitata. Ne predstavlja verjetnosti najdbe.</Text>
      <Text style={commonStyles.muted}>Karta ne potrjuje dostopa ali dovoljenja za nabiranje.</Text>
      <AppButton title="Poglej podrobne razmere" variant="secondary" onPress={onOpenConditions} />
    </ScrollView>
  </Card>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, padding: 0, gap: 0 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  mapModeSwitch: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: radii.round, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border },
  mapModeOption: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.round },
  mapModeOptionActive: { backgroundColor: colors.primary },
  mapModeOptionPressed: { opacity: 0.78 },
  mapModeText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  mapModeTextActive: { color: colors.white },
  searchPanel: { maxHeight: 270, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, overflow: 'hidden', elevation: 3 },
  searchScroll: { flexGrow: 0 },
  searchContent: { padding: spacing.sm, gap: spacing.xs },
  searchSectionTitle: { color: colors.primary, fontSize: 13, fontWeight: '800', paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  searchResult: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm },
  searchResultPressed: { backgroundColor: colors.surfaceSoft },
  searchResultTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  searchResultIcon: { width: 28, height: 28, borderRadius: 14 },
  mapWrap: { flex: 1, minHeight: 0, marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surfaceSoft },
  markerShell: { width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: colors.white, backgroundColor: colors.white, elevation: 4 },
  markerSelected: { borderColor: colors.secondary, transform: [{ scale: 1.12 }] }, marker: { width: 40, height: 40, borderRadius: 20 },
  friendMarker: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: colors.white, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  recenter: { position: 'absolute', right: spacing.lg, top: spacing.lg, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  conditionsAction: { position: 'absolute', left: spacing.md, top: spacing.md, maxWidth: '68%', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.round, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, elevation: 3 },
  conditionsLocation: { color: colors.text, fontSize: 13, fontWeight: '700' },
  conditionsActionText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  preview: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg }, previewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft }, closeButtonPressed: { opacity: 0.65 }, grow: { flex: 1 }, locating: { position: 'absolute', alignSelf: 'center', top: spacing.lg, backgroundColor: colors.surface, padding: spacing.sm, borderRadius: radii.round },
  heatmapControls: { position: 'absolute', left: spacing.sm, right: spacing.sm, top: 66, gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: 'rgba(255,253,247,0.96)', borderWidth: 1, borderColor: colors.border, elevation: 4 },
  heatmapControlsHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heatmapControlsClose: { width: 34, height: 34 },
  heatmapControlLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  heatmapChipRow: { gap: spacing.xs, paddingRight: spacing.md },
  heatmapDateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heatmapLegend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  heatmapAttribution: { color: colors.muted, fontSize: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.muted, fontSize: 10 },
  heatmapStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heatmapErrorText: { flex: 1, color: colors.danger, fontSize: 12 },
  retryText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  heatmapPreview: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, maxHeight: '80%', minHeight: 0, padding: spacing.md, gap: spacing.sm, elevation: 6, zIndex: 5 },
  heatmapPreviewHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  heatmapCardDateSwitch: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, gap: 3, borderRadius: radii.round, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border },
  heatmapCardDateOption: { minWidth: 82, minHeight: 36, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round },
  heatmapCardDateOptionActive: { backgroundColor: colors.primary },
  heatmapCardDateText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  heatmapCardDateTextActive: { color: colors.white },
  heatmapDetailsScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  heatmapDetailsContent: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  heatmapScoreLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  heatmapAreaScore: { color: colors.primary, fontSize: 27, fontWeight: '900' },
  heatmapClassLabel: { flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  heatmapDetailTitle: { marginTop: spacing.xs, color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  heatmapInfluence: { paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  heatmapInfluenceLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  heatmapInfluenceValue: { color: colors.text, fontSize: 12, fontWeight: '700' },
  list: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
});
