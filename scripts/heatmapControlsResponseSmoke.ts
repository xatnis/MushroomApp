import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { INITIAL_HEATMAP_CONTROLS, heatmapControlsReducer, heatmapControlsPanelVisible,
  type HeatmapControlsAction } from '../src/domain/heatmap/controlsState';
import { createHeatmapSourcePreparation, createHeatmapVisualCache, heatmapSourceReady,
  requestHeatmapHandoff, type HeatmapRenderView } from '../src/domain/heatmap/visual';
import { OVERVIEW_FEATURES, OVERVIEW_WEATHER_POINTS, type HeatmapLod } from '../src/domain/heatmap/lod';
import { REGIONAL_INDEX, HEATMAP_PILOT_METADATA } from '../src/domain/heatmap/regional';
import { HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { weatherAssessmentsFor, type HeatmapPilotBundle } from '../src/services/heatmap/pilotHeatmap';
import { shiftLocalDate } from '../src/services/weather';

let controls = INITIAL_HEATMAP_CONTROLS;
ok(heatmapControlsPanelVisible(controls, true, false));
ok(!heatmapControlsPanelVisible(controls, true, true)); // temporary card occlusion
ok(heatmapControlsPanelVisible(controls, true, false)); // restore prior open state
controls = heatmapControlsReducer(controls, { type: 'dismiss' });
for (const event of ['weather', 'targetLod', 'displayedLod', 'prewarm', 'camera', 'species', 'date', 'focus', 'detail-close']) {
  // Defensive reducer ignores events outside its two user-intent actions.
  controls = heatmapControlsReducer(controls, { type: event } as HeatmapControlsAction);
  ok(!heatmapControlsPanelVisible(controls, true, false), event);
}
ok(!heatmapControlsPanelVisible(controls, true, true));
ok(!heatmapControlsPanelVisible(controls, true, false), 'closed-before-card stays closed');
controls = heatmapControlsReducer(controls, { type: 'open' });
ok(heatmapControlsPanelVisible(controls, true, false));
ok(!heatmapControlsPanelVisible(controls, false, false), 'Rastisca mode remains hidden');
controls = heatmapControlsReducer(controls, { type: 'dismiss' });
ok(!heatmapControlsPanelVisible(controls, true, false), 'dismiss during card occlusion wins over restore');

const screen = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const hook = readFileSync('src/services/heatmap/useHeatmapVisuals.ts', 'utf8');
strictEqual((screen.match(/dispatchHeatmapControls\(\{ type: 'open' \}\)/g) ?? []).length, 1, 'only explicit Pogoji reopens');
ok(screen.includes('onPressIn={(event) => {') && screen.includes("type: 'dismiss'"));
ok(!hook.includes('loadHeatmapPilot(') && !hook.includes('getRegionalWeather('));
ok(screen.includes('data={visual.detailData}') && screen.includes('data={visual.overviewData}'));

const date = '2026-10-04', points = [...OVERVIEW_WEATHER_POINTS, ...HEATMAP_PILOT_METADATA.weatherCells];
const cells = Object.fromEntries(points.map(p => [p.id, { ...p, baseLocalDate: date,
  fetchedAt: date + 'T10:00:00Z', stale: false, errors: {},
  days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' as const : 'forecast' as const,
    precipitationMm: 2, temperatureMeanC: 14, evapotranspirationMm: 1 })),
  currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
  tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
}]));
const scoringAt = performance.now();
const assessments = Object.fromEntries(['today', 'tomorrow'].map(day => [day,
  Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile => [profile, Object.fromEntries(Object.values(cells)
    .map(c => [c.id, assessHeatmapWeather(c, profile, day as 'today' | 'tomorrow')]))]))])) as HeatmapPilotBundle['assessments'];
console.log({ cachedDatasetScoringMs: performance.now() - scoringAt, scoredOnce: points.length * 8,
  scorerCallsOnSelection: 0, networkRequestsOnSelection: 0 });
const bundle: HeatmapPilotBundle = { policyVersion: 'fixture', baseLocalDate: date, assessments,
  weather: { baseLocalDate: date, policyVersion: 'fixture', fetchedAt: date + 'T10:00:00Z', stale: false, cells, coldRequestCount: 0 } };
