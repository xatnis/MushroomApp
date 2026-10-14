import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { aggregateCivilDay, indexHourlySource, HOURLY_INTERVAL_CONTRACT, validateIntervalCoverage, type HourlySource } from '../src/domain/weatherIntervals';
import { civilDailyPeriod, ljubljanaClock, sampleNativeSoil } from '../src/domain/soilSampling';
import { shiftLocalDate } from '../src/services/weather';
import { hourlyWeatherFixture } from './sevenDayHourlyFixture';
import { sevenDayHourlyRequestPlan, withCivilHourlyWeather } from '../src/services/sevenDayHourlyWeather';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions, buildWeatherInputsForTargetDate } from '../src/domain/sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';

const clone = <T,>(data: T): T => JSON.parse(JSON.stringify(data));
for (const invalid of [null, [], { hourly: { time: 'not-an-array' } }, { hourly: { time: [NaN] } }]) {
  const indexed = indexHourlySource({ data: invalid, contract: HOURLY_INTERVAL_CONTRACT, source: 'archive', fetchedAt: '2026-10-14T08:00:00Z', stale: false } as any);
  strictEqual(aggregateCivilDay(indexed, '2026-03-29', '2026-03-30').entry.day.precipitationMm, undefined, 'invalid payload unavailable, never crashes/zero');
}
for (const [date, hours] of [['2026-03-29', 23], ['2026-10-25', 25], ['2024-02-29', 24], ['2026-12-31', 24]] as const) {
  const period = civilDailyPeriod(date), start = Date.parse(period.startUtc!), end = Date.parse(period.endUtc!);
  strictEqual((end - start) / 3600000, hours);
  const time = Array.from({ length: hours + 1 }, (_, i) => (start + i * 3600000) / 1000);
  const source: HourlySource = { source: 'archive', fetchedAt: '2026-10-14T08:00:00Z', stale: false, contract: HOURLY_INTERVAL_CONTRACT,
    data: { timezone: 'GMT', utc_offset_seconds: 0, hourly_units: { time: 'unixtime', precipitation: 'mm', temperature_2m: '°C', et0_fao_evapotranspiration: 'mm' },
      hourly: { time, precipitation: time.map((_, i) => i ? 1 : 999), temperature_2m: time.map((_, i) => i === hours ? 999 : -2 + i), et0_fao_evapotranspiration: time.map((_, i) => i ? .5 : 999) } } };
  const result = aggregateCivilDay(indexHourlySource(source), date, shiftLocalDate(date, 1));
  strictEqual(result.entry.day.precipitationMm, hours, 'exclude interval ending at start, include interval ending at next midnight');
  strictEqual(result.entry.day.evapotranspirationMm, hours / 2);
  strictEqual(result.entry.day.temperatureMeanC, -2 + (hours - 1) / 2, 'sample mean, not temperature sum or endpoint-after-day');
  strictEqual(result.period.compatible, true); strictEqual(result.coverage.precipitation.expected, hours);
  const clocks = time.slice(0, -1).map(t => ljubljanaClock(t * 1000).slice(11, 16));
  if (hours === 23) ok(!clocks.includes('02:00'));
  if (hours === 25) strictEqual(clocks.filter(c => c === '02:00').length, 2);
  for (const mutation of ['gap', 'duplicate', 'overlap', 'units', 'null', 'short', 'timestamp', 'source'] as const) {
    const damaged = clone(source);
    if (mutation === 'gap') damaged.data.hourly!.time![5] += 3600;
    if (mutation === 'duplicate') damaged.data.hourly!.time!.push(time[5]);
    if (mutation === 'overlap') damaged.data.hourly!.time![5] += 1800;
    if (mutation === 'units') damaged.data.hourly_units!.precipitation = 'inch';
    if (mutation === 'null') damaged.data.hourly!.precipitation![5] = null;
    if (mutation === 'short') damaged.data.hourly!.precipitation!.pop();
    if (mutation === 'timestamp') damaged.data.hourly_units!.time = 'iso8601';
    if (mutation === 'source') damaged.fetchedAt = 'invalid';
    strictEqual(aggregateCivilDay(indexHourlySource(damaged), date, date).entry.day.precipitationMm, undefined, mutation);
    ok(!validateIntervalCoverage(indexHourlySource(damaged), date, 'precipitation').complete);
  }
  const zero = clone(source); zero.data.hourly!.precipitation!.fill(0);
  strictEqual(aggregateCivilDay(indexHourlySource(zero), date, date).entry.day.precipitationMm, 0);
  const temperatureMissing = clone(source); temperatureMissing.data.hourly!.temperature_2m![2] = null;
  const partial = aggregateCivilDay(indexHourlySource(temperatureMissing), date, date);
  strictEqual(partial.entry.day.temperatureMeanC, undefined); strictEqual(partial.entry.day.precipitationMm, hours);
}

