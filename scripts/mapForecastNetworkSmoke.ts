import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { hourlyWeatherFixture } from './sevenDayHourlyFixture';
import { getCanonicalPointWeatherSummary, loadCanonicalPointSnapshot, pointResults } from '../src/services/pointConditions';
import { loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { conditionsForLocation, mapConditionsLocation } from '../src/domain/locationConditions';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { forecastComparison, forecastFactorInsights } from '../src/components/mapForecastPresentation';

async function run() {
  const realDate = globalThis.Date, originalFetch = globalThis.fetch, date = '2026-10-14'; let now = realDate.parse(date + 'T12:00:00Z');
  class FixtureDate extends realDate { constructor(value?: number | string) { super(value === undefined ? now : value); } static now() { return now; } }
  globalThis.Date = FixtureDate as DateConstructor;
  const rows = new Map<string, any>(), db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key),
    runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let http = 0, offline = false;
  globalThis.fetch = (async (url: any) => { http++; if (offline) throw new Error('offline');
    const parsed = new URL(String(url)); ok(!String(url).includes('Private') && !parsed.searchParams.has('name') && !parsed.searchParams.has('id'));
    return { ok: true, json: async () => hourlyWeatherFixture(String(url), date) }; }) as any;
  try {
    const point = { id: 'private-test-only', title: 'Private annotations never sent', latitude: 46.5, longitude: 14.5 };
    const [preview, concurrentFull] = await Promise.all([loadSevenDaySnapshot(db, point, date), loadCanonicalPointSnapshot(db, point, date)]);
    strictEqual(preview, concurrentFull); strictEqual(http, 2); const cold = http;
    strictEqual(await loadSevenDaySnapshot(db, point, date), preview); strictEqual(http, cold, 'full from preview is warm');
    for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
      const week = pointResults(preview, profile); ok(week.every(day => day.score != null));
      for (const result of week) {
        const comparison = forecastComparison(result, week[0], preview);
        ok(!comparison.includes('ni na voljo'), 'real production snapshot/input contract supports comparison');
        if (result.score === week[0].score) strictEqual(comparison, 'Enaka ocena kot danes');
        else ok(comparison.startsWith(result.score! > week[0].score! ? '+' : '−'));
        ok(forecastFactorInsights(result).every(factor => result.canonical.components.some(c => c.key === factor.key && c.weightedPoints === factor.points && c.weight === factor.maximum)));
      }
      for (const [index, day] of [[0, 'today'], [1, 'tomorrow']] as const) {
        const detail = conditionsForLocation(mapConditionsLocation(point), preview, profile, day, date)!;
        deepStrictEqual(detail.summary, week[index].inputs); deepStrictEqual(detail.scoreDetails, week[index].canonical);
      }
      for (let i = 0; i < 7; i++) strictEqual(pointResults(preview, profile)[i], week[i]);
    }
    strictEqual(await getCanonicalPointWeatherSummary(db, point.latitude, point.longitude, date), preview.today);
    strictEqual(http, cold, 'date/profile/scroll/return/Razmere parity reuse has no HTTP');
    strictEqual(await loadSevenDaySnapshot(db, point, date), preview); strictEqual(http, cold, 'warm reopen');
    const next = { latitude: 46.6, longitude: 14.9 }, other = await loadSevenDaySnapshot(db, next, date);
    strictEqual(http - cold, 2); strictEqual(other.latitude, next.latitude); strictEqual(other.longitude, next.longitude);
    strictEqual(conditionsForLocation(mapConditionsLocation({ ...next, id: 'new' }), preview, 'generic', 'today', date), undefined, 'A never belongs under B');
    const beforeWarm = http; await loadSevenDaySnapshot(db, next, date); strictEqual(http, beforeWarm);
    now += 31 * 60 * 1000; offline = true;
    const stale = await loadSevenDaySnapshot(db, point, date); ok(stale.stale); ok(pointResults(stale, 'generic').every(day => day.status === 'stale'));
    console.log('PASS production map forecast HTTP fixture', { coldPreview: cold, concurrentFullExtra: 0, fullFromPreview: 0, returnToMap: 0,
      warmReopen: 0, differentColdPoint: 2, cachedProfilesAndDays: 0, panZoomAndScroll: 'no forecast acquisition handler', expiredOfflineRefreshAttempts: http - beforeWarm });
  } finally { globalThis.Date = realDate; globalThis.fetch = originalFetch; }
}
/** Explicit opt-in public-coordinate probe; no private locations or raw payload artifacts. */
async function live() {
  const rows = new Map<string, any>(), db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key),
    runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  const fetch = globalThis.fetch; let http = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => { http++; return fetch(...args); }) as typeof fetch;
  try {
    const date = weatherLocalDate(), point = { latitude: 46.5, longitude: 14.5 }, counts: Record<string, number> = {};
    let before = http; const snapshot = await loadSevenDaySnapshot(db, point, date); counts.coldSelectedPoint = http - before;
    before = http; strictEqual(await loadSevenDaySnapshot(db, point, date), snapshot); counts.fullFromPreview = http - before;
    before = http; strictEqual(await getCanonicalPointWeatherSummary(db, point.latitude, point.longitude, date), snapshot.today); counts.returnPointContext = http - before;
    before = http; await loadSevenDaySnapshot(db, point, date); counts.warmReopen = http - before;
    before = http; const second = await loadSevenDaySnapshot(db, { latitude: 46.6, longitude: 14.9 }, date); counts.differentColdPoint = http - before;
    before = http;
    const availability = (Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map(profile => ({ profile,
      readyFirstPoint: pointResults(snapshot, profile).filter(day => day.score != null).length,
      readySecondPoint: pointResults(second, profile).filter(day => day.score != null).length }));
    counts.profileAndDateSelection = http - before;
    console.log('LIVE production service probe (not native gesture measurement)', { baseDate: date, counts, availability,
      forecastRetrievedAt: snapshot.forecastRetrievedAt, blockers: snapshot.blockers });
  } finally { globalThis.fetch = fetch; }
}
void (process.argv.includes('--live') ? live() : run()).catch(error => { console.error(error); process.exitCode = 1; });
