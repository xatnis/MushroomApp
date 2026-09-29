import type { SQLiteDatabase } from 'expo-sqlite';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition } from '../../domain/heatmap/types';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import { getHeatmapWeatherBatch } from '../weather';

// Transport engineering defaults, not Open-Meteo hard limits. 53 archive days
// count as multiple calls per coordinate; pace cold batches for the free pilot.
export const REGIONAL_WEATHER_BATCH_SIZE = 25;
export const REGIONAL_WEATHER_BATCH_INTERVAL_MS = 15000;
const TTL_MS = 30 * 60 * 1000;
const pending = new Map<string, Promise<HeatmapWeatherBatch>>();
let nextColdStart = 0;

export function regionalWeatherKey(points: HeatmapWeatherCellDefinition[], date: string): string {
  return `regional-v2:${HEATMAP_WEATHER_POLICY_VERSION}:${date}:D-60:D+1:soil09:${points.map(p => `${p.id}:${p.latitude}:${p.longitude}`).join('|')}`;
}

export function getRegionalWeather(db: SQLiteDatabase, points: HeatmapWeatherCellDefinition[], date: string): Promise<HeatmapWeatherBatch> {
  const key = regionalWeatherKey(points, date);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = load(db, points, date).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}

async function load(db: SQLiteDatabase, points: HeatmapWeatherCellDefinition[], date: string): Promise<HeatmapWeatherBatch> {
  const cells: HeatmapWeatherBatch['cells'] = {};
  let successful = 0;
  for (let offset = 0; offset < points.length; offset += REGIONAL_WEATHER_BATCH_SIZE) {
    const group = points.slice(offset, offset + REGIONAL_WEATHER_BATCH_SIZE);
    const key = regionalWeatherKey(group, date);
    const stored = await db.getFirstAsync<{ payload: string; fetchedAt: string }>('SELECT payload, fetchedAt FROM weather_cache WHERE cacheKey = ?', key);
    let cached: HeatmapWeatherBatch | undefined;
    if (stored && Date.now() - Date.parse(stored.fetchedAt) < TTL_MS) {
      try { cached = JSON.parse(stored.payload) as HeatmapWeatherBatch; } catch { /* Ignore invalid cache. */ }
    }
    if (cached?.baseLocalDate === date && group.every(p => cached?.cells[p.id])) {
      Object.assign(cells, cached.cells); successful++; continue;
    }
    const waitMs = Math.max(0, nextColdStart - Date.now());
    nextColdStart = Date.now() + waitMs + REGIONAL_WEATHER_BATCH_INTERVAL_MS;
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    try {
      const batch = await getHeatmapWeatherBatch(db, group, date);
      Object.assign(cells, batch.cells); successful++;
      // Do not pin partial failures for 30 minutes: retry can recover them.
      if (Object.values(batch.cells).every(c => !c.errors.historical && !c.errors.forecast && !c.stale)) {
        try {
          await db.runAsync('INSERT OR REPLACE INTO weather_cache (cacheKey, payload, fetchedAt, expiresAt) VALUES (?, ?, ?, ?)', key, JSON.stringify(batch), new Date().toISOString(), new Date(Date.now() + TTL_MS).toISOString());
        } catch { /* A cache write failure must not discard successfully fetched weather. */ }
      }
    } catch {
      for (const p of group) cells[p.id] = { ...p, baseLocalDate: date, days: [], errors: { historical: 'Podatki niso na voljo.', forecast: 'Podatki niso na voljo.' }, fetchedAt: new Date().toISOString(), stale: false };
    }
  }
  if (!successful) throw new Error('Vremenskih podatkov za območja trenutno ni mogoče pridobiti. Poskusite znova.');
  return { policyVersion: HEATMAP_WEATHER_POLICY_VERSION, baseLocalDate: date,
    fetchedAt: Object.values(cells).map(c => c.fetchedAt).sort().at(-1)!,
    stale: Object.values(cells).some(c => c.stale), coldRequestCount: 2 * Math.ceil(points.length / REGIONAL_WEATHER_BATCH_SIZE), cells };
}
