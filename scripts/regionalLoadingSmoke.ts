import { loadHeatmapPilot, mergeHeatmapBundles, weatherAssessmentsFor } from '../src/services/heatmap/pilotHeatmap';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createRegionalWeatherLoader, regionalWeatherKey } from '../src/services/heatmap/regionalWeather';
import { REGIONAL_INDEX, isRegionalPoint, HEATMAP_PILOT_METADATA, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { viewportWeatherPointIds, heatmapViewportStatus, intersectsBounds, type Bounds } from '../src/domain/heatmap/spatial';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import { HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import { getHeatmapWeatherBatch, searchLocations, shiftLocalDate } from '../src/services/weather';
import type { HeatmapWeatherBatch, HeatmapWeatherCellDefinition } from '../src/domain/heatmap/types';

const rows = new Map<string, { payload: string; fetchedAt?: string; expiresAt?: string }>();
const db = { getFirstAsync: async (_: string, key: string) => rows.get(key) ?? null,
  runAsync: async (_: string, key: string, payload: string, fetchedAt?: string, expiresAt?: string) => { rows.set(key, { payload, fetchedAt, expiresAt }); },
} as unknown as SQLiteDatabase;
const date = localDateFor();
const points = HEATMAP_PILOT_METADATA.weatherCells;
const batch = (group: HeatmapWeatherCellDefinition[]): HeatmapWeatherBatch => ({
  policyVersion: 'fixture', baseLocalDate: date, fetchedAt: new Date().toISOString(), stale: false, coldRequestCount: 2,
  cells: Object.fromEntries(group.map(p => [p.id, { ...p, baseLocalDate: date, fetchedAt: new Date().toISOString(), stale: false, errors: {},
    days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast', precipitationMm: 2, temperatureMeanC: 14, evapotranspirationMm: 1 })),
    currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
    tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  }])),
});
async function tests() {
  let calls = 0;
  const requested: string[] = [];
  const loader = createRegionalWeatherLoader(async (_db, group) => {
    calls++; requested.push(...group.map(p => p.id)); await new Promise(resolve => setTimeout(resolve, 5)); return batch(group);
  }, 0);
  const [a, b] = await Promise.all([loader(db, points.slice(0, 5), date), loader(db, points.slice(3, 8), date)]);
  strictEqual(new Set(requested).size, requested.length, 'overlapping in-flight points fetched once');
  strictEqual(requested.length, 8);
  deepStrictEqual(a.cells[points[3].id], b.cells[points[3].id]);
  await loader(db, points.slice(0, 5), date); strictEqual(calls, 2, 'pan back cache');
  await loader(db, points.slice(5, 10), date); strictEqual(requested.length, 10, 'pan only missing');
  for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
    const source = a.cells[points[0].id];
    const actual = assessHeatmapWeather(source, profile, day), expected = assessHeatmapWeather(batch([points[0]]).cells[points[0].id], profile, day);
    deepStrictEqual(actual.score, expected.score, 'same inputs keep scores/components');
    strictEqual(actual.dataQuality, expected.dataQuality);
  }
  strictEqual(calls, 3, 'species/date pure evaluation never fetches');
  let diskCalls = 0;
  const reloaded = createRegionalWeatherLoader(async (_db, group) => { diskCalls++; return batch(group); }, 0);
  await reloaded(db, points.slice(0, 10), date); strictEqual(diskCalls, 0, 'SQLite reuse after service restart');
  rows.clear();
  let fail = true, attempts = 0;
  const partial = createRegionalWeatherLoader(async (_db, group) => {
    attempts++; if (fail && group[0].id === points[0].id) throw new Error('timeout'); return batch(group);
  }, 0);
  const progress: number[] = [];
  const result = await partial(db, points.slice(0, 30), date, value => progress.push(Object.keys(value.cells).length));
  strictEqual(Object.values(result.cells).filter(c => c.errors.forecast).length, 25);
  ok(progress.includes(25), 'first batch published before all points finish');
  fail = false;
  const retry = await partial(db, points.slice(0, 30), date);
  strictEqual(attempts, 3, 'retry only failed batch; pending promises removed');
  ok(Object.values(retry.cells).every(c => !c.errors.forecast));
  const border: Bounds = [14.75, 46.45, 15.05, 46.85];
  ok(!isRegionalPoint([14.9, 46.65]), 'test viewport center is in Austria');
  const visible = REGIONAL_INDEX.visible(border, undefined, 0);
  const buffered = REGIONAL_INDEX.visible(border);
  ok(visible.length > 0); ok(buffered.length >= visible.length);
  ok(viewportWeatherPointIds(buffered).length < 126);
  strictEqual(heatmapViewportStatus(true, true, true, false), 'loading');
  strictEqual(heatmapViewportStatus(true, true, false, false), 'ready');
  strictEqual(heatmapViewportStatus(true, false, true, false), 'out-of-coverage');
  strictEqual(heatmapViewportStatus(true, true, false, true), 'error');
  strictEqual(REGIONAL_INDEX.visible([0, 0, 1, 1]).length, 0);
  const staticView = buildHeatmapRenderCollection({}, visible, 'boletusEdulis', 'tomorrow');
  strictEqual(staticView.collection.features.length, visible.length);
  ok(Object.values(staticView.assessments).every(a => a.score === null && a.dataQuality === 'insufficient'));
  const hole = { type: 'Polygon' as const, coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
  ] };
  strictEqual(intersectsBounds(hole, [1.2, 1.2, 1.8, 1.8]), false, 'envelope/hole is not coverage');
  strictEqual(intersectsBounds(hole, [-1, 1.1, 5, 1.2]), true, 'polygon crosses viewport');
  strictEqual(intersectsBounds({ type: 'Polygon', coordinates: [[[0, 0], [3, 0], [0, 3], [0, 0]]] }, [2, 2, 3, 3]), false);
  strictEqual(REGIONAL_INDEX.visible([14.8, 46.72, 15, 46.8], undefined, 0).length, 0, 'Austria has no prepared cells');
  for (const covered of [true, false]) for (const loading of [true, false]) for (const failed of [true, false]) {
    const status = heatmapViewportStatus(true, covered, loading, failed);
    strictEqual(['loading', 'ready', 'error', 'out-of-coverage'].filter(value => value === status).length, 1);
    if (!covered) strictEqual(status, 'out-of-coverage');
  }
  rows.clear();
  rows.set(regionalWeatherKey(points.slice(0, 25), date), { payload: JSON.stringify(batch(points.slice(0, 25))) });
  let migratedFetches = 0;
  await createRegionalWeatherLoader(async (_db, group) => { migratedFetches++; return batch(group); }, 0)(db, points.slice(0, 3), date);
  strictEqual(migratedFetches, 0, 'existing grouped cache preserved on upgrade');
  rows.clear();
  let expiredFetches = 0;
  const expired = batch([points[0]]).cells[points[0].id]; expired.fetchedAt = new Date(Date.now() - 31 * 60000).toISOString();
  rows.set(regionalWeatherKey([points[0]], date), { payload: JSON.stringify(expired) });
  await createRegionalWeatherLoader(async (_db, group) => { expiredFetches++; return batch(group); }, 0)(db, [points[0]], date);
  strictEqual(expiredFetches, 1, 'expired disk cache refreshes');
  rows.clear();
  let finishSecond!: () => void;
  let secondStarted!: () => void;
  const startedSecond = new Promise<void>(resolve => { secondStarted = resolve; });
  const delayed = createRegionalWeatherLoader(async (_db, group) => {
    if (group[0].id === points[25].id) { secondStarted(); await new Promise<void>(resolve => { finishSecond = resolve; }); }
    return batch(group);
  }, 0);
  const owner = delayed(db, points.slice(0, 30), date);
  let joinedProgress = 0;
  const joiner = delayed(db, [points[0], points[25]], date, value => { joinedProgress = Object.keys(value.cells).length; });
  await startedSecond; await Promise.resolve(); await Promise.resolve();
  strictEqual(joinedProgress, 1, 'joined requests receive useful progress before the slow batch finishes');
  finishSecond(); await Promise.all([owner, joiner]);
  rows.clear();
  const townPoints = (x: number, y: number) => {
    const ids = new Set(viewportWeatherPointIds(REGIONAL_INDEX.visible([x - .1, y - .1, x + .1, y + .1])));
    return points.filter(p => ids.has(p.id));
  };
  const velenje = townPoints(15.11277, 46.35719), celje = townPoints(15.26044, 46.23092);
  const panRequests: string[][] = [];
  const pan = createRegionalWeatherLoader(async (_db, group) => { panRequests.push(group.map(p => p.id)); return batch(group); }, 0);
  const first = await pan(db, velenje, date); await pan(db, celje, date); await pan(db, velenje, date);
  strictEqual(panRequests.length, 2, 'Velenje / Celje / Velenje only two batches');
  deepStrictEqual(panRequests[1].sort(), celje.filter(p => !velenje.some(v => v.id === p.id)).map(p => p.id).sort());
  for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
    const weather = Object.fromEntries(Object.values(first.cells).map(c => [c.id, assessHeatmapWeather(c, profile, day)]));
    const features = REGIONAL_INDEX.visible([15.01, 46.26, 15.21, 46.46]);
    const view = buildHeatmapRenderCollection(weather, features, profile, day);
    for (const feature of features) if (weather[feature.properties.weatherCellId]) {
      deepStrictEqual(view.assessments[feature.properties.id].scoreDetails, weather[feature.properties.weatherCellId].score);
    }
  }
  strictEqual(panRequests.length, 2, 'all species/dates remain local computations');
  console.log('PAN fixture', { velenjePoints: velenje.length, celjePoints: celje.length, newCeljePoints: panRequests[1].length, httpRequestsByStep: [2, 2, 0, 0, 0] });
  rows.clear();
  for (const p of points.slice(0, 3)) rows.set(regionalWeatherKey([p], date), { payload: JSON.stringify(batch([p]).cells[p.id]) });
  const originalFetch = globalThis.fetch;
  let unexpectedFetches = 0;
  globalThis.fetch = async () => { unexpectedFetches++; throw new Error('Cache-backed service must not fetch'); };
  try {
    const initial = await loadHeatmapPilot(db, { pointIds: points.slice(0, 2).map(p => p.id) });
    const next = await loadHeatmapPilot(db, { pointIds: points.slice(1, 3).map(p => p.id) });
    const merged = mergeHeatmapBundles(initial, next);
    strictEqual(Object.keys(merged.weather.cells).length, 3, 'pan preserves useful cells');
    const emptyProgress = await loadHeatmapPilot(db, { pointIds: [] });
    deepStrictEqual(mergeHeatmapBundles(merged, emptyProgress).weather.cells, merged.weather.cells, 'initial progress does not erase ready cells');
    for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
      deepStrictEqual(weatherAssessmentsFor(merged, profile, day)[points[0].id], assessHeatmapWeather(initial.weather.cells[points[0].id], profile, day));
    }
    strictEqual(unexpectedFetches, 0, 'actual bundle/service/cache species-date path has zero requests');
  } finally { globalThis.fetch = originalFetch; }
  rows.clear();
  let aborts = 0;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true });
  });
  try {
    const timed = createRegionalWeatherLoader((database, group, localDate) => getHeatmapWeatherBatch(database, group, localDate, { requestTimeoutMs: 5 }), 0);
    const failed = await timed(db, [points[0]], date);
    strictEqual(aborts, 2, 'archive and forecast both abort on timeout');
    ok(failed.cells[points[0].id].errors.historical && failed.cells[points[0].id].errors.forecast);
  } finally { globalThis.fetch = originalFetch; }
  const brokenDisk = { getFirstAsync: async () => { throw new Error('disk read'); }, runAsync: async () => { throw new Error('disk write'); } } as unknown as SQLiteDatabase;
  const recovered = await createRegionalWeatherLoader(async (_db, group) => batch(group), 0)(brokenDisk, [points[0]], date);
  strictEqual(recovered.cells[points[0].id].days.length, 62, 'disk failure preserves usable weather');
  console.log('PASS: viewport/buffer/border, static habitat, cache/dedupe, partial failure/retry, pan, species/date, exclusive UI states');
}

