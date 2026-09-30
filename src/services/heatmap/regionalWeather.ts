import type { SQLiteDatabase } from 'expo-sqlite';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition, HeatmapWeatherCellSource } from '../../domain/heatmap/types';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import { getHeatmapWeatherBatch } from '../weather';
import metadata from '../../data/heatmapRegional/metadata.json';

export const REGIONAL_WEATHER_BATCH_SIZE = 25;
export const REGIONAL_WEATHER_BATCH_INTERVAL_MS = 15000;
const TTL_MS = 30 * 60 * 1000;
export function regionalWeatherKey(points: HeatmapWeatherCellDefinition[], date: string): string {
  return `regional-v2:${HEATMAP_WEATHER_POLICY_VERSION}:${date}:D-60:D+1:soil09:${points.map(p => `${p.id}:${p.latitude}:${p.longitude}`).join('|')}`;
}
const healthy = (c: HeatmapWeatherCellSource) => Boolean(c.errors) && !c.errors.historical && !c.errors.forecast && !c.stale && Array.isArray(c.days) && c.days.length > 0;
const debug = (details: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[Heatmap viewport weather]', details);
};

/** Per-point ownership is registered before any await, including SQLite reads.
 * Overlapping viewport requests join the same promise; only missing points batch together. */
export function createRegionalWeatherLoader(fetchBatch = getHeatmapWeatherBatch, intervalMs = REGIONAL_WEATHER_BATCH_INTERVAL_MS) {
  const memory = new Map<string, HeatmapWeatherCellSource>();
  const pending = new Map<string, Promise<HeatmapWeatherCellSource>>();
  let nextStart = 0;
  return async function load(db: SQLiteDatabase, points: HeatmapWeatherCellDefinition[], date: string,
    onProgress?: (batch: HeatmapWeatherBatch) => void): Promise<HeatmapWeatherBatch> {
    const started = Date.now();
    const cells: HeatmapWeatherBatch['cells'] = {};
    let requests = 0, hits = 0, joined = 0, diskHits = 0;
    let firstUsefulMs: number | undefined;
    let progressQueued = false;
    const snapshot = (): HeatmapWeatherBatch => ({ policyVersion: HEATMAP_WEATHER_POLICY_VERSION,
      baseLocalDate: date, fetchedAt: Object.values(cells).map(c => c.fetchedAt).sort().at(-1) ?? new Date().toISOString(),
      stale: Object.values(cells).some(c => c.stale), coldRequestCount: requests, cells: { ...cells } });
    const publish = () => {
      if (progressQueued) return;
      progressQueued = true;
      void Promise.resolve().then(() => {
        progressQueued = false;
        if (firstUsefulMs == null && Object.values(cells).some(healthy)) firstUsefulMs = Date.now() - started;
        onProgress?.(snapshot());
      });
    };
    const owned: Array<{ point: HeatmapWeatherCellDefinition; key: string; resolve: (cell: HeatmapWeatherCellSource) => void }> = [];
    const waits = points.map(point => {
      const key = regionalWeatherKey([point], date);
      const cached = memory.get(key);
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) {
        hits++; cells[point.id] = cached; return Promise.resolve();
      }
      let promise = pending.get(key);
      if (promise) joined++;
      else {
        promise = new Promise<HeatmapWeatherCellSource>(resolve => owned.push({ point, key, resolve }));
        pending.set(key, promise);
      }
      return promise.then(cell => { cells[point.id] = cell; publish(); });
    });
    if (Object.values(cells).some(healthy)) firstUsefulMs = Date.now() - started;
    onProgress?.(snapshot());
    const work = async () => {
      const missing: typeof owned = [];
      // Preserve the previous Regional V2 grouped disk cache on upgrade.
      const legacy = new Map<string, Promise<HeatmapWeatherBatch | undefined>>();
      const legacyCell = async (point: HeatmapWeatherCellDefinition) => {
        const index = metadata.weatherCells.findIndex(p => p.id === point.id && p.latitude === point.latitude && p.longitude === point.longitude);
        if (index < 0) return undefined;
        const offset = Math.floor(index / REGIONAL_WEATHER_BATCH_SIZE) * REGIONAL_WEATHER_BATCH_SIZE;
        const key = regionalWeatherKey(metadata.weatherCells.slice(offset, offset + REGIONAL_WEATHER_BATCH_SIZE), date);
        if (!legacy.has(key)) legacy.set(key, (async () => {
          try {
            const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM weather_cache WHERE cacheKey = ?', key);
            return row ? JSON.parse(row.payload) as HeatmapWeatherBatch : undefined;
          } catch { return undefined; }
        })());
        return (await legacy.get(key))?.cells?.[point.id];
      };
      for (const entry of owned) {
        let cached: HeatmapWeatherCellSource | undefined;
        try {
          const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM weather_cache WHERE cacheKey = ?', entry.key);
          if (row) cached = JSON.parse(row.payload) as HeatmapWeatherCellSource;
        } catch { /* Disk cache failure is a miss. */ }
        if (!cached || !healthy(cached) || Date.now() - Date.parse(cached.fetchedAt) >= TTL_MS) cached = await legacyCell(entry.point);
        if (cached?.id === entry.point.id && cached.baseLocalDate === date && healthy(cached) && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) {
          memory.set(entry.key, cached); hits++; diskHits++; entry.resolve(cached); pending.delete(entry.key);
        } else missing.push(entry);
      }
      await Promise.resolve(); onProgress?.(snapshot());
      for (let offset = 0; offset < missing.length; offset += REGIONAL_WEATHER_BATCH_SIZE) {
        const group = missing.slice(offset, offset + REGIONAL_WEATHER_BATCH_SIZE);
        const wait = Math.max(0, nextStart - Date.now());
        nextStart = Date.now() + wait + intervalMs;
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        let batch: HeatmapWeatherBatch | undefined;
        requests += 2;
        const requestStarted = Date.now();
        try { batch = await fetchBatch(db, group.map(e => e.point), date); } catch { /* Resolve failures per point so other batches remain usable. */ }
        debug({ batchPointCount: group.length, requestDurationMs: Date.now() - requestStarted });
        const writes: Promise<unknown>[] = [];
        for (const entry of group) {
          const cell = batch?.cells[entry.point.id] ?? { ...entry.point, baseLocalDate: date, days: [],
            errors: { historical: 'Podatki niso na voljo.', forecast: 'Podatki niso na voljo.' }, fetchedAt: new Date().toISOString(), stale: false };
          if (healthy(cell)) {
            memory.set(entry.key, cell);
            writes.push(db.runAsync('INSERT OR REPLACE INTO weather_cache (cacheKey, payload, fetchedAt, expiresAt) VALUES (?, ?, ?, ?)',
              entry.key, JSON.stringify(cell), cell.fetchedAt, new Date(Date.parse(cell.fetchedAt) + TTL_MS).toISOString()).catch(() => { /* Keep memory result. */ }));
          }
          entry.resolve(cell); pending.delete(entry.key);
        }
        // Publish the whole batch together, before waiting for disk persistence.
        await Promise.all(writes); onProgress?.(snapshot());
      }
    };
    await Promise.all([work(), ...waits]);
    const result = snapshot(); onProgress?.(result);
    debug({ requiredPointCount: points.length, cacheHits: hits, joined, missingPointCount: owned.length - diskHits,
      batchesRequested: requests / 2, durationMs: Date.now() - started, firstUsefulMs,
      readyDurationMs: Object.values(cells).every(healthy) ? Date.now() - started : undefined,
      failedPointCount: Object.values(cells).filter(c => !healthy(c)).length });
    return result;
  };
}
export const getRegionalWeather = createRegionalWeatherLoader();
