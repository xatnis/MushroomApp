import { friendlyCloudError, requireSupabase } from './supabase';

export async function updateCloudProfile(userId: string, username: string, displayName?: string) {
  const clean = username.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(clean)) throw new Error('Uporabniško ime naj ima 3–32 dovoljenih znakov.');
  const response = await requireSupabase().from('profiles').update({ username: clean, display_name: displayName?.trim() || null }).eq('id', userId);
  if (response.error) throw new Error(friendlyCloudError(response.error, 'Profila ni bilo mogoče shraniti.'));
}
