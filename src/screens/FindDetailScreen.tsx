import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, EmptyState, Notice, Screen, StatusPill, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppContext';
import { formatQuantity, slDateTime } from '../domain/format';
import { speciesName } from '../domain/species';
import { colors, spacing } from '../theme';
import { removeLocalPhoto } from '../services/media';

export function FindDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'FindDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, finds, hotspots, repository, refresh } = useApp();
  const find = finds.find((item) => item.id === route.params.findId);
  const hotspot = hotspots.find((item) => item.id === find?.hotspotId);
  if (!find) return <Screen><EmptyState title="Obiska ni mogoče najti" message="Morda je bil izbrisan ali pripada drugemu profilu." /></Screen>;
  const remove = () => Alert.alert('Izbrišem obisk?', 'Obisk bo skrit takoj. Če je sinhroniziran, bo izbris in čiščenje fotografij dodano v čakalno vrsto.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Izbriši', style: 'destructive', onPress: async () => { const uris = await repository.deleteFind(profile, find.id); await Promise.all(uris.map((uri) => removeLocalPhoto(uri).catch(() => undefined))); await refresh(); navigation.goBack(); } }]);
  return <Screen>
    <View style={styles.row}><View style={styles.grow}><Text style={commonStyles.title}>{find.outcome === 'nothing' ? 'Nič nisem našel' : 'Zabeležen obisk'}</Text><Text style={commonStyles.muted}>{slDateTime(find.observedAt)} · {hotspot?.title || 'Rastišče'}</Text></View><StatusPill state={find.syncState} /></View>
    <Card>{find.items.length ? find.items.map((item) => <View key={item.id}><Text style={commonStyles.heading}>{speciesName(item.speciesId, item.customName)}</Text><Text style={commonStyles.body}>{find.outcome === 'nothing' && item.searchedFor ? 'Iskana vrsta' : formatQuantity(item.quantity, item.unit)}</Text></View>) : <Text style={commonStyles.body}>Brez navedenih vrst.</Text>}{find.notes ? <Text style={commonStyles.body}>{find.notes}</Text> : null}</Card>
    <Card><Text style={commonStyles.heading}>Vreme ob času obiska</Text>{find.weather.status === 'complete' ? <><Text style={commonStyles.body}>Ocenjena temperatura: {find.weather.temperatureC?.toFixed(1) ?? '—'} °C</Text><Text style={commonStyles.body}>Padavine v uri: {find.weather.precipitationMm?.toFixed(1) ?? '—'} mm</Text><Text style={commonStyles.muted}>Open-Meteo · {find.weather.dataset === 'archive' ? 'zgodovinski arhiv' : 'nedavni podatki'} · pridobljeno {find.weather.retrievedAt ? slDateTime(find.weather.retrievedAt) : '—'}</Text></> : <Notice tone={find.weather.status === 'error' ? 'warning' : 'info'}>{find.weather.status === 'pending' ? 'Vreme bo dopolnjeno, ko bo povezava na voljo.' : 'Za ta obisk vreme ni na voljo.'}</Notice>}</Card>
    <View style={styles.photos}>{find.photos.map((photo) => <View key={photo.id}><Image source={{ uri: photo.localUri }} style={styles.photo} />{photo.uploadState === 'failed' ? <Text style={styles.failed}>Prenos ni uspel</Text> : null}</View>)}</View>
    <Card><Text style={commonStyles.heading}>Zasebnost</Text><Text style={commonStyles.body}>{find.visibility === 'private' ? 'Zasebni obisk' : find.visibility === 'friends' ? 'Viden sprejetim prijateljem' : 'Objavljeno skupnosti brez GPS koordinat'}</Text>{find.visibility === 'community' ? <Text style={commonStyles.muted}>Community API ne vrne zemljepisne širine ali dolžine. Zasebni naslov rastišča in drugi obiski niso objavljeni.</Text> : null}</Card>
    <AppButton title="Uredi obisk" onPress={() => navigation.navigate('Record', { findId: find.id })} />
    <AppButton title="Izbriši obisk" variant="danger" onPress={remove} />
  </Screen>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, grow: { flex: 1 }, photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, photo: { width: 150, height: 150, borderRadius: 14, backgroundColor: colors.surfaceSoft }, failed: { color: colors.danger, fontSize: 12 } });
