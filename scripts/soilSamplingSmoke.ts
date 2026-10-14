import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sampleNativeSoil, providerInstant, resolveLjubljanaClock, ljubljanaClock, civilDailyPeriod, providerDailyPeriod } from '../src/domain/soilSampling';
import { evaluateSevenDayConditions, buildWeatherInputsForTargetDate } from '../src/domain/sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { sevenDayFixture } from './sevenDayFixture';

const clone = <T,>(data: T): T => JSON.parse(JSON.stringify(data));
const providerClock = (instant: number, offset: number) => new Date(instant + offset * 1000).toISOString().slice(0, 16);
function response(date: string, offset: number) {
  const start = resolveLjubljanaClock(date + 'T00:00')[0], end = resolveLjubljanaClock(shiftLocalDate(date, 1) + 'T00:00')[0];
  const instants = Array.from({ length: (end - start) / 3600000 }, (_, i) => start + i * 3600000);
  return { utc_offset_seconds: offset, hourly_units: { soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³' },
    hourly: { time: instants.map(i => providerClock(i, offset)), soil_moisture_0_to_7cm: instants.map((_, i) => .18 + i / 1000), soil_moisture_7_to_28cm: instants.map((_, i) => .24 + i / 1000) } };
}
for (const [date, offset, count, rawHour, utc] of [
  ['2026-03-29', 3600, 23, '08', '2026-03-29T07:00:00.000Z'],
  ['2026-10-25', 7200, 25, '10', '2026-10-25T08:00:00.000Z'],
] as const) {
  const data = response(date, offset); strictEqual(data.hourly.time.length, count);
  const period = civilDailyPeriod(date); strictEqual((Date.parse(period.endUtc!) - Date.parse(period.startUtc!)) / 3600000, count);
  strictEqual(providerDailyPeriod(date, offset).compatible, false, 'a fixed 24-hour API bin is not a 23/25-hour civil day');
  const morning = sampleNativeSoil(data, date, { kind: 'morning' }, '2026-10-14T08:00:00Z');
  strictEqual(morning.missing.length, 0); strictEqual(morning.point!.time, date + 'T09:00');
  strictEqual(morning.metadata!.providerTime, date + `T${rawHour}:00`); strictEqual(morning.metadata!.instantUtc, utc);
  strictEqual(morning.metadata!.retrievedAt, '2026-10-14T08:00:00Z'); strictEqual(morning.metadata!.mode, 'forecast');
  const index = data.hourly.time.indexOf(morning.metadata!.providerTime);
  strictEqual(morning.point!.soilMoisture0To7Cm, data.hourly.soil_moisture_0_to_7cm[index]);
  strictEqual(morning.point!.soilMoisture7To28Cm, data.hourly.soil_moisture_7_to_28cm[index], 'depths from same indexed instant, not depth interpolation');
  const missing = clone(data); missing.hourly.soil_moisture_0_to_7cm.splice(index, 1); missing.hourly.soil_moisture_7_to_28cm.splice(index, 1); missing.hourly.time.splice(index, 1);
  strictEqual(sampleNativeSoil(missing, date, { kind: 'morning' }).point, undefined, 'never fall back to a different morning hour');
  const base = shiftLocalDate(date, -1), week = sevenDayFixture(base);
  week.soilByDate[date] = morning.point!;
  week.legacyTomorrowSoil = { ...morning.point!, time: offset === 3600 ? date + 'T10:00' : date + 'T08:00' };
  week.dailyPeriods[date] = providerDailyPeriod(date, offset);
  for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
    const results = evaluateSevenDayConditions(week, profile);
    strictEqual(results[1].score, null, 'different legacy Tomorrow sampling instant remains gated, even with identical/clamped values');
    ok(results[1].missing.some(s => s.includes('drug instant')));
    ok(results.slice(2).every(r => r.score == null && r.missing.some(s => s.includes('Dnevna UTC/DST'))));
    ok(results[2].provenance.every(p => p.date < results[2].targetLocalDate));
  }
}
deepStrictEqual(resolveLjubljanaClock('2026-03-29T02:30'), [], 'spring nonexistent civil clock has no guessed instant');
deepStrictEqual(resolveLjubljanaClock('2026-10-25T02:30').map(t => new Date(t).toISOString()), ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
strictEqual(new Date(providerInstant('2026-10-25T02:30', 3600)!).toISOString(), '2026-10-25T01:30:00.000Z', 'fixed offset disambiguates repeated clock explicitly');
strictEqual(new Date(providerInstant('2026-10-25T02:30', 7200)!).toISOString(), '2026-10-25T00:30:00.000Z');
for (const invalid of ['2026-02-30T09:00', '2026-10-14T25:00', '2026-10-14T09:61', 'not-time']) strictEqual(providerInstant(invalid, 7200), undefined);
strictEqual(providerInstant('2026-10-14T09:00', undefined), undefined, 'unknown offset is unavailable, not interpreted as host local time');

const date = '2026-10-14', data = response(date, 7200);
for (const minute of ['00','15','30','45','59']) {
  const current = sampleNativeSoil(data, date, { kind: 'current', providerReference: date + `T10:${minute}` });
  strictEqual(current.point!.time, date + 'T10:00'); strictEqual(current.metadata!.mode, 'currentModelled');
  ok(Date.parse(current.metadata!.instantUtc) <= providerInstant(date + `T10:${minute}`, 7200)!);
}
const wrongUnits = clone(data); wrongUnits.hourly_units.soil_moisture_0_to_7cm = '%';
strictEqual(sampleNativeSoil(wrongUnits, date, { kind: 'morning' }).point!.soilMoisture0To7Cm, undefined);
const wrongDepth: any = clone(data); wrongDepth.hourly.soil_moisture_0_to_1cm = wrongDepth.hourly.soil_moisture_0_to_7cm; delete wrongDepth.hourly.soil_moisture_0_to_7cm;
strictEqual(sampleNativeSoil(wrongDepth, date, { kind: 'morning' }).point!.soilMoisture0To7Cm, undefined);
const partial: any = clone(data); partial.hourly.soil_moisture_7_to_28cm[9] = null;
strictEqual(sampleNativeSoil(partial, date, { kind: 'morning' }).point!.soilMoisture7To28Cm, undefined);
const duplicate = clone(data); duplicate.hourly.time.push(date + 'T09:00');
strictEqual(sampleNativeSoil(duplicate, date, { kind: 'morning' }).point, undefined);
const sourceDateMissing = sampleNativeSoil(data, shiftLocalDate(date, 1), { kind: 'morning' }); strictEqual(sourceDateMissing.point, undefined, 'no Today carry-forward');
const autumn = response('2026-10-25', 3600);
const repeatedCurrent = sampleNativeSoil(autumn, '2026-10-25', { kind: 'current', providerReference: '2026-10-25T02:45' });
strictEqual(repeatedCurrent.metadata!.instantUtc, '2026-10-25T01:00:00.000Z', 'current sample follows explicit offset in repeated hour');
const hostZone = process.env.TZ;
try { for (const zone of ['UTC','Europe/Ljubljana','America/New_York']) {
  process.env.TZ = zone;
  strictEqual(sampleNativeSoil(data, date, { kind: 'morning' }).metadata!.instantUtc, '2026-10-14T07:00:00.000Z');
  strictEqual(ljubljanaClock(providerInstant('2026-03-29T08:00', 3600)!), '2026-03-29T09:00:00');
} } finally { if (hostZone == null) delete process.env.TZ; else process.env.TZ = hostZone; }

const parity: any[] = [];
for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
  const snapshot = sevenDayFixture(date), week = evaluateSevenDayConditions(snapshot, profile);
  strictEqual(week[0].score, calculateMushroomWeatherScore(snapshot.today, profile).score);
  const source = { id: 'same-vintage', latitude: snapshot.latitude, longitude: snapshot.longitude, baseLocalDate: date,
    days: snapshot.daily.map(e => e.day).filter(d => d.date <= shiftLocalDate(date, 1)), currentSoil: snapshot.legacyCurrentSoil,
    tomorrowMorningSoil: snapshot.legacyTomorrowSoil, errors: {}, stale: false, fetchedAt: snapshot.today.updatedAt };
  for (const index of [0,1]) {
    const assessment = assessHeatmapWeather(source, profile, index ? 'tomorrow' : 'today'), row = week[index];
    strictEqual(row.score, assessment.score.score); deepStrictEqual(row.canonical.components, assessment.score.components);
    deepStrictEqual(row.inputs.historical, assessment.summary.historical);
    strictEqual(row.inputs.current!.soilMoisture0To7Cm, assessment.summary.current!.soilMoisture0To7Cm);
    strictEqual(row.inputs.historical!.evapotranspiration7dMm, assessment.summary.historical!.evapotranspiration7dMm);
    const explanationReference = index ? assessment.score : calculateMushroomWeatherScore(snapshot.today, profile);
    deepStrictEqual(row.canonical.coverage, explanationReference.coverage);
    deepStrictEqual(row.canonical.reasons, explanationReference.reasons, 'Today retains the canonical point future-trend context; regional capped forecast is deliberately different');
  }
  const nearest = clone(snapshot); nearest.legacyCurrentSoil = { time: date + 'T11:00', soilMoisture0To7Cm: .22, soilMoisture7To28Cm: .27 };
  const nearestTotal = calculateMushroomWeatherScore({ ...snapshot.today, current: nearest.legacyCurrentSoil }, profile).score;
  strictEqual(evaluateSevenDayConditions(nearest, profile)[0].score, null);
  const saturated = clone(snapshot); saturated.today.current!.soilMoisture0To7Cm = .5; saturated.today.current!.soilMoisture7To28Cm = .5;
  saturated.soilByDate[date] = { time: date + 'T10:00', soilMoisture0To7Cm: .5, soilMoisture7To28Cm: .5 };
  saturated.legacyCurrentSoil = { time: date + 'T11:00', soilMoisture0To7Cm: .51, soilMoisture7To28Cm: .51 };
  strictEqual(evaluateSevenDayConditions(saturated, profile)[0].score, null, 'same rounded total/fully saturated components do not hide input mismatch');
  const unorderedPoint = clone(snapshot);
  unorderedPoint.today.current!.soilMoisture0To7Cm = .51; unorderedPoint.today.current!.soilMoisture7To28Cm = .51;
  unorderedPoint.canonicalCurrentSoil = { time: date + 'T09:00', soilMoisture0To7Cm: .51, soilMoisture7To28Cm: .51 };
  unorderedPoint.soilByDate[date] = { time: date + 'T10:00', soilMoisture0To7Cm: .5, soilMoisture7To28Cm: .5 };
  unorderedPoint.legacyCurrentSoil = { ...unorderedPoint.soilByDate[date] };
  const pointMismatch = evaluateSevenDayConditions(unorderedPoint, profile)[0];
  strictEqual(pointMismatch.score, null); ok(pointMismatch.missing.some(s => s.includes('point referenca')), 'canonical point extraction also independently checked despite saturation/array reordering');
  for (let index = 2; index < 7; index++) strictEqual(week[index].inputs.current!.time, shiftLocalDate(date, index) + 'T09:00');
  const unknown = clone(snapshot); delete unknown.dailyPeriods[shiftLocalDate(date, -1)]; ok(evaluateSevenDayConditions(unknown, profile).every(r => r.score === null));
  const calendar = sevenDayFixture('2026-12-31'); strictEqual(buildWeatherInputsForTargetDate(calendar, '2027-01-01', profile).history.at(-1)!.day.date, '2026-12-31');
  parity.push({ profile, canonicalFloor: week[0].score, legacyNearestDiagnostic: nearestTotal, productionBehaviorChanged: false });
}
console.log('Audited 10:45 sampling-policy difference (synthetic, NOT new production scores)', parity);
for (const file of ['src/services/weather.ts','src/domain/mushroomWeather.ts','src/domain/locationConditions.ts','src/domain/heatmap/assessment.ts','src/services/heatmap/pilotHeatmap.ts','src/screens/MapScreen.tsx','src/components/SevenDayConditionsView.tsx'])
  strictEqual(readFileSync(file,'utf8').replace('export async function cachedFetch<T>', 'async function cachedFetch<T>').replace(/\r\n/g,'\n'), execFileSync('git',['show',`4222eb0:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'), file);
console.log('PASS native two-layer soil/current floor/exact future local09, provenance, 23/25h, nonexistent/repeated clocks, response-fixed offset and host independence, all-profile Today/Tomorrow full-input/windows/components/metadata parity, stronger mismatch gates, incompatible daily bins/unknown metadata, no production/heatmap/UI/source changes.');
