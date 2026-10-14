// Explicit opt-in, public non-user test coordinate. No raw payloads/files/precise private locations are persisted.
import { loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { getMushroomWeatherSummary } from '../src/services/weather';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
async function run() {
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let requests = 0; const original = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => { requests++; return original(...args); }) as typeof fetch;
  try {
    const point = { latitude: 46.5, longitude: 14.5 }, today = weatherLocalDate();
    const main = getMushroomWeatherSummary(db, point.latitude, point.longitude, { baseLocalDate: today });
    const snapshot = await loadSevenDaySnapshot(db, point, today); const legacyMain = await main;
    console.log('LIVE existing point + concurrent weekly snapshot HTTP', requests);
    for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
      const results = evaluateSevenDayConditions(snapshot, id);
      console.log(id, results.map(result => ({ day: result.horizonDay, score: result.score, status: result.status, missingCount: result.missing.length })));
      console.log('Reasons', [...new Set(results.flatMap(result => result.missing))]);
      console.log('INPUT AUDIT Day0', id, Object.fromEntries(['rain7dMm','rain14dMm','rain26dMm','rain30dMm','rain60dMm','avgTemp14dC','avgTemp20dC','evapotranspiration7dMm'].map(key =>
        [key, { legacy: (legacyMain.historical as any)?.[key], civilHourly: (snapshot.today.historical as any)?.[key] }])),
        'legacy score', calculateMushroomWeatherScore(legacyMain, id).score, 'candidate diagnostic (gated)', results[0].canonical.score);
    }
    const before = requests; await loadSevenDaySnapshot(db, point, today);
    console.log('LIVE warm reopen extra HTTP', requests - before, 'forecast retrieval', snapshot.forecastRetrievedAt, 'blockers', snapshot.blockers);
    console.log('Hourly payload cost', [...rows.entries()].filter(([key]) => key.startsWith('seven-day-hourly')).map(([key, row]) => ({ endpoint: key.includes('soil_moisture') ? 'forecast' : 'archive',
      bytes: Buffer.byteLength(row.payload, 'utf8'), hours: JSON.parse(row.payload).hourly?.time?.length })));
  } finally { globalThis.fetch = original; }
}
void run().catch(error => { console.error('Live check failed', error); process.exitCode = 1; });
