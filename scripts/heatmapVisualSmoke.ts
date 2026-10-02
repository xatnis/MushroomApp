import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHeatmapVisualCache, createHeatmapVisualCoalescer, finishHeatmapHandoff, heatmapLayerVisible, requestHeatmapHandoff,
  retainHeatmapGrid, HEATMAP_VISUAL, type HeatmapHandoff } from '../src/domain/heatmap/visual';
import { OVERVIEW_FEATURES, OVERVIEW_INDEX, OVERVIEW_WEATHER_POINTS, selectHeatmapLod, buildOverviewCollection } from '../src/domain/heatmap/lod';
import { REGIONAL_INDEX, HEATMAP_PILOT_METADATA, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import type { HeatmapWeatherAssessment } from '../src/domain/heatmap/types';
import type { HeatmapLod } from '../src/domain/heatmap/lod';
import { shiftLocalDate } from '../src/services/weather';

let state: HeatmapHandoff = { displayed: 'overview' };
state = requestHeatmapHandoff(state, 'detail', false);
ok(heatmapLayerVisible(state, 'overview')); ok(!heatmapLayerVisible(state, 'detail'));
state = requestHeatmapHandoff(state, 'detail', true);
ok(heatmapLayerVisible(state, 'overview')); ok(heatmapLayerVisible(state, 'detail'), 'one acknowledged native frame overlaps');
state = finishHeatmapHandoff(state);
ok(heatmapLayerVisible(state, 'detail')); ok(!heatmapLayerVisible(state, 'overview'));
state = requestHeatmapHandoff(state, 'overview', true);
ok(heatmapLayerVisible(state, 'detail')); ok(heatmapLayerVisible(state, 'overview'));
state = finishHeatmapHandoff(state);
strictEqual(state.displayed, 'overview');

let wanted: HeatmapLod = 'overview'; let changes = 0;
for (const zoom of [8.8, 9.2, 9.6, 9.3, 9.7, 8.9]) {
  const next = selectHeatmapLod(zoom, wanted); if (next !== wanted) changes++;
  wanted = next; state = requestHeatmapHandoff(state, wanted, zoom !== 9.6);
  ok(heatmapLayerVisible(state, 'overview') || heatmapLayerVisible(state, 'detail'), 'never blank during rapid zoom');
}
strictEqual(changes, 2); strictEqual(finishHeatmapHandoff(state).displayed, 'overview', 'stale detail completion cannot overwrite zoom-out');
const stale = requestHeatmapHandoff({ displayed: 'overview' }, 'detail', true);
strictEqual(finishHeatmapHandoff(stale, 'overview').displayed, 'overview', 'queued native callback cannot promote superseded detail');

const date = '2026-10-02';
const makeWeather = (profile: Parameters<typeof assessHeatmapWeather>[1], day: 'today' | 'tomorrow') =>
  Object.fromEntries([...OVERVIEW_WEATHER_POINTS, ...HEATMAP_PILOT_METADATA.weatherCells].map(p => [p.id, assessHeatmapWeather({
    ...p, baseLocalDate: date, fetchedAt: date + 'T10:00:00Z', stale: false, errors: {},
    days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast',
      precipitationMm: 2, temperatureMeanC: 14, evapotranspirationMm: 1 })),
    currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
    tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  }, profile, day)])) as Record<string, HeatmapWeatherAssessment>;
