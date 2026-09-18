import type { AuthResponse, Session, User } from '@supabase/supabase-js';
import { authRedirectUrl, friendlyCloudError, requireSupabase } from './supabase';

export interface SignUpInput { email: string; password: string; username: string; displayName?: string }
export interface SignUpResult { user?: User; session?: Session; needsEmailConfirmation: boolean; message: string }

const normalizeUsername = (value: string) => value.trim();

function validateCredentials(email: string, password: string) {
  if (!email.trim() || !email.includes('@')) throw new Error('Vnesite veljaven e-poštni naslov.');
  if (password.length < 8) throw new Error('Geslo mora imeti najmanj 8 znakov.');
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResponse> {
  validateCredentials(email, password);
  const result = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (result.error) throw new Error(friendlyCloudError(result.error));
  return result;
}

export async function signUpWithEmail(input: SignUpInput): Promise<SignUpResult> {
  validateCredentials(input.email, input.password);
  const username = normalizeUsername(input.username);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('Uporabniško ime naj ima 3–32 znakov ter le črke, številke, piko, vezaj ali podčrtaj.');
  const client = requireSupabase();
  const availability = await client.rpc('is_username_available', { candidate: username });
  if (availability.error) throw new Error(friendlyCloudError(availability.error, 'Uporabniškega imena trenutno ni mogoče preveriti.'));
  if (!availability.data) throw new Error('To uporabniško ime je že zasedeno.');
  const result = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { emailRedirectTo: authRedirectUrl, data: { username, display_name: input.displayName?.trim() || username } },
  });
  if (result.error) throw new Error(friendlyCloudError(result.error));
  const needsEmailConfirmation = !result.data.session;
  return {
    user: result.data.user ?? undefined,
    session: result.data.session ?? undefined,
    needsEmailConfirmation,
    message: needsEmailConfirmation ? 'Preverite e-pošto in potrdite račun. Nato se prijavite.' : 'Račun je ustvarjen.',
  };
}

export async function requestPasswordReset(email: string) {
  if (!email.trim() || !email.includes('@')) throw new Error('Vnesite veljaven e-poštni naslov.');
  const result = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl });
  if (result.error) throw new Error(friendlyCloudError(result.error));
}

export async function updatePassword(password: string) {
  if (password.length < 8) throw new Error('Geslo mora imeti najmanj 8 znakov.');
  const result = await requireSupabase().auth.updateUser({ password });
  if (result.error) throw new Error(friendlyCloudError(result.error));
}

export async function signOutFromCloud() {
  const result = await requireSupabase().auth.signOut();
  if (result.error) throw new Error(friendlyCloudError(result.error));
}
