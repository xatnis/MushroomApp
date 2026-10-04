/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dateQuality, taxonomyGroup, usableSpatial, verbatimDateQuality, auditRecords, duplicateAudit,
  scoreDistribution, historicalAssessment, SPECIES } from './biGbifValidation';
import { calculateMushroomWeatherScore } from '../../src/domain/mushroomWeather';
import { shiftLocalDate } from '../../src/services/weather';

strictEqual(dateQuality({ eventDate: '2007' }).precision, 'year');
strictEqual(dateQuality({ eventDate: '2007-10' }).precision, 'month');
strictEqual(dateQuality({ eventDate: '2004-02-29' }).date, '2004-02-29');
strictEqual(dateQuality({ year: 2005, month: 10, day: 4 }).date, '2005-10-04');
for (const record of [{ eventDate: '2003-02-29' }, { eventDate: '2006-13' }, { eventDate: '2008-04' },
  { eventDate: '2008-04-01' }, { eventDate: '2007-10-01/2007-10-03' }, { eventDate: 'invalid', year: 2007 },
  { eventDate: '2007-10-02', day: 3 }, { year: 2007, day: 3 }, {}]) strictEqual(dateQuality(record).precision, 'unknown');
strictEqual(verbatimDateQuality({ 'http://rs.tdwg.org/dwc/terms/year': '2007' }).precision, 'year');
strictEqual(verbatimDateQuality({ 'http://rs.tdwg.org/dwc/terms/eventDate': '2004-02-29' }).precision, 'exact-day');

const exact = { taxonKey: 123, acceptedTaxonKey: 123, taxonRank: 'SPECIES', taxonomicStatus: 'ACCEPTED',
  scientificName: 'Example species', countryCode: 'SI', occurrenceStatus: 'PRESENT',
  eventDate: '2007', decimalLatitude: 46, decimalLongitude: 14, coordinateUncertaintyInMeters: 3000 };
strictEqual(taxonomyGroup(exact, 123), 'primary-exact-species');
strictEqual(taxonomyGroup({ ...exact, taxonKey: 124, taxonomicStatus: 'SYNONYM' }, 123), 'synonym-or-different-concept');
strictEqual(taxonomyGroup({ ...exact, taxonRank: 'VARIETY' }, 123), 'infraspecific-or-other-rank');
strictEqual(taxonomyGroup({ ...exact, infraspecificEpithet: 'autonym' }, 123), 'infraspecific-or-other-rank');
ok(usableSpatial(exact)); // Coarse representative usable for weather, NOT GPS habitat accuracy.
ok(!usableSpatial({ ...exact, decimalLatitude: null }));
ok(!usableSpatial({ ...exact, issues: ['COUNTRY_COORDINATE_MISMATCH'] }));
ok(!usableSpatial({ ...exact, decimalLongitude: 999 }));
const audit = auditRecords([exact, { ...exact, taxonRank: 'VARIETY' }], 123, []);
strictEqual(audit.primaryExactSpecies, 1);
strictEqual(audit.exactDayWithUsableSpatial, 0);
strictEqual(audit.seasonal.available, false);
strictEqual(duplicateAudit([exact, exact]).sameTaxonDateGridExcess, 1);
strictEqual(scoreDistribution([]).mean, null);
strictEqual(scoreDistribution([]).atLeast[80], null);
deepStrictEqual(scoreDistribution([20, 40, 60, 70, 90]).bins['60-69'], { count: 1, fraction: .2 });
strictEqual(scoreDistribution([0, 100]).median, 50);

const date = '2004-10-15';
const times = Array.from({ length: 61 }, (_, i) => shiftLocalDate(date, i - 60));
const response = { daily: { time: times, precipitation_sum: times.map((_, i) => i < 60 ? 2 : 999),
  temperature_2m_mean: times.map(() => 14), et0_fao_evapotranspiration: times.map(() => 1) },
  hourly: { time: [date + 'T09:00'], soil_moisture_0_to_7cm: [.24], soil_moisture_7_to_28cm: [.26] } };
for (const profile of ['generic', ...SPECIES.map(s => s.profile)] as const) {
  const assessment = historicalAssessment(response, date, 46, 14, profile);
  deepStrictEqual(assessment.score, calculateMushroomWeatherScore(assessment.summary, profile));
  strictEqual(assessment.summary.historical?.rain60dMm, 120);
  strictEqual(assessment.summary.historical?.rain26dMm, 52);
  strictEqual(assessment.summary.historical?.rain7dMm, 14); // Target-day rain 999 is NEVER included.
  strictEqual(assessment.dataQuality, 'complete');
  const limited = historicalAssessment({ daily: response.daily }, date, 46, 14, profile);
  strictEqual(limited.dataQuality, 'limited');
  ok(limited.score.score != null);
  ok(!limited.score.components.some(c => c.key === 'soilMoisture'));
  deepStrictEqual(limited.score, calculateMushroomWeatherScore(limited.summary, profile));
  const missing = historicalAssessment({}, date, 46, 14, profile);
  strictEqual(missing.dataQuality, 'insufficient');
  strictEqual(missing.score.score, undefined);
}
const invalidSignal = historicalAssessment({ daily: { ...response.daily, precipitation_sum: times.map(() => null) } }, date, 46, 14, 'boletusEdulis');
strictEqual(invalidSignal.dataQuality, 'insufficient');
strictEqual(invalidSignal.summary.historical?.rain26dMm, undefined);
// Freeze the pre-study production sources. Research fixtures aren't occurrence results.
for (const file of ['src/domain/mushroomWeather.ts', 'src/services/weather.ts', 'src/domain/heatmap/assessment.ts', 'src/domain/heatmap/pilot.ts', 'src/domain/heatmap/zgs.ts']) {
  strictEqual(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
    execFileSync('git', ['show', `1d7b102:${file}`], { maxBuffer: 5 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n'), file);
}
console.log('PASS research date/taxonomy/spatial gates, duplicates, production scorer identity, D-60:D-exclusive windows, soil missing/null, empty-distribution NA, unchanged formulas/habitat. Fixtures are NOT dataset validation results.');
