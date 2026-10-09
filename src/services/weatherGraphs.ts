import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherSummary } from '../domain/types';
import { buildWeatherDailySeries, summarySeriesInputs, type WeatherSeriesInput } from '../domain/weatherSeries';
import { getMushroomWeatherSummary, mapDailyWeather, shiftLocalDate } from './weather';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../domain/heatmap/config';

interface CacheRow { cacheKey: string; payload: string; fetchedAt: string; expiresAt: string }
interface GraphLocation { latitude: number; longitude: number; weatherCellId?: string }
const pending = new WeakMap<SQLiteDatabase, Map<string, Promise<ReturnType<typeof buildWeatherDailySeries>>>>();

/** Read existing raw point/batch payloads, not the scoring timeline capped at D+1. */
export async function readWeatherGraphCache(db: SQLiteDatabase, location: GraphLocation, today: string): Promise<WeatherSeriesInput[]> {
  const inputs: WeatherSeriesInput[] = [];
  const coordinate = `${location.latitude.toFixed(2)}:${location.longitude.toFixed(2)}`;
  for (const endpoint of ['archive', 'forecast'] as const) {
    const start = shiftLocalDate(today, -60), end = shiftLocalDate(today, -8);
    const key = endpoint === 'archive' ? `mushroom-archive-v2:${coordinate}:${start}:${end}` : `mushroom-forecast-v1:${coordinate}:${today}`;
    try {
      const point = await db.getFirstAsync<CacheRow>('SELECT cacheKey,payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey=?', key);
      const candidates: Array<{ row: CacheRow; index: number }> = point ? [{ row: point, index: 0 }] : [];
      if ((!point || Date.parse(point.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(point.expiresAt))) && location.weatherCellId && /^[\w-]+$/.test(location.weatherCellId)) {
        const marker = `${location.weatherCellId}:${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
        const prefix = endpoint === 'archive' ? `heatmap-archive:${HEATMAP_WEATHER_POLICY_VERSION}:${start}:${end}:` : `heatmap-forecast:${HEATMAP_WEATHER_POLICY_VERSION}:${today}:`;
        const batch = await db.getFirstAsync<CacheRow>('SELECT cacheKey,payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey LIKE ? ORDER BY fetchedAt DESC LIMIT 1', `${prefix}%${marker}%`);
        const index = batch ? batch.cacheKey.slice(prefix.length).split('|').findIndex(p => p === marker) : -1;
        if (batch && index >= 0) candidates.push({ row: batch, index });
      }
      // Prefer the freshest usable payload; an expired point must not hide a fresh batch.
      candidates.sort((a, b) => Date.parse(b.row.expiresAt) - Date.parse(a.row.expiresAt));
      for (const { row, index } of candidates) {
        try {
          const payload = JSON.parse(row.payload);
          const data = Array.isArray(payload) ? payload.find(p => p?.location_id === index) ?? payload[index] : payload;
          if (!data || !Array.isArray(data.daily?.time)) continue;
          for (const day of mapDailyWeather(data, endpoint === 'archive' ? 'historical' : 'forecast')) inputs.push({ day,
            source: endpoint === 'archive' ? 'archive' : day.date < today ? 'recentForecastHistory' : 'forecast', fetchedAt: row.fetchedAt,
            stale: !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now() });
          break;
        } catch { /* Try another usable existing payload before requesting this point. */ }
      }
    } catch { /* Corrupt/absent disk cache is a miss, not a crash or invented day. */ }
  }
  return inputs;
}

export function loadWeatherGraphSeries(db: SQLiteDatabase, location: GraphLocation, today: string, seed?: MushroomWeatherSummary) {
  let requests = pending.get(db); if (!requests) { requests = new Map(); pending.set(db, requests); }
  const key = `${location.latitude}:${location.longitude}:${location.weatherCellId ?? ''}:${today}`;
  const existing = requests.get(key); if (existing) return existing;
  const task = (async () => {
    const cached = await readWeatherGraphCache(db, location, today);
    const initial = seed && seed.latitude === location.latitude && seed.longitude === location.longitude ? summarySeriesInputs(seed, today) : [];
    let inputs = [...initial, ...cached];
    const series = () => buildWeatherDailySeries(location.latitude, location.longitude, today, inputs);
    const current = series();
    if (!current.partial && !current.stale) return current;
    // Only this inspected point. Canonical timeout, hybrid boundary, TTL and in-flight dedupe.
    try {
      const summary = await getMushroomWeatherSummary(db, location.latitude, location.longitude, { baseLocalDate: today });
      inputs = [...inputs, ...summarySeriesInputs(summary, today), ...await readWeatherGraphCache(db, location, today)];
    } catch { if (!current.availableRange) throw new Error('Vremenskih podatkov trenutno ni mogoče pridobiti.'); }
    return series();
  })().finally(() => requests!.delete(key));
  requests.set(key, task); return task;
}
