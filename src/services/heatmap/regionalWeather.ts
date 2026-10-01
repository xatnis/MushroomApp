import type { SQLiteDatabase } from 'expo-sqlite';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition, HeatmapWeatherCellSource } from '../../domain/heatmap/types';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import { getHeatmapWeatherBatch } from '../weather';
import metadata from '../../data/heatmapRegional/metadata.json';

export const REGIONAL_WEATHER_BATCH_SIZE = 25;
// One batch in flight (two HTTP requests). Small interactive bursts, not 15s per batch.
export const REGIONAL_WEATHER_BATCH_INTERVAL_MS = 2000;
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
  let transport = Promise.resolve();
  const recent: Array<{ time: number; points: number }> = [];
  return async function load(db: SQLiteDatabase, points: HeatmapWeatherCellDefinition[], date: string,
    onProgress?: (batch: HeatmapWeatherBatch) => void, signal?: AbortSignal): Promise<HeatmapWeatherBatch> {
    const started = Date.now();
    const cells: HeatmapWeatherBatch['cells'] = {};
    let requests = 0, hits = 0, joined = 0, diskHits = 0;
    let firstUsefulMs: number | undefined;
    let readingCache = true;
    let publishedCount = -1;
    let progressQueued = false;
    const snapshot = (): HeatmapWeatherBatch => ({ policyVersion: HEATMAP_WEATHER_POLICY_VERSION,
      baseLocalDate: date, fetchedAt: Object.values(cells).map(c => c.fetchedAt).sort().at(-1) ?? new Date().toISOString(),
      stale: Object.values(cells).some(c => c.stale), coldRequestCount: requests, cells: { ...cells } });
    const emit = () => {
      const count = Object.keys(cells).length;
      if (signal?.aborted || count === publishedCount) return;
      publishedCount = count;
      if (firstUsefulMs == null && Object.values(cells).some(healthy)) firstUsefulMs = Date.now() - started;
      onProgress?.(snapshot());
    };
    const publish = () => {
      if (progressQueued) return;
      progressQueued = true;
      void Promise.resolve().then(() => {
        progressQueued = false;
        if (!readingCache) emit();
      });
    };
    const owned: Array<{ point: HeatmapWeatherCellDefinition; key: string; running?: boolean; done?: boolean; resolve: (cell: HeatmapWeatherCellSource) => void }> = [];
    const unavailable = (point: HeatmapWeatherCellDefinition): HeatmapWeatherCellSource => ({ ...point, baseLocalDate: date, days: [],
      errors: { historical: 'Podatki niso na voljo.', forecast: 'Podatki niso na voljo.' }, fetchedAt: new Date().toISOString(), stale: false });
    const cancelQueued = () => {
      for (const entry of owned) if (!entry.running && !entry.done) {
        entry.done = true; pending.delete(entry.key); entry.resolve(unavailable(entry.point));
      }
    };
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
    signal?.addEventListener('abort', cancelQueued, { once: true });
    if (signal?.aborted) cancelQueued();
    if (Object.values(cells).some(healthy)) firstUsefulMs = Date.now() - started;
    emit();
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
        if (entry.done) continue;
        let cached: HeatmapWeatherCellSource | undefined;
        try {
          const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM weather_cache WHERE cacheKey = ?', entry.key);
          if (row) cached = JSON.parse(row.payload) as HeatmapWeatherCellSource;
        } catch { /* Disk cache failure is a miss. */ }
        if (!cached || !healthy(cached) || Date.now() - Date.parse(cached.fetchedAt) >= TTL_MS) cached = await legacyCell(entry.point);
        if (entry.done) continue;
        if (cached?.id === entry.point.id && cached.baseLocalDate === date && healthy(cached) && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) {
          entry.done = true;
          memory.set(entry.key, cached); hits++; diskHits++; entry.resolve(cached); pending.delete(entry.key);
        } else missing.push(entry);
      }
      readingCache = false;
      await Promise.resolve(); emit();
      for (let offset = 0; offset < missing.length; offset += REGIONAL_WEATHER_BATCH_SIZE) {
        if (signal?.aborted) break;
        // Do not reserve slots for an entire old viewport. Recheck ownership after the lock.
        const preceding = transport;
        let release!: () => void;
        transport = new Promise<void>(resolve => { release = resolve; });
        await preceding;
        const group = missing.slice(offset, offset + REGIONAL_WEATHER_BATCH_SIZE).filter(e => !e.done);
        if (!group.length || signal?.aborted) { release(); continue; }
        while (recent.length && recent[0].time <= Date.now() - 60000) recent.shift();
        // Conservative local budget: <=75 locations/minute for these long-history requests.
        // HTTP count is NOT provider accounting. Other screens/IP users also consume quota.
        let projected = recent.reduce((sum, item) => sum + item.points, 0) + group.length;
        let budgetWait = 0;
        if (intervalMs > 0) for (const item of recent) {
          if (projected <= 75) break;
          projected -= item.points;
          budgetWait = Math.max(0, item.time + 60000 - Date.now());
        }
        const wait = Math.max(0, nextStart - Date.now(), budgetWait);
        if (wait) await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, wait);
          signal?.addEventListener('abort', finish, { once: true });
          if (signal?.aborted) finish();
        });
        if (signal?.aborted) { release(); break; }
        try {
        nextStart = Date.now() + intervalMs;
        recent.push({ time: Date.now(), points: group.length });
        group.forEach(entry => { entry.running = true; });
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
          entry.done = true; entry.resolve(cell); pending.delete(entry.key);
        }
        // Publish the whole batch together, before waiting for disk persistence.
        await Promise.all(writes); emit();
        } finally {
          // Never strand dedupe ownership/the transport lock after an unexpected failure.
          for (const entry of group) if (!entry.done) {
            entry.done = true; pending.delete(entry.key); entry.resolve(unavailable(entry.point));
          }
          release();
        }
      }
    };
    await Promise.all([work(), ...waits]);
    signal?.removeEventListener('abort', cancelQueued);
    const result = snapshot(); emit();
    debug({ requiredPointCount: points.length, cacheHits: hits, joined, missingPointCount: owned.length - diskHits,
      batchesRequested: requests / 2, durationMs: Date.now() - started, firstUsefulMs,
      readyDurationMs: Object.values(cells).every(healthy) ? Date.now() - started : undefined,
      failedPointCount: Object.values(cells).filter(c => !healthy(c)).length });
    return result;
  };
}
export const getRegionalWeather = createRegionalWeatherLoader();
