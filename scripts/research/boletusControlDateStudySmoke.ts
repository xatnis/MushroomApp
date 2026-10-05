/// <reference types="node" />
import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { calculateMushroomWeatherScore, BOLETUS_EDULIS_SCORE_V1_CONFIG, MUSHROOM_SCORE_V1_CONFIG } from '../../src/domain/mushroomWeather';
import { shiftLocalDate } from '../../src/services/weather';
import { strictAssessment } from './occurrenceValidationV2';
import { genericRain14Signal, researchCandidate, VARIANTS } from './boletusRecentRainStudy';
import { selectControls, controlTarget, sliceTarget, evaluate, analyze, quadrant, syntheticRain, syntheticGrid, MODELS, STUDY_CUTOFF, type MatchedSet } from './boletusControlDateStudy';

const offsets = (date: string, dates: string[]) => dates.map(d => (Date.parse(d) - Date.parse(date)) / 86400000);
const chosen = selectControls('2024-09-01');
deepStrictEqual(offsets('2024-09-01', chosen), [-48, -35, 34, 47]);
deepStrictEqual(selectControls('2024-09-01'), chosen, 'deterministic weather-blind matching');
for (const date of ['2024-01-02', '2024-04-21', '2024-09-01', '2024-11-25', '2024-12-31', '2026-09-13']) {
  for (const exclusion of [21, 28]) {
    const dates = selectControls(date, exclusion);
    ok(dates.length <= 4 && new Set(dates).size === dates.length);
    ok(dates.filter(d => d < date).length <= 2 && dates.filter(d => d > date).length <= 2);
    for (const d of dates) {
      const offset = offsets(date, [d])[0];
      ok(Math.abs(offset) > exclusion && Math.abs(offset) <= 60 && d !== date);
      strictEqual(d.slice(0, 4), date.slice(0, 4));
      ok(d.slice(5) >= '04-01' && d.slice(5) <= '11-30' && d <= STUDY_CUTOFF);
    }
  }
}
throws(() => selectControls('2024-02-30')); throws(() => selectControls('2024-09-01', 60));
const target = controlTarget({ decimalLatitude: 46.47, decimalLongitude: 14.85, eventDate: '2024-09-01', verbatimEventDate: '2024-09-01' }, chosen[0]);
deepStrictEqual(target, { decimalLatitude: 46.47, decimalLongitude: 14.85, eventDate: chosen[0] }, 'same location; no stale observation date metadata');

const date = '2024-09-01', time = Array.from({ length: 184 }, (_, i) => shiftLocalDate(date, i - 120));
const raw = { daily: { time, precipitation_sum: time.map(d => d < date ? 2 : 999),
  temperature_2m_mean: time.map(() => 13), et0_fao_evapotranspiration: time.map(() => 1) },
  hourly: { time: [date+'T00:00',date+'T09:00',shiftLocalDate(date,1)+'T00:00'],
    soil_moisture_0_to_7cm: [.28,.99,.99], soil_moisture_7_to_28cm: [.28,.99,.99] } };
