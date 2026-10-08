import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { sortHotspots } from '../src/domain/hotspotRanking';
import { topThreeHotspots } from '../src/domain/hotspotTopThree';
import { heatmapControlsReducer, INITIAL_HEATMAP_CONTROLS, heatmapControlsPanelVisible, hotspotPopupVisible } from '../src/domain/heatmap/controlsState';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { Hotspot } from '../src/domain/types';

const hotspots = Array.from({ length: 9 }, (_, i) => ({ id: `h${i}`, title: i === 0 ? 'Dolgo ime zasebnega rastišča pri Črni na Koroškem' : `Rastišče ${i}`,
  latitude: 46.47, longitude: 14.85, profileId: 'local:device', locationSource: 'manual', locationSharing: 'private', syncState: 'local', createdAt: '', updatedAt: '' })) as Hotspot[];
let assessments: Record<string, any> = { h0: { score: 82, classLabel: 'Zelo dobre razmere' }, h1: { score: 90, classLabel: 'Odlične razmere' },
  h2: { score: 90, classLabel: 'Odlične razmere' }, h3: { score: 0, classLabel: 'Slabe razmere' }, h4: { score: null }, h5: { score: NaN } };
deepStrictEqual(topThreeHotspots(hotspots, assessments, false), [], 'partial scores never presented as final');
deepStrictEqual(topThreeHotspots(hotspots, assessments, true).map(h => h.id), ['h1', 'h2', 'h0']);
deepStrictEqual(topThreeHotspots(hotspots, assessments, true), sortHotspots(hotspots, assessments, 'conditions').slice(0, 3), 'same comparator/ties as list');
for (const count of [0, 1, 2, 3]) strictEqual(topThreeHotspots(hotspots, Object.fromEntries(hotspots.slice(0, count).map(h => [h.id, { score: 70 }])), true).length, count);
deepStrictEqual(topThreeHotspots([], assessments, true), []);

// Execute the ACTUAL panel, including its shared grouped hook call and row callbacks.
const element = (type: any, props: any) => ({ type, props });
let complete = false, calls: any[][] = [], closeCount = 0, selected: Hotspot | undefined, retries = 0;
const req = createRequire(__filename), Module = req('node:module').Module;
const filename = resolve('src/components/HotspotTopThree.tsx'), mod = new Module(filename);
mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/components'));
const original = mod.require.bind(mod);
mod.require = (id: string) => {
  if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
  if (id === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'ActivityIndicator'].map(s => [s, s])), StyleSheet: { create: (s: any) => s, hairlineWidth: 1 } };
  if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
  if (id.endsWith('/useLocationConditions')) return { useLocationConditions: (...args: any[]) => { calls.push(args); return { assessments, complete, retry: () => retries++ }; } };
  return original(id);
};
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
const render = (targetProfile = 'generic', dayMode = 'today', visible = true, locations = hotspots) => mod.exports.HotspotTopThree({ hotspots: locations,
  context: { targetProfile, dayMode }, enabled: true, visible, maxHeight: 160, onClose: () => closeCount++, onSelect: (h: Hotspot) => selected = h });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const rows = (n: any) => walk(n).filter(e => e.type === 'Pressable' && e.props.accessibilityLabel?.startsWith('Prikaži'));
let tree = render(); ok(text(tree).includes('Izračunavam pogoje')); strictEqual(rows(tree).length, 0);
strictEqual(calls.at(-1)![0], hotspots, 'all own locations, not filtered viewport'); strictEqual(calls.at(-1)![4], 250);
complete = true; tree = render(); strictEqual(rows(tree).length, 3); strictEqual(tree.props.style[1].maxHeight, 160);
ok(walk(tree).some(e => e.type === 'ScrollView')); ok(text(tree).includes('Ocena ne zagotavlja najdbe.'));
rows(tree)[0].props.onPress(); strictEqual(selected, hotspots[1]);
walk(tree).find(e => e.props.accessibilityLabel === 'Zapri Top 3').props.onPress(); strictEqual(closeCount, 1);
for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES)) for (const day of ['today', 'tomorrow']) {
  assessments = { h0: { score: day === 'today' ? 71 : 83, classLabel: `${profile}-${day}` } };
  tree = render(profile, day); ok(text(tree).includes(MUSHROOM_WEATHER_PROFILES[profile as keyof typeof MUSHROOM_WEATHER_PROFILES].label));
  ok(text(tree).includes(`${profile}-${day}`)); strictEqual(calls.at(-1)![1], profile); strictEqual(calls.at(-1)![2], day);
}
complete = false; tree = render('lactariusDeliciosus', 'tomorrow'); strictEqual(rows(tree).length, 0, 'new incomplete generation cannot label old scores as current');
complete = true; assessments = {}; tree = render(); ok(text(tree).includes('Trenutno ni mogoče izračunati')); ok(!text(tree).includes('0/100'));
walk(tree).find(e => e.type === 'Pressable' && !e.props.accessibilityLabel).props.onPress(); strictEqual(retries, 1);
tree = render('generic', 'today', true, []); ok(text(tree).includes('najprej shrani rastišče'));
strictEqual(render('generic', 'today', false), null, 'closed panel has no native card');

// Execute actual Map intents/back callback. No duplicate camera/navigation system.
const mapSource = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MapScreen.tsx', mapSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const variables = new Map<string, string>(); const effects: string[] = [];
function inspect(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.initializer) variables.set(n.name.getText(ast), n.initializer.getText(ast));
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect') effects.push(n.arguments[0].getText(ast));
  ts.forEachChild(n, inspect);
}
inspect(ast);
const state: any = { controls: INITIAL_HEATMAP_CONTROLS, selectedId: 'old', showMyHotspots: false, mode: 'map', isFocused: true,
  topThreeVisible: true, heatmapEnabled: true, heatmapAreaCardOpen: false, listSort: 'conditions', query: 'hidden search',
  locationRequestGate: { cancel() {} }, cancelPendingHotspotFocus() {}, setLocating() {},
  nav: { enabled: true, profileId: 'boletusEdulis', targetDay: 'tomorrow' } };
