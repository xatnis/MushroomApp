import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { REGIONAL_INDEX } from '../src/domain/heatmap/regional';
import { viewportWeatherPointIds, type Bounds } from '../src/domain/heatmap/spatial';
import { HEATMAP_LOD, selectHeatmapLod, type HeatmapLod } from '../src/domain/heatmap/lod';
import { HEATMAP_VISUAL, shouldPrewarmHeatmapDetail, createHeatmapVisualCache, heatmapSourceReady,
  requestHeatmapHandoff, finishHeatmapHandoff, heatmapLayerVisible, type HeatmapHandoff } from '../src/domain/heatmap/visual';

strictEqual(HEATMAP_LOD.detailEnterZoom, 9.2, 'measured compromise: 9.0 needs up to 70 buffered weather points');
strictEqual(HEATMAP_LOD.overviewEnterZoom, 8.5);
strictEqual(HEATMAP_VISUAL.detailPrewarmZoom, 8.8);
strictEqual(HEATMAP_VISUAL.viewportDelayMs, 60);
strictEqual(shouldPrewarmHeatmapDetail('overview', 8.7), false);
strictEqual(shouldPrewarmHeatmapDetail('overview', 8.8), true);
strictEqual(shouldPrewarmHeatmapDetail('detail', 8.8), false);
strictEqual(shouldPrewarmHeatmapDetail('overview', NaN), false);

for (const [sequence, expected] of [
  [[8, 8.4, 8.7, 8.8, 8.9, 9, 9.2, 9.5], ['overview', 'overview', 'overview', 'overview', 'overview', 'overview', 'detail', 'detail']],
  [[9.3, 9, 8.8, 8.6, 8.5, 8.3], ['detail', 'detail', 'detail', 'detail', 'overview', 'overview']],
  [[8.4, 8.8, 9.1, 8.7, 9.2, 8.4, 9.3], ['overview', 'overview', 'overview', 'overview', 'detail', 'overview', 'detail']],
] as Array<[number[], HeatmapLod[]]>) {
  let target: HeatmapLod = 'overview', state: HeatmapHandoff = { displayed: 'overview' };
  sequence.forEach((zoom, i) => {
    target = selectHeatmapLod(zoom, target);
    strictEqual(target, expected[i]);
    // Prewarm does not change logical ownership; ready geometry begins overlap.
    shouldPrewarmHeatmapDetail(target, zoom); strictEqual(target, expected[i]);
    state = requestHeatmapHandoff(state, target, false);
    ok(heatmapLayerVisible(state, 'overview') || heatmapLayerVisible(state, 'detail'));
    state = requestHeatmapHandoff(state, target, true);
    ok(heatmapLayerVisible(state, state.displayed), 'outgoing stays until confirmation');
    state = finishHeatmapHandoff(state, target);
    strictEqual(state.displayed, target, 'ready handoff cannot leave overview stuck');
  });
}