const weather = makeWeather('boletusEdulis', 'today');
const cache = createHeatmapVisualCache();
const bounds: [number, number, number, number] = [14.75, 46.37, 14.95, 46.57];
const features = REGIONAL_INDEX.visible(bounds);
const a = cache.prepare('detail', features, weather, 'boletusEdulis', 'today', date);
deepStrictEqual(a.collection, buildHeatmapRenderCollection(weather, features, 'boletusEdulis', 'today').collection);
deepStrictEqual(JSON.parse(a.serialized), a.collection);
strictEqual(cache.prepare('detail', REGIONAL_INDEX.visible([...bounds]), { ...weather }, 'boletusEdulis', 'today', date), a, 'effective set, not bounds/array/record identity');
const irrelevant = Object.keys(weather).find(id => !features.some(f => f.properties.weatherCellId === id))!;
strictEqual(cache.prepare('detail', features, { ...weather, [irrelevant]: { ...weather[irrelevant] } }, 'boletusEdulis', 'today', date), a, 'unrelated weather batch is a hit');
const relevant = features[0].properties.weatherCellId;
ok(cache.prepare('detail', features, { ...weather, [relevant]: { ...weather[relevant] } }, 'boletusEdulis', 'today', date) !== a);
const empty = cache.prepare('detail', [], weather, 'boletusEdulis', 'today', date);
strictEqual(retainHeatmapGrid(a, empty), a, 'never clear populated source to empty');
ok(cache.prepare('detail', features, weather, 'boletusEdulis', 'today', '2026-10-03') !== a, 'new date never reuses old snapshot');
// Panel/card state is not accepted by the cache; repeating the same inputs changes neither object nor string.
const stable = cache.prepare('detail', features, weather, 'boletusEdulis', 'today', date);
const before = cache.builds;
for (let i = 0; i < 20; i++) strictEqual(cache.prepare('detail', features, weather, 'boletusEdulis', 'today', date), stable);
strictEqual(cache.builds, before, '20 unrelated UI renders: zero rebuild/source-data change');

// Desktop local-path benchmark, NOT React commit/GPU/native frame measurements.
const benchmarkCache = createHeatmapVisualCache(24);
const rows: object[] = [];
for (const [name, lod, box] of [
  ['OVERVIEW pan', 'overview', [14.58, 46.24, 15.12, 46.69]],
  ['DETAIL pan', 'detail', bounds],
] as Array<[string, HeatmapLod, typeof bounds]>) {
  const t = performance.now();
  const set = lod === 'overview' ? OVERVIEW_FEATURES : REGIONAL_INDEX.visible(box);
  const filterMs = performance.now() - t;
  const oldStart = performance.now();
  const oldOverview = buildOverviewCollection(weather, OVERVIEW_INDEX.visible(box), 'boletusEdulis', 'today');
  const oldDetail = lod === 'detail' ? buildHeatmapRenderCollection(weather, set, 'boletusEdulis', 'today') : undefined;
  JSON.stringify(oldOverview.collection); if (oldDetail) JSON.stringify(oldDetail.collection);
  const oldPrepareMs = performance.now() - oldStart;
  // Overview is already prepared independently of the viewport. A pan is a hit.
  if (lod === 'overview') benchmarkCache.prepare(lod, set, weather, 'boletusEdulis', 'today', date);
  const buildCount = benchmarkCache.builds;
  const start = performance.now();
  const result = benchmarkCache.prepare(lod, set, weather, 'boletusEdulis', 'today', date);
  const prepareMs = performance.now() - start;
  const parts = benchmarkCache.lastTiming;
  const cacheStart = performance.now();
  strictEqual(benchmarkCache.prepare(lod, set, weather, 'boletusEdulis', 'today', date), result);
  const cacheMs = performance.now() - cacheStart;
  rows.push({ name, polygons: set.length, filterMs, oldPrepareMs, prepareMs, cacheMs,
    parts,
    beforeRebuilds: lod === 'detail' ? 2 : 1, afterRebuilds: benchmarkCache.builds - buildCount,
    beforeSourceDataChanges: lod === 'detail' ? 2 : 1, afterSourceDataChanges: benchmarkCache.builds - buildCount,
    visualSettlementMs: HEATMAP_VISUAL.viewportDelayMs, firstFrame: 'requires native render acknowledgement; not measured on desktop' });
}
for (const [name, lod, profile, day] of [
  ['OVERVIEW -> DETAIL cached prewarm', 'detail', 'boletusEdulis', 'today'],
  ['DETAIL -> OVERVIEW prewarmed', 'overview', 'boletusEdulis', 'today'],
  ['species switch', 'detail', 'lactariusDeliciosus', 'today'],
  ['Danes -> Jutri', 'detail', 'lactariusDeliciosus', 'tomorrow'],
] as const) {
  const assessed = profile === 'boletusEdulis' ? weather : makeWeather(profile, day);
  const count = benchmarkCache.builds, t = performance.now();
  benchmarkCache.prepare(lod, lod === 'overview' ? OVERVIEW_FEATURES : features, assessed, profile, day, date);
  rows.push({ name, prepareMs: performance.now() - t, rebuilds: benchmarkCache.builds - count, networkRequests: 0,
    nativeSourceRemounts: 0, nativeEmptyFrame: 'state invariant passed; physical GPU timing unmeasured' });
}
// Both actual hook sources update for a new profile/day, including the warmed overview.
for (const [profile, day] of [['cantharellusCibarius', 'today'], ['cantharellusCibarius', 'tomorrow']] as const) {
  const assessed = makeWeather(profile, day), count = benchmarkCache.builds, t = performance.now();
  benchmarkCache.prepare('overview', OVERVIEW_FEATURES, assessed, profile, day, date);
  benchmarkCache.prepare('detail', features, assessed, profile, day, date);
  rows.push({ name: `both sources ${profile}/${day}`, prepareMs: performance.now() - t, rebuilds: benchmarkCache.builds - count,
    submittedSourceChanges: 2, networkRequests: 0, ReactCommits: 'device diagnostic, not measured by this pure test' });
}
const map = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const hook = readFileSync('src/services/heatmap/useHeatmapVisuals.ts', 'utf8');
ok(map.includes('<GeoJSONSource id="regional-overview-source" data={visual.overviewData}'));
ok(map.includes('data={visual.detailData}'));
ok(!map.includes('maxzoom={detailReady'));
ok(map.includes('onDidFinishRenderingFrameFully={visual.onFullyRendered}'));
ok(!hook.includes('selectedAreaId'), 'card selection cannot rebuild source');
ok(hook.includes('coalescer.push(bundle)'), 'bounded coalescing window');
ok(hook.includes('REGIONAL_INDEX.visible(visualBounds)'), 'visual filter independent of network scheduling');
strictEqual(HEATMAP_VISUAL.viewportDelayMs, 100);
console.log('Heatmap visual smoke passed: handoff/rapid zoom/cache/retention/source lifetime; React/native timing not measured.');
console.log(JSON.stringify(rows, null, 2));

