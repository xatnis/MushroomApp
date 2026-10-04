/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok, rejects } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, HISTORICAL_MODEL, exactDay, verbatimDay, qualityTier, primaryTaxonomy, publicSpatial, deduplicate,
  eligibleRecord, auditSpecies, seasons, weatherRequest, strictAssessment } from './occurrenceValidationV2';
import { ResearchCache } from './researchCache';
import { SPECIES } from './biGbifValidation';
import { calculateMushroomWeatherScore } from '../../src/domain/mushroomWeather';
import { shiftLocalDate } from '../../src/services/weather';

async function main() {
  strictEqual(exactDay({ eventDate: '2024-02-29' }), '2024-02-29');
  strictEqual(exactDay({ eventDate: '2024-10-01T22:10:00-04:00', year: 2024, month: 10, day: 1 }), '2024-10-01');
  strictEqual(exactDay({ eventDate: '1949-12-31' }), '1949-12-31'); // Date audit distinct from coverage eligibility.
  strictEqual(verbatimDay('Sun Oct 24 2021 12:39:15 GMT+0200 (GMT+2)'), '2021-10-24');
  strictEqual(verbatimDay('2024/06/14 10:47 AM'), '2024-06-14');
  strictEqual(verbatimDay('06/14/2024'), undefined);
  strictEqual(exactDay({ eventDate: '2024-10-01', verbatimEventDate: '2024-10-02 13:00' }), undefined);
  for (const record of [{}, { eventDate: '2023-02-29' }, { eventDate: '2024-13-01' }, { eventDate: '2024-10' },
    { eventDate: '2024' }, { eventDate: '2024-10-01/2024-10-02' }, { eventDate: '2024-10-01', day: 2 },
    { eventDate: '2024-10-01T99:01' }, { year: 2024, month: 10, day: 1 }]) strictEqual(exactDay(record), undefined);
  deepStrictEqual([0, 3000, 3001, 10000, 10001, null, undefined, -1, NaN, '100'].map(qualityTier),
    ['A', 'A', 'B', 'B', 'C', 'UNKNOWN', 'UNKNOWN', 'INVALID', 'INVALID', 'INVALID']);
  const r = { key: 1, gbifID: '1', occurrenceID: 'https://example.invalid/observation/1', datasetKey: DATASET,
    taxonKey: 100, acceptedTaxonKey: 100, speciesKey: 100, taxonRank: 'SPECIES', taxonomicStatus: 'ACCEPTED',
    countryCode: 'SI', occurrenceStatus: 'PRESENT', eventDate: '2024-10-01',
    decimalLatitude: 46.47045, decimalLongitude: 14.85009, coordinateUncertaintyInMeters: 100,
    issues: ['COORDINATE_ROUNDED', 'TAXON_ID_NOT_FOUND'] };
  const allowed = new Set(['1']);
  ok(primaryTaxonomy(r, 100));
  ok(!primaryTaxonomy({ ...r, taxonKey: 101, taxonomicStatus: 'SYNONYM' }, 100));
  ok(!primaryTaxonomy({ ...r, taxonRank: 'SUBSPECIES', infraspecificEpithet: 'example' }, 100));
  ok(!primaryTaxonomy({ ...r, speciesKey: 101 }, 100));
  ok(publicSpatial(r, allowed)); // Non-fatal warnings aren't hasGeospatialIssue=true.
  ok(!publicSpatial(r, new Set())); // Server's geospatial-excluded record.
  ok(!publicSpatial({ ...r, occurrenceStatus: 'ABSENT' }, allowed));
  ok(!publicSpatial({ ...r, decimalLatitude: null }, allowed));
  ok(!publicSpatial({ ...r, datasetKey: 'other' }, allowed));
  ok(eligibleRecord(r, 100, allowed, '2026-10-04'));
  for (const change of [{ coordinateUncertaintyInMeters: null }, { coordinateUncertaintyInMeters: 10001 },
    { eventDate: '1949-12-31' }, { eventDate: '1950-01-20' }, { eventDate: '2027-01-01' }, { occurrenceStatus: 'ABSENT' }]) {
    ok(!eligibleRecord({ ...r, ...change }, 100, allowed, '2026-10-04'));
  }
  const other = { ...r, key: 2, gbifID: '2', occurrenceID: 'other-ID' };
  strictEqual(deduplicate([r, r, other]).duplicates, 1);
  strictEqual(deduplicate([r, other]).rows.length, 2); // Same date/coordinates != duplicate ID.
  const bridge = { ...r, key: 2, gbifID: '2' };
  strictEqual(deduplicate([r, other, bridge, { ...other, key: 3, gbifID: '3' }]).rows.length, 1);
  const audit = auditSpecies([r, other], [r, other], 100, '2026-10-04');
  strictEqual(audit.primaryEligible, 2);
  strictEqual(audit.sameDayLocationExcessAuditOnly, 1);
  strictEqual(seasons([r])[9].percent, 100);
  const url = new URL(weatherRequest(r));
  strictEqual(url.searchParams.get('models'), HISTORICAL_MODEL);
  strictEqual(url.searchParams.get('start_date'), '2024-08-02');
  strictEqual(url.searchParams.get('end_date'), '2024-10-01');
  strictEqual(weatherRequest(r), weatherRequest({ ...r, decimalLatitude: 46.47049, decimalLongitude: 14.85011 }));
  ok(weatherRequest(r) !== weatherRequest({ ...r, eventDate: '2024-10-02' }));
  ok(weatherRequest(r) !== weatherRequest(r, 'era5_land')); // Model-specific cache.
  const date = r.eventDate, time = Array.from({ length: 63 }, (_, i) => shiftLocalDate(date, i - 60));
  const response = { daily: { time, precipitation_sum: time.map((_, i) => i < 60 ? 2 : 999),
    temperature_2m_mean: time.map(() => 14), et0_fao_evapotranspiration: time.map(() => 1) },
    hourly: { time: [date + 'T00:00', date + 'T09:00', shiftLocalDate(date, 1) + 'T00:00'],
      soil_moisture_0_to_7cm: [.24, .99, .99], soil_moisture_7_to_28cm: [.26, .99, .99] } };
  for (const species of SPECIES) {
    const a = strictAssessment(response, r, species.profile);
    strictEqual(a.summary.historical?.rain60dMm, 120);
    strictEqual(a.summary.historical?.rain26dMm, 52);
    strictEqual(a.summary.current?.soilMoisture0To7Cm, .24);
    strictEqual(a.summary.current?.temperatureC, undefined); // Realised daily D mean is discarded as well, not just unused.
    strictEqual(a.summary.forecast, undefined);
    strictEqual(a.dataQuality, 'complete');
    deepStrictEqual(a.score, calculateMushroomWeatherScore(a.summary, species.profile));
    const limited = strictAssessment({ daily: response.daily }, r, species.profile);
    strictEqual(limited.dataQuality, 'limited');
    ok(limited.score.score != null);
    deepStrictEqual(limited.score, calculateMushroomWeatherScore(limited.summary, species.profile));
    const empty = strictAssessment({}, r, species.profile);
    strictEqual(empty.dataQuality, 'insufficient');
    strictEqual(empty.score.score, undefined);
    strictEqual(strictAssessment({ daily: { ...response.daily, precipitation_sum: time.map(() => null) } }, r, species.profile).dataQuality, 'insufficient');
  }
  const directory = mkdtempSync(join(tmpdir(), 'mushroom-research-cache-test-'));
  try {
    let calls = 0;
    const transport = (async () => { calls++; return new Response(JSON.stringify({ value: 4 }), { status: 200 }); }) as typeof fetch;
    const cache = new ResearchCache(directory, false, 0, transport);
    const [a, b] = await Promise.all([cache.get('https://example.invalid/a'), cache.get('https://example.invalid/a')]);
    deepStrictEqual(a, b); strictEqual(calls, 1); strictEqual(cache.joins, 1);
    await cache.get('https://example.invalid/a'); strictEqual(calls, 1);
    const restarted = new ResearchCache(directory, true, 0, transport);
    deepStrictEqual(await restarted.get('https://example.invalid/a'), a); strictEqual(calls, 1);
    await rejects(restarted.get('https://example.invalid/missing'), /Offline cache miss/);
    let attempts = 0;
    const failing = new ResearchCache(directory, false, 0, (async () => { attempts++; return new Response('', { status: 503 }); }) as typeof fetch);
    await rejects(failing.get('https://example.invalid/failed'), /HTTP 503/); strictEqual(attempts, 3);
    const recover = new ResearchCache(directory, false, 0, transport);
    await recover.get('https://example.invalid/failed'); strictEqual(calls, 2); // Failures aren't cached as successes.
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const file of ['src/domain/mushroomWeather.ts', 'src/services/weather.ts', 'src/domain/heatmap/assessment.ts', 'src/domain/heatmap/pilot.ts', 'src/domain/heatmap/zgs.ts']) {
    strictEqual(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
      execFileSync('git', ['show', `d050a0f:${file}`], { maxBuffer: 5 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n'), file);
  }
  console.log('PASS V2 daily dates, taxonomy/synonym gates, uncertainty tiers, server geospatial gate, status, identifier dedupe, cache/inflight/disk/failure, start-of-day soil, future leakage exclusion, production scorer identity/renormalization, unchanged production sources.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
