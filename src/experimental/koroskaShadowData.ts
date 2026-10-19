/** Public, static RESEARCH presentation only. No scoring, transport or persisted cache access. */
import type { HeatmapHabitatFeature, HeatmapHabitatState } from '../domain/heatmap/types';
import type { MushroomWeatherProfileId } from '../domain/types';

export const KOROSKA_SHADOW_ENABLED = process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW === '1';
export type ShadowState = 'poor' | 'average' | 'good' | 'very-good' | 'excellent' | 'unknown' | 'outside' | 'insufficient';
export interface ShadowVector { score: number | null; label: string | null; status: string; missing: string[]; category: ShadowState }
export interface ShadowArtifact {
  schema: 'koroska-shadow-map-v1'; researchOnly: true; contract: 'regional-civil-week-v1'; snapshotId: string;
  captureId: string; capturedAt: string; expiresAt: number; modelIssuedAt: null; modelFingerprint: string; geometryFingerprint: string;
  dates: string[]; profiles: MushroomWeatherProfileId[]; bounds: [number, number, number, number]; attribution: string[];
  weather: Array<{ id: string; latitude: number; longitude: number }>;
  provenance: Array<{ weatherId: string; source: string; retrievedAt: string | null; sha256: string | null }>;
  cells: Array<{ id: string; weatherIndex: number; habitat: HeatmapHabitatState[]; geometry: HeatmapHabitatFeature['geometry'] }>;
  vectors: ShadowVector[];
}
const labels: Record<string, ShadowState> = { 'Slabe razmere': 'poor', 'Povprečne razmere': 'average', 'Dobre razmere': 'good',
  'Zelo dobre razmere': 'very-good', 'Odlične razmere': 'excellent' };
export const categoryForLabel = (label: string | null): ShadowState => label != null && labels[label] ? labels[label] : 'insufficient';
export function validateShadowArtifact(value: unknown): ShadowArtifact {
  const d = value as ShadowArtifact;
  if (!d || d.schema !== 'koroska-shadow-map-v1' || d.researchOnly !== true || d.contract !== 'regional-civil-week-v1'
    || !d.snapshotId || !d.captureId || !Number.isFinite(Date.parse(d.capturedAt)) || !Number.isFinite(d.expiresAt) || d.modelIssuedAt !== null
    || d.cells?.length !== 696 || d.weather?.length !== 11 || d.dates?.length !== 7 || d.profiles?.join(',') !== 'generic,boletusEdulis,cantharellusCibarius,lactariusDeliciosus'
    || d.vectors?.length !== 308 || new Set(d.cells.map(c => c.id)).size !== 696
    || !/^[a-f0-9]{64}$/.test(d.modelFingerprint) || !/^[a-f0-9]{64}$/.test(d.geometryFingerprint)
    || d.bounds?.join(',') !== '14.65,46.35,15.05,46.59' || !d.attribution?.length
    || new Set(d.weather.map(w => w.id)).size !== 11 || d.weather.some(w => !w.id || !Number.isFinite(w.latitude) || !Number.isFinite(w.longitude))
    || d.provenance?.length !== 22 || d.provenance.some(p => !d.weather.some(w => w.id === p.weatherId)
      || !['archive', 'forecast'].includes(p.source) || !p.retrievedAt || !Number.isFinite(Date.parse(p.retrievedAt)) || !p.sha256)) throw new Error('Neveljaven omejeni raziskovalni posnetek.');
  const dateEpoch = (date: string) => /^\d{4}-\d\d-\d\d$/.test(date) ? Date.parse(date + 'T12:00:00Z') : NaN;
  if (d.dates.some((date, i) => !Number.isFinite(dateEpoch(date)) || new Date(dateEpoch(date)).toISOString().slice(0, 10) !== date
    || (i > 0 && dateEpoch(date) - dateEpoch(d.dates[i - 1]) !== 86400000))) throw new Error('Neveljavni absolutni datumi posnetka.');
  for (const c of d.cells) if (!Number.isInteger(c.weatherIndex) || !d.weather[c.weatherIndex] || c.habitat.length !== 4
    || c.habitat.some(h => !['candidate', 'unknown', 'outside-model'].includes(h)) || !['Polygon', 'MultiPolygon'].includes(c.geometry?.type)
    || !Array.isArray(c.geometry.coordinates) || !c.geometry.coordinates.length) throw new Error('Neveljavna geografija posnetka.');
  for (const v of d.vectors) if ((v.score !== null && (!Number.isInteger(v.score) || v.score < 0 || v.score > 100
    || !['ready', 'stale'].includes(v.status) || categoryForLabel(v.label) !== v.category || v.category === 'insufficient'))
    || (v.score === null && (v.label !== null || v.category !== 'insufficient')) || !Array.isArray(v.missing)) throw new Error('Neveljavna ali nepopolna številčna ocena.');
  return d;
}
export const shadowColumn = (profile: number, day: number) => `s${profile * 7 + day}`;
export function shadowCellResult(d: ShadowArtifact, cellId: string, profile: number, day: number) {
  const cell = d.cells.find(c => c.id === cellId);
  if (!cell || !Number.isInteger(profile) || !d.profiles[profile] || !Number.isInteger(day) || day < 0 || day > 6) return undefined;
  const vector = d.vectors[(cell.weatherIndex * 4 + profile) * 7 + day], habitat = cell.habitat[profile];
  const category: ShadowState = habitat === 'unknown' ? 'unknown' : habitat === 'outside-model' ? 'outside' : vector.category;
  return { cell, vector, habitat, category, score: habitat === 'candidate' ? vector.score : null,
    label: habitat === 'candidate' ? vector.label : null, date: d.dates[day], profile: d.profiles[profile], weather: d.weather[cell.weatherIndex] };
}
/** Build once per artifact, not on pan/zoom/date/profile. Only 28 small categorical attributes per polygon. */
export function shadowGeometry(d: ShadowArtifact): string {
  return JSON.stringify({ type: 'FeatureCollection', features: d.cells.map(c => {
    const properties: Record<string, string> = { id: c.id };
    for (let p = 0; p < 4; p++) for (let day = 0; day < 7; day++) {
      const vector = d.vectors[(c.weatherIndex * 4 + p) * 7 + day];
      properties[shadowColumn(p, day)] = c.habitat[p] === 'unknown' ? 'unknown' : c.habitat[p] === 'outside-model' ? 'outside' : vector.category;
    }
    return { type: 'Feature', id: c.id, geometry: c.geometry, properties };
  }) });
}
/** Rewrite a COPY of the existing production categorical paint; never mutate that paint or its source. */
export function shadowPaint<T>(paint: T, profile: number, day: number): T {
  const copy = (v: unknown): unknown => Array.isArray(v) ? v.length === 2 && v[0] === 'get' && v[1] === 'renderState'
    ? ['get', shadowColumn(profile, day)] : v.map(copy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v;
  return copy(paint) as T;
}
export const shadowDateLabel = (date: string) => new Intl.DateTimeFormat('sl-SI', { timeZone: 'Europe/Ljubljana', weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(date + 'T12:00:00Z'));
export const shadowIsStale = (d: ShadowArtifact, now = Date.now()) => now >= d.expiresAt;
export const pointForecastDate = (selected: string, today: string) => selected >= today && selected <= new Date(Date.parse(today + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10) ? selected : undefined;
