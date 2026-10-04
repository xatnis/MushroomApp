import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OVERVIEW_FEATURES, OVERVIEW_INDEX, OVERVIEW_WEATHER_POINTS, buildOverviewCollection } from '../src/domain/heatmap/lod';
import { prioritizedWeatherPointIds, type Bounds } from '../src/domain/heatmap/spatial';
import { createRegionalWeatherLoader, regionalWeatherStartWait, OVERVIEW_WEATHER_BATCH_SIZE, REGIONAL_WEATHER_BATCH_SIZE,
  REGIONAL_WEATHER_BATCH_INTERVAL_MS, REGIONAL_WEATHER_POINT_BUDGET } from '../src/services/heatmap/regionalWeather';
import { prioritizedOverviewWeatherPointIds, overviewReadyCoverage, shouldPrefetchOverview, OVERVIEW_PREFETCH, createOverviewCoverageDiagnostics } from '../src/domain/heatmap/overviewLoading';
import { HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import { loadHeatmapPilot, weatherAssessmentsFor, createHeatmapRequestGate, scheduleSettledHeatmapLoad } from '../src/services/heatmap/pilotHeatmap';
import { getHeatmapWeatherBatch, shiftLocalDate } from '../src/services/weather';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition } from '../src/domain/heatmap/types';
import { createHeatmapVisualCache } from '../src/domain/heatmap/visual';

const date = localDateFor(), bounds: Bounds = [13.2, 45.8, 16.3, 48.5];
const visible = OVERVIEW_INDEX.visible(bounds, undefined, 0), buffered = OVERVIEW_INDEX.visible(bounds);
const ids = prioritizedWeatherPointIds(buffered, visible, bounds, OVERVIEW_WEATHER_POINTS);
const points = ids.map(id => OVERVIEW_WEATHER_POINTS.find(p => p.id === id)!);
const fixture = (group: HeatmapWeatherCellDefinition[]): HeatmapWeatherBatch => ({ baseLocalDate: date,
  policyVersion: 'fixture', fetchedAt: new Date().toISOString(), stale: false, coldRequestCount: 2,
  cells: Object.fromEntries(group.map(p => [p.id, { ...p, baseLocalDate: date, fetchedAt: new Date().toISOString(), stale: false, errors: {},
    days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast',
      precipitationMm: 2, temperatureMeanC: 14, evapotranspirationMm: 1 })),
    currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
    tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  }])) });
