// Explicit opt-in, public non-user test coordinate. No raw payloads/files/precise private locations are persisted.
import { loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { getMushroomWeatherSummary } from '../src/services/weather';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';
async function run() {
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let requests = 0; const original = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => { requests++; return original(...args); }) as typeof fetch;
  try {
    const point = { latitude: 46.5, longitude: 14.5 }, today = weatherLocalDate();
    const main = getMushroomWeatherSummary(db, point.latitude, point.longitude, { baseLocalDate: today });
    const snapshot = await loadSevenDaySnapshot(db, point, today); await main;
    console.log('LIVE existing point + concurrent weekly snapshot HTTP', requests);
    for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
      const results = evaluateSevenDayConditions(snapshot, id);
      console.log(id, results.map(result => ({ day: result.horizonDay, score: result.score, status: result.status, missingCount: result.missing.length })));
      console.log('Reasons', [...new Set(results.flatMap(result => result.missing))]);
    }
    const before = requests; await loadSevenDaySnapshot(db, point, today);
    console.log('LIVE warm reopen extra HTTP', requests - before, 'forecast retrieval', snapshot.forecastRetrievedAt, 'blockers', snapshot.blockers);
  } finally { globalThis.fetch = original; }
}
void run().catch(error => { console.error('Live check failed', error); process.exitCode = 1; });
