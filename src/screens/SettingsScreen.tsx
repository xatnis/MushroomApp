import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { AppButton, Card, Notice, Screen, SectionTitle, commonStyles } from '../components/ui';
import { useApp } from '../state/AppContext';
import { friendlyCloudError, supabase } from '../services/supabase';
import { removeLocalPhoto } from '../services/media';
import { t } from '../i18n';

export function SettingsScreen() {
  const { profile, session, repository, exportDiary, signOut, refresh } = useApp();
  const [conflicts, setConflicts] = useState<Array<{ id: string; entity: 'hotspot' | 'find'; entityId: string; createdAt: string }>>([]);
  const loadConflicts = () => repository.listConflicts(profile.id).then(setConflicts);
  useEffect(() => { void loadConflicts(); }, [profile.id]);
  const resolve = async (id: string, choice: 'mine' | 'cloud') => { await repository.resolveConflict(profile, id, choice); await refresh(); await loadConflicts(); };
  const exportData = () => Alert.alert('Izvoz vsebuje točne lokacije', 'JSON izvoz vključuje strukturiran dnevnik in točne koordinate. Datoteke fotografij niso vključene, zato to ni popolna varnostna kopija fotografij.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Izvozi', onPress: () => void exportDiary().catch((error) => Alert.alert('Izvoz', error.message)) }]);
  const deleteLocal = () => Alert.alert('Izbrišem lokalni dnevnik?', 'Rastišča, obiski in lokalne fotografije tega lokalnega profila bodo trajno odstranjeni. Tega ni mogoče razveljaviti.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Trajno izbriši', style: 'destructive', onPress: async () => { const uris = await repository.listPhotoUris(profile.id); await repository.deleteLocalDiary(profile.id); await Promise.all(uris.map((uri) => removeLocalPhoto(uri).catch(() => undefined))); await refresh(); } }]);
  const deleteAccount = () => Alert.alert('Trajno izbrišem račun?', 'Strežniška funkcija bo odstranila fotografije, podatke aplikacije in Auth račun. Odjava sama računa ne izbriše.', [{ text: 'Prekliči', style: 'cancel' }, { text: 'Izbriši račun', style: 'destructive', onPress: async () => {
    if (!supabase || !session) return; const uris = await repository.listPhotoUris(profile.id); const response = await supabase.functions.invoke('delete-account', { body: {} }); if (response.error) return Alert.alert('Brisanje računa', friendlyCloudError(response.error, 'Računa trenutno ni mogoče izbrisati.'));
    await repository.deleteCloudProfileCache(session.user.id); await Promise.all(uris.map((uri) => removeLocalPhoto(uri).catch(() => undefined))); await signOut();
  } }]);
  return <Screen><Text style={commonStyles.title}>Nastavitve in podatki</Text>{conflicts.length ? <Card><SectionTitle>Konflikti sinhronizacije</SectionTitle><Text style={commonStyles.body}>Lokalne nesinhronizirane spremembe smo ohranili. Za vsak zapis izberite različico.</Text>{conflicts.map((conflict) => <View key={conflict.id} style={commonStyles.gap}><Text style={commonStyles.heading}>{conflict.entity === 'hotspot' ? 'Rastišče' : 'Obisk'} · {conflict.entityId.slice(0, 8)}</Text><View style={commonStyles.wrap}><AppButton title="Ohrani mojo" onPress={() => void resolve(conflict.id, 'mine')} /><AppButton title="Uporabi oblačno" variant="secondary" onPress={() => void resolve(conflict.id, 'cloud')} /></View></View>)}</Card> : null}<Card><SectionTitle>Izvoz</SectionTitle><Text style={commonStyles.body}>Izvoz vsebuje strukturirane podatke dnevnika, vključno s točnimi lokacijami. Fotografije so navedene z lokalnimi potmi, vendar njihove datoteke niso priložene.</Text><AppButton title="Izvozi JSON" onPress={exportData} /></Card><Notice tone="warning">{t.safety}</Notice>{profile.mode === 'local' ? <Card><SectionTitle>Lokalni podatki</SectionTitle><Text style={commonStyles.body}>Brisanje vpliva samo na trenutni lokalni dnevnik. To ni napaka sinhronizacije in ne vpliva na morebitne ločene račune.</Text><AppButton title="Izbriši lokalni dnevnik" variant="danger" onPress={deleteLocal} /></Card> : <Card><SectionTitle>Račun</SectionTitle><Text style={commonStyles.body}>Ta postopek je ločen od odjave in zahteva nastavljeno strežniško funkcijo.</Text><AppButton title="Trajno izbriši račun" variant="danger" onPress={deleteAccount} /></Card>}</Screen>;
}
