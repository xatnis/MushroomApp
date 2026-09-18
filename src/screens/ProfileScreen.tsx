import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Field, Notice, Screen, SectionTitle, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppContext';
import { speciesName } from '../domain/species';
import { updateCloudProfile } from '../services/profiles';
import { colors, radii, spacing } from '../theme';

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, session, cloudConfigured, cloudNotice, finds, hotspots, repository, syncNow, retrySync, attachLocalDiary, useCloudDiary, logout } = useApp();
  const [stats, setStats] = useState({ hotspots: 0, finds: 0, thisYear: 0, pending: 0, attention: 0 });
  const [editing, setEditing] = useState(false); const [username, setUsername] = useState(profile.username ?? ''); const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  useEffect(() => { void repository.stats(profile.id).then(setStats); }, [finds, hotspots, profile.id, repository]);
  const frequent = useMemo(() => {
    const counts = new Map<string, number>();
    finds.flatMap((find) => find.items).forEach((item) => { const name = speciesName(item.speciesId, item.customName); counts.set(name, (counts.get(name) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [finds]);
  const saveProfile = async () => {
    if (profile.mode !== 'cloud' || !session) return;
    setProfileSaving(true);
    try {
      await updateCloudProfile(session.user.id, username, displayName);
      await repository.updateProfile(profile.id, username.trim(), displayName.trim() || undefined); setEditing(false);
    } catch (error) { Alert.alert('Profil', error instanceof Error ? error.message : 'Profila ni bilo mogoče shraniti.'); }
    finally { setProfileSaving(false); }
  };
  return <Screen><View style={styles.hero}><View style={styles.avatar}><Text style={styles.avatarText}>{(displayName || username || 'M').slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={commonStyles.title}>{profile.mode === 'cloud' ? (displayName || username || 'Moj profil') : 'Lokalni dnevnik'}</Text><Text style={commonStyles.muted}>{profile.mode === 'cloud' ? `${session?.user.email ?? ''} · @${username || 'brez-imena'}` : 'Podatki so shranjeni samo v tej napravi'}</Text></View></View>
    {!cloudConfigured ? <Notice tone="info">Supabase ni nastavljen. Oblak, prijatelji in skupnost so izklopljeni; lokalno beleženje deluje.</Notice> : null}
    {cloudNotice ? <Notice tone="warning">{cloudNotice}</Notice> : null}
    {profile.mode === 'local' && session ? <Card><Text style={commonStyles.heading}>Prijavljen račun je na voljo</Text><Text style={commonStyles.body}>Izberite, ali želite trenutni lokalni dnevnik izrecno pripeti računu ali odpreti ločen oblačni dnevnik.</Text>{hotspots.length ? <AppButton title="Pripni lokalni dnevnik" onPress={() => void attachLocalDiary().catch((error) => Alert.alert('Pripenjanje', error.message))} /> : null}<AppButton title="Odpri oblačni dnevnik" variant="secondary" onPress={() => void useCloudDiary()} /></Card> : null}
    {!session && cloudConfigured ? <AppButton title="Prijava ali nov račun" onPress={() => navigation.navigate('Auth')} /> : null}
    {editing ? <Card><Field label="Uporabniško ime" value={username} onChangeText={setUsername} autoCapitalize="none" /><Field label="Prikazno ime" value={displayName} onChangeText={setDisplayName} /><AppButton title="Shrani profil" loading={profileSaving} onPress={() => void saveProfile()} /><AppButton title="Prekliči" variant="ghost" onPress={() => setEditing(false)} /></Card> : profile.mode === 'cloud' ? <AppButton title="Uredi profil" variant="secondary" onPress={() => setEditing(true)} /> : null}
    <View style={styles.stats}><Stat value={stats.hotspots} label="rastišč" /><Stat value={stats.finds} label="obiskov" /><Stat value={stats.thisYear} label="letos" /></View>
    <Card><SectionTitle>Pogoste vrste</SectionTitle>{frequent.length ? frequent.map(([name, count]) => <Text key={name} style={commonStyles.body}>{name} · {count}×</Text>) : <Text style={commonStyles.muted}>Po prvih obiskih se tukaj prikažejo pogosto beležene vrste.</Text>}</Card>
    <AppButton title="Moje najdbe" variant="secondary" onPress={() => navigation.navigate('MyFinds')} />
    <AppButton title="Prijatelji" variant="secondary" disabled={!session} onPress={() => navigation.navigate('Friends')} />
    <Card><SectionTitle>Sinhronizacija</SectionTitle><Text style={commonStyles.body}>{profile.mode === 'local' ? 'Namerno samo v napravi' : `${stats.pending} v čakalni vrsti · ${stats.attention} zahtevata pozornost`}</Text>{profile.mode === 'cloud' ? <View style={commonStyles.wrap}><AppButton title="Sinhroniziraj zdaj" onPress={() => void syncNow()} /><AppButton title="Ponovi napake" variant="secondary" onPress={() => void retrySync()} /></View> : null}</Card>
    <AppButton title="Nastavitve in podatki" variant="secondary" onPress={() => navigation.navigate('Settings')} />
    {session ? <AppButton title="Odjava" variant="ghost" onPress={() => void logout()} /> : null}
  </Screen>;
}
function Stat({ value, label }: { value: number; label: string }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={commonStyles.muted}>{label}</Text></View>; }
const styles = StyleSheet.create({ hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.white, fontSize: 30, fontWeight: '800' }, stats: { flexDirection: 'row', gap: spacing.sm }, stat: { flex: 1, alignItems: 'center', padding: spacing.md, backgroundColor: colors.surfaceSoft, borderRadius: radii.md }, statValue: { color: colors.primary, fontSize: 26, fontWeight: '900' } });
