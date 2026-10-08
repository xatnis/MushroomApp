import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { sortHotspots } from '../src/domain/hotspotRanking';
import { topThreeHotspots } from '../src/domain/hotspotTopThree';
import { heatmapControlsReducer, INITIAL_HEATMAP_CONTROLS, heatmapControlsPanelVisible, hotspotPopupVisible, topThreePanelMaxHeight } from '../src/domain/heatmap/controlsState';
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
Object.defineProperty(state, 'selected', { get: () => hotspots.find(h => h.id === state.selectedId) });
state.dispatchHeatmapControls = (action: any) => state.controls = heatmapControlsReducer(state.controls, action);
Object.defineProperty(state, 'heatmapControls', { get: () => state.controls });
Object.defineProperty(state, 'topThreeOriginPopup', { get: () => state.selectedId != null && state.controls.topThreeOriginId === state.selectedId });
state.heatmapControlsPanelVisible = heatmapControlsPanelVisible;
state.updateHeatmapNavigation = (patch: any) => state.nav = { ...state.nav, ...patch };
for (const [setter, key] of [['setSelectedId', 'selectedId'], ['setTopThreeRequested', 'requested'], ['setCameraTarget', 'cameraTarget'], ['setMode', 'mode'],
  ['setOwnerFilter', 'ownerFilter'], ['setShowMyHotspots', 'showMyHotspots'], ['setQuery', 'query']]) state[setter] = (value: any) => state[key] = value;
const compile = (code: string) => runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, state);
state.focusHotspot = compile(variables.get('focusHotspot')!);
state.openTopThree = compile(variables.get('openTopThree')!);
state.openTopThree(); strictEqual(state.controls.topThreeOpen, true); strictEqual(state.showMyHotspots, false);
strictEqual(state.selectedId, undefined); strictEqual(state.requested, true); strictEqual(state.listSort, 'conditions');
ok(!heatmapControlsPanelVisible(state.controls, true, false)); ok(!hotspotPopupVisible(true, true, false, true));
compile(variables.get('selectTopThreeHotspot')!)(hotspots[2]);
strictEqual(state.controls.topThreeOpen, undefined); strictEqual(state.showMyHotspots, true); strictEqual(state.selectedId, hotspots[2].id);
strictEqual(state.cameraTarget.center.join(','), `${hotspots[2].longitude},${hotspots[2].latitude}`); strictEqual(state.cameraTarget.hotspotId, hotspots[2].id);
strictEqual(state.query, ''); strictEqual(state.nav.profileId, 'boletusEdulis'); strictEqual(state.nav.targetDay, 'tomorrow'); strictEqual(state.nav.enabled, true);
strictEqual(state.controls.topThreeOriginId, hotspots[2].id);
const focusedCamera = state.cameraTarget, navBeforeReturn = { ...state.nav };
state.openTopThree();
strictEqual(state.selectedId, undefined); strictEqual(state.controls.topThreeOpen, true);
strictEqual(state.controls.topThreeOriginId, undefined); strictEqual(state.cameraTarget, focusedCamera, 'return never calls focus/camera setter');
deepStrictEqual(state.nav, navBeforeReturn); strictEqual(state.listSort, 'conditions');
compile(variables.get('selectTopThreeHotspot')!)(hotspots[0]);
compile(variables.get('selectTopThreeHotspot')!)(hotspots[1]);
strictEqual(state.controls.topThreeOriginId, hotspots[1].id, 'latest selection wins');
state.focusHotspot(hotspots[0]); strictEqual(state.controls.topThreeOriginId, undefined, 'marker focus clears Top 3 origin');
state.controls = heatmapControlsReducer(state.controls, { type: 'top-three-open' });
state.controls = heatmapControlsReducer(state.controls, { type: 'open' }); strictEqual(state.controls.topThreeOpen, undefined); ok(heatmapControlsPanelVisible(state.controls, true, false));
strictEqual(state.controls.filterFromTopThree, true, 'explicit filter owns overlay over a preserved regional selection');
state.controls = heatmapControlsReducer(state.controls, { type: 'dismiss' }); strictEqual(state.controls.filterFromTopThree, undefined);
state.controls = heatmapControlsReducer(state.controls, { type: 'top-three-open' });
let back: (() => boolean) | undefined, removed = 0;
state.BackHandler = { addEventListener: (_: string, fn: () => boolean) => { back = fn; return { remove: () => removed++ }; } };
const cleanup = compile(effects.find(e => e.includes("'hardwareBackPress'"))!)();
ok(back!()); strictEqual(state.controls.topThreeOpen, undefined); strictEqual(state.nav.profileId, 'boletusEdulis'); cleanup(); strictEqual(removed, 1);
compile(variables.get('selectTopThreeHotspot')!)(hotspots[2]);
const popupCamera = state.cameraTarget;
const cleanupPopup = compile(effects.find(e => e.includes("'hardwareBackPress'"))!)();
ok(back!()); strictEqual(state.controls.topThreeOpen, true); strictEqual(state.selectedId, undefined);
strictEqual(state.cameraTarget, popupCamera); cleanupPopup();
state.controls = heatmapControlsReducer(state.controls, { type: 'open' });
const cleanupFilter = compile(effects.find(e => e.includes("'hardwareBackPress'"))!)();
ok(back!()); strictEqual(state.controls.userDismissedPanel, true); strictEqual(state.controls.topThreeOpen, undefined, 'one Back closes filter only'); cleanupFilter();
for (const action of ['top-three-close', 'open', 'dismiss', 'hotspot-entry', 'leave'] as const) {
  const origin = heatmapControlsReducer(INITIAL_HEATMAP_CONTROLS, { type: 'top-three-select', hotspotId: 'h0' });
  strictEqual(heatmapControlsReducer(origin, { type: action }).topThreeOriginId, undefined, `${action} clears transient origin`);
}
compile(variables.get('selectTopThreeHotspot')!)(hotspots[2]);
let cardClose: string | undefined;
function findCardClose(n: ts.Node) {
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'HotspotMapCard') {
    const attr = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'onClose') as ts.JsxAttribute;
    cardClose = (attr.initializer as ts.JsxExpression).expression!.getText(ast);
  }
  ts.forEachChild(n, findCardClose);
}
findCardClose(ast); compile(cardClose!)();
strictEqual(state.selectedId, undefined); strictEqual(state.controls.topThreeOriginId, undefined); strictEqual(state.controls.topThreeOpen, undefined, 'X does not return to panel');
compile(variables.get('selectTopThreeHotspot')!)(hotspots[1]);
let openedDetail: any;
state.navigation = { navigate: (_: string, params: any) => openedDetail = params };
state.conditionsContext = { targetProfile: state.nav.profileId, dayMode: state.nav.targetDay };
state.rankingDetailParams = (id: string, context: any) => ({ hotspotId: id, ...context });
compile(variables.get('openSelectedHotspot')!)();
strictEqual(openedDetail.hotspotId, hotspots[1].id); strictEqual(state.controls.topThreeOriginId, undefined);
compile(variables.get('selectTopThreeHotspot')!)(hotspots[0]); state.selectedId = undefined;
compile(effects.find(e => e.includes('topThreeOriginId !== selected?.id'))!)();
strictEqual(state.controls.topThreeOriginId, undefined, 'deselection or deleted item clears origin');
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
ok(mapSource.includes('topThreePanelMaxHeight(mapViewportHeight, mapControlsBottom, spacing.lg, spacing.sm, HOTSPOT_MARKER_HEIGHT)'));
strictEqual(topThreePanelMaxHeight(400, 108, 16, 8, 52), 216);
strictEqual(topThreePanelMaxHeight(600, 64, 16, 8, 52), 400);
strictEqual(topThreePanelMaxHeight(200, 108, 16, 8, 52), 16, 'tiny viewport scroll fallback');
strictEqual(topThreePanelMaxHeight(100, 108, 16, 8, 52), 0);
complete = true; assessments = Object.fromEntries(hotspots.slice(1, 4).map(h => [h.id, { score: 80, classLabel: 'Zelo dobre razmere' }]));
const layout = render(); const panelNodes = walk(layout), scroll = panelNodes.find(n => n.type === 'ScrollView');
const titleStyle = panelNodes.find(n => n.type === 'Text' && text(n).includes('Top 3 po')).props.style;
const subtitleStyle = panelNodes.find(n => n.type === 'Text' && text(n).includes('Splošno')).props.style;
const caveatStyle = panelNodes.find(n => n.type === 'Text' && text(n).includes('Ocena ne')).props.style;
const closeStyle = panelNodes.find(n => n.props.accessibilityLabel === 'Zapri Top 3').props.style;
const rowStyle = rows(layout)[0].props.style({ pressed: false })[0];
const nameStyle = panelNodes.find(n => n.type === 'Text' && n.props.numberOfLines === 2).props.style;
const rowHeight = (scale: number, lines = 1) => Math.max(rowStyle.minHeight, (nameStyle.lineHeight * lines + subtitleStyle.lineHeight) * scale + 2 * rowStyle.paddingVertical);
const desiredHeight = (scale: number) => 2 + scroll.props.contentContainerStyle.padding * 2
  + Math.max(closeStyle.height, (titleStyle.lineHeight + subtitleStyle.lineHeight) * scale)
  + 3 * rowHeight(scale) + caveatStyle.lineHeight * scale;
