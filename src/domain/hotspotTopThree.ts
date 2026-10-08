import type { Hotspot } from './types';
import { rankingScore, sortHotspots, type RankingAssessments } from './hotspotRanking';

/** Presentation of the existing conditions ordering, never a separate score. */
export function topThreeHotspots<T extends Pick<Hotspot, 'id' | 'title'>>(hotspots: T[], assessments: RankingAssessments, complete: boolean): T[] {
  return complete ? sortHotspots(hotspots, assessments, 'conditions').filter(h => rankingScore(assessments[h.id]) != null).slice(0, 3) : [];
}