async function benchmark(live: boolean) {
  // Reproducible phone-sized local window: ~15 km east/west × 22 km north/south, plus 20% overscan.
  for (const name of ['Črna na Koroškem', 'Velenje', 'Maribor', 'Celje']) {
    const place = (await searchLocations(name)).find(p => p.country === 'Slovenija' || p.country === 'Slovenia');
    if (!place) throw new Error('Geocoder missing ' + name);
    const bounds: Bounds = [place.longitude - .1, place.latitude - .1, place.longitude + .1, place.latitude + .1];
    const visible = REGIONAL_INDEX.visible(bounds, undefined, 0), buffered = REGIONAL_INDEX.visible(bounds);
    const ids = new Set(viewportWeatherPointIds(buffered));
    rows.clear(); let firstMs: number | null = null;
    const loader = createRegionalWeatherLoader(live ? getHeatmapWeatherBatch : async (_db, group) => batch(group), 15000);
    let httpRequests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => { httpRequests++; return originalFetch(...args); };
    const start = performance.now();
    const weather = await loader(db, points.filter(p => ids.has(p.id)), date, value => {
      if (firstMs == null) {
        const assessments = Object.fromEntries(Object.values(value.cells).map(c => [c.id, assessHeatmapWeather(c, 'boletusEdulis', 'today')]));
        const view = buildHeatmapRenderCollection(assessments, visible, 'boletusEdulis', 'today');
        if (Object.values(view.assessments).some(a => a.habitatState === 'candidate' && a.score !== null)) firstMs = performance.now() - start;
      }
    });
    const completeMs = performance.now() - start;
    const coldHttpRequests = httpRequests;
    const cachedStart = performance.now(); const cached = await loader(db, points.filter(p => ids.has(p.id)), date);
    console.log(JSON.stringify({ name, live, date, bounds, visibleCells: visible.length, bufferedCells: buffered.length, points: ids.size,
      requests: coldHttpRequests, plannedRequests: weather.coldRequestCount, firstMs, completeMs, cachedMs: performance.now() - cachedStart, cachedRequests: httpRequests - coldHttpRequests,
      failed: Object.values(weather.cells).filter(c => c.errors.historical || c.errors.forecast).length }));
    globalThis.fetch = originalFetch;
    if (live) await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
async function livePan() {
  rows.clear();
  const loader = createRegionalWeatherLoader();
  const originalFetch = globalThis.fetch;
  let httpRequests = 0;
  globalThis.fetch = async (...args) => { httpRequests++; return originalFetch(...args); };
  let latest: HeatmapWeatherBatch | undefined;
  try {
    for (const [name, x, y] of [['Velenje', 15.11277, 46.35719], ['Celje', 15.26044, 46.23092], ['Velenje return', 15.11277, 46.35719]] as const) {
      const features = REGIONAL_INDEX.visible([x - .1, y - .1, x + .1, y + .1]);
      const ids = new Set(viewportWeatherPointIds(features));
      const start = performance.now(), before = httpRequests;
      let firstMs: number | undefined;
      latest = await loader(db, points.filter(p => ids.has(p.id)), date, progress => {
        if (firstMs == null && Object.values(progress.cells).some(c => c.days.length >= 60 && !c.errors.historical && !c.errors.forecast)) firstMs = performance.now() - start;
      });
      console.log(JSON.stringify({ name, requiredPoints: ids.size, requests: httpRequests - before, firstMs, completeMs: performance.now() - start,
        failedPoints: Object.values(latest.cells).filter(c => c.errors.historical || c.errors.forecast).length }));
    }
    const before = httpRequests;
    for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
      for (const cell of Object.values(latest!.cells)) assessHeatmapWeather(cell, profile, day);
    }
    console.log(JSON.stringify({ speciesAndDateRequests: httpRequests - before }));
  } finally { globalThis.fetch = originalFetch; }
}
void (process.argv.includes('--live-pan') ? livePan() : process.argv.includes('--live') ? benchmark(true) : tests()).catch(error => { console.error(error); process.exitCode = 1; });