// Cached-only preparation must not invoke the loader or use an older settled
// zoomed-out viewport during a gesture. Normal weather generation is unchanged.
const hook = readFileSync('src/services/heatmap/useHeatmapVisuals.ts', 'utf8');
const screen = readFileSync('src/screens/MapScreen.tsx', 'utf8');
ok(hook.includes('const detailBounds = moving ? prewarmBounds : visualBounds'));
ok(hook.includes('bounds && bounds === visualBounds'));
ok(hook.includes('enabled && !moving && incomingSelectionReady'), 'native confirmation still requires the current settled generation');
ok(!hook.includes('loadHeatmapPilot(') && !hook.includes('getRegionalWeather('), 'prewarm has zero weather network side effects');
ok(screen.includes('setDetailPrewarmBounds([...gestureBounds] as Bounds)'));
ok(screen.includes('!prewarmBand.current'), 'at most one prewarm snapshot per gesture, not one per camera event');
const weatherEffect = screen.slice(screen.indexOf('scheduleSettledHeatmapLoad('), screen.indexOf('scheduleSettledHeatmapLoad(') + 3500);
ok(!weatherEffect.includes('detailPrewarmBounds'), 'visual-only prewarm is not a network dependency');
const warmCache = createHeatmapVisualCache();
const firstCells = REGIONAL_INDEX.visible([14.75, 46.37, 14.95, 46.57]);
const currentCells = REGIONAL_INDEX.visible([15.16, 46.13, 15.36, 46.33]);
const previous = warmCache.prepare('detail', firstCells, {}, 'boletusEdulis', 'today', '2026-10-03');
const current = warmCache.prepare('detail', currentCells, {}, 'boletusEdulis', 'today', '2026-10-03');
ok(!heatmapSourceReady(previous, currentCells, 'boletusEdulis', 'today', '2026-10-03'), 'superseded prewarm cannot certify current generation');
ok(heatmapSourceReady(current, currentCells, 'boletusEdulis', 'today', '2026-10-03'));
const builds = warmCache.builds;
for (let i = 0; i < 10; i++) strictEqual(warmCache.prepare('detail', currentCells, {}, 'boletusEdulis', 'today', '2026-10-03'), current);
strictEqual(warmCache.builds, builds, 'same prepared cell set does not rebuild on rapid camera/UI events');
console.log('PASS: earlier measured thresholds, prewarm band, slow zoom, zoom-out, rapid zoom, cached-only prewarm, stale source identity, no empty/stuck handoff. Native GPU timing needs physical verification.');

// MapLibre's 512-logical-point Web Mercator world, north-up / zero pitch.
// This is a reproducible camera-size simulation, not native Android frame timing.
function cameraBounds(lon: number, lat: number, zoom: number, width = 400, height = 650): Bounds {
  const world = 512 * 2 ** zoom, radians = lat * Math.PI / 180;
  const x = (lon + 180) / 360, y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  const latitude = (position: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * position))) * 180 / Math.PI;
  return [(x - width / world / 2) * 360 - 180, latitude(y + height / world / 2),
    (x + width / world / 2) * 360 - 180, latitude(y - height / world / 2)];
}

for (const [name, lon, lat, width, height] of [
  ['Crna', 14.850090, 46.470450, 400, 650],
  ['Celje', 15.26044, 46.23092, 400, 650],
  ['Crna large screen', 14.850090, 46.470450, 520, 800],
] as Array<[string, number, number, number, number]>) {
  for (const zoom of [8.5, 8.7, 9.0, 9.1, 9.2, 9.5]) {
    const bounds = cameraBounds(lon, lat, zoom, width, height), start = performance.now();
    const visible = REGIONAL_INDEX.visible(bounds, undefined, 0), buffered = REGIONAL_INDEX.visible(bounds);
    const filterMs = performance.now() - start;
    const points = viewportWeatherPointIds(buffered);
    const cache = createHeatmapVisualCache(), preparedAt = performance.now();
    // Worst-case cold visual cache, empty weather: static habitat must still render.
    const view = cache.prepare('detail', buffered, {}, 'boletusEdulis', 'today', '2026-10-03');
    const prepareMs = performance.now() - preparedAt, cachedAt = performance.now();
    strictEqual(cache.prepare('detail', buffered, {}, 'boletusEdulis', 'today', '2026-10-03'), view);
    const hitMs = performance.now() - cachedAt;
    ok(cache.lastTiming.cacheHit); strictEqual(cache.builds, 1);
    const repeated: number[] = [];
    for (let i = 0; i < 5; i++) {
      const freshCache = createHeatmapVisualCache(), at = performance.now();
      freshCache.prepare('detail', buffered, {}, 'boletusEdulis', 'today', '2026-10-03');
      repeated.push(performance.now() - at);
    }
    repeated.sort((a, b) => a - b);
    console.log(JSON.stringify({ name, size: `${width}x${height}`, zoom, visible: visible.length,
      buffered: buffered.length, weatherPoints: points.length, filterMs: +filterMs.toFixed(2),
      prepareMs: +prepareMs.toFixed(2), prepareMedianMs: +repeated[2].toFixed(2),
      hitMs: +hitMs.toFixed(2), sourceKiB: +(view.serialized.length / 1024).toFixed(1) }));
  }
}
