import { useEffect, useState } from 'react';
import { Alert, Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Chip, EmptyState, Field, Notice, Screen, SectionTitle, StatusPill, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppContext';
import type { HotspotWithHistory } from '../domain/types';
import { slDate, slDateTime, formatQuantity } from '../domain/format';
import { speciesName } from '../domain/species';
import { colors, spacing } from '../theme';
import { removeLocalPhoto } from '../services/media';

export function HotspotDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'HotspotDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, repository, refresh, requestHotspotFocus } = useApp();
  const [hotspot, setHotspot] = useState<HotspotWithHistory>();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const load = async () => { const value = await repository.getHotspot(profile.id, route.params.hotspotId); setHotspot(value); setTitle(value?.title ?? ''); setNotes(value?.notes ?? ''); };
  useEffect(() => { void load(); }, [route.params.hotspotId]);
  if (!hotspot) return <Screen><EmptyState title="Rastišča ni mogoče najti" message="Morda je bilo izbrisano ali pripada drugemu lokalnemu profilu." /></Screen>;
  const species = Array.from(new Set(hotspot.finds.flatMap((find) => find.items.map((item) => speciesName(item.speciesId, item.customName)))));
  const save = async () => { await repository.updateHotspot(profile, { ...hotspot, title: title.trim() || undefined, notes: notes.trim() || undefined }); await refresh(); await load(); setEditing(false); };
  const remove = () => Alert.alert('Izbrišem rastišče?', `Izbrisani bodo tudi vsi obiski (${hotspot.finds.length}) in fotografije bodo označene za odstranitev iz oblaka.`, [{ text: 'Prekliči', style: 'cancel' }, { text: 'Izbriši', style: 'destructive', onPress: async () => { const uris = await repository.deleteHotspot(profile, hotspot.id); await Promise.all(uris.map((uri) => removeLocalPhoto(uri).catch(() => undefined))); await refresh(); navigation.popTo('Tabs'); } }]);
  const openNavigation = () => void Linking.openURL(`geo:${hotspot.latitude},${hotspot.longitude}?q=${hotspot.latitude},${hotspot.longitude}`);
  return <Screen>
    <View style={styles.titleRow}><View style={styles.grow}><Text style={commonStyles.title}>{hotspot.title || 'Rastišče brez naslova'}</Text><Text style={commonStyles.muted}>{hotspot.latitude.toFixed(5)}, {hotspot.longitude.toFixed(5)}</Text></View><StatusPill state={hotspot.syncState} /></View>
    <Notice tone="info">Deljenje lokacije s prijatelji omogoči dostop do točne lokacije in osnovnih podatkov rastišča. Zasebnih obiskov ne objavi.</Notice>
    {editing ? <Card><Field label="Naslov" value={title} onChangeText={setTitle} /><Field label="Opombe" value={notes} onChangeText={setNotes} multiline /><Text style={commonStyles.heading}>Deljenje lokacije</Text><View style={commonStyles.wrap}><Chip label="Zasebno" selected={hotspot.locationSharing === 'private'} onPress={() => setHotspot({ ...hotspot, locationSharing: 'private' })} /><Chip label="S prijatelji" selected={hotspot.locationSharing === 'friends'} onPress={() => setHotspot({ ...hotspot, locationSharing: 'friends' })} /></View><AppButton title="Shrani" onPress={() => void save()} /><AppButton title="Prekliči" variant="ghost" onPress={() => setEditing(false)} /></Card>
    : <Card><Text style={commonStyles.body}>{hotspot.notes || 'Brez opomb.'}</Text><Text style={commonStyles.muted}>Prvič zabeleženo: {slDate(hotspot.createdAt)}</Text><Text style={commonStyles.muted}>Lokacija: {hotspot.locationSharing === 'friends' ? 'deljena s sprejetimi prijatelji' : 'zasebna'}</Text><View style={commonStyles.wrap}>{species.map((name) => <Chip key={name} label={name} />)}</View></Card>}
    <View style={commonStyles.wrap}><AppButton title="Dodaj obisk" style={styles.flexButton} onPress={() => navigation.navigate('Record', { hotspotId: hotspot.id })} /><AppButton title="Uredi rastišče" variant="secondary" style={styles.flexButton} onPress={() => setEditing(true)} /></View>
    <View style={commonStyles.wrap}><AppButton title="Prikaži na zemljevidu" variant="secondary" style={styles.flexButton} onPress={() => { requestHotspotFocus(hotspot); navigation.navigate('Tabs', { screen: 'Map' }); }} /><AppButton title="Odpri navigacijo" variant="secondary" style={styles.flexButton} onPress={openNavigation} /></View>
    <Text style={commonStyles.muted}>Zunanja navigacija ne zagotavlja varne gozdne poti ali dovoljenja za vstop na zemljišče.</Text>
    <SectionTitle>Zgodovina obiskov</SectionTitle>
    {hotspot.finds.length ? hotspot.finds.map((find) => <Card key={find.id}><View style={styles.titleRow}><View style={styles.grow}><Text style={commonStyles.heading}>{find.outcome === 'nothing' ? 'Nič najdenega' : find.items.map((item) => speciesName(item.speciesId, item.customName)).join(', ') || 'Obisk'}</Text><Text style={commonStyles.muted}>{slDateTime(find.observedAt)}</Text></View><StatusPill state={find.syncState} /></View>{find.items.map((item) => <Text key={item.id} style={commonStyles.body}>{speciesName(item.speciesId, item.customName)} · {formatQuantity(item.quantity, item.unit)}</Text>)}{find.notes ? <Text style={commonStyles.body}>{find.notes}</Text> : null}{find.weather.status === 'complete' ? <Text style={commonStyles.muted}>Ocenjeno vreme: {find.weather.temperatureC?.toFixed(1) ?? '—'} °C · {find.weather.precipitationMm?.toFixed(1) ?? '—'} mm padavin</Text> : <Text style={commonStyles.muted}>Vreme: {find.weather.status === 'pending' ? 'čaka na pridobitev' : 'ni na voljo'}</Text>}<View style={commonStyles.wrap}>{find.photos.slice(0, 4).map((photo) => <Image key={photo.id} source={{ uri: photo.localUri }} style={styles.photo} />)}</View><AppButton title="Odpri obisk" variant="secondary" onPress={() => navigation.navigate('FindDetail', { findId: find.id })} /></Card>) : <EmptyState title="Ni obiskov" message="To rastišče še nima shranjenih obiskov." />}
    <AppButton title="Izbriši rastišče in obiske" variant="danger" onPress={remove} />
  </Screen>;
}

const styles = StyleSheet.create({ titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, grow: { flex: 1 }, flexButton: { flexGrow: 1, flexBasis: 150 }, photo: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surfaceSoft } });
