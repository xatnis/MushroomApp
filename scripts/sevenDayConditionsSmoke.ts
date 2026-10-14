import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { calculateMushroomWeatherScore, MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { buildWeatherInputsForTargetDate, evaluateSevenDayConditions, SEVEN_DAY_REQUIREMENTS } from '../src/domain/sevenDayConditions';
import { loadSevenDaySnapshot, forecastSoilAt, weatherUtcOffsetAtDate, compatibleWeatherTimezone, matchesCanonicalVintage } from '../src/services/sevenDayConditions';
import { shiftLocalDate } from '../src/services/weather';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { sevenDayFixture } from './sevenDayFixture';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
for (const base of ['2026-10-13', '2024-02-28', '2024-02-29', '2026-03-28', '2026-10-24', '2026-12-29']) {
  const snapshot = sevenDayFixture(base), profiles = Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[];
  for (const profile of profiles) {
    const rows = evaluateSevenDayConditions(snapshot, profile);
    strictEqual(rows.length, 7); deepStrictEqual(rows.map(r => r.targetLocalDate), Array.from({ length: 7 }, (_, i) => shiftLocalDate(base, i)));
    ok(rows.every(r => r.score != null && r.status === 'ready'));
    strictEqual(rows[0].score, calculateMushroomWeatherScore(snapshot.today, profile).score);
    const legacy = assessHeatmapWeather({ id: 'same-input', latitude: snapshot.latitude, longitude: snapshot.longitude, baseLocalDate: base,
      days: snapshot.daily.map(e => e.day).filter(d => d.date <= shiftLocalDate(base, 1)), currentSoil: snapshot.legacyCurrentSoil,
      tomorrowMorningSoil: snapshot.soilByDate[shiftLocalDate(base, 1)], fetchedAt: snapshot.today.updatedAt, stale: false, errors: {} }, profile, 'tomorrow');
    strictEqual(rows[1].score, legacy.score.score); deepStrictEqual(rows[1].canonical.components, legacy.score.components);
    for (let i = 0; i < 7; i++) {
      const row = rows[i], built = buildWeatherInputsForTargetDate(snapshot, row.targetLocalDate, profile);
      ok(row.provenance.every(p => p.date < row.targetLocalDate)); strictEqual(row.modelledHistoryDays, i);
      for (const days of [7, 14, 26, 30, 60] as const) {
        const expected = snapshot.daily.filter(e => e.day.date >= shiftLocalDate(row.targetLocalDate, -days) && e.day.date < row.targetLocalDate).reduce((s, e) => s + e.day.precipitationMm!, 0);
        strictEqual(built.historical[`rain${days}dMm`], expected);
      }
      for (const days of [14, 20] as const) {
        const values = snapshot.daily.filter(e => e.day.date >= shiftLocalDate(row.targetLocalDate, -days) && e.day.date < row.targetLocalDate).map(e => e.day.temperatureMeanC!);
        strictEqual(built.historical[`avgTemp${days}dC`], values.reduce((a, b) => a + b, 0) / days);
      }
      const poisoned = clone(snapshot); poisoned.daily.filter(e => e.day.date >= row.targetLocalDate).forEach(e => { e.day.precipitationMm = 99999; e.day.temperatureMeanC = -99; e.day.evapotranspirationMm = 99999; });
      deepStrictEqual(evaluateSevenDayConditions(poisoned, profile)[i].canonical.components, row.canonical.components, 'no post-target precipitation/temperature/ET0 leakage');
    }
    ok(rows[0].inputs.historical!.rain26dMm !== rows[6].inputs.historical!.rain26dMm, 'rolling totals really move');
    const missing = clone(snapshot); delete missing.soilByDate[shiftLocalDate(base, 2)];
    const limited = evaluateSevenDayConditions(missing, profile)[2]; strictEqual(limited.score, null); strictEqual(limited.label, null); ok(limited.missing.some(s => s.includes('vlagi tal')));
    const badEt0 = clone(snapshot); badEt0.daily.find(e => e.day.date === base)!.day.evapotranspirationMm = undefined;
    strictEqual(evaluateSevenDayConditions(badEt0, profile)[1].score, null, 'optional canonical renormalization not published as comparable full forecast');
    const gap = clone(snapshot); gap.daily = gap.daily.filter(e => e.day.date !== shiftLocalDate(base, -5));
    strictEqual(evaluateSevenDayConditions(gap, profile)[0].score, null);
    const old = clone(snapshot); old.stale = true; ok(evaluateSevenDayConditions(old, profile).every(r => r.status === 'stale'));
    const duplicate = clone(snapshot); duplicate.daily.push(duplicate.daily.find(e => e.day.date === shiftLocalDate(base, -5))!);
    strictEqual(buildWeatherInputsForTargetDate(duplicate, shiftLocalDate(base, 5), profile).historical.rain7dMm, rows[5].inputs.historical!.rain7dMm, 'unique calendar dates, not count of rows');
  }
  throws(() => buildWeatherInputsForTargetDate(snapshot, shiftLocalDate(base, 7), 'generic'));
}
const shortHistory = sevenDayFixture(); shortHistory.daily = shortHistory.daily.filter(e => e.day.date >= shiftLocalDate(shortHistory.baseLocalDate, -30));
ok(evaluateSevenDayConditions(shortHistory, 'lactariusDeliciosus').every(r => r.score == null && r.missing.some(s => s.includes('60-dnevne'))));
const mismatched = sevenDayFixture(); mismatched.legacyCurrentSoil = { time: '2026-10-13T11:00', soilMoisture0To7Cm: .5, soilMoisture7To28Cm: .5 };
ok(evaluateSevenDayConditions(mismatched, 'generic')[0].missing.some(s => s.includes('Today/Tomorrow')));
const nullable = sevenDayFixture(); nullable.daily.find(e => e.day.date === nullable.baseLocalDate)!.day.temperatureMeanC = undefined;
strictEqual(evaluateSevenDayConditions(nullable, 'generic')[1].score, null, 'never infer mean from min/max');
const sourceFailure = sevenDayFixture(); sourceFailure.today.errors.forecast = 'Napoved trenutno ni dosegljiva'; sourceFailure.blockers.push('Napoved ni dosegljiva');
ok(evaluateSevenDayConditions(sourceFailure, 'generic').every(r => r.status === 'error' && r.score == null), 'failed request differs from insufficient model data');
const zero = sevenDayFixture(); zero.daily.forEach(e => e.day.precipitationMm = 0);
strictEqual(buildWeatherInputsForTargetDate(zero, shiftLocalDate(zero.baseLocalDate, 3), 'generic').historical.rain14dMm, 0, 'valid zero, not missing');
const foreignSoil = sevenDayFixture(); foreignSoil.soilByDate[shiftLocalDate(foreignSoil.baseLocalDate, 3)] = foreignSoil.soilByDate[foreignSoil.baseLocalDate];
strictEqual(evaluateSevenDayConditions(foreignSoil, 'generic')[3].targetSoil, undefined, 'old-date soil not shown as future context');
strictEqual(weatherLocalDate(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
strictEqual(weatherLocalDate(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
strictEqual(weatherUtcOffsetAtDate('2026-03-28'), 3600); strictEqual(weatherUtcOffsetAtDate('2026-03-29'), 7200);
strictEqual(weatherUtcOffsetAtDate('2026-10-24'), 7200); strictEqual(weatherUtcOffsetAtDate('2026-10-25'), 3600);
ok(compatibleWeatherTimezone('Europe/Belgrade', '2026-10-24')); ok(compatibleWeatherTimezone('Europe/Berlin', '2026-03-28'));
ok(compatibleWeatherTimezone('Europe/Vienna', '2026-10-13'), 'actual timezone=auto alias from the public Slovenian test point');
ok(!compatibleWeatherTimezone('UTC', '2026-10-24')); ok(!compatibleWeatherTimezone('not-a-zone', '2026-10-24'));
const soil = { hourly_units: { soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³' }, hourly: { time: ['2026-10-14T09:00'], soil_moisture_0_to_7cm: [.271], soil_moisture_7_to_28cm: [.29] } };
strictEqual(forecastSoilAt(soil, '2026-10-14', '2026-10-14T09:00')!.soilMoisture0To7Cm, .271);
strictEqual(forecastSoilAt({ hourly: { time: soil.hourly.time } }, '2026-10-14', '2026-10-14T09:00')!.soilMoisture0To7Cm, undefined, 'no incompatible-depth substitution');
strictEqual(forecastSoilAt({ ...soil, hourly_units: { soil_moisture_0_to_7cm: '%' } }, '2026-10-14', '2026-10-14T09:00')!.soilMoisture0To7Cm, undefined);

async function transport() {
  // This scenario's canonical Today builder intentionally uses the host calendar. Freeze its audited date,
  // rather than make a 2026-10-13 fixture fail on the developer's current calendar date.
  const RealDate = globalThis.Date;
  class FixtureDate extends RealDate {
    constructor(value?: string | number) { super(value === undefined ? '2026-10-13T12:00:00Z' : value); }
    static now() { return RealDate.parse('2026-10-13T12:00:00Z'); }
  }
  globalThis.Date = FixtureDate as DateConstructor;
  const today = '2026-10-13', rows = new Map<string, any>(), fixture = sevenDayFixture(today);
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let http = 0, fail = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    http++; if (fail) throw new Error('offline'); const forecast = String(url).includes('/v1/forecast');
    const days = fixture.daily.filter(e => forecast ? e.day.date >= shiftLocalDate(today, -7) : e.day.date <= shiftLocalDate(today, -8)).map(e => e.day);
    const time = fixture.daily.flatMap(e => Array.from({ length: 24 }, (_, hour) => e.day.date + 'T' + String(hour).padStart(2, '0') + ':00'));
    const data = { timezone: 'Europe/Ljubljana', utc_offset_seconds: 7200, current: { time: today + 'T10:00', temperature_2m: 15 },
      daily_units: { precipitation_sum: 'mm', temperature_2m_mean: '°C', et0_fao_evapotranspiration: 'mm' }, daily: { time: days.map(d => d.date), precipitation_sum: days.map(d => d.precipitationMm), temperature_2m_mean: days.map(d => d.temperatureMeanC), et0_fao_evapotranspiration: days.map(d => d.evapotranspirationMm) },
      hourly_units: soil.hourly_units, hourly: { time, soil_moisture_0_to_7cm: time.map(t => t < today ? .2 : fixture.soilByDate[t.slice(0, 10)]?.soilMoisture0To7Cm),
        soil_moisture_7_to_28cm: time.map(t => t < today ? .25 : fixture.soilByDate[t.slice(0, 10)]?.soilMoisture7To28Cm) } };
    return { ok: true, status: 200, json: async () => data };
  }) as any;
  try {
    const first = loadSevenDaySnapshot(db, fixture, today), second = loadSevenDaySnapshot(db, fixture, today); strictEqual(first, second);
    const snapshot = await first; strictEqual(http, 2); ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.daily));
    for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) ok(evaluateSevenDayConditions(snapshot, profile).every(r => r.score != null));
    const warm = await loadSevenDaySnapshot(db, fixture, today); strictEqual(warm, snapshot); strictEqual(http, 2);
    // Reconstruct with a new database identity using the same existing canonical disk rows, not another request.
    const diskDb = { ...db }; await loadSevenDaySnapshot(diskDb, fixture, today); strictEqual(http, 2);
    const stored = new Map([...rows].map(([key, row]) => [key, clone(row)]));
    const archive = JSON.parse([...stored].find(([key]) => key.includes('archive'))![1].payload);
    const forecast = JSON.parse([...stored].find(([key]) => key.includes('forecast'))![1].payload);
    ok(matchesCanonicalVintage(snapshot.today, archive, forecast, today));
    const changed = clone(forecast); changed.daily.precipitation_sum[changed.daily.time.length - 1] += 1;
    ok(!matchesCanonicalVintage(snapshot.today, archive, changed, today), 'future source replacement detected even if the newest archive timestamp is unchanged');
    const variant = async (modify: (data: any, key: string) => void, base = today) => {
      const variantRows = new Map([...stored].map(([key, row]) => {
        const data = JSON.parse(row.payload);
        if (base !== today) {
          const shiftTime = (time: string) => shiftLocalDate(time.slice(0, 10), 11) + time.slice(10);
          data.daily.time = data.daily.time.map(shiftTime); data.hourly.time = data.hourly.time.map(shiftTime); data.current.time = shiftTime(data.current.time);
          key = key.replace('2026-08-14:2026-10-05', '2026-08-25:2026-10-16').replace(':2026-10-13', ':2026-10-24');
        }
        modify(data, key); return [key, { ...row, payload: JSON.stringify(data) }] as const;
      }));
      return loadSevenDaySnapshot({ getFirstAsync: async (_: string, key: string) => variantRows.get(key) } as any, fixture, base);
    };
    const alias = await variant(data => data.timezone = 'Europe/Vienna');
    ok(evaluateSevenDayConditions(alias, 'generic').every(r => r.score != null));
    const dst = await variant(() => {}, '2026-10-24');
    strictEqual(dst.baseLocalDate, '2026-10-24');
    strictEqual(dst.soilSampling?.['2026-10-25'].providerTime, '2026-10-25T10:00');
    strictEqual(dst.soilByDate['2026-10-25'].time, '2026-10-25T09:00', 'correct civil morning is now available even across the provider DST offset');
    ok(evaluateSevenDayConditions(dst, 'generic').slice(1).every(r => r.score === null && r.missing.some(s => s.includes('UTC/DST') || s.includes('Today/Tomorrow'))));
    const incompatible = await variant(data => { delete data.hourly.soil_moisture_0_to_7cm; delete data.hourly.soil_moisture_7_to_28cm; data.hourly.soil_moisture_0_to_1cm = data.hourly.time.map(() => .3); });
    ok(evaluateSevenDayConditions(incompatible, 'generic').every(r => r.score == null));
    const missingEt0 = await variant(data => data.daily.et0_fao_evapotranspiration = data.daily.time.map(() => null));
    ok(evaluateSevenDayConditions(missingEt0, 'boletusEdulis').every(r => r.score == null));
    const wrongZone = await variant(data => data.timezone = 'UTC'); ok(wrongZone.blockers.length > 0);
    strictEqual(http, 2, 'all profile/variable/DST disk cases add no HTTP');
    // Source-vintage guard runs after a cached canonical summary, not merely an endpoint timestamp test.
    const vintageRows = new Map([...stored].map(([key, row]) => [key, clone(row)]));
    const forecastKey = [...vintageRows.keys()].find(key => key.includes('forecast'))!;
    let reads = 0;
    const vintageDb = { getFirstAsync: async (_: string, key: string) => {
      if (++reads === 3) vintageRows.get(forecastKey)!.payload = JSON.stringify(changed);
      return vintageRows.get(key);
    } } as any;
    const incoherent = await loadSevenDaySnapshot(vintageDb, fixture, today);
    ok(incoherent.blockers.some(s => s.includes('istemu snapshotu')));
    ok(evaluateSevenDayConditions(incoherent, 'generic').every(r => r.score == null));
    // Expired raw rows and offline fetch yield clearly stale, internally coherent weather data.
    rows.forEach(row => row.expiresAt = '2000-01-01T00:00:00Z'); fail = true;
    const stale = await loadSevenDaySnapshot({ ...db } as any, fixture, today); ok(stale.stale);
    ok(evaluateSevenDayConditions(stale, 'generic').every(r => r.status === 'stale')); strictEqual(http, 4);
    console.log('Seven-day mock HTTP: cold 2 existing endpoint requests, concurrent extra 0, warm memory/disk extra 0, 4 profiles/day selections extra 0; stale offline attempted 2 refreshes.');
  } finally { globalThis.fetch = original; globalThis.Date = RealDate; }
}
for (const path of ['src/domain/mushroomWeather.ts','src/domain/heatmap/assessment.ts','src/services/weather.ts','src/services/weatherGraphs.ts',
  'src/components/WeatherGraphs.tsx','src/screens/MapScreen.tsx','src/domain/hotspotRanking.ts','src/navigation/AppNavigator.tsx'])
  strictEqual(readFileSync(path,'utf8').replace(/\r\n/g,'\n'), execFileSync('git',['show',`d7fc1e7:${path}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'),path);
void transport().then(() => console.log('PASS 4 profiles x 7 dates x calendar/DST/leap/year cases, D7/14/26/30/60 T14/20, Today/Tomorrow full-input parity/gate, native soil/ET0/units, missing/null/partial/stale, no future leakage, immutable vintage/dedupe/cache and production-source guards.'));
