/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { calculateMushroomWeatherScore, MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG } from '../../src/domain/mushroomWeather';
import type { MushroomWeatherSummary } from '../../src/domain/types';
import { genericRain14Signal, researchCandidate, VARIANTS, numericStats, distribution, oldRainSubgroup, type StudyRow } from './boletusRecentRainStudy';
import { strictAssessment } from './occurrenceValidationV2';
import { shiftLocalDate } from '../../src/services/weather';

const summary: MushroomWeatherSummary = { latitude: 0, longitude: 0, source: 'open-meteo', updatedAt: 'fixture', stale: false, errors: {},
  historical: { days: [], coverage: { rain3dDays:0, rain7dDays:0, rain14dDays:0, rain26dDays:0, rain30dDays:0, rain60dDays:0,
    temp7dDays:0, temp14dDays:0, temp20dDays:0, evapotranspiration7dDays:0 },
    rain7dMm: 1, rain14dMm: 12, rain26dMm: 100, rain30dMm: 110, avgTemp20dC: 13, evapotranspiration7dMm: 21 },
  current: { soilMoisture0To7Cm: .28, soilMoisture7To28Cm: .28 } };
const before = JSON.stringify(summary), v1 = calculateMushroomWeatherScore(summary, 'boletusEdulis');
deepStrictEqual(BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights, { rain26:50, temperature:30, soilMoisture:15, drying:5 });
strictEqual(MUSHROOM_SCORE_V1_CONFIG.rain.targetsMm.days14, 60);
strictEqual(v1.score, 95);
const main = researchCandidate(summary);
deepStrictEqual(Object.fromEntries(main.components.map(c => [c.key,c.weight])), { rain26:35,temperature:30,soilMoisture:15,drying:5,rain14:15 });
strictEqual(main.availableWeight, 100); strictEqual(main.score, 83); // 35 + 3 + 30 + 15 + 0.
for (const mm of [0,2.9,12,30,60,120]) {
  const s = { ...summary, historical: { ...summary.historical!, rain14dMm:mm } };
  const expected = calculateMushroomWeatherScore({ ...s, historical: { ...s.historical, rain7dMm:0,rain30dMm:0 } }, 'generic')
    .components.find(c => c.key === 'rain')!.value / MUSHROOM_SCORE_V1_CONFIG.rain.horizonWeights.days14;
  strictEqual(genericRain14Signal(s), expected, 'uses real Generic scorer, not copied normalization');
  for (const variant of VARIANTS) {
    const result = researchCandidate(s, variant);
    const expectedPoints = v1.components.reduce((n,c) => n + c.value * (c.key === 'rain26' ? variant.rain26 : c.weight), 0) + expected * variant.rain14;
    strictEqual(result.score, Math.round(expectedPoints));
    for (const c of result.components.filter(c => c.key !== 'rain14')) strictEqual(c.value, v1.components.find(old => old.key === c.key)!.value);
  }
}
strictEqual(JSON.stringify(summary), before, 'no mutation');
deepStrictEqual(calculateMushroomWeatherScore(summary, 'boletusEdulis'), v1, 'research invocation cannot affect production');
const no14 = { ...summary, historical: { ...summary.historical!, rain14dMm:undefined } };
strictEqual(genericRain14Signal(no14), undefined);
strictEqual(researchCandidate(no14).availableWeight, 85);
strictEqual(researchCandidate(no14).score, Math.round(80 / 85 * 100));
const noSoil = { ...summary, current:undefined };
strictEqual(researchCandidate(noSoil).availableWeight, 85);
strictEqual(researchCandidate(noSoil).score, Math.round(68 / 85 * 100));
const empty = { ...summary, current:undefined, historical:undefined };
strictEqual(researchCandidate(empty).score, undefined, 'no fake 0 score');
strictEqual(numericStats([]).mean, null);
deepStrictEqual([distribution([59,60,79,80,89,90]).atLeast[80].count, distribution([59,60,79,80,89,90]).bins['90-100'].count], [3,1]);
ok(oldRainSubgroup({ rain26Signal:.8, rain14Signal:.4 } as StudyRow));
ok(!oldRainSubgroup({ rain26Signal:.799, rain14Signal:.4 } as StudyRow));
const date = '2024-10-01', r = { eventDate:date, decimalLatitude:46.47, decimalLongitude:14.85 };
const time = Array.from({ length:63 }, (_,i) => shiftLocalDate(date,i-60));
const response = { daily:{ time, precipitation_sum:time.map((_,i) => i < 60 ? 2 : 999),
  temperature_2m_mean:time.map(() => 13), et0_fao_evapotranspiration:time.map(() => 1) }, hourly:{
  time:[date+'T00:00',date+'T09:00',shiftLocalDate(date,1)+'T00:00'], soil_moisture_0_to_7cm:[.24,.99,.99], soil_moisture_7_to_28cm:[.26,.99,.99] } };
const strict = strictAssessment(response,r,'boletusEdulis');
strictEqual(strict.summary.historical?.rain14dMm,28);
strictEqual(strict.summary.historical?.rain26dMm,52);
strictEqual(strict.summary.forecast,undefined); strictEqual(strict.summary.current?.soilMoisture0To7Cm,.24);
const changedFuture = { ...response,daily:{ ...response.daily, precipitation_sum:time.map((_,i) => i < 60 ? 2 : 10000) } };
strictEqual(researchCandidate(strict.summary).score,researchCandidate(strictAssessment(changedFuture,r,'boletusEdulis').summary).score,'future realised rainfall excluded');
for (const file of ['src/domain/mushroomWeather.ts','src/services/weather.ts','src/domain/heatmap/assessment.ts','src/domain/heatmap/pilot.ts','src/domain/heatmap/zgs.ts']) {
  strictEqual(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show',`d050a0f:${file}`],{maxBuffer:5*1024*1024}).toString().replace(/\r\n/g,'\n'),file);
}
strictEqual(readFileSync('src/screens/MapScreen.tsx','utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show','55a2841:src/screens/MapScreen.tsx'],{maxBuffer:5*1024*1024}).toString().replace(/\r\n/g,'\n'),'UI unchanged');
console.log('PASS research-only weights, Generic D14 reuse, all sensitivities, missing renormalization/no fake zeros, input immutability, future leakage prevention, byte-identical production scorer/weather/habitat/UI. Synthetic fixtures are NOT reconstructed phone observations.');
