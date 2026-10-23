import { shadowCellResult, shadowColumn, type ShadowArtifact, type ShadowVector } from './koroskaShadowData';
import type { LiveRegionalSnapshot } from './koroskaLive';

/** Small stable ID groups, prepared once. No polygon/source construction when switching live/frozen. */
export const shadowWeatherGroups = (d: ShadowArtifact) => d.weather.map((_, i) => d.cells.filter(c => c.weatherIndex === i).map(c => c.id));
export function liveRegionalPaint<T>(paint: T, groups: string[][], snapshot: LiveRegionalSnapshot | undefined, profile: number, day: number): T {
  const get = ['get', shadowColumn(profile, day)];
  const match: unknown[] = ['match', ['get', 'id']];
  groups.forEach((ids, i) => match.push(ids, snapshot?.publicationAllowed ? snapshot.vectors[(i * 4 + profile) * 7 + day].category : 'insufficient'));
  match.push('insufficient');
  const state = ['case', ['==', get, 'unknown'], 'unknown', ['==', get, 'outside'], 'outside', match];
  const copy = (v: unknown): unknown => Array.isArray(v) ? v.length === 2 && v[0] === 'get' && v[1] === 'renderState' ? state : v.map(copy)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v;
  return copy(paint) as T;
}
export function regionalPreviewResult(d: ShadowArtifact, mode: 'frozen' | 'live', snapshot: LiveRegionalSnapshot | undefined,
  id: string, profile: number, day: number, dates: string[], message: string) {
  const original = shadowCellResult(d, id, profile, day);
  if (!original || mode === 'frozen') return original;
  const canonical = snapshot?.vectors[(original.cell.weatherIndex * 4 + profile) * 7 + day];
  const vector: ShadowVector = canonical && snapshot?.publicationAllowed ? canonical
    : { score: null, label: null, category: 'insufficient', status: 'insufficient_data', missing: [message, ...(canonical?.missing ?? [])] };
  return { ...original, vector, date: dates[day], score: original.habitat === 'candidate' ? vector.score : null,
    label: original.habitat === 'candidate' ? vector.label : null, category: original.habitat === 'unknown' ? 'unknown' as const : original.habitat === 'outside-model' ? 'outside' as const : vector.category };
}
