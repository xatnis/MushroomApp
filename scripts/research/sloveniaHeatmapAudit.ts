/** Isolated audit: never writes src/, never uses private locations, network only with --live-six/--live-pairs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { HEATMAP_HABITAT, HEATMAP_PILOT_METADATA } from '../../src/domain/heatmap/regional';
import { habitatStateFor, HEATMAP_PROFILE_IDS } from '../../src/domain/heatmap/pilot';
import { OVERVIEW_FEATURES } from '../../src/domain/heatmap/lod';
import { buildHistoricalWeatherSummaryForTarget, shiftLocalDate } from '../../src/services/weather';
import { withCivilHourlyWeather, sevenDayHourlyRequestPlan } from '../../src/services/sevenDayHourlyWeather';
import { evaluateSevenDayConditions, CANONICAL_POINT_POLICY, type SevenDaySnapshot } from '../../src/domain/sevenDayConditions';
import { loadPointSnapshots, pointResults } from '../../src/services/pointConditions';
import { weatherLocalDate } from '../../src/domain/weatherSeries';
import { hourlyWeatherFixture } from '../sevenDayHourlyFixture';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (n: number) => Math.round(n * 1000) / 1000;
function time(fn: () => unknown, count = 5) { const ms: number[] = []; for (let i = 0; i < count; i++) { const start = performance.now(); fn(); ms.push(performance.now() - start); } return round(median(ms)); }
const db = () => { const rows = new Map<string, any>(); return { getFirstAsync: async (_: string, key: string) => rows.get(key),
  runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) } as any; };
function output(value: unknown, name: string) {
  const text = JSON.stringify(value, null, 2);
  if (process.argv.includes('--save')) writeFileSync(`docs/research/slovenia-heatmap-${name}-audit.json`, text + '\n');
  console.log(text);
}

async function offline() {
  const collection = JSON.parse(readFileSync('docs/research/slovenia-geometry-audit.tmp.json', 'utf8'));
  const n = collection.features.length; strictEqual(n, 21052);
  const bytes = (value: unknown) => { const text = JSON.stringify(value), gc = (globalThis as any).gc;
    gc?.(); const before = process.memoryUsage().heapUsed; const decoded = JSON.parse(text); const heap = process.memoryUsage().heapUsed - before;
    return { rawBytes: Buffer.byteLength(text), gzipBytes: gzipSync(text).length, parseMedianMs: time(() => JSON.parse(text)),
      stringifyMedianMs: time(() => JSON.stringify(decoded)), approximateParseHeapDeltaBytes: heap }; };
  const geometry = bytes(collection);
  const hash = (text: string) => [...text].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  // Synthetic attributes ONLY; not model output or a fabricated national habitat mask.
  const columns = new Uint8Array(n * 28 * 2);
  collection.features.forEach((feature: any, index: number) => {
    const base = hash(feature.properties.weatherCellId);
    for (let j = 0; j < 28; j++) {
      const score = j % 11 ? (base + j * 7) % 101 : 255; // 255 = unavailable, never missing-as-zero.
      feature.properties[`s${j}`] = score === 255 ? null : score;
      feature.properties[`q${j}`] = score === 255 ? 2 : 0;
      columns[(index * 28 + j) * 2] = score; columns[(index * 28 + j) * 2 + 1] = score === 255 ? 2 : 0;
    }
  });
  const allAttributes = bytes(collection);
  const selected = { ...collection, features: collection.features.map((feature: any) => ({ ...feature,
    properties: { id: feature.properties.id, score: feature.properties.s4, status: feature.properties.q4 } })) };
  const selectedAttributes = bytes(selected);
  const dateJoinMs = time(() => collection.features.map((feature: any) => ({ ...feature, properties: { id: feature.properties.id, score: feature.properties.s4, status: feature.properties.q4 } })));
  const regionalHabitat = Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile => [profile, Object.fromEntries(['candidate', 'unknown', 'outside-model'].map(state => [state,
    { cells: HEATMAP_HABITAT.features.filter(f => habitatStateFor(f, profile) === state).length,
      weatherLocations: new Set(HEATMAP_HABITAT.features.filter(f => habitatStateFor(f, profile) === state).map(f => f.properties.weatherCellId)).size }]))]));
  const regionalOverview = Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile => [profile, Object.fromEntries(['candidate', 'unknown', 'outside-model'].map(state => [state,
    OVERVIEW_FEATURES.filter(f => { const fractions = f.properties.habitatFractions[profile]; return (fractions['outside-model'] >= .8 ? 'outside-model' : fractions.candidate >= .6 ? 'candidate' : 'unknown') === state; }).length]))]));
  const baseDate = '2026-10-14', point = { latitude: 46.5, longitude: 14.5 }, retrieved = '2026-10-14T12:00:00Z';
  const empty: SevenDaySnapshot = { ...point, baseLocalDate: baseDate, timezone: 'Europe/Ljubljana', today: { ...point, source: 'open-meteo', stale: false, errors: {}, updatedAt: retrieved },
    daily: [], soilByDate: {}, dailyPeriods: {}, forecastIssuedAt: null, forecastRetrievedAt: null, archiveRetrievedAt: null, expiresAt: Number.MAX_SAFE_INTEGER, stale: false,
    blockers: [], snapshotId: 'audit-synthetic-only', assembledAt: retrieved };
  // Prebuild fixtures OUTSIDE timing: fixture generation is not production decoding cost.
  const sources = sevenDayHourlyRequestPlan(point.latitude, point.longitude, baseDate).map(plan => ({ status: 'fulfilled' as const,
    value: { data: hourlyWeatherFixture(plan.url, baseDate), stale: false, fetchedAt: retrieved } }));
  const adapterTimes: number[] = []; let snapshot = empty;
  for (let i = 0; i < 7; i++) { const start = performance.now(); snapshot = await withCivilHourlyWeather(db(), empty, undefined, sources); adapterTimes.push(performance.now() - start); }
  snapshot.pointPolicyVersion = CANONICAL_POINT_POLICY; snapshot.today.inputPolicyVersion = CANONICAL_POINT_POLICY; snapshot.today.evaluationLocalDate = baseDate;
  const fixtureResults = HEATMAP_PROFILE_IDS.flatMap(profile => evaluateSevenDayConditions(snapshot, profile));
  strictEqual(fixtureResults.filter(result => result.score != null).length, 28);
  const allProfilesWeekMs = time(() => HEATMAP_PROFILE_IDS.forEach(profile => evaluateSevenDayConditions(snapshot, profile)), 9);
  const historyAt = (day: number) => { const date = shiftLocalDate(baseDate, day), start = shiftLocalDate(date, -60); return buildHistoricalWeatherSummaryForTarget(snapshot.daily.filter(e => e.day.date >= start && e.day.date < date).map(e => e.day), date); };
  const repeatMs = time(() => { for (let sample = 0; sample < 32; sample++) for (let profile = 0; profile < 4; profile++) for (let day = 0; day < 7; day++) historyAt(day); });
  const sharedMs = time(() => { for (let sample = 0; sample < 32; sample++) { const byDate = Array.from({ length: 7 }, (_, day) => historyAt(day));
    for (let profile = 0; profile < 4; profile++) for (let day = 0; day < 7; day++) void byDate[day]; } });
  for (let day = 0; day < 7; day++) deepStrictEqual(historyAt(day), fixtureResults[day].inputs.historical);
  const memoMs = time(() => { for (let i = 0; i < 1000; i++) for (const profile of HEATMAP_PROFILE_IDS) pointResults(snapshot, profile); });
  output({ auditOnly: true, environment: `${process.platform} Node ${process.version}, not Android`, baseCommit: 'b63e18a', geometrySource: 'pinned national polygon and existing grid, NO national habitat values',
    nodeBaselineHeapBytes: process.memoryUsage().heapUsed, geometry, selectedAttributes, all28SyntheticAttributes: allAttributes,
    syntheticColumns: { rawBytes: columns.byteLength, gzipBytes: gzipSync(columns).length, format: 'two uint8 values per cell/profile/day; 255 score unavailable, category flags synthetic' },
    dateJoinMs, regionalCells: HEATMAP_HABITAT.features.length, regionalWeather: HEATMAP_PILOT_METADATA.weatherCells.length, regionalHabitat, regionalOverview,
    scoring: { fixtureOnly: true, fixtureNumericOutcomes: 28, hourlyAdapterMedianMs: round(median(adapterTimes)), oneWeatherLocationFourProfilesSevenDatesMedianMs: allProfilesWeekMs,
      serializedSnapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)), serializedAllProfilesResultsBytes: Buffer.byteLength(JSON.stringify(fixtureResults)),
      reusedHistory32PointsMs: sharedMs, repeatedHistory32PointsMs: repeatMs, sharedAssemblies: 224, repeatedAssemblies: 896,
      memo4000ProfileLookupsMs: memoMs, scaled269LocationsAdapterPlusScoringSeconds: round(269 * (median(adapterTimes) + allProfilesWeekMs) / 1000) },
    limits: ['Geometry and attribute codecs are JSON/gzip, NOT measured MVT or PMTiles.', 'Heap deltas exclude native copies/GPU and are GC/runtime-sensitive.',
      'Generated numeric attributes are synthetic compression stress data, NOT forecasts.', 'No native date/profile switch or FPS measurement.'] }, 'performance');
}

async function liveSix() {
  const geometry = JSON.parse(readFileSync('docs/research/slovenia-heatmap-geometry-audit.json', 'utf8'));
  const paired = process.argv.includes('--live-pairs');
  const points: { latitude: number; longitude: number }[] = geometry.regions.flatMap((region: any) => (paired ? [region.publicCoordinate, region.weatherCentre10km] : [region.publicCoordinate])
    .map((point: number[]) => ({ latitude: point[0], longitude: point[1] })));
  strictEqual(points.length, paired ? 12 : 6); const database = db(), original = globalThis.fetch;
  let requests = 0; const payloads: any[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (++requests > 2) throw new Error('Audit cap: at most two batched HTTP requests, never a national acquisition');
    const start = performance.now(), response = await original(url, options), address = new URL(String(url));
    const metric: any = { endpoint: address.hostname.startsWith('archive') ? 'archive' : 'forecast', responseMs: round(performance.now() - start), status: response.status };
    payloads.push(metric);
    return { ok: response.ok, status: response.status, json: async () => {
      const start = performance.now(), data = await response.json(); metric.decodeMs = round(performance.now() - start); metric.decodedJsonBytes = Buffer.byteLength(JSON.stringify(data));
      metric.locations = (Array.isArray(data) ? data : [data]).map((row: any) => ({ latitude: row.latitude, longitude: row.longitude, elevation: row.elevation,
        hourlyCount: row.hourly?.time?.length, topSoilUnits: row.hourly_units?.soil_moisture_0_to_7cm, deeperSoilUnits: row.hourly_units?.soil_moisture_7_to_28cm })); return data;
    } };
  }) as any;
  try {
    const date = weatherLocalDate(), start = performance.now(), uniqueSnapshots = await loadPointSnapshots(database, points, date), acquired = performance.now();
    // Production deliberately returns unique locations. The phase anchor itself is also a
    // weather centre; rebuild logical pair positions by exact identity, never array index.
    const snapshots = points.map((point: { latitude: number; longitude: number }) => {
      const snapshot = uniqueSnapshots.find(s => s.latitude === point.latitude && s.longitude === point.longitude);
      if (!snapshot) throw new Error('Missing exact research point identity'); return snapshot;
    });
    if (paired) for (let i = 0; i < snapshots.length; i += 2) {
      strictEqual(snapshots[i].forecastRetrievedAt, snapshots[i+1].forecastRetrievedAt);
      strictEqual(snapshots[i].archiveRetrievedAt, snapshots[i+1].archiveRetrievedAt);
      strictEqual(snapshots[i].pointPolicyVersion, snapshots[i+1].pointPolicyVersion);
    }
    const availability = snapshots.map((snapshot, index) => ({ region: geometry.regions[paired ? Math.floor(index/2) : index].name,
      role: paired && index % 2 ? '10km-sampling-centre' : 'exact-public-point', sourceSnapshotId: snapshot.snapshotId,
      forecastRetrievedAt: snapshot.forecastRetrievedAt, blockers: snapshot.blockers, profiles: Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile => [profile,
        pointResults(snapshot, profile).map(result => ({ score: result.score, status: result.status, missing: result.missing }))])) }));
    const scored = performance.now(), canReopen = snapshots.every(s => !s.blockers.length && !s.stale && s.expiresAt > Date.now());
    if (canReopen) await loadPointSnapshots(database, points, date);
    const warm = performance.now(); strictEqual(requests, 2);
    const spatialComparison = paired ? geometry.regions.map((region: any, index: number) => ({ region: region.name,
      sameCanonicalContractSameBatchedSources: true, NOTGroundTruthOrLegacyRegionalComparison: true,
      profiles: Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile => [profile, pointResults(snapshots[index*2], profile).map((point, day) => {
        const cell = pointResults(snapshots[index*2+1], profile)[day];
        return { date: point.targetLocalDate, pointScore: point.score, centreScore: cell.score,
          pointMinusCentre: point.score != null && cell.score != null ? point.score - cell.score : null,
          labelChanged: point.label !== cell.label, pointT20: point.inputs.historical?.avgTemp20dC, centreT20: cell.inputs.historical?.avgTemp20dC,
          pointTopSoil: point.targetSoil?.soilMoisture0To7Cm, centreTopSoil: cell.targetSoil?.soilMoisture0To7Cm };
      })])) })) : undefined;
    output({ auditOnly: true, environment: 'LIVE bounded public-coordinate probe, Windows/Node, not Android or nationwide validation', date, requests, uniqueLocations: uniqueSnapshots.length,
      acquisitionMs: round(acquired - start), allScoresMs: round(scored - acquired), warmMs: canReopen ? round(warm - scored) : null,
      warmAdditionalRequests: canReopen ? 0 : null, warmSkippedForIncompleteSources: !canReopen, payloads, availability, spatialComparison,
      attribution: 'Weather data by Open-Meteo.com, https://open-meteo.com/, CC BY 4.0; modified into experimental MushroomApp suitability assessments; not probability of finds.' }, paired ? 'live-pairs' : 'live-six');
  } finally { globalThis.fetch = original; }
}
void (process.argv.includes('--live-six') || process.argv.includes('--live-pairs') ? liveSix() : offline()).catch(error => { console.error(error); process.exitCode = 1; });
