import type { SQLiteDatabase } from 'expo-sqlite';
import metadata from '../src/data/heatmapRegional/metadata.json';
import { getRegionalWeather } from '../src/services/heatmap/regionalWeather';
import { localDateFor } from '../src/domain/heatmap/assessment';

const rows = new Map<string, { payload: string; fetchedAt: string; expiresAt: string }>();
const db = {
  getFirstAsync: async (_sql: string, key: string) => rows.get(key) ?? null,
  runAsync: async (_sql: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => {
    rows.set(key, { payload, fetchedAt, expiresAt });
    return { changes: 1, lastInsertRowId: 0 };
  },
} as unknown as SQLiteDatabase;

async function main() {
  const date = localDateFor();
  const start = performance.now();
  const weather = await getRegionalWeather(db, metadata.weatherCells, date);
  const coldMs = performance.now() - start;
  const cachedStart = performance.now();
  const cached = await getRegionalWeather(db, metadata.weatherCells, date);
  console.log(JSON.stringify({ date, coldMs, cachedMs: performance.now() - cachedStart,
    points: Object.keys(weather.cells).length, plannedHttpRequests: weather.coldRequestCount,
    historicalFailures: Object.values(weather.cells).filter(c => c.errors.historical).length,
    forecastFailures: Object.values(weather.cells).filter(c => c.errors.forecast).length,
    cachedEqual: JSON.stringify(weather.cells) === JSON.stringify(cached.cells),
    samples: Object.values(weather.cells).slice(0, 3).map(c => ({ id: c.id, days: c.days.length, errors: c.errors })),
  }, null, 2));
}
void main().catch(error => { console.error(error); throw error; });
