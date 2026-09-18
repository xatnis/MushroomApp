import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton, Card, Chip, Field, Notice, Screen, SectionTitle, commonStyles } from '../components/ui';
import { useApp } from '../state/AppContext';
import type { RootStackParamList } from '../navigation/types';
import type { DraftItem, FindPhoto, Outcome, QuantityUnit, RecordingDraft, Visibility } from '../domain/types';
import { normalizeSearch, speciesName } from '../domain/species';
import { haversineKm, parseQuantity } from '../domain/format';
import { choosePhotos, removeLocalPhoto, takePhoto } from '../services/media';
import { getHistoricalWeather, searchLocations, type PlaceSearchResult } from '../services/weather';
import { colors, radii, spacing } from '../theme';

const blankItem = (): DraftItem => ({ id: Crypto.randomUUID(), speciesId: 'unknown', quantityText: '', searchedFor: false });
const newDraft = (): RecordingDraft => ({ observedAt: new Date().toISOString(), outcome: 'found', notes: '', visibility: 'private', shareExactCommunityLocation: false, items: [blankItem()], photoUris: [] });
const quickSpecies = [
  { label: 'Jurček', speciesId: 'boletus-group' },
  { label: 'Lisička', speciesId: 'cantharellus-cibarius' },
  { label: 'Marela', speciesId: 'macrolepiota-procera' },
  { label: 'Dežnikarica', speciesId: 'macrolepiota-procera' },
  { label: 'Štorovka', speciesId: 'armillaria-group' },
  { label: 'Golobica', speciesId: 'russula-group' },
  { label: 'Mlečnica', speciesId: 'other' },
] as const;
const placeDetails = (place: { name: string; admin1?: string; admin2?: string; country?: string }) => [...new Set([place.admin2, place.admin1, place.country]
  .map((value) => value?.trim()).filter((value): value is string => Boolean(value) && value !== place.name))].join(', ');