const assessment = strictAssessment(sliceTarget(raw, date), { ...target, eventDate: date }, 'boletusEdulis');
strictEqual(assessment.summary.historical?.days.length, 60);
strictEqual(assessment.summary.historical?.rain14dMm, 28); strictEqual(assessment.summary.historical?.rain26dMm, 52);
strictEqual(assessment.summary.current?.soilMoisture0To7Cm, .28); strictEqual(assessment.summary.forecast, undefined);
ok(assessment.summary.historical!.days.every(d => d.date < date));
deepStrictEqual(assessment.score, strictAssessment(raw, { ...target, eventDate: date }, 'boletusEdulis').score, 'combined interval changes transport only');
const futureChanged = { ...raw, daily: { ...raw.daily, precipitation_sum: time.map(d => d < date ? 2 : 10000) } };
deepStrictEqual(assessment.score, strictAssessment(sliceTarget(futureChanged, date), { ...target, eventDate: date }, 'boletusEdulis').score, 'no future-rain leakage');
const gaps = { ...raw, daily: { ...raw.daily, precipitation_sum: time.map(d => d === shiftLocalDate(date,-5) ? null : 2) } };
const gapAssessment = strictAssessment(sliceTarget(gaps, date), { ...target, eventDate: date }, 'boletusEdulis');
strictEqual(gapAssessment.dataQuality, 'insufficient');
throws(() => evaluate(gapAssessment.summary, date, 'A', gapAssessment.dataQuality), /Insufficient weather/, 'do not score a required rain gap or convert it to zero');
const summary = { ...assessment.summary, historical: { ...assessment.summary.historical!, rain26dMm: 100, rain14dMm: 12, rain7dMm: 1, evapotranspiration7dMm: 21 } };
strictEqual(calculateMushroomWeatherScore(summary, 'boletusEdulis').score, 95);
strictEqual(researchCandidate(summary).score, 83);
deepStrictEqual(BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights, { rain26:50, temperature:30, soilMoisture:15, drying:5 });
strictEqual(MUSHROOM_SCORE_V1_CONFIG.rain.targetsMm.days14, 60);
for (const v of VARIANTS) {
  const original = calculateMushroomWeatherScore(summary, 'boletusEdulis');
  strictEqual(researchCandidate(summary, v).score, Math.round(original.components.reduce((s,c) => s+c.value*(c.key==='rain26'?v.rain26:c.weight),0)+genericRain14Signal(summary)!*v.rain14));
}
const missing = evaluate({ ...summary, current: undefined }, date, 'A', 'limited');
strictEqual(missing.availableWeights.V1, 85); strictEqual(missing.availableWeights['35/15'], 85);
const rain = syntheticRain(2.9, 100);
strictEqual(rain.rainPoints.V1, 50); ok(Math.abs(rain.rainPoints['35/15'] - 35.725) < 1e-10);
ok(syntheticGrid().every(r => r.rain14 <= r.rain26)); strictEqual(syntheticGrid().length, 43);
throws(() => syntheticRain(80, 60));

const ev = (score: number) => ({ ...evaluate(summary, date, 'A', 'complete'), scores: Object.fromEntries(MODELS.map(m=>[m,score])) as typeof missing.scores });
const sets: MatchedSet[] = [ { case:1,occurrence:ev(90),controls:[ev(80),ev(70)] },
  { case:2,occurrence:ev(70),controls:[ev(80),ev(70)] }, { case:3,occurrence:ev(90),controls:[ev(90),ev(80)] },
  { case:4,occurrence:ev(60),controls:[ev(90),ev(80)] }, { case:5,occurrence:ev(50),controls:[] } ];
const result = analyze(sets), model = result.models.V1;
strictEqual(result.occurrenceN,5); strictEqual(result.matchedOccurrenceN,4); strictEqual(result.controlN,8);
strictEqual(model.pairwise.winPct,37.5); strictEqual(model.pairwise.tiePct,25); strictEqual(model.pairwise.lossPct,37.5);
deepStrictEqual(model.ranks, { 'rank 1 unique':1,'tied rank 1':1,'rank 2':1,'rank 3+':1 });
deepStrictEqual(model.differences.map(d=>d.minusMean),[15,-5,5,-25]);
strictEqual(model.pairedMinusMean.mean,-2.5); strictEqual(model.absolutePairDifference.median,10);
strictEqual(quadrant({ ...ev(90),rain26Signal:.8,rain14Signal:.4 }), 'Q2 high/low');
strictEqual(quadrant({ ...ev(90),rain26Signal:.8,rain14Signal:.8 }), 'Q1 high/high');
strictEqual(quadrant({ ...ev(90),rain26Signal:.7,rain14Signal:.5 }), 'mixed/mid');
// Freeze every runtime source file, not just score formulas.
for (const file of execFileSync('git',['ls-files','src']).toString().trim().split(/\r?\n/)) {
  strictEqual(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show',`a68d4f80cab3b5bbb961ee20949a0ee66c706fa2:${file}`],{maxBuffer:30*1024*1024}).toString().replace(/\r\n/g,'\n'),file);
}
console.log('PASS deterministic same-location/year/calendar matching, ±60/21/28, cutoff/max4/no own-date, combined transport identical/no future leakage, all candidate weights, Generic D14=60 reuse, missing renormalization, synthetic physical constraints, paired/rank statistics, ALL runtime src unchanged.');
