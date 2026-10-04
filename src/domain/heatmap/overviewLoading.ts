import type { HeatmapHabitatFeature, HeatmapWeatherCellDefinition } from './types';
import type { Bounds } from './spatial';
import { HEATMAP_LOD } from './lod';

// Loading policy, not a habitat/weather-model threshold.
export const OVERVIEW_PREFETCH = { maxZoom: 8.8, maxPoints: 6 } as const;
export const shouldPrefetchOverview = (lod: 'overview' | 'detail', zoom: number, previousSettledZoom: number) =>
  lod === 'detail' && Number.isFinite(zoom) && zoom > HEATMAP_LOD.overviewEnterZoom && zoom <= OVERVIEW_PREFETCH.maxZoom && zoom < previousSettledZoom;

/** One focus + one central point first, then largest visible-cell gain. Cached
 * points are removed by the loader before batching; each cell maps to one point,
 * so static counts equal the marginal gain for each remaining missing point.
 * Overscan-only points cannot outrank visible coverage. No GIS/geometry rebuild. */
export function prioritizedOverviewWeatherPointIds(features: HeatmapHabitatFeature[], visible: HeatmapHabitatFeature[],
  bounds: Bounds, points: Array<Pick<HeatmapWeatherCellDefinition, 'id' | 'latitude' | 'longitude'>>, focus?: { latitude: number; longitude: number }): string[] {
  const gain = new Map<string, number>();
  for (const f of visible) gain.set(f.properties.weatherCellId, (gain.get(f.properties.weatherCellId) ?? 0) + 1);
  const required = new Set(features.map(f => f.properties.weatherCellId));
  const lookup = new Map(points.filter(p => required.has(p.id)).map(p => [p.id, p]));
  const x = (bounds[0] + bounds[2]) / 2, y = (bounds[1] + bounds[3]) / 2;
  const distance = (id: string, longitude = x, latitude = y) => {
    const p = lookup.get(id);
    return p ? ((p.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2 + (p.latitude - latitude) ** 2 : Infinity;
  };
  const visibleIds = [...lookup.keys()].filter(id => gain.has(id));
  const center = [...visibleIds].sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))[0];
  const focused = focus && focus.longitude >= bounds[0] && focus.longitude <= bounds[2] && focus.latitude >= bounds[1] && focus.latitude <= bounds[3]
    ? [...visibleIds].sort((a, b) => distance(a, focus.longitude, focus.latitude) - distance(b, focus.longitude, focus.latitude) || a.localeCompare(b))[0] : undefined;
  const tier = (id: string) => id === focused ? 0 : id === center ? 1 : gain.has(id) ? 2 : 3;
  return [...lookup.keys()].sort((a, b) => tier(a) - tier(b) || (gain.get(b) ?? 0) - (gain.get(a) ?? 0) || distance(a) - distance(b) || a.localeCompare(b));
}

/** Weather-scoreable means a valid weather assessment, NOT verified mushroom
 * habitat. Unknown/outside habitat may legitimately remain neutral after 100%. */
export function overviewReadyCoverage(features: HeatmapHabitatFeature[], readyPointIds: Set<string>) {
  const readyCells = features.filter(f => readyPointIds.has(f.properties.weatherCellId)).length;
  return { readyCells, totalCells: features.length, overviewReadyCoveragePct: features.length ? 100 * readyCells / features.length : 0 };
}

export function createOverviewCoverageDiagnostics(now = () => performance.now()) {
  let key = '', started = 0;
  const emitted = new Set<string>();
  return (viewportKey: string, coverage: ReturnType<typeof overviewReadyCoverage>) => {
    if (key !== viewportKey) { key = viewportKey; started = now(); emitted.clear(); }
    const events: Array<{ milestone: string; elapsedMs: number; overviewReadyCoveragePct: number }> = [];
    for (const [milestone, threshold] of [['first', 0], ['50%', 50], ['80%', 80], ['100%', 100]] as const) {
      if (!emitted.has(milestone) && (threshold === 0 ? coverage.readyCells > 0 : coverage.totalCells > 0 && coverage.overviewReadyCoveragePct >= threshold)) {
        emitted.add(milestone); events.push({ milestone, elapsedMs: now() - started, overviewReadyCoveragePct: coverage.overviewReadyCoveragePct });
      }
    }
    return events;
  };
}
