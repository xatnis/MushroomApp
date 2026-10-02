import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import type { SQLiteDatabase } from 'expo-sqlite';
import { readFileSync } from 'node:fs';
import { OVERVIEW_INDEX, OVERVIEW_WEATHER_POINTS, buildOverviewCollection, selectHeatmapLod, overviewHabitatState } from '../src/domain/heatmap/lod';
import { REGIONAL_INDEX, HEATMAP_PILOT_METADATA, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { prioritizedWeatherPointIds, type Bounds } from '../src/domain/heatmap/spatial';
import { HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import { createRegionalWeatherLoader, regionalWeatherKey } from '../src/services/heatmap/regionalWeather';
import { loadHeatmapPilot } from '../src/services/heatmap/pilotHeatmap';
import { shiftLocalDate } from '../src/services/weather';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition } from '../src/domain/heatmap/types';

strictEqual(selectHeatmapLod(9.49, 'overview'), 'overview');
strictEqual(selectHeatmapLod(9.5, 'overview'), 'detail');
strictEqual(selectHeatmapLod(9.01, 'detail'), 'detail');
strictEqual(selectHeatmapLod(9, 'detail'), 'overview');
for (const initial of ['overview', 'detail'] as const) {
  let current = initial;
  for (const zoom of [9.2, 9.4, 9.1, 9.45, 9.3]) current = selectHeatmapLod(zoom, current);
  strictEqual(current, initial, 'hysteresis');
}
strictEqual(overviewHabitatState({ candidate: .1, unknown: .9, 'outside-model': 0 }), 'unknown');
strictEqual(overviewHabitatState({ candidate: .6, unknown: .4, 'outside-model': 0 }), 'candidate');
strictEqual(overviewHabitatState({ candidate: .1, unknown: .1, 'outside-model': .8 }), 'outside-model');
const mapSource = readFileSync('src/screens/MapScreen.tsx', 'utf8');
ok(mapSource.includes('minzoom={HEATMAP_LOD.overviewEnterZoom}'));
ok(mapSource.includes('maxzoom={detailReady ? HEATMAP_LOD.overviewEnterZoom : 24}'));
ok(mapSource.includes('setOverviewTapped(true)'));
const rows = new Map<string, { payload: string }>();
const db = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string) => rows.set(key, { payload }) } as unknown as SQLiteDatabase;
const date = localDateFor();
const fixture = (points: HeatmapWeatherCellDefinition[]): HeatmapWeatherBatch => ({ baseLocalDate: date, policyVersion: 'test', fetchedAt: new Date().toISOString(), stale: false, coldRequestCount: 2,
  cells: Object.fromEntries(points.map(p => [p.id, { ...p, baseLocalDate: date, fetchedAt: new Date().toISOString(), stale: false, errors: {},
    days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast', precipitationMm: 2, temperatureMeanC: 14, evapotranspirationMm: 1 })),
    currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
    tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  }])) });

async function run() {
  for (const [name, zoom, bounds] of [
    ['DETAIL LOCAL', 10.5, [14.75, 46.37, 14.95, 46.57]],
    ['MEDIUM', 9, [14.58, 46.24, 15.12, 46.69]],
    ['LARGE', 6.5, [13.2, 45.8, 16.3, 48.5]],
  ] as Array<[string, number, Bounds]>) {
    rows.clear();
    const lod = selectHeatmapLod(zoom, 'overview');
    const index = lod === 'overview' ? OVERVIEW_INDEX : REGIONAL_INDEX;
    const definitions = lod === 'overview' ? OVERVIEW_WEATHER_POINTS : HEATMAP_PILOT_METADATA.weatherCells;
    const visible = index.visible(bounds, undefined, 0), buffered = index.visible(bounds);
    const ids = prioritizedWeatherPointIds(buffered, visible, bounds, definitions);
    const points = ids.map(id => definitions.find(p => p.id === id)!);
    strictEqual(points.every(p => p.id.startsWith('overview-')), lod === 'overview');
    let requests = 0, first: number | undefined;
    const loader = createRegionalWeatherLoader(async (_db, group) => { requests += 2; await new Promise(r => setTimeout(r, 20)); return fixture(group); }, process.argv.includes('--paced') ? 2000 : 0);
    const start = performance.now();
    const result = await loader(db, points, date, batch => { if (first == null && Object.keys(batch.cells).length) first = performance.now() - start; });
    const full = performance.now() - start;
    const timings: Record<string, number> = {};
    for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
      const t = performance.now();
      const assessed = Object.fromEntries(Object.values(result.cells).map(c => [c.id, assessHeatmapWeather(c, profile, day)]));
      const view = lod === 'overview' ? buildOverviewCollection(assessed, buffered, profile, day) : buildHeatmapRenderCollection(assessed, buffered, profile, day);
      timings[`${profile}/${day}`] = performance.now() - t;
      for (const a of Object.values(view.assessments)) deepStrictEqual(a.scoreDetails, assessed[a.weatherCellId].score, 'same pure scorer');
    }
    const before = requests;
    await loader(db, points, date);
    strictEqual(requests, before, 'cached return and all profile/date switches have no requests');
    console.log(JSON.stringify({ name, lod, zoom, visible: visible.length, buffered: buffered.length, points: points.length, requests, firstMs: first, fullMs: full, timings, mockTransportMs: 20, paced: process.argv.includes('--paced') }));
  }
  const coarse = OVERVIEW_WEATHER_POINTS[0], fine = HEATMAP_PILOT_METADATA.weatherCells[0];
  ok(regionalWeatherKey([{ ...fine, id: coarse.id }], date) !== regionalWeatherKey([fine], date), 'LOD/grid id prevents cache collisions even at same coordinates');
  rows.clear();
  let started!: () => void, finish!: () => void;
  const running = new Promise<void>(r => { started = r; });
  const calls: string[][] = [];
  const loader = createRegionalWeatherLoader(async (_db, group) => {
    calls.push(group.map(p => p.id));
    if (calls.length === 1) { started(); await new Promise<void>(r => { finish = r; }); }
    return fixture(group);
  }, 0);
  const abort = new AbortController();
  const low = loader(db, OVERVIEW_WEATHER_POINTS, date, undefined, abort.signal);
  await running; abort.abort();
  const high = loader(db, [fine], date); finish(); await Promise.all([low, high]);
  strictEqual(calls.length, 2); deepStrictEqual(calls[1], [fine.id], 'detail takes next batch, not old overview queue');
  await loader(db, OVERVIEW_WEATHER_POINTS.slice(0, 25), date); strictEqual(calls.length, 2, 'overview in-flight cache reused after return');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Overview cached load must not fetch detail or overview'); };
  try {
    const result = await loadHeatmapPilot(db, { pointIds: [coarse.id], pointDefinitions: OVERVIEW_WEATHER_POINTS });
    deepStrictEqual(Object.keys(result.weather.cells), [coarse.id], 'actual bundle service uses supplied LOD definitions');
    ok(result.assessments.today.boletusEdulis[coarse.id]);
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS LOD, cache separation, priority handoff, fractions, unchanged scorer and profile/date zero-refetch');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