function database() {
  const rows = new Map<string, { payload: string }>();
  const db = { getFirstAsync: async (_: string, key: string) => rows.get(key),
    runAsync: async (_: string, key: string, payload: string) => rows.set(key, { payload }) } as unknown as SQLiteDatabase;
  return { db, rows };
}
async function benchmark(live = false, before = false) {
  const { db } = database(), requests: Array<Record<string, number>> = [];
  let start = performance.now();
  const coverage: Record<string, number> = {}, sources: number[] = [];
  let transportMs = 0, lastEnd = start;
  const cache = createHeatmapVisualCache();
  const fetchBatch = async (database: SQLiteDatabase, group: HeatmapWeatherCellDefinition[], localDate: string) => {
    const t = performance.now();
    const batch = live ? await getHeatmapWeatherBatch(database, group, localDate)
      : (await new Promise(r => setTimeout(r, 120)), fixture(group));
    const end = performance.now(); transportMs += end - t;
    requests.push({ points: group.length, startMs: t - start, endMs: end - start, transportMs: end - t, gapMs: t - lastEnd }); lastEnd = end;
    return batch;
  };
  let factory = createRegionalWeatherLoader;
  if (before) {
    const code = execFileSync('git', ['show', 'e5053076e9d54c1b636ca135c30b3665f8c8e97d:src/services/heatmap/regionalWeather.ts'], { encoding: 'utf8' });
    const module = { exports: {} as { createRegionalWeatherLoader: typeof factory } };
    new Function('require', 'module', 'exports', ts.transpileModule(code, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText)(createRequire(resolve('src/services/heatmap/regionalWeather.ts')), module, module.exports);
    factory = module.exports.createRegionalWeatherLoader;
  }
  const ordered = before ? points : prioritizedOverviewWeatherPointIds(buffered, visible, bounds, OVERVIEW_WEATHER_POINTS)
    .map(id => OVERVIEW_WEATHER_POINTS.find(p => p.id === id)!);
  const diagnostics: Array<Record<string, unknown>> = [];
  const loader = factory(fetchBatch);
  start = performance.now(); lastEnd = start; // exclude baseline module compilation
  const originalFetch = globalThis.fetch;
  let httpRequests = 0;
  if (live) globalThis.fetch = async (...args) => { httpRequests++; return originalFetch(...args); };
  const progress = (batch: HeatmapWeatherBatch) => {
    const weather = Object.fromEntries(Object.values(batch.cells).map(c => [c.id, assessHeatmapWeather(c, 'boletusEdulis', 'today')]));
    const ready = visible.filter(f => weather[f.properties.weatherCellId]?.score.score !== null &&
      weather[f.properties.weatherCellId]?.score.score !== undefined && weather[f.properties.weatherCellId]?.dataQuality !== 'insufficient').length;
    const pct = 100 * ready / visible.length;
    for (const [name, threshold] of [['first', 0], ['50', 50], ['80', 80], ['100', 100]] as const)
      if (coverage[name] === undefined && (threshold === 0 ? ready > 0 : pct >= threshold)) coverage[name] = performance.now() - start;
    const builds = cache.builds, t = performance.now();
    cache.prepare('overview', OVERVIEW_FEATURES, weather, 'boletusEdulis', 'today', date);
    if (cache.builds !== builds) sources.push(performance.now() - t);
  };
  const result = await loader(db, ordered, date, progress, undefined, { onDiagnostic: e => diagnostics.push(e) });
  if (live) globalThis.fetch = originalFetch;
  const fullMs = performance.now() - start, coldBatches = requests.length;
  const warmStart = performance.now(); await loader(db, points, date); const warmMs = performance.now() - warmStart;
  const restarted = factory(fetchBatch), diskStart = performance.now();
  await restarted(db, points, date); const diskMs = performance.now() - diskStart;
  console.log(JSON.stringify({ live, before, visibleCells: visible.length, points: points.length, requests, diagnostics,
    httpRequests: live ? httpRequests : requests.length * 2,
    coverage, fullMs, transportMs, nonTransportMs: fullMs - transportMs, sourceBuilds: sources.length,
    sourcePrepareMs: sources, warmMs, diskMs, cacheExtraBatches: requests.length - coldBatches,
    failed: Object.values(result.cells).filter(c => c.errors.historical || c.errors.forecast).length,
    nativeMaplibreFrameMs: 'not measured' }, null, 2));
}

async function tests() {
  strictEqual(OVERVIEW_WEATHER_BATCH_SIZE, 40); strictEqual(REGIONAL_WEATHER_BATCH_SIZE, 25);
  strictEqual(REGIONAL_WEATHER_BATCH_INTERVAL_MS, 2000); strictEqual(REGIONAL_WEATHER_POINT_BUDGET, 75);
  strictEqual(regionalWeatherStartWait([{ time: 0, points: 40 }], 35, 1000, 2000), 1000);
  strictEqual(regionalWeatherStartWait([{ time: 0, points: 40 }], 40, 1000, 2000), 59000, '40-point batching cannot bypass quota');
  strictEqual(regionalWeatherStartWait([{ time: 0, points: 40 }], 40, 60000, 2000), 0);
  strictEqual(regionalWeatherStartWait([{ time: 0, points: 40 }, { time: 2000, points: 6 }], 34, 2010, 0), 57990,
    'overview continuation still respects previous DETAIL/OVERVIEW budget');
  const synthetic = (id: string, weatherCellId: string) => ({ ...visible[0], properties: { ...visible[0].properties, id, weatherCellId } });
  const defs = [0, 1, 2, 3].map(i => ({ id: String(i), latitude: 1, longitude: 1 + i }));
  const all = [synthetic('center', '0'), synthetic('low', '1'), ...Array.from({ length: 6 }, (_, i) => synthetic('high' + i, '2')), synthetic('buffer', '3')];
  deepStrictEqual(prioritizedOverviewWeatherPointIds(all, all.slice(0, -1), [0, 0, 2, 2], defs), ['0', '2', '1', '3']);
  strictEqual(prioritizedOverviewWeatherPointIds(all, all.slice(0, -1), [0, 0, 4, 2], defs, { longitude: 2, latitude: 1 })[0], '1', 'focus first');
  const gainOrder = prioritizedOverviewWeatherPointIds(buffered, visible, bounds, OVERVIEW_WEATHER_POINTS);
  console.log('first 25 ready cells: distance vs coverage gain', {
    before: overviewReadyCoverage(visible, new Set(ids.slice(0, 25))),
    after: overviewReadyCoverage(visible, new Set(gainOrder.slice(0, 25))),
  });
  const coverage = overviewReadyCoverage(all, new Set(['2'])); strictEqual(coverage.readyCells, 6);
  let clock = 0; const metric = createOverviewCoverageDiagnostics(() => clock);
  strictEqual(metric('a', overviewReadyCoverage(all, new Set())).length, 0);
  clock = 100; deepStrictEqual(metric('a', coverage).map(e => e.milestone), ['first', '50%']);
  clock = 200; deepStrictEqual(metric('a', overviewReadyCoverage(all, new Set(['0', '1', '2', '3']))).map(e => e.milestone), ['80%', '100%']);
  strictEqual(metric('a', coverage).length, 0, 'milestones logged once per viewport/selection');
  strictEqual(shouldPrefetchOverview('detail', 8.7, 9), true);
  for (const args of [['detail', 8.7, 8.6], ['detail', 8.5, 9], ['detail', 9, 9.3], ['overview', 8.7, 9]] as const)
    strictEqual(shouldPrefetchOverview(args[0], args[1], args[2]), false);
  const gate = createHeatmapRequestGate(); const oldGeneration = gate.next();
  gate.invalidate(); const detailGeneration = gate.next();
  ok(!gate.isCurrent(oldGeneration) && gate.isCurrent(detailGeneration), 'stale speculative generation may not overwrite DETAIL');
  let scheduled = 0;
  const first = scheduleSettledHeatmapLoad(() => { scheduled++; }); first();
  const intermediate = scheduleSettledHeatmapLoad(() => { scheduled++; }); intermediate();
  const settled = scheduleSettledHeatmapLoad(() => { scheduled++; });
  await new Promise(r => setTimeout(r, 275)); settled();
  strictEqual(scheduled, 1, 'only settled 250ms viewport schedules prefetch');
  const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
  ok(source.includes('.slice(0, OVERVIEW_PREFETCH.maxPoints)'));
  ok(source.includes('overviewPrefetchGate.isCurrent(requestId)')); ok(source.includes('controller.abort()'));
  const { db, rows } = database();
  let calls = 0, active = 0, maxActive = 0;
  const groups: string[][] = [];
  const loader = createRegionalWeatherLoader(async (_db, group) => {
    calls++; active++; maxActive = Math.max(maxActive, active); groups.push(group.map(p => p.id));
    await new Promise(r => setTimeout(r, 5)); active--; return fixture(group);
  }, 0);
  const [a, b] = await Promise.all([loader(db, points, date), loader(db, points.slice(0, 6), date)]);
  strictEqual(calls, 1); strictEqual(maxActive, 1); strictEqual(groups[0].length, 40);
  strictEqual(b.cells[points[0].id], a.cells[points[0].id], 'shared point promise');
  await loader(db, points, date); strictEqual(calls, 1, 'overview round trip memory cache');
  await createRegionalWeatherLoader(async (_db, group) => { calls++; return fixture(group); }, 0)(db, points, date);
  strictEqual(calls, 1, 'restart disk cache: 100% hits');
  const originalFetch = globalThis.fetch;
  let network = 0; globalThis.fetch = async () => { network++; throw new Error('unexpected'); };
  try {
    const bundle = await loadHeatmapPilot(db, { pointIds: ids, pointDefinitions: OVERVIEW_WEATHER_POINTS });
    for (const p of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const)
      deepStrictEqual(weatherAssessmentsFor(bundle, p, day)[points[0].id].score, assessHeatmapWeather(a.cells[points[0].id], p, day).score);
    strictEqual(network, 0, 'cached species/day pipeline');
  } finally { globalThis.fetch = originalFetch; }
  rows.clear(); calls = 0;
  const paced = createRegionalWeatherLoader(async (_db, group) => { calls++; return fixture(group); }, 150);
  await paced(db, points.slice(0, 10), date);
  const t = performance.now();
  await paced(db, points.slice(10, 10 + OVERVIEW_PREFETCH.maxPoints), date, undefined, undefined, { prefetch: true });
  strictEqual(calls, 1, 'prefetch skips imposed spacing/budget rather than blocking transport');
  ok(performance.now() - t < 150);
  await paced(db, points.slice(10, 16), date); strictEqual(calls, 2, 'foreground retry still runs');
  rows.clear();
  let burstCalls = 0, burstActive = 0, burstMax = 0;
  const burstDiagnostics: Array<Record<string, unknown>> = [];
  const burst = createRegionalWeatherLoader(async (_db, group) => {
    burstCalls++; burstActive++; burstMax = Math.max(burstMax, burstActive);
    await new Promise(r => setTimeout(r, 10)); burstActive--; return fixture(group);
  });
  const prefetchedPoints = gainOrder.slice(0, OVERVIEW_PREFETCH.maxPoints).map(id => points.find(p => p.id === id)!);
  await burst(db, prefetchedPoints, date, undefined, undefined, { prefetch: true });
  const zoomOutAt = performance.now(); let firstCoverage = 0;
  await burst(db, points, date, value => {
    firstCoverage = Math.max(firstCoverage, overviewReadyCoverage(visible, new Set(Object.keys(value.cells))).overviewReadyCoveragePct);
  }, undefined, { onDiagnostic: e => burstDiagnostics.push(e) });
  strictEqual(burstCalls, 2); strictEqual(burstMax, 1);
  ok(burstDiagnostics.some(e => e.continueOverview === true && e.batchPointCount === 34 && e.schedulerWaitMs === 0), 'bounded 6+34 continuation avoids prefetch-induced spacing');
  console.log('ZOOM OUT simulation', { prefetchedPoints: 6, initialCoveragePct: overviewReadyCoverage(visible, new Set(prefetchedPoints.map(p => p.id))).overviewReadyCoveragePct,
    firstCoverage, fullFromHandoffMs: performance.now() - zoomOutAt, httpIncludingPrefetch: 4, schedulerWaitMs: 0, maxBatchConcurrency: burstMax });
  rows.clear();
  let release!: () => void, started!: () => void;
  const start = new Promise<void>(r => { started = r; }); const order: string[][] = [];
  const cancellable = createRegionalWeatherLoader(async (_db, group) => {
    order.push(group.map(p => p.id));
    if (order.length === 1) { started(); await new Promise<void>(r => { release = r; }); }
    return fixture(group);
  }, 0);
  const abort = new AbortController();
  const old = cancellable(db, points.slice(0, 6), date, undefined, abort.signal, { prefetch: true });
  await start; abort.abort();
  const foreground = cancellable(db, [{ ...points[6], id: 'detail-test' }], date);
  release(); await Promise.all([old, foreground]);
  deepStrictEqual(order[1], ['detail-test'], 'DETAIL goes next, not stale overview work');
  await cancellable(db, points.slice(0, 6), date); strictEqual(order.length, 2, 'finished stale prefetch stays cached');
  rows.clear();
  const twoGroups = [...points, { ...points[0], id: 'detail-failure' }];
  let attempt = 0; const progress: number[] = [];
  const failing = createRegionalWeatherLoader(async (_db, group) => {
    if (++attempt === 1) throw new Error('partial'); return fixture(group);
  }, 0);
  const result = await failing(db, twoGroups, date, value => progress.push(Object.keys(value.cells).length));
  strictEqual(Object.values(result.cells).filter(c => c.errors.forecast).length, 25);
  ok(progress.includes(25) && progress.includes(41));
  ok(Object.values(result.cells).filter(c => !c.errors.forecast).every(c => assessHeatmapWeather(c, 'generic', 'today').score.score !== null));
  console.log('PASS overview batching/budget/coverage priority/prefetch/stale/dedupe/cache/restart/partial failures/species-day');
}
void (process.argv.includes('--benchmark') || process.argv.includes('--live') || process.argv.includes('--before')
  ? benchmark(process.argv.includes('--live'), process.argv.includes('--before'))
  : tests()).catch(e => { console.error(e); process.exitCode = 1; });
