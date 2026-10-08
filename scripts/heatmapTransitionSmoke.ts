import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { selectHeatmapLod, OVERVIEW_FEATURES, type HeatmapLod } from '../src/domain/heatmap/lod';
import { REGIONAL_INDEX, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { HEATMAP_VISUAL, createHeatmapVisualCache, heatmapSourceReady, heatmapRenderProbes,
  heatmapInteractionLod, createHeatmapRenderConfirmation, requestHeatmapHandoff, finishHeatmapHandoff,
  heatmapLayerVisible, type HeatmapHandoff, type HeatmapRenderProbe } from '../src/domain/heatmap/visual';
import { localDateFor } from '../src/domain/heatmap/assessment';

const map = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const hook = readFileSync('src/services/heatmap/useHeatmapVisuals.ts', 'utf8');
const queryCode = hook.slice(hook.indexOf('query: async'), hook.indexOf('nextFrame:'));
ok(!queryCode.includes('filter:'), 'viewport query must not restrict confirmation to three IDs');
ok(queryCode.includes('queryRenderedFeatures({'), 'options-only overload queries whole native viewport, not center point');
ok(/onRegionIsChanging=\{\(event\) => \{[^}]*observeCameraZoom\(event.nativeEvent.zoom, event.nativeEvent.bounds\)/.test(map), 'camera zoom observation remains wired during gestures alongside UI-focus cancellation');
ok(map.includes('onDidFinishRenderingFrame={visual.onFullyRendered}'), 'incoming geometry must not wait for unrelated basemap downloads');
ok(map.includes('afterId="regional-overview-border"'), 'detail explicitly above outgoing overview');
ok(map.includes("onPress={visual.interactionLod === 'overview'"));
ok(map.includes("onPress={visual.interactionLod === 'detail'"));
strictEqual(HEATMAP_VISUAL.viewportDelayMs, 60);
ok(!hook.includes('a.score !== null'), 'geometry handoff cannot wait for weather');

const date = localDateFor();
const features = REGIONAL_INDEX.visible([14.75, 46.37, 14.95, 46.57], undefined, 0);
const cache = createHeatmapVisualCache();
const noWeather = cache.prepare('detail', features, {}, 'boletusEdulis', 'today', date);
ok(heatmapSourceReady(noWeather, features, 'boletusEdulis', 'today', date), 'prepared neutral geometry owns detail without a weather score');
ok(!heatmapSourceReady(undefined, features, 'boletusEdulis', 'today', date));
ok(!heatmapSourceReady(noWeather, features, 'lactariusDeliciosus', 'today', date), 'old profile source is not ready');
ok(!heatmapSourceReady(noWeather, features, 'boletusEdulis', 'tomorrow', date), 'old day source is not ready');
ok(!heatmapSourceReady(noWeather, features, 'boletusEdulis', 'today', '2000-01-01'), 'old snapshot revision is not ready');
ok(!heatmapSourceReady(noWeather, undefined, 'boletusEdulis', 'today', date), 'pending viewport is not empty viewport');
const empty = cache.prepare('detail', [], {}, 'boletusEdulis', 'today', date);
ok(heatmapSourceReady(empty, [], 'boletusEdulis', 'today', date), 'intentional zero geometry is ready');
ok(!heatmapSourceReady(empty, [], 'generic', 'today', date), 'even an empty source must be submitted for the current selection');
const probes = heatmapRenderProbes(noWeather, new Set(features.map(f => f.properties.id)), 'detail');
strictEqual(probes.length, features.length);
ok(probes.every(p => p.score < 0), 'missing weather remains no-score, never fake 0');
deepStrictEqual(noWeather.collection, buildHeatmapRenderCollection({}, features, 'boletusEdulis', 'today').collection);
ok(OVERVIEW_FEATURES.length > 0);
strictEqual(heatmapInteractionLod('detail', false), undefined, 'outgoing overview cannot own detail taps while preparing');
strictEqual(heatmapInteractionLod('detail', true), 'detail');
strictEqual(heatmapInteractionLod('overview', true), 'overview');

async function run() {
  let state: HeatmapHandoff = { displayed: 'overview' }, target: HeatmapLod = 'overview';
  const rafs = new Set<() => void>();
  type Result = Array<{ properties: Record<string, unknown> }>;
  const replies: Array<(result: Result) => void> = [];
  let queries = 0, commits = 0;
  const confirmation = createHeatmapRenderConfirmation({
    query: async () => { queries++; return new Promise(resolve => replies.push(resolve)); },
    nextFrame: cb => { rafs.add(cb); return () => { rafs.delete(cb); }; },
    commit: lod => { strictEqual(target, lod); commits++; state = finishHeatmapHandoff(state, lod); },
  });
  const nonblank = () => ok(heatmapLayerVisible(state, 'overview') || heatmapLayerVisible(state, 'detail'));
  const flushRaf = () => { for (const cb of rafs) { rafs.delete(cb); cb(); nonblank(); } };
  const cross = (zoom: number, expected: HeatmapRenderProbe[] = probes) => {
    target = selectHeatmapLod(zoom, target);
    state = requestHeatmapHandoff(state, target, true);
    if (state.incoming) confirmation.arm(state.incoming, expected); else confirmation.cancel();
    nonblank();
  };

  // Slow zoom: target changes at threshold, independent of the camera-idle event.
  cross(8.4); cross(8.7); cross(8.9); cross(9.0); strictEqual(target, 'overview'); cross(9.2);
  strictEqual(target, 'detail'); strictEqual(state.displayed, 'overview'); strictEqual(state.incoming, 'detail');
  const firstFrame = confirmation.onFullFrame();
  // Center is a habitat hole / earlier render is empty, but a later frame exists.
  await confirmation.onFullFrame(); strictEqual(queries, 1);
  replies.shift()!([]); await firstFrame;
  strictEqual(queries, 2, 'frame received during query is replayed, not lost forever');
  // Choose an ID NOT among the old first/middle/last sample; full-viewport query can find it.
  const elsewhere = probes[1];
  ok(elsewhere && elsewhere.id !== probes[0].id && elsewhere.id !== probes[Math.floor(probes.length / 2)].id);
  replies.shift()!([{ properties: { ...elsewhere } }]); await Promise.resolve(); await Promise.resolve();
  strictEqual(rafs.size, 1); ok(heatmapLayerVisible(state, 'overview'));
  flushRaf(); strictEqual(state.displayed, 'detail'); strictEqual(state.incoming, undefined);
  cross(9.7); cross(10.2); strictEqual(state.displayed, 'detail', 'no repeated settled-step transition');
  strictEqual(commits, 1); nonblank();

  // Zero expected geometry needs a post-submission native frame, NOT a >0 query.
  cross(8.4);
  const overviewFrame = confirmation.onFullFrame(); replies.shift()!([{ properties: { ...probes[0] } }]);
  await overviewFrame; flushRaf(); strictEqual(state.displayed, 'overview');
  cross(9.7, []); const beforeZero = queries;
  await confirmation.onFullFrame(); strictEqual(queries, beforeZero); nonblank();
  flushRaf(); strictEqual(state.displayed, 'detail', 'legitimate no-data cannot keep overview forever');

  // Rapid zoom with a pending old query. New generation can confirm independently.
  cross(8.4); const old = confirmation.onFullFrame();
  cross(9.7); cross(10.2); cross(9.4); cross(9.8); cross(10.5);
  strictEqual(target, 'detail'); strictEqual(state.displayed, 'detail');
  replies.shift()!([{ properties: { ...probes[0] } }]); await old;
  strictEqual(rafs.size, 0); nonblank();

  // Explicit superseded source generation while still waiting for detail.
  state = { displayed: 'overview' }; target = 'overview'; cross(9.7);
  const stale = confirmation.onFullFrame(); cross(10.2);
  const current = confirmation.onFullFrame(); strictEqual(replies.length, 2);
  replies.shift()!([{ properties: { ...probes[0] } }]); await stale; strictEqual(rafs.size, 0);
  replies.shift()!([{ properties: { ...elsewhere } }]); await current;
  flushRaf(); strictEqual(state.displayed, 'detail');
  for (let i = 0; i < 5; i++) { await confirmation.onFullFrame(); nonblank(); }
  strictEqual(state.incoming, undefined, 'no infinite confirmation transition across settled frames');
  confirmation.cancel();
  // Last native frame preceded JS settlement; identical data need not trigger another frame.
  state = { displayed: 'overview' }; target = 'overview'; cross(9.7);
  const postCommitProbe = confirmation.verifyRenderedLayer();
  replies.shift()!([{ properties: { ...elsewhere } }]); await postCommitProbe;
  flushRaf(); strictEqual(state.displayed, 'detail', 'proactive rendered-layer query cannot wait for a nonexistent callback');
  state = { displayed: 'overview' }; target = 'overview'; cross(9.7, []);
  await confirmation.verifyRenderedLayer(); strictEqual(rafs.size, 0, 'RAF alone does not certify empty source submission');
  await confirmation.onFullFrame(); flushRaf(); strictEqual(state.displayed, 'detail');
  confirmation.cancel();
  console.log('PASS: threshold during gesture, slow/rapid zoom, full viewport/hole, queued frame replay, stale generation, zero features, layer order, taps, no empty handoff, no stuck logical transition. Native GPU timing still requires device verification.');
}
const testDeadline = setTimeout(() => { console.error('Transition test did not complete'); process.exitCode = 1; }, 5000);
void run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(testDeadline));