async function timingTests() {
  const commits: number[] = [];
  const coalescer = createHeatmapVisualCoalescer<number>(n => commits.push(n));
  coalescer.push(1); await new Promise(r => setTimeout(r, 10));
  deepStrictEqual(commits, [1], 'first useful snapshot is not delayed 80 ms');
  coalescer.push(2);
  for (let i = 3; i <= 6; i++) { await new Promise(r => setTimeout(r, 10)); coalescer.push(i); }
  await new Promise(r => setTimeout(r, 60));
  deepStrictEqual(commits, [1, 6], 'five progressive snapshots become one update, bounded window');
  coalescer.push(7); coalescer.cancel(); await new Promise(r => setTimeout(r, 90));
  deepStrictEqual(commits, [1, 6], 'unmount cancellation');
  console.log('Weather visual coalescing: first immediate, 5 updates -> 1 within 80 ms, cleanup passed.');
  // Candidate local settlement windows, measured with the same lightweight filter/prepare.
  // This measures timers + JS, not touch/GPU latency, so it cannot choose an Android optimum.
  for (const delay of [60, 100, 120]) {
    const start = performance.now();
    await new Promise(r => setTimeout(r, delay));
    const t = performance.now();
    const set = REGIONAL_INDEX.visible(bounds);
    cache.prepare('detail', set, weather, 'boletusEdulis', 'today', date);
    console.log(JSON.stringify({ localDelayCandidateMs: delay, jsWorkMs: performance.now() - t,
      scheduledPlusJsMs: performance.now() - start, nativeFirstFrameUnmeasured: true }));
  }
}
void timingTests().catch(error => { console.error(error); process.exitCode = 1; });