export function RecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Record'>>();
  const insets = useSafeAreaInsets();
  const { profile, hotspots, finds, repository, saveVisit, saveDraft, clearDraft, refresh, online } = useApp();
  const existing = route.params?.findId ? finds.find((find) => find.id === route.params?.findId) : undefined;
  const [draft, setDraft] = useState<RecordingDraft>(() => ({ ...newDraft(), hotspotId: route.params?.hotspotId, latitude: route.params?.latitude, longitude: route.params?.longitude, locationSource: route.params?.latitude != null ? 'manual' : undefined }));
  const [photos, setPhotos] = useState<FindPhoto[]>(existing?.photos ?? []);
  const speciesInputRefs = useRef(new Map<string, TextInput>());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [locating, setLocating] = useState(false);
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void (async () => {
      if (existing) {
        setDraft({ hotspotId: existing.hotspotId, latitude: existing.observationLatitude, longitude: existing.observationLongitude, accuracyM: existing.observationAccuracyM, observedAt: existing.observedAt, outcome: existing.outcome, notes: existing.notes ?? '', visibility: existing.visibility, shareExactCommunityLocation: false, items: existing.items.map((item) => ({ id: item.id, speciesId: item.speciesId, customName: item.customName, quantityText: item.quantity?.toString() ?? '', unit: item.unit, searchedFor: item.searchedFor })), photoUris: existing.photos.map((photo) => photo.localUri) });
      } else {
        const stored = await repository.loadDraft(profile.id);
        if (stored && !route.params?.hotspotId && route.params?.latitude == null) { setDraft(stored); setPhotos(stored.photoUris.map((localUri) => ({ id: Crypto.randomUUID(), findId: '', localUri, uploadState: 'local', createdAt: new Date().toISOString() }))); }
        else if (!route.params?.hotspotId && route.params?.latitude == null) void acquireLocation();
      }
    })();
  }, []);

  useEffect(() => {
    if (existing) return;
    const timer = setTimeout(() => void saveDraft({ ...draft, photoUris: photos.map((photo) => photo.localUri) }), 400);
    return () => clearTimeout(timer);
  }, [draft, existing, photos, saveDraft]);

  useEffect(() => {
    if (!placeSearchOpen) return;
    const name = placeQuery.trim();
    if (name.length < 2) { setPlaceResults([]); setPlaceSearchError(undefined); setPlaceSearchLoading(false); return; }
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      setPlaceSearchLoading(true); setPlaceSearchError(undefined);
      void searchLocations(name, controller.signal)
        .then((results) => { if (active) setPlaceResults(results); })
        .catch((error) => {
          if (!active || (error instanceof Error && error.name === 'AbortError')) return;
          setPlaceResults([]);
          setPlaceSearchError('Lokacij trenutno ni mogoče poiskati. Preverite povezavo in poskusite znova.');
          console.warn('Location search failed', error);
        })
        .finally(() => { if (active) setPlaceSearchLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [placeQuery, placeSearchOpen]);

  const selectedHotspot = hotspots.find((hotspot) => hotspot.id === draft.hotspotId);
  const nearby = useMemo(() => draft.latitude == null || draft.longitude == null ? undefined : hotspots
    .map((hotspot) => ({ hotspot, km: haversineKm(draft.latitude!, draft.longitude!, hotspot.latitude, hotspot.longitude) }))
    .filter(({ km }) => km <= 0.15).sort((a, b) => a.km - b.km)[0], [draft.latitude, draft.longitude, hotspots]);

  async function acquireLocation() {
    setLocating(true); setMessage(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { setMessage('Lokacija ni dovoljena. Izberite obstoječe rastišče ali ročno vnesite koordinate.'); return; }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 200 });
      const location = last ?? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Lokacije ni bilo mogoče pridobiti v 12 sekundah. Osnutek je shranjen.')), 12_000)),
      ]);
      setDraft((current) => ({ ...current, hotspotId: undefined, latitude: location.coords.latitude, longitude: location.coords.longitude, accuracyM: location.coords.accuracy ?? undefined, locationSource: 'gps', locationName: undefined, locationAdmin1: undefined, locationAdmin2: undefined, locationCountry: undefined }));
      setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]);
      if ((location.coords.accuracy ?? 0) > 100) setMessage(`Lokacija je manj natančna (±${Math.round(location.coords.accuracy ?? 0)} m). Po potrebi jo popravite.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Lokacija ni dosegljiva. Osnutek je shranjen.'); }
    finally { setLocating(false); }
  }

  const selectPlace = (place: PlaceSearchResult) => {
    setDraft((current) => ({
      ...current,
      hotspotId: undefined,
      latitude: place.latitude,
      longitude: place.longitude,
      accuracyM: undefined,
      locationSource: 'manual',
      locationName: place.name,
      locationAdmin1: place.admin1,
      locationAdmin2: place.admin2,
      locationCountry: place.country,
    }));
    setPlaceSearchOpen(false); setPlaceQuery(''); setPlaceResults([]); setPlaceSearchError(undefined); setMessage(undefined);
  };

  const updateItem = (id: string, changes: Partial<DraftItem>) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item) }));
  const focusSpeciesInput = (id: string) => speciesInputRefs.current.get(id)?.focus();
  const selectQuickSpecies = (id: string, choice: typeof quickSpecies[number]) => updateItem(id, { speciesId: choice.speciesId, customName: choice.label });
  const selectCustomSpecies = (id: string) => {
    updateItem(id, { speciesId: 'other', customName: '' });
    focusSpeciesInput(id);
  };
  const addSpeciesBlock = () => {
    const item = blankItem();
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
  };
  const itemMatchesQuick = (item: DraftItem, label: string) => normalizeSearch(speciesName(item.speciesId, item.customName)) === normalizeSearch(label);
  const itemUsesCustomSpecies = (item: DraftItem) => item.speciesId === 'other' && !quickSpecies.some((choice) => itemMatchesQuick(item, choice.label));
  const updateSpeciesName = (id: string, name: string) => {
    const quick = quickSpecies.find((choice) => normalizeSearch(choice.label) === normalizeSearch(name));
    setDraft((current) => {
      const duplicate = quick && current.items.some((item) => item.id !== id && normalizeSearch(speciesName(item.speciesId, item.customName)) === normalizeSearch(quick.label));
      if (duplicate) return { ...current, items: current.items.filter((item) => item.id !== id) };
      return { ...current, items: current.items.map((item) => item.id === id ? { ...item, speciesId: quick?.speciesId ?? 'other', customName: name } : item) };
    });
  };
  const addCamera = async () => { try { const photo = await takePhoto(); if (photo) setPhotos((current) => [...current, photo]); } catch (error) { Alert.alert('Fotografija', error instanceof Error ? error.message : 'Fotografije ni bilo mogoče shraniti.'); } };
  const addLibrary = async () => { try { const selected = await choosePhotos(); setPhotos((current) => [...current, ...selected]); } catch (error) { Alert.alert('Fotografija', error instanceof Error ? error.message : 'Fotografij ni bilo mogoče shraniti.'); } };
  const removePhoto = (photo: FindPhoto) => Alert.alert('Odstrani fotografijo?', 'Fotografija bo odstranjena iz tega obiska.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Odstrani', style: 'destructive', onPress: () => { setPhotos((current) => current.filter((item) => item.id !== photo.id)); if (!existing?.photos.some((item) => item.id === photo.id)) void removeLocalPhoto(photo.localUri); } }]);

  const submit = async () => {
    if (saving) return;
    setSaving(true); setMessage(undefined);
    try {
      const hotspot = selectedHotspot ?? (existing ? hotspots.find((item) => item.id === existing.hotspotId) : undefined);
      const latitude = hotspot?.latitude ?? draft.latitude;
      const longitude = hotspot?.longitude ?? draft.longitude;
      if (latitude == null || longitude == null) throw new Error('Izberite rastišče ali določite lokacijo. Osnutek ostaja shranjen.');
      const timestamp = new Date().toISOString();
      const items = draft.items.filter((item) => item.speciesId !== 'other' || Boolean(item.customName?.trim())).filter((item) => item.speciesId || item.customName).map((item) => ({
        id: item.id, findId: existing?.id ?? '', speciesId: item.speciesId, customName: item.customName,
        quantity: parseQuantity(item.quantityText), unit: item.quantityText.trim() ? item.unit ?? 'pieces' as QuantityUnit : undefined,
        searchedFor: draft.outcome === 'nothing' ? item.searchedFor : false,
        createdAt: existing?.items.find((old) => old.id === item.id)?.createdAt ?? timestamp, updatedAt: timestamp, syncState: profile.mode === 'cloud' ? 'pending' as const : 'local' as const,
      }));
      const weatherChanged = existing && (existing.observedAt !== draft.observedAt || existing.observationLatitude !== latitude || existing.observationLongitude !== longitude);
      if (existing) {
        const removedUris = existing.photos.filter((old) => !photos.some((photo) => photo.id === old.id)).map((photo) => photo.localUri);
        await repository.updateFind(profile, { ...existing, hotspotId: hotspot?.id ?? existing.hotspotId, observedAt: draft.observedAt, observationLatitude: latitude, observationLongitude: longitude, observationAccuracyM: draft.accuracyM, outcome: draft.outcome, notes: draft.notes.trim() || undefined, visibility: draft.visibility, shareExactCommunityLocation: false, weather: weatherChanged ? { provider: 'open-meteo', status: 'pending' } : existing.weather, items, photos, updatedAt: timestamp, syncState: profile.mode === 'cloud' ? 'pending' : 'local' });
        await Promise.all(removedUris.map((uri) => removeLocalPhoto(uri).catch(() => undefined)));
        if (weatherChanged && online) {
          void getHistoricalWeather(repository.database, latitude, longitude, draft.observedAt)
            .then((weather) => repository.updateWeather(profile, existing.id, weather))
            .then(refresh);
        }
        await refresh(); setMessage(profile.mode === 'cloud' ? 'Spremembe čakajo na sinhronizacijo.' : 'Spremembe so shranjene v napravi.');
        navigation.replace('FindDetail', { findId: existing.id });
      } else {
        const result = await saveVisit({
          profile, hotspot,
          newHotspot: hotspot ? undefined : { latitude, longitude, title: draft.hotspotTitle?.trim() || undefined, locationName: draft.locationName, locationAdmin1: draft.locationAdmin1, locationAdmin2: draft.locationAdmin2, locationCountry: draft.locationCountry, locationSource: draft.locationSource ?? 'manual', accuracyM: draft.accuracyM, locationSharing: 'private' },
          find: { hotspotId: hotspot?.id ?? '', observedAt: draft.observedAt, observationLatitude: latitude, observationLongitude: longitude, observationAccuracyM: draft.accuracyM, outcome: draft.outcome, notes: draft.notes.trim() || undefined, visibility: draft.visibility, shareExactCommunityLocation: false, weather: { provider: 'open-meteo', status: 'pending' }, items, photos },
        });
        setMessage(profile.mode === 'cloud' ? (online ? 'Shranjeno v napravi. Čaka na sinhronizacijo.' : 'Shranjeno brez povezave. Čaka na sinhronizacijo.') : (online ? 'Shranjeno v napravi.' : 'Shranjeno brez povezave.'));
        navigation.replace('HotspotDetail', { hotspotId: result.hotspotId });
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Obiska ni bilo mogoče shraniti.'); }
    finally { setSaving(false); }
  };

  const discard = () => Alert.alert('Zavrzi osnutek?', 'Neshranjeni podatki bodo odstranjeni.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Zavrzi', style: 'destructive', onPress: () => { void clearDraft(); navigation.goBack(); } }]);

  return <Screen style={{ paddingBottom: insets.bottom + spacing.xl }}>
    <Text style={commonStyles.title}>{existing ? 'Uredi obisk' : 'Zabeleži obisk'}</Text>
    {message ? <Notice tone={message.includes('ni ') || message.includes('Izberite') ? 'warning' : 'success'}>{message}</Notice> : null}
    <Card><SectionTitle>Rastišče</SectionTitle>
      {selectedHotspot ? <><Text style={commonStyles.heading}>{selectedHotspot.title || 'Rastišče brez naslova'}</Text>{selectedHotspot.locationName ? <Text style={commonStyles.body}>{selectedHotspot.locationName}</Text> : null}<Text style={commonStyles.muted}>{selectedHotspot.latitude.toFixed(5)}, {selectedHotspot.longitude.toFixed(5)}</Text><AppButton title="Izberi drugo" variant="ghost" onPress={() => setDraft((current) => ({ ...current, hotspotId: undefined }))} /></>
      : <><Field label="Naslov novega rastišča (neobvezno)" value={draft.hotspotTitle ?? ''} onChangeText={(hotspotTitle) => setDraft((current) => ({ ...current, hotspotTitle }))} placeholder="npr. Smrekov gozd" />
        {draft.locationName ? <View style={styles.locationSummary}><Text style={commonStyles.muted}>Izbrana lokacija</Text><Text style={commonStyles.heading}>{draft.locationName}</Text>{placeDetails({ name: draft.locationName, admin1: draft.locationAdmin1, admin2: draft.locationAdmin2, country: draft.locationCountry }) ? <Text style={commonStyles.muted}>{placeDetails({ name: draft.locationName, admin1: draft.locationAdmin1, admin2: draft.locationAdmin2, country: draft.locationCountry })}</Text> : null}<Text style={commonStyles.muted}>{draft.latitude?.toFixed(5)}, {draft.longitude?.toFixed(5)}</Text><AppButton title="Spremeni lokacijo" variant="ghost" onPress={() => setPlaceSearchOpen(true)} /></View>
        : <Text style={commonStyles.muted}>{draft.latitude != null ? `${draft.latitude.toFixed(5)}, ${draft.longitude?.toFixed(5)}${draft.accuracyM ? ` · ±${Math.round(draft.accuracyM)} m` : ''}` : 'Lokacija še ni določena.'}</Text>}
        <AppButton title={locating ? 'Pridobivam lokacijo …' : 'Uporabi trenutno lokacijo'} variant="secondary" loading={locating} onPress={() => void acquireLocation()} />
        {!draft.locationName ? <AppButton title="Izberi lokacijo" variant="secondary" onPress={() => setPlaceSearchOpen((open) => !open)} /> : null}
        {placeSearchOpen ? <View style={styles.locationSearch}>
          <Field label="Poišči mesto ali kraj" placeholder="Npr. Maribor" value={placeQuery} onChangeText={setPlaceQuery} autoCapitalize="words" autoCorrect={false} />
          {placeSearchLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {placeSearchError ? <Notice tone="warning">{placeSearchError}</Notice> : null}
          {placeResults.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => selectPlace(place)} style={({ pressed }) => [styles.placeResult, pressed && styles.placeResultPressed]}><Text style={commonStyles.heading}>{place.name}</Text>{placeDetails(place) ? <Text style={commonStyles.muted}>{placeDetails(place)}</Text> : null}</Pressable>)}
          {placeQuery.trim().length >= 2 && !placeSearchLoading && !placeSearchError && !placeResults.length ? <Text style={commonStyles.muted}>Ni najdenih lokacij.</Text> : null}
          <Text style={commonStyles.muted}>Iskanje lokacij: Open‑Meteo / GeoNames</Text>
        </View> : null}
        {nearby ? <Notice tone="info">V bližini je »{nearby.hotspot.title || 'rastišče brez naslova'}« ({Math.round(nearby.km * 1000)} m). <Text onPress={() => setDraft((current) => ({ ...current, hotspotId: nearby.hotspot.id }))} style={styles.link}>Dodaj obisk tja.</Text></Notice> : null}
        <Text style={commonStyles.muted}>Ali izberite obstoječe:</Text><View style={commonStyles.wrap}>{hotspots.slice(0, 8).map((hotspot) => <Chip key={hotspot.id} label={hotspot.title || 'Brez naslova'} onPress={() => setDraft((current) => ({ ...current, hotspotId: hotspot.id }))} />)}</View></>}
    </Card>
    <Card><SectionTitle>Izid obiska</SectionTitle><View style={commonStyles.wrap}>{([['found', 'Našel sem gobe'], ['nothing', 'Nič nisem našel'], ['unspecified', 'Brez izida']] as Array<[Outcome, string]>).map(([value, label]) => <Chip key={value} label={label} selected={draft.outcome === value} onPress={() => setDraft((current) => ({ ...current, outcome: value }))} />)}</View></Card>
    <Card><SectionTitle>{draft.outcome === 'nothing' ? 'Kaj ste iskali? (neobvezno)' : 'Vrste'}</SectionTitle>
      {draft.items.map((item, index) => <View key={item.id} style={styles.item}><View style={styles.itemHead}><Text style={commonStyles.heading}>Vrsta {index + 1}</Text><Pressable onPress={() => setDraft((current) => ({ ...current, items: current.items.filter((value) => value.id !== item.id) }))}><Text style={styles.remove}>Odstrani</Text></Pressable></View>
        <Text style={commonStyles.muted}>Izberi vrsto:</Text><View style={commonStyles.wrap}>{quickSpecies.map((choice) => <Chip key={choice.label} label={choice.label} selected={itemMatchesQuick(item, choice.label)} onPress={() => selectQuickSpecies(item.id, choice)} />)}<Chip label="Drugo" selected={itemUsesCustomSpecies(item)} onPress={() => selectCustomSpecies(item.id)} /></View>
        <Field ref={(input) => { if (input) speciesInputRefs.current.set(item.id, input); else speciesInputRefs.current.delete(item.id); }} label="Vrsta gobe" value={item.speciesId === 'other' ? item.customName ?? '' : item.speciesId === 'unknown' && !item.customName ? '' : speciesName(item.speciesId, item.customName)} onChangeText={(name) => updateSpeciesName(item.id, name)} placeholder="npr. Smrček" />
        {draft.outcome !== 'nothing' ? <><Field label="Količina (neobvezno)" value={item.quantityText} keyboardType="decimal-pad" onChangeText={(quantityText) => updateItem(item.id, { quantityText })} placeholder="npr. 2,5" /><View style={commonStyles.wrap}>{(['pieces', 'g', 'kg'] as QuantityUnit[]).map((unit) => <Chip key={unit} label={unit === 'pieces' ? 'kosi' : unit} selected={(item.unit ?? 'pieces') === unit} onPress={() => updateItem(item.id, { unit })} />)}</View></> : <Chip label="To vrsto sem iskal" selected={item.searchedFor} onPress={() => updateItem(item.id, { searchedFor: !item.searchedFor })} />}
      </View>)}
      <AppButton title="+ Dodaj drugo vrsto" variant="secondary" onPress={addSpeciesBlock} />
    </Card>
    <Card><SectionTitle>Fotografije</SectionTitle><View style={commonStyles.row}><AppButton title="Kamera" variant="secondary" style={styles.flexButton} onPress={() => void addCamera()} /><AppButton title="Galerija" variant="secondary" style={styles.flexButton} onPress={() => void addLibrary()} /></View><View style={commonStyles.wrap}>{photos.map((photo) => <Pressable key={photo.id} onPress={() => removePhoto(photo)}><Image source={{ uri: photo.localUri }} style={styles.photo} /><Text style={styles.photoRemove}>Odstrani</Text></Pressable>)}</View></Card>
    <AppButton title={showAdvanced ? 'Skrij dodatno' : 'Opombe, čas in deljenje'} variant="ghost" onPress={() => setShowAdvanced(!showAdvanced)} />
    {showAdvanced ? <Card><Field label="Opombe (neobvezno)" value={draft.notes} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} multiline />
      <Text style={commonStyles.body}>Datum in čas: {new Intl.DateTimeFormat('sl-SI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.observedAt))}</Text><AppButton title="Spremeni datum in čas" variant="secondary" onPress={() => setShowDate(true)} />{showDate ? <DateTimePicker value={new Date(draft.observedAt)} mode="datetime" maximumDate={new Date()} onChange={(_event, date) => { setShowDate(false); if (date) setDraft((current) => ({ ...current, observedAt: date.toISOString() })); }} /> : null}
      <Text style={commonStyles.heading}>Vidnost obiska</Text><View style={commonStyles.wrap}>{([['private', 'Private · Samo jaz'], ['friends', 'Friends · Moji prijatelji'], ['community', 'Community · Skupnost']] as Array<[Visibility, string]>).map(([value, label]) => <Chip key={value} label={label} selected={draft.visibility === value} onPress={() => setDraft((current) => ({ ...current, visibility: value, shareExactCommunityLocation: false }))} />)}</View>
      {draft.visibility === 'community' ? <Notice tone="info">Skupnost vidi podatke o obisku, vendar API ne vrne natančnih GPS koordinat. Zasebno rastišče in drugi obiski ostanejo skriti.</Notice> : null}
      {!selectedHotspot ? <><Field label="Zemljepisna širina" keyboardType="decimal-pad" value={draft.latitude?.toString() ?? ''} onChangeText={(value) => setDraft((current) => ({ ...current, latitude: value ? Number(value.replace(',', '.')) : undefined, locationSource: 'manual' }))} /><Field label="Zemljepisna dolžina" keyboardType="decimal-pad" value={draft.longitude?.toString() ?? ''} onChangeText={(value) => setDraft((current) => ({ ...current, longitude: value ? Number(value.replace(',', '.')) : undefined, locationSource: 'manual' }))} /></> : null}
    </Card> : null}
    <AppButton title={existing ? 'Shrani spremembe' : 'Shrani obisk'} loading={saving} onPress={() => void submit()} />
    {!existing ? <AppButton title="Zavrzi osnutek" variant="ghost" onPress={discard} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' }, item: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }, itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, remove: { color: colors.danger, fontWeight: '700' },
  locationSummary: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, locationSearch: { gap: spacing.sm }, placeResult: { padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceSoft }, placeResultPressed: { opacity: 0.75 },
  flexButton: { flex: 1 }, photo: { width: 92, height: 92, borderRadius: 12 }, photoRemove: { color: colors.danger, fontSize: 12, textAlign: 'center', marginTop: 3 },
});
