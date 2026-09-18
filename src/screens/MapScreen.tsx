import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
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

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const SLOVENIA_CENTER: [number, number] = [14.82, 46.12];

const placeDetails = (place: PlaceSearchResult) => {
  const values = [place.admin2, place.admin1, place.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== place.name);
  return [...new Set(values)].join(', ');
};

export function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<TabsParamList, 'Map'>>();
  const { hotspots, finds, session, exploreLocation, setExploreLocation, pendingHotspotFocus, clearHotspotFocus } = useApp();
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
    setCameraTarget({ center: [exploreLocation.longitude, exploreLocation.latitude], zoom: exploreLocation.source === 'gps' ? 15 : 12 });
  }, [exploreLocation, route.params?.focusExploreLocationAt]);

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
    {mode === 'map' ? <View style={styles.mapWrap}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        androidView="texture"
        attribution
        attributionPosition={{ bottom: spacing.sm, left: spacing.sm }}
        logo={false}
        scaleBar={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onPress={() => {
          if (Date.now() <= suppressMapPressUntil.current) return;
          setSelectedId(undefined);
        }}
        onLongPress={(event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat;
          navigation.navigate('Record', { latitude, longitude });
        }}
      >
        <Camera ref={camera} initialViewState={{ center: SLOVENIA_CENTER, zoom: 7 }} />
        {locationGranted ? <UserLocation animated accuracy minDisplacement={3} /> : null}
        {ownerFilter === 'mine' ? filtered.map((hotspot) => <Marker key={hotspot.id} id={hotspot.id} lngLat={[hotspot.longitude, hotspot.latitude]} anchor="bottom" onPress={(event) => {
          event.stopPropagation();
          suppressMapPressUntil.current = Date.now() + 300;
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
      {exploreLocation && !selected ? <Pressable accessibilityRole="button" accessibilityLabel={`Poglej razmere za ${exploreLocation.name}`} onPress={() => navigation.navigate('Tabs', { screen: 'Conditions' })} style={({ pressed }) => [styles.conditionsAction, pressed && styles.searchResultPressed]}>
        <Ionicons name="cloud-outline" size={21} color={colors.primary} />
        <View style={styles.grow}><Text numberOfLines={1} style={styles.conditionsLocation}>{exploreLocation.name}</Text><Text style={styles.conditionsActionText}>Poglej razmere</Text></View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable> : null}
      {selected ? <Card style={styles.preview}>
        <View style={styles.previewTop}><View style={styles.grow}><Text style={commonStyles.heading}>{selected.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{finds.filter((find) => find.hotspotId === selected.id).length} obiskov</Text></View><StatusPill state={selected.syncState} /><Pressable accessibilityRole="button" accessibilityLabel="Zapri kartico rastišča" hitSlop={8} onPress={() => setSelectedId(undefined)} style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}><Ionicons name="close" size={21} color={colors.muted} /></Pressable></View>
        <AppButton title="Podrobnosti" variant="secondary" onPress={() => navigation.navigate('HotspotDetail', { hotspotId: selected.id })} />
      </Card> : null}
      {locating ? <View style={styles.locating}><Text style={commonStyles.muted}>Pridobivam lokacijo …</Text></View> : null}
    </View> : <View style={styles.list}>{ownerFilter === 'friends' ? friendHotspots.map((hotspot) => <Pressable key={hotspot.id} onPress={() => void Linking.openURL(`geo:${hotspot.latitude},${hotspot.longitude}?q=${hotspot.latitude},${hotspot.longitude}`)}><Card><Text style={commonStyles.heading}>{hotspot.title || 'Deljeno rastišče'}</Text><Text style={commonStyles.muted}>@{hotspot.owner_username} · točna lokacija, izrecno deljena s prijatelji</Text></Card></Pressable>) : filtered.length ? filtered.map((hotspot) => <Pressable key={hotspot.id} onPress={() => navigation.navigate('HotspotDetail', { hotspotId: hotspot.id })}><Card><View style={styles.previewTop}><View style={styles.grow}><Text style={commonStyles.heading}>{hotspot.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{hotspot.latitude.toFixed(4)}, {hotspot.longitude.toFixed(4)} · {finds.filter((find) => find.hotspotId === hotspot.id).length} obiskov</Text></View><StatusPill state={hotspot.syncState} /></View></Card></Pressable>) : <EmptyState title={query.trim() ? 'Ni zadetkov med rastišči' : 'Še ni rastišč'} message={query.trim() ? 'Poskusite z drugim nazivom ali vrsto.' : 'Dodajte prvo rastišče z gumbom + ali z dolgim pritiskom na zemljevid.'} />}</View>}
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, padding: 0, gap: 0 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
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
  list: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
});
