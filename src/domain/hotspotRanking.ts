import type { Hotspot, MushroomWeatherProfileId } from './types';
import type { HeatmapTargetDay } from './heatmap/types';

/** Selection context, not a scorer or a stored mushroom species. */
export interface ConditionsTargetContext { targetProfile: MushroomWeatherProfileId; dayMode: HeatmapTargetDay }
export const DEFAULT_RANKING_CONTEXT: ConditionsTargetContext = { targetProfile: 'generic', dayMode: 'today' };
export type HotspotSortMode = 'recent' | 'name' | 'conditions';
export type RankingAssessments = Record<string, { score: number | null } | undefined>;
export const HOTSPOT_RANKING_SETTLE_MS = 200;
export function rankingScore(value: { score: number | null } | undefined): number | undefined {
  return value?.score != null && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100 ? value.score : undefined;
}
export function sortHotspots<T extends Pick<Hotspot, 'id' | 'title'>>(hotspots: T[], assessments: RankingAssessments, sort: HotspotSortMode): T[] {
  if (sort === 'recent') return hotspots; // preserve repository ORDER BY updatedAt DESC
  const positions = new Map(hotspots.map((h, i) => [h.id, i]));
  return [...hotspots].sort((a, b) => {
    if (sort === 'name') return (a.title || 'Rastišče brez naslova').localeCompare(b.title || 'Rastišče brez naslova', 'sl', { sensitivity: 'base' })
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const left = rankingScore(assessments[a.id]), right = rankingScore(assessments[b.id]);
    if (left !== right) return left == null ? 1 : right == null ? -1 : right - left;
    return positions.get(a.id)! - positions.get(b.id)!;
  });
}
export function rankingDetailParams(hotspotId: string, context: ConditionsTargetContext) {
  return { hotspotId, conditionsContext: { ...context } };
}

/** Fixed coalescing window, not a trailing debounce which could starve progressive ranking.
 * New profile/day/filter/sort generations publish immediately; late old callbacks cannot win. */
export function createRankingOrderCoalescer(publish: (value: { key: string; ids: string[] }) => void,
  schedule: (work: () => void) => () => void = work => {
    const timer = setTimeout(work, HOTSPOT_RANKING_SETTLE_MS); return () => clearTimeout(timer);
  }) {
  let key: string | undefined, generation = 0;
  let pending: { key: string; ids: string[] } | undefined;
  let cancel: (() => void) | undefined;
  return {
    update(value: { key: string; ids: string[] }) {
      if (key !== value.key) {
        generation++; cancel?.(); cancel = undefined; pending = undefined; key = value.key;
        publish(value); return;
      }
      pending = value;
      if (cancel) return;
      const token = generation;
      cancel = schedule(() => {
        if (token !== generation) return;
        cancel = undefined;
        if (pending) { const next = pending; pending = undefined; publish(next); }
      });
    },
    cancel() { generation++; cancel?.(); cancel = undefined; pending = undefined; key = undefined; },
  };
}
