import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const cloudConfigured = Boolean(url && publicKey);

export const supabase: SupabaseClient | undefined = cloudConfigured
  ? createClient(url!, publicKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : undefined;

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export const authRedirectUrl = 'mushroomapp-preview://auth/callback';

export function friendlyCloudError(error: unknown, fallback = 'Postopek v oblaku trenutno ni uspel. Poskusite znova.') {
  const message = error instanceof Error ? error.message : String(error ?? '');
  console.warn('[Supabase]', message);
  const lower = message.toLocaleLowerCase('en-US');
  if (lower.includes('invalid login credentials')) return 'E-pošta ali geslo ni pravilno.';
  if (lower.includes('email not confirmed')) return 'Najprej potrdite račun prek povezave v e-pošti.';
  if (lower.includes('user already registered')) return 'Račun s tem e-poštnim naslovom že obstaja.';
  if (lower.includes('username') && (lower.includes('duplicate') || lower.includes('unique'))) return 'To uporabniško ime je že zasedeno.';
  if (lower.includes('friendships_user_low_user_high_key') || lower.includes('duplicate key')) return 'Prošnja ali prijateljstvo med tema uporabnikoma že obstaja.';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout')) return 'Povezava z oblakom trenutno ni na voljo. Lokalni podatki so ostali shranjeni.';
  if (lower.includes('jwt') || lower.includes('session')) return 'Seja je potekla. Prijavite se znova.';
  return fallback;
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('CLOUD_NOT_CONFIGURED');
  return supabase;
}
