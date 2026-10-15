// Explicit opt-in, public non-user test coordinate. No raw payloads/files/precise private locations are persisted.
import { loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { getCanonicalPointWeatherSummary, scoreForPointSummary } from '../src/services/pointConditions';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { conditionsForLocation, mapConditionsLocation } from '../src/domain/locationConditions';
async function run() {
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let requests = 0; const original = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => { requests++; return original(...args); }) as typeof fetch;
  try {
    const point = { latitude: 46.5, longitude: 14.5 }, today = weatherLocalDate();
    const main = getCanonicalPointWeatherSummary(db, point.latitude, point.longitude, today);
    const snapshot = await loadSevenDaySnapshot(db, point, today); const canonicalMain = await main;
    strictEqual(canonicalMain, snapshot.today);
    console.log('LIVE canonical point + concurrent weekly snapshot HTTP', requests);
    for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
      const results = evaluateSevenDayConditions(snapshot, id);
      console.log(id, results.map(result => ({ day: result.horizonDay, score: result.score, status: result.status, missingCount: result.missing.length })));
      console.log('Reasons', [...new Set(results.flatMap(result => result.missing))]);
      deepStrictEqual(scoreForPointSummary(canonicalMain, id), results[0].canonical);
      deepStrictEqual(calculateMushroomWeatherScore(results[1].inputs, id), results[1].canonical);
      for (const [index, day] of [[0, 'today'], [1, 'tomorrow']] as const) {
        const assessment = conditionsForLocation(mapConditionsLocation({ ...point, id: 'public-selected' }), snapshot, id, day, today)!;
        deepStrictEqual(assessment.summary, results[index].inputs);
        deepStrictEqual(assessment.scoreDetails, results[index].canonical);
        deepStrictEqual(assessment.soilSampling, results[index].soilSampling);
        strictEqual(assessment.score, results[index].score);
      }
      console.log('Full canonical Today/Tomorrow inputs/components/explanation parity', id, 'PASS');
    }
    const before = requests; await loadSevenDaySnapshot(db, point, today);
    console.log('LIVE warm reopen extra HTTP', requests - before, 'forecast retrieval', snapshot.forecastRetrievedAt, 'blockers', snapshot.blockers);
    console.log('Hourly payload cost', [...rows.entries()].filter(([key]) => key.startsWith('seven-day-hourly')).map(([key, row]) => ({ endpoint: key.includes('soil_moisture') ? 'forecast' : 'archive',
      bytes: Buffer.byteLength(row.payload, 'utf8'), hours: JSON.parse(row.payload).hourly?.time?.length })));
  } finally { globalThis.fetch = original; }
}
void run().catch(error => { console.error('Live check failed', error); process.exitCode = 1; });