async function integrated() {
  const previousFetch = globalThis.fetch;
  let http = 0, offline = false; const rows = new Map<string, any>(); let base = '2026-03-28';
  const RealDate = globalThis.Date;
  class FixtureDate extends RealDate {
    constructor(value?: string | number) { super(value === undefined ? base + 'T12:00:00Z' : value); }
    static now() { return RealDate.parse(base + 'T12:00:00Z'); }
  }
  globalThis.Date = FixtureDate as DateConstructor;
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  globalThis.fetch = (async (url: any) => { http++; if (offline) throw new Error('offline'); return { ok: true, json: async () => hourlyWeatherFixture(String(url), base) }; }) as any;
  try {
    for (const day of ['2026-03-28', '2026-10-24', '2024-02-28', '2026-12-31']) {
      base = day; const legacy = sevenDayFixture(base);
      const [first, duplicate] = await Promise.all([withCivilHourlyWeather(db, legacy), withCivilHourlyWeather(db, legacy)]);
      deepStrictEqual(first.daily, duplicate.daily); strictEqual(http, (['2026-03-28','2026-10-24','2024-02-28','2026-12-31'].indexOf(day) + 1) * 2);
      strictEqual(first.daily.length, 67); ok(first.daily.every(d => first.dailyPeriods[d.day.date].compatible));
      for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
        const evaluated = evaluateSevenDayConditions(first, profile);
        ok(evaluated.every(d => d.score !== null), `${base} ${profile} compatible same-snapshot fixture`);
        for (const row of evaluated) {
          const reference = buildWeatherInputsForTargetDate(legacy, row.targetLocalDate, profile);
          const { days: _actualDays, ...actualWindows } = row.inputs.historical!;
          const { days: _referenceDays, ...referenceWindows } = reference.summary.historical!;
          deepStrictEqual(actualWindows, referenceWindows, 'all scorer raw windows, ET0 and coverage match; sampled hourly min/max remain separate context');
          deepStrictEqual(row.canonical.components, calculateMushroomWeatherScore(reference.summary, profile).components);
          strictEqual(row.soilTime, legacy.soilByDate[row.targetLocalDate].time);
        }
        const changed = clone(first); changed.legacyDaily![0].day.precipitationMm = 999;
        // D60 changes even if score saturation hides it; shorter windows unaffected.
        strictEqual(evaluateSevenDayConditions(changed, 'lactariusDeliciosus')[0].score, null);
        const changedEt0 = clone(first); changedEt0.legacyDaily!.find(e => e.day.date === shiftLocalDate(base, -1))!.day.evapotranspirationMm = 999;
        ok(evaluateSevenDayConditions(changedEt0, profile).slice(0, 2).every(r => r.score === null));
        ok(evaluateSevenDayConditions(changedEt0, profile).slice(2).every(r => r.score !== null), 'independent reference never contaminates future windows');
        const future = clone(first); future.daily.filter(e => e.day.date >= shiftLocalDate(base, 3)).forEach(e => e.day.precipitationMm = 999);
        deepStrictEqual(evaluateSevenDayConditions(future, profile)[3].canonical.components, evaluated[3].canonical.components);
      }
      const before = http; await withCivilHourlyWeather(db, legacy); strictEqual(http, before, 'warm disk 0 HTTP');
      const forecastPlan = sevenDayHourlyRequestPlan(legacy.latitude, legacy.longitude, base)[1];
      const data = JSON.parse(rows.get(forecastPlan.key).payload);
      const validPayload = rows.get(forecastPlan.key).payload;
      for (const badCurrent of [Number.MAX_SAFE_INTEGER, Date.now() / 1000 + 3600]) {
        data.current.time = badCurrent; rows.get(forecastPlan.key).payload = JSON.stringify(data);
        const invalidCurrent = await withCivilHourlyWeather(db, legacy);
        strictEqual(evaluateSevenDayConditions(invalidCurrent, 'generic')[0].score, null, 'invalid/future provider current instant is not a current observation');
        ok(evaluateSevenDayConditions(invalidCurrent, 'generic').slice(2).every(r => r.score !== null));
      }
      rows.get(forecastPlan.key).payload = validPayload; data.current = JSON.parse(validPayload).current;
      const shiftedSoil = JSON.parse(validPayload); shiftedSoil.hourly.soil_moisture_0_to_7cm.pop();
      rows.get(forecastPlan.key).payload = JSON.stringify(shiftedSoil);
      const unequalSoil = await withCivilHourlyWeather(db, legacy);
      ok(evaluateSevenDayConditions(unequalSoil, 'generic').every(r => r.score === null), 'unequal layer/time arrays cannot silently shift soil values');
      rows.get(forecastPlan.key).payload = validPayload;
      delete data.hourly.soil_moisture_0_to_7cm; data.hourly.soil_moisture_0_to_1cm = data.hourly.time.map(() => .3);
      rows.get(forecastPlan.key).payload = JSON.stringify(data);
      const incompatible = await withCivilHourlyWeather(db, legacy);
      ok(evaluateSevenDayConditions(incompatible, 'generic').every(r => r.score === null));
      strictEqual(http, before);
    }
    // A failed refresh uses a visibly stale snapshot, never claims freshly issued forecast data.
    rows.forEach(row => row.expiresAt = '2000-01-01T00:00:00Z'); offline = true;
    const stale = await withCivilHourlyWeather(db, sevenDayFixture(base)); ok(stale.stale); ok(stale.expiresAt < Date.now());
    const missingDb: any = { ...db, getFirstAsync: async () => undefined };
    const failure = await withCivilHourlyWeather(missingDb, sevenDayFixture(base));
    ok(failure.blockers.length); ok(evaluateSevenDayConditions(failure, 'generic').every(r => r.score === null && r.status === 'error'));
    console.log('PASS UTC civil intervals: spring 23h/autumn 25h, accumulation endpoints vs sampled temperature, seam/no duplicates/no zero gaps, native soil Unix provenance, all 4x7 profile input/component parity, D60, calendar/year/leap, strict legacy mismatch gates, future cutoff, cold 2 additional hourly requests/concurrent 0/warm 0, stale/offline.');
  } finally { globalThis.fetch = previousFetch; globalThis.Date = RealDate; }
}
void integrated();