state.dispatchHeatmapControls = (action: any) => state.controls = heatmapControlsReducer(state.controls, action);
state.updateHeatmapNavigation = (patch: any) => state.nav = { ...state.nav, ...patch };
for (const [setter, key] of [['setSelectedId', 'selectedId'], ['setTopThreeRequested', 'requested'], ['setCameraTarget', 'cameraTarget'], ['setMode', 'mode'],
  ['setOwnerFilter', 'ownerFilter'], ['setShowMyHotspots', 'showMyHotspots'], ['setQuery', 'query']]) state[setter] = (value: any) => state[key] = value;
const compile = (code: string) => runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, state);
state.focusHotspot = compile(variables.get('focusHotspot')!);
compile(variables.get('openTopThree')!)(); strictEqual(state.controls.topThreeOpen, true); strictEqual(state.showMyHotspots, false);
strictEqual(state.selectedId, undefined); strictEqual(state.requested, true); strictEqual(state.listSort, 'conditions');
ok(!heatmapControlsPanelVisible(state.controls, true, false)); ok(!hotspotPopupVisible(true, true, false, true));
compile(variables.get('selectTopThreeHotspot')!)(hotspots[2]);
strictEqual(state.controls.topThreeOpen, undefined); strictEqual(state.showMyHotspots, true); strictEqual(state.selectedId, hotspots[2].id);
strictEqual(state.cameraTarget.center.join(','), `${hotspots[2].longitude},${hotspots[2].latitude}`); strictEqual(state.cameraTarget.hotspotId, hotspots[2].id);
strictEqual(state.query, ''); strictEqual(state.nav.profileId, 'boletusEdulis'); strictEqual(state.nav.targetDay, 'tomorrow'); strictEqual(state.nav.enabled, true);
state.controls = heatmapControlsReducer(state.controls, { type: 'top-three-open' });
state.controls = heatmapControlsReducer(state.controls, { type: 'open' }); strictEqual(state.controls.topThreeOpen, undefined); ok(heatmapControlsPanelVisible(state.controls, true, false));
strictEqual(state.controls.filterFromTopThree, true, 'explicit filter owns overlay over a preserved regional selection');
state.controls = heatmapControlsReducer(state.controls, { type: 'dismiss' }); strictEqual(state.controls.filterFromTopThree, undefined);
state.controls = heatmapControlsReducer(state.controls, { type: 'top-three-open' });
let back: (() => boolean) | undefined, removed = 0;
state.BackHandler = { addEventListener: (_: string, fn: () => boolean) => { back = fn; return { remove: () => removed++ }; } };
const cleanup = compile(effects.find(e => e.includes("'hardwareBackPress'"))!)();
ok(back!()); strictEqual(state.controls.topThreeOpen, undefined); strictEqual(state.nav.profileId, 'boletusEdulis'); cleanup(); strictEqual(removed, 1);
state.controls = heatmapControlsReducer(state.controls, { type: 'top-three-open' });
state.controls = heatmapControlsReducer(state.controls, { type: 'leave' }); strictEqual(state.controls.topThreeOpen, undefined);

const baseline = execFileSync('git', ['show', 'e99921b:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
const slice = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
strictEqual(slice(mapSource, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'), slice(baseline, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'));
strictEqual(slice(mapSource, '  const observeCameraZoom', '  const heatmapAreaCardOpen'), slice(baseline, '  const observeCameraZoom', '  const heatmapAreaCardOpen'), 'visual preparation unchanged');
strictEqual(slice(mapSource, '  useEffect(() => () => heatmapRequestGate', '  // One post-commit'), slice(baseline, '  useEffect(() => () => heatmapRequestGate', '  // One post-commit'), 'regional weather effects unchanged');
for (const file of ['src/domain/mushroomWeather.ts', 'src/domain/locationConditions.ts', 'src/services/heatmap/regionalWeather.ts', 'src/services/heatmap/pilotHeatmap.ts',
  'src/state/AppContext.tsx', 'src/navigation/AppNavigator.tsx', 'src/components/HotspotConditionsMarkers.tsx'])
  strictEqual(readFileSync(file, 'utf8'), execFileSync('git', ['show', `e99921b:${file}`], { encoding: 'utf8' }), file);
ok(mapSource.includes('hotspots={hotspots} context={conditionsContext}')); ok(mapSource.includes('topThreeRequested ?'));
ok(mapSource.includes('mapViewportHeight * .5') && mapSource.includes('mapControlsBottom - spacing.lg - spacing.sm'));
const rankingSource = readFileSync('src/domain/hotspotRanking.ts', 'utf8');
const oldRanking = execFileSync('git', ['show', 'e99921b:src/domain/hotspotRanking.ts'], { encoding: 'utf8' });
const functionText = (source: string, name: string) => {
  const file = ts.createSourceFile('ranking.ts', source, ts.ScriptTarget.Latest, true);
  return file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(file);
};
for (const name of ['sortHotspots', 'rankingScore', 'createRankingOrderCoalescer']) strictEqual(functionText(rankingSource, name), functionText(oldRanking, name));
console.log('PASS Top 3 actual UI, same comparator, all/partial/zero/unavailable/ties, 4 profiles x 2 days, existing focus, visibility, exclusive reducer/back/leave, regional/source/weather/privacy isolation. Native layout requires phone QA.');
