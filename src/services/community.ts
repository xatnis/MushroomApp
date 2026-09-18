import type { CommunityCard } from '../domain/types';
import { friendlyCloudError, requireSupabase } from './supabase';

export type FeedCard = CommunityCard & { signedPhotoUrls?: string[] };

export async function loadCommunityCards(scope: 'friends' | 'community', offset: number, limit = 20): Promise<FeedCard[]> {
  const client = requireSupabase();
  const result = await client.rpc('get_shared_find_cards', { p_scope: scope, p_offset: offset, p_limit: limit });
  if (result.error) throw new Error(friendlyCloudError(result.error, 'Objav trenutno ni mogoče naložiti.'));
  const cards = (result.data ?? []) as CommunityCard[];
  return Promise.all(cards.map(async (card) => {
    const signed = await Promise.all((card.photoPaths ?? []).slice(0, 3).map(async (path) => {
      const response = await client.storage.from('find-photos').createSignedUrl(path, 300);
      return response.data?.signedUrl;
    }));
    return { ...card, signedPhotoUrls: signed.filter((url): url is string => Boolean(url)) };
  }));
}