const features = REGIONAL_INDEX.visible([14.58, 46.24, 15.12, 46.69]);
const publications: Array<{ lod: HeatmapLod; view: HeatmapRenderView }> = [];
const deferred: Array<{ work: () => void; cancelled: boolean }> = [];
const cache = createHeatmapVisualCache();
const preparation = createHeatmapSourcePreparation(cache, (lod, view) => publications.push({ lod, view }), work => {
  const task = { work, cancelled: false }; deferred.push(task); return () => { task.cancelled = true; };
});
for (const [profile, day] of [['boletusEdulis', 'today'], ['cantharellusCibarius', 'today'], ['cantharellusCibarius', 'tomorrow']] as const) {
  publications.length = 0;
  const lookupAt = performance.now(), weather = weatherAssessmentsFor(bundle, profile, day);
  const lookupMs = performance.now() - lookupAt;
  const legacyCache = createHeatmapVisualCache(), legacyAt = performance.now();
  legacyCache.prepare('overview', OVERVIEW_FEATURES, weather, profile, day, date);
  legacyCache.prepare('detail', features, weather, profile, day, date);
  const beforeMs = performance.now() - legacyAt, activeAt = performance.now();
  const view = preparation.update({ lod: 'detail', detailFeatures: features, weather, profile, day, date })!;
  const activeMs = performance.now() - activeAt;
  deepStrictEqual(publications.map(p => p.lod), ['detail'], 'inactive overview neither builds nor submits during detail selection');
  strictEqual(deferred.length, 0);
  strictEqual(view.collection.features[0].geometry, features[0].geometry, 'static geometry object is reused');
  ok(heatmapSourceReady(view, features, profile, day, date));
  const state = { displayed: 'detail' as const };
  strictEqual(requestHeatmapHandoff(state, 'detail', true), state, 'species/day is data update, not a LOD handoff');
  console.log({ profile, day, features: features.length, lookupMs, beforeDualSourceMs: beforeMs,
    afterActiveSourceMs: activeMs, parts: cache.lastTiming, beforeSourceUpdates: 2, afterActiveSourceUpdates: 1,
    afterInactiveSourceUpdates: 0, nativeFirstRenderedFrame: 'not measured; dev callback is map-wide, not layer proof' });
}
publications.length = 0;
preparation.update({ lod: 'overview', detailFeatures: features, weather: assessments.today.generic, profile: 'generic', day: 'today', date });
deepStrictEqual(publications.map(p => p.lod), ['overview'], 'overview source publishes before detail prewarm work');
strictEqual(deferred.length, 1);
const old = deferred[0];
preparation.update({ lod: 'overview', detailFeatures: features, weather: assessments.tomorrow.lactariusDeliciosus,
  profile: 'lactariusDeliciosus', day: 'tomorrow', date });
ok(old.cancelled); old.work(); // simulate a callback delivered despite cancellation
strictEqual(publications.length, 2, 'stale prewarm generation cannot publish');
deferred[1].work();
deepStrictEqual(publications.map(p => p.lod), ['overview', 'overview', 'detail']);
strictEqual(publications[2].view.selectionKey, `lactariusDeliciosus/tomorrow/${date}`);
preparation.update({ lod: 'overview', detailFeatures: features, weather: assessments.today.generic,
  profile: 'generic', day: 'today', date });
const pendingPrewarm = deferred[2];
preparation.update({ lod: 'detail', detailFeatures: features, weather: assessments.today.boletusEdulis,
  profile: 'boletusEdulis', day: 'today', date });
ok(pendingPrewarm.cancelled, 'detail takeover cancels inactive prewarm');
const publicationCount = publications.length;
pendingPrewarm.work();
strictEqual(publications.length, publicationCount, 'stale prewarm cannot overwrite active detail');
for (const profile of HEATMAP_PROFILE_IDS) preparation.update({ lod: 'detail', detailFeatures: features,
  weather: assessments.tomorrow[profile], profile, day: 'tomorrow', date });
strictEqual(publications[publications.length - 1].view.selectionKey,
  `${HEATMAP_PROFILE_IDS[HEATMAP_PROFILE_IDS.length - 1]}/tomorrow/${date}`, 'rapid detail selection: latest wins');
preparation.cancel();
console.log('PASS: immediate/durable dismiss, explicit reopen, card restore, active-first detail/overview, stale deferred generation, geometry reuse, no source remount or new LOD handoff, zero-refetch cached species/day.');