strictEqual(desiredHeight(1), 210);
ok(desiredHeight(1) <= topThreePanelMaxHeight(400, 108, 16, 8, 52), '360 pt width / 400 pt map: normal rows fit (arithmetic, not Yoga)');
ok(desiredHeight(1.5) > topThreePanelMaxHeight(400, 108, 16, 8, 52), 'large fonts have ScrollView fallback');
ok(scroll.props.contentContainerStyle.padding > 0); ok(rowHeight(1, 2) > rowHeight(1));
ok(mapSource.includes('onBackToTopThree={topThreeOriginPopup ? openTopThree : undefined}'));
const rankingSource = readFileSync('src/domain/hotspotRanking.ts', 'utf8');
const oldRanking = execFileSync('git', ['show', 'e99921b:src/domain/hotspotRanking.ts'], { encoding: 'utf8' });
const functionText = (source: string, name: string) => {
  const file = ts.createSourceFile('ranking.ts', source, ts.ScriptTarget.Latest, true);
  return file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(file);
};
for (const name of ['sortHotspots', 'rankingScore', 'createRankingOrderCoalescer']) strictEqual(functionText(rankingSource, name), functionText(oldRanking, name));
strictEqual(readFileSync('src/services/heatmap/useLocationConditions.ts', 'utf8'), execFileSync('git', ['show', 'e59576e:src/services/heatmap/useLocationConditions.ts'], { encoding: 'utf8' }), 'cached completion/hook transport is byte-identical');
console.log('PASS Top 3 actual UI, same comparator, all/partial/zero/unavailable/ties, 4 profiles x 2 days, existing focus, visibility, exclusive reducer/back/leave, regional/source/weather/privacy isolation. Native layout requires phone QA.');
