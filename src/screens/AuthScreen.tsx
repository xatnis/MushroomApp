import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Field, Notice, Screen, commonStyles } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppContext';
import { requestPasswordReset, updatePassword } from '../services/auth';

export function AuthScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Auth'>>();
  const { cloudConfigured, session, authLoading, profile, hotspots, attachLocalDiary, useCloudDiary, signIn, signUp } = useApp();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(route.params?.mode ?? 'login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [username, setUsername] = useState(''); const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false); const [message, setMessage] = useState<string>();
  if (!cloudConfigured) return <Screen><Text style={commonStyles.title}>Oblak ni nastavljen</Text><Notice tone="info">V `.env` dodajte javni URL in publishable ključ Supabase ter aplikacijo znova zaženite. Lokalni dnevnik ostane popolnoma uporaben.</Notice></Screen>;
  if (session) return <Screen><Text style={commonStyles.title}>Prijavljeni ste</Text><Card><Text style={commonStyles.body}>{session.user.email}</Text><Text style={commonStyles.muted}>Lokalnih podatkov ne pripnemo samodejno računu.</Text></Card>{profile.mode === 'local' && hotspots.length ? <><Notice tone="warning">V lokalnem dnevniku je {hotspots.length} rastišč. Pripenjanje ohrani njihove ID-je in jih doda v sinhronizacijsko vrsto.</Notice><AppButton title="Pripni lokalni dnevnik temu računu" onPress={() => void attachLocalDiary().then(() => navigation.popTo('Tabs')).catch((error) => Alert.alert('Pripenjanje', error.message))} /></> : null}<AppButton title="Odpri ločen oblačni dnevnik" variant="secondary" onPress={() => void useCloudDiary().then(() => navigation.popTo('Tabs')).catch((error) => Alert.alert('Dnevnik', error.message))} /><AppButton title="Nazaj" variant="ghost" onPress={() => navigation.goBack()} /></Screen>;

  const submit = async () => {
    setLoading(true); setMessage(undefined);
    try {
      if (mode === 'signup') {
        const result = await signUp({ email, password, username, displayName });
        setMessage(result.message);
      } else if (mode === 'forgot') {
        await requestPasswordReset(email);
        setMessage('Če račun obstaja, smo poslali povezavo za ponastavitev gesla.');
      } else if (mode === 'reset') {
        await updatePassword(password); setMessage('Geslo je posodobljeno.');
      } else {
        await signIn(email, password);
        setMessage('Prijava je uspela.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Postopek ni uspel.'); }
    finally { setLoading(false); }
  };
  return <Screen><Text style={commonStyles.title}>{mode === 'signup' ? 'Ustvari račun' : mode === 'forgot' ? 'Pozabljeno geslo' : mode === 'reset' ? 'Novo geslo' : 'Prijava'}</Text>{message ? <Notice tone={message.includes('uspel') || message.includes('ustvarjen') || message.includes('poslali') || message.includes('posodobljeno') ? 'success' : 'warning'}>{message}</Notice> : null}<Card>
    {mode !== 'reset' ? <Field label="E-pošta" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /> : null}
    {mode !== 'forgot' ? <Field label={mode === 'reset' ? 'Novo geslo' : 'Geslo'} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /> : null}
    {mode === 'signup' ? <><Field label="Uporabniško ime" value={username} onChangeText={setUsername} autoCapitalize="none" hint="Javno pri objavah in iskanju prijateljev." /><Field label="Prikazno ime (neobvezno)" value={displayName} onChangeText={setDisplayName} /></> : null}
    <AppButton title={mode === 'signup' ? 'Ustvari račun' : mode === 'forgot' ? 'Pošlji povezavo' : mode === 'reset' ? 'Shrani novo geslo' : 'Prijava'} loading={loading || authLoading} onPress={() => void submit()} />
  </Card><View style={commonStyles.wrap}>{mode !== 'login' ? <AppButton title="Prijava" variant="ghost" onPress={() => setMode('login')} /> : null}{mode !== 'signup' ? <AppButton title="Nov račun" variant="ghost" onPress={() => setMode('signup')} /> : null}{mode === 'login' ? <AppButton title="Pozabljeno geslo" variant="ghost" onPress={() => setMode('forgot')} /> : null}</View></Screen>;
}
