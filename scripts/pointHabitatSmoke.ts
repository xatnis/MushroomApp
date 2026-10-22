import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { selectedStripStub } from './shadowUxSourceGuards';
import { withoutKoroskaShadow } from './koroskaShadowSourceGuards';
import { resolvePointHabitat, pointHabitatLabel, type PointHabitatSource } from '../src/domain/pointHabitat';
import type { MushroomWeatherProfileId } from '../src/domain/types';

// Observe the actual first standalone import before any test imports regional geometry.
strictEqual(Object.keys(require.cache).filter(p => /heatmapRegional[\\/]habitat|heatmap[\\/]regional\.ts/.test(p)).length, 0, 'resolver import is geometry-lazy');
let escapedHttp = 0; const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { escapedHttp++; throw Error('Habitat context must not acquire weather or habitat over HTTP'); }) as typeof fetch;
const memoryBefore = process.memoryUsage(), coldStart = performance.now();
const first = resolvePointHabitat(46.47045, 14.85009, 'generic');
const coldMs = performance.now() - coldStart, memoryAfter = process.memoryUsage();
const regional = require('../src/domain/heatmap/regional') as typeof import('../src/domain/heatmap/regional');
const { habitatStateFor, habitatExplanation, HEATMAP_PROFILE_IDS } = require('../src/domain/heatmap/pilot') as typeof import('../src/domain/heatmap/pilot');
const { createHabitatSpatialIndex, containsPoint } = require('../src/domain/heatmap/spatial') as typeof import('../src/domain/heatmap/spatial');
const { sevenDayFixture } = require('./sevenDayFixture') as typeof import('./sevenDayFixture');
const { evaluateSevenDayConditions } = require('../src/domain/sevenDayConditions') as typeof import('../src/domain/sevenDayConditions');
const { withoutPointHabitatUi } = require('./pointMigrationSourceGuards') as typeof import('./pointMigrationSourceGuards');
for (const file of ['src/components/SevenDayConditionsView.tsx','src/components/SevenDayMapForecast.tsx']) {
  strictEqual(withoutPointHabitatUi(readFileSync(file, 'utf8')), execFileSync('git', ['show', `6c54e0a:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'all weather/navigation/view code unchanged outside exact informational additions');
}
strictEqual(first.provenance.cellCount, 10531); strictEqual(first.provenance.landCover.vintage, '2021 v200');
strictEqual(first.provenance.treeComposition.dataVintage, null);
const points: Array<{ latitude: number; longitude: number; profile: MushroomWeatherProfileId; state: string; id: string }> = [];
for (const profile of HEATMAP_PROFILE_IDS) for (const state of ['candidate','unknown','outside-model'] as const) {
  const f = regional.HEATMAP_HABITAT.features.find(f => habitatStateFor(f, profile) === state
    && regional.REGIONAL_INDEX.atPoint([f.properties.centerLongitude, f.properties.centerLatitude])?.properties.id === f.properties.id);
  if (!f) { strictEqual(profile, 'generic'); strictEqual(state, 'unknown', 'only the genuinely unsupported generic unknown fixture is absent'); continue; }
  const p = { latitude: f.properties.centerLatitude, longitude: f.properties.centerLongitude, profile, state, id: f.properties.id }; points.push(p);
  const context = resolvePointHabitat(p.latitude, p.longitude, profile);
  strictEqual(context.state, state); strictEqual(context.cellId, p.id);
  strictEqual(context.explanation, habitatExplanation(profile, state, f.properties.zgs?.zgsAvailable));
  strictEqual(context.zgsAvailable, f.properties.zgs?.zgsAvailable === true);
  strictEqual(context.treeCompositionRetrievedAt, context.zgsAvailable ? p.id.startsWith('area-')
    ? context.provenance.treeComposition.legacyRetrievedAt ?? context.provenance.treeComposition.retrievedAt
    : context.provenance.treeComposition.retrievedAt : undefined);
}
const outside = resolvePointHabitat(0, 0, 'generic'); strictEqual(outside.state, 'outside-coverage'); strictEqual(outside.cellId, undefined);
strictEqual(resolvePointHabitat(NaN, 14, 'generic').reason, 'invalid-coordinate');
const candidate = points.find(p => p.profile === 'generic' && p.state === 'candidate')!;
const unknown = points.find(p => p.state === 'unknown')!;
strictEqual(resolvePointHabitat(unknown.latitude, unknown.longitude, 'generic').state, 'candidate', 'species differences use actual evidence, not cached last profile');
strictEqual(resolvePointHabitat(unknown.latitude, unknown.longitude, unknown.profile).state, 'unknown');
const pointPairs = [candidate, unknown, ...points];
for (let i = 0; i < 100; i++) { const p = pointPairs[i % pointPairs.length]; strictEqual(resolvePointHabitat(p.latitude, p.longitude, p.profile).cellId, p.id); }

// Labelled synthetic polygons exercise the existing canonical half-open boundary/hole convention, not a new GIS rule.
const base = regional.HEATMAP_HABITAT.features[0];
const polygon: typeof base = { ...base, properties: { ...base.properties, id: 'fixture-with-hole' }, geometry: { type: 'Polygon', coordinates: [
  [[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[3,1],[3,3],[1,3],[1,1]],
] } };
const neighbour: typeof base = { ...base, properties: { ...base.properties, id: 'fixture-right' }, geometry: { type: 'Polygon', coordinates: [[[4,0],[8,0],[8,4],[4,4],[4,0]]] } };
const multi: typeof base = { ...base, properties: { ...base.properties, id: 'fixture-multi' }, geometry: { type: 'MultiPolygon', coordinates: [[[[10,0],[12,0],[12,2],[10,2],[10,0]]], [[[14,0],[16,0],[16,2],[14,2],[14,0]]]] } };
const index = createHabitatSpatialIndex([polygon, neighbour, multi]);
const source: PointHabitatSource = { atPoint: p => index.atPoint(p), stateFor: habitatStateFor, explanationFor: habitatExplanation, provenance: first.provenance };
for (const [latitude, longitude, id] of [[.5,.5,'fixture-with-hole'], [2,2,undefined], [0,0,'fixture-with-hole'], [2,4,'fixture-right'], [4,2,undefined], [2,1,undefined], [2,3,'fixture-with-hole'], [1,11,'fixture-multi'], [1,13,undefined], [1,15,'fixture-multi']] as const) {
  const result = resolvePointHabitat(latitude, longitude, 'generic', source);
  strictEqual(result.cellId, id); strictEqual(result.state === 'outside-coverage', id === undefined);
}
ok(!containsPoint(polygon.geometry, [2,2])); // Envelope match is insufficient.
// Persisted weather inputs and seven independent numerical outcomes are byte-identical after all habitat lookups.
const snapshot = sevenDayFixture();
snapshot.latitude = snapshot.today.latitude = unknown.latitude; snapshot.longitude = snapshot.today.longitude = unknown.longitude;
const beforeSnapshot = JSON.stringify(snapshot);
for (const profile of HEATMAP_PROFILE_IDS) {
  const before = evaluateSevenDayConditions(snapshot, profile);
  for (const p of points) resolvePointHabitat(p.latitude, p.longitude, profile);
  deepStrictEqual(evaluateSevenDayConditions(snapshot, profile), before);
}
strictEqual(JSON.stringify(snapshot), beforeSnapshot);
for (const file of ['src/domain/sevenDayConditions.ts','src/domain/mushroomWeather.ts','src/domain/soilSampling.ts','src/domain/weatherIntervals.ts',
  'src/domain/heatmap/regional.ts','src/domain/heatmap/spatial.ts','src/domain/heatmap/pilot.ts','src/domain/heatmap/zgs.ts','src/services/useSevenDayConditions.ts',
  'src/services/pointConditions.ts','src/services/weather.ts','src/screens/MapScreen.tsx','src/experimental/koroskaShadowData.ts','src/data/koroskaShadow/snapshot.json']) {
  const unchanged = (s: string) => file === 'src/screens/MapScreen.tsx' ? withoutKoroskaShadow(s) : s.replace(/\r\n/g, '\n');
  strictEqual(unchanged(readFileSync(file, 'utf8')), unchanged(execFileSync('git', ['show', `6c54e0a:${file}`], { encoding: 'utf8' })), file + ' numerical/data contract unchanged; shadow presentation executed by shadowUxSmoke');
}

// Actual component execution with component-local memo/state, not a replacement presentation model.
const jsx = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const native = { ...Object.fromEntries(['View','Text','Pressable','Modal','ScrollView','ActivityIndicator'].map(t => [t,t])), StyleSheet: { create: (s: any) => s },
  AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => 1, useWindowDimensions: () => ({ width: 360, fontScale: 1 }) };
function compile(file: string, imports: (id: string) => any) {
  const path = resolve(file), here = createRequire(path), Module = here('node:module'), mod = new Module(path);
  mod.filename = path; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  mod.require = (id: string) => id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === 'react-native' ? native : imports(id) ?? here(id);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path);
  return mod.exports;
}
let queries = 0, memo: { deps: any[]; value: any } | undefined, expanded = false;
const child = compile('src/components/PointHabitatContext.tsx', id => id === 'react' ? {
  useState: () => [expanded, (next: any) => expanded = typeof next === 'function' ? next(expanded) : next],
  useMemo: (f: () => any, deps: any[]) => { if (!memo || deps.some((v, i) => v !== memo!.deps[i])) memo = { deps, value: f() }; return memo.value; },
} : id === '../domain/pointHabitat' ? { pointHabitatLabel, resolvePointHabitat: (...args: Parameters<typeof resolvePointHabitat>) => { queries++; return resolvePointHabitat(...args); } } : undefined);
const habitat = (p: any) => child.PointHabitatContext(p);
const expand = (n: any): any => Array.isArray(n) ? n.map(expand) : n?.props ? typeof n.type === 'function' ? expand(n.type(n.props)) : { ...n, props: { ...n.props, children: expand(n.props.children) } } : n;
const p = { latitude: unknown.latitude, longitude: unknown.longitude, profileId: unknown.profile };
let tree = habitat(p); ok(text(tree).includes(pointHabitatLabel('unknown')));
const count = queries; for (let day = 0; day < 7; day++) habitat({ ...p }); strictEqual(queries, count, 'date changes do not redo spatial lookup');
const disclose = walk(tree).find(n => n.type === 'Pressable')!; ok(disclose.props.style.minHeight >= 48); strictEqual(disclose.props.accessibilityState.expanded, false);
disclose.props.onPress(); tree = habitat(p); ok(text(tree).includes('2021 v200')); ok(text(tree).includes('ni čas opazovanja')); ok(text(tree).includes(unknown.id));
strictEqual(walk(tree).find(n => n.type === 'Pressable')!.props.accessibilityState.expanded, true);
for (const point of [...points, { latitude: 0, longitude: 0, profile: 'generic' as const, state: 'outside-coverage' }]) {
  const props = { latitude: point.latitude, longitude: point.longitude, profileId: point.profile };
  ok(text(habitat(props)).includes(pointHabitatLabel(point.state as any)));
  strictEqual(text(habitat({ ...props, compact: true })), pointHabitatLabel(point.state as any));
}
let selectedIndex = 0, weatherLoading = false, calls = 0;
const weather = (profile: MushroomWeatherProfileId) => ({ loading: weatherLoading, snapshot, results: weatherLoading ? undefined : evaluateSevenDayConditions(snapshot, profile), retry() {} });
const imports = (id: string) => id === './useSelectedStrip' ? selectedStripStub : id === 'react' ? { useRef: (initial: any) => ({ current: initial }), useState: (initial: any) => typeof initial === 'boolean' ? [false, () => {}] : [selectedIndex ?? initial, (v: number) => selectedIndex = v] }
  : id === './PointHabitatContext' ? { PointHabitatContext: habitat } : id === 'react-native-safe-area-context' ? { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }
  : id === './ui' ? { Card: 'Card', AppButton: 'AppButton', commonStyles: {} }
  : id === '@expo/vector-icons' ? { Ionicons: 'Icon' }
  : id === '../services/useSevenDayConditions' ? { useSevenDayConditions: (_db: any, location: any, profile: MushroomWeatherProfileId) => { calls++; strictEqual(location.latitude, p.latitude); return weather(profile); } } : undefined;
const full = compile('src/components/SevenDayConditionsView.tsx', imports), compact = compile('src/components/SevenDayMapForecast.tsx', imports);
for (const origin of ['map-point','hotspot','conditions'] as const) for (const profile of HEATMAP_PROFILE_IDS) {
  const location = { latitude: p.latitude, longitude: p.longitude, name: origin === 'hotspot' ? 'PRIVATE_TEST_NAME' : 'Izbrana točka', source: origin };
  const props = { location, database: {}, profileId: profile, onProfileChange() {}, onSnapshot() {} };
  const result = resolvePointHabitat(p.latitude, p.longitude, profile);
  for (selectedIndex = 0; selectedIndex < 7; selectedIndex++) {
    const fullTree = expand(full.SevenDayContent(props));
    const previewTree = expand(compact.SevenDayMapForecastPreview({ ...props, initialDay: selectedIndex, maxHeight: 320, onClose() {}, onFull() {}, onSelectDate() {}, onWeatherGraphs() {} }));
    const score = evaluateSevenDayConditions(snapshot, profile)[selectedIndex].score;
    ok(text(fullTree).includes(`Vremenski pogoji: ${score}/100`)); ok(text(previewTree).includes(`Vremenski pogoji: ${score}/100`));
    ok(text(fullTree).includes(pointHabitatLabel(result.state))); ok(text(previewTree).includes(pointHabitatLabel(result.state)));
  }
  const safeResult = JSON.stringify(result); ok(!safeResult.includes(location.name)); ok(!('latitude' in result)); ok(!('longitude' in result));
}
weatherLoading = true; const loading = expand(full.SevenDayContent({ location: { ...p, name: 'Novo mesto' }, profileId: p.profileId, database: {}, onProfileChange() {}, onSnapshot() {} }));
ok(text(loading).includes('Preračunavam')); ok(text(loading).includes(pointHabitatLabel('unknown')));
ok(!text(loading).includes('0/100'));
strictEqual(escapedHttp, 0); globalThis.fetch = originalFetch;
const start = performance.now(); for (let i = 0; i < 1000; i++) { const point = points[i % points.length]; resolvePointHabitat(point.latitude, point.longitude, point.profile); }
const thousandWarmLookupsMs = performance.now() - start;
const spreadStart = performance.now();
for (let i = 0; i < 1000; i++) {
  const f = regional.HEATMAP_HABITAT.features[Math.floor(i * regional.HEATMAP_HABITAT.features.length / 1000)];
  resolvePointHabitat(f.properties.centerLatitude, f.properties.centerLongitude, HEATMAP_PROFILE_IDS[i % 4]);
}
console.log(JSON.stringify({ evidence: 'Windows/Node not Android', cells: first.provenance.cellCount, firstStandaloneLookupIncludingImportsMs: coldMs,
  thousandWarmLookupsMs, thousandSpatiallySpreadLookupsMs: performance.now() - spreadStart, standaloneHeapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
  standaloneRssDeltaBytes: memoryAfter.rss - memoryBefore.rss, noNewDatasetCopies: true, componentQueries: queries, weatherHookRenders: calls, http: escapedHttp }));
console.log('PASS real regional candidate/unknown/outside/coverage, canonical borders/holes/multipolygons, exact coordinate/profile memo, full/compact 3 origins x 4 profiles x 7 dates, unchanged numeric scores/snapshot/source bytes, provenance and no private export. Native QA separate.');
