import { friendlyCloudError, requireSupabase } from './supabase';

export interface FriendRow {
  friendshipId?: string;
  profileId: string;
  username: string;
  displayName?: string;
  status?: 'pending' | 'accepted';
  direction?: 'incoming' | 'outgoing';
}

export interface FriendHotspot { id: string; owner_username: string; latitude: number; longitude: number; title?: string }

export async function listFriendships(): Promise<FriendRow[]> {
  const result = await requireSupabase().rpc('get_my_friendships');
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Prijateljstev ni mogoče naložiti.'));
  return (result.data ?? []) as FriendRow[];
}

export async function searchProfiles(query: string): Promise<FriendRow[]> {
  if (query.trim().length < 2) return [];
  const result = await requireSupabase().rpc('search_profiles', { search_query: query.trim(), result_limit: 20 });
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Iskanje uporabnikov trenutno ni na voljo.'));
  return (result.data ?? []) as FriendRow[];
}

export async function sendFriendRequest(currentUserId: string, profileId: string) {
  const result = await requireSupabase().from('friendships').insert({ requester_id: currentUserId, recipient_id: profileId });
  if (result.error) throw new Error(friendlyCloudError(result.error));
}

export async function respondToFriendRequest(friendshipId: string, action: 'accept' | 'reject') {
  const result = await requireSupabase().rpc('respond_to_friend_request', { friendship_id: friendshipId, response: action });
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Prošnje ni bilo mogoče posodobiti.'));
}

export async function removeFriendship(friendshipId: string) {
  const result = await requireSupabase().from('friendships').delete().eq('id', friendshipId);
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Prijateljstva ni bilo mogoče odstraniti.'));
}

export async function listFriendHotspots(): Promise<FriendHotspot[]> {
  const result = await requireSupabase().rpc('get_friend_hotspots');
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Rastišč prijateljev ni mogoče naložiti.'));
  return (result.data ?? []) as FriendHotspot[];
}
