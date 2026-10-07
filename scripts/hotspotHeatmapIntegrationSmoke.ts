import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { conditionsContextFromNavigation, conditionsNavigationPatch } from '../src/domain/hotspotHeatmap';
import { DEFAULT_HEATMAP_NAVIGATION_STATE, patchHeatmapNavigationState } from '../src/domain/heatmap/navigationState';
import { INITIAL_HEATMAP_CONTROLS, heatmapControlsReducer, heatmapControlsPanelVisible, hotspotPopupVisible } from '../src/domain/heatmap/controlsState';
import { rankingDetailParams } from '../src/domain/hotspotRanking';

// Run actual Map handlers + render-input derivation, not a replacement state machine.
const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const vars = new Map<string, string>(), effects: string[] = [];
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.initializer) vars.set(n.name.getText(ast), n.initializer.getText(ast));
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect') effects.push(n.arguments[0].getText(ast));
  ts.forEachChild(n, visit);
}
visit(ast);
const state: any = { mode: 'list', ownerFilter: 'mine', listSort: 'conditions', showMyHotspots: true, isFocused: true,
  nav: { ...DEFAULT_HEATMAP_NAVIGATION_STATE, enabled: false }, controls: INITIAL_HEATMAP_CONTROLS,
  mapWasMoved: { current: false }, consumedHotspotFocus: { current: undefined }, requests: [],
  heatmapAreaCardOpen: false, pendingHotspotFocus: undefined, cameraTarget: undefined };
Object.defineProperties(state, {
  heatmapNavigation: { get: () => state.nav }, heatmapEnabled: { get: () => state.nav.enabled },
  conditionsContext: { get: () => conditionsContextFromNavigation(state.nav) },
  selected: { get: () => state.selectedId ? { id: state.selectedId } : undefined },
});
Object.assign(state, { conditionsContextFromNavigation, conditionsNavigationPatch,
  rankingDetailParams, navigation: { navigate: (screen: string, params: any) => { state.navigation = { screen, params }; } },
  useMemo: (fn: () => any) => fn(), useRef: (initial: any) => state.renderRef ??= { current: initial },
  updateHeatmapNavigation: (patch: any) => { state.nav = patchHeatmapNavigationState(state.nav, patch); },
  dispatchHeatmapControls: (action: any) => { state.controls = heatmapControlsReducer(state.controls, action); },
  requestHotspotFocus: (hotspot: any, conditions: any) => { state.requests.push({ hotspot, conditions }); state.pendingHotspotFocus = {
    requestId: 'focus-v2', hotspotId: hotspot.id, latitude: hotspot.latitude, longitude: hotspot.longitude, conditions }; },
});
for (const name of ['Mode', 'CameraMoving', 'SelectedId', 'OwnerFilter', 'ShowMyHotspots', 'CameraTarget']) {
  state[`set${name}`] = (value: any) => { const key = name[0].toLowerCase() + name.slice(1); state[key] = typeof value === 'function' ? value(state[key]) : value; };
}
const compile = (code: string) => runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, state);
const select = compile(`(${vars.get('setConditionsContext')})`), switchView = compile(`(${vars.get('switchHotspotView')})`);
const show = compile(`(${vars.get('showRankingHotspot')})`), entry = compile(`(${effects.find(c => c.includes('consumedHotspotFocus.current = pendingHotspotFocus.requestId'))})`);
const species = compile(`(${vars.get('selectHeatmapSpecies')})`), day = compile(`(${vars.get('selectHeatmapDay')})`);
const toggle = compile(`(${vars.get('toggleMyHotspots')})`), openDetail = compile(`(${vars.get('openSelectedHotspot')})`);
state.__DEV__ = false;
const contextDeclaration = source.slice(source.indexOf('  const conditionsContext ='), source.indexOf('  const [heatmapBundle'));
const renderInputs = () => compile(`(() => { ${contextDeclaration} return { conditionsContext, heatmapProfileId, heatmapTargetDay }; })()`) as any;
// Initialize offscreen render snapshot before changing the shared choice.
const initialRenderProfile = renderInputs().heatmapProfileId;
select({ targetProfile: 'cantharellusCibarius', dayMode: 'tomorrow' });
strictEqual(state.nav.profileId, 'cantharellusCibarius'); strictEqual(state.nav.targetDay, 'tomorrow');
strictEqual(renderInputs().heatmapProfileId, initialRenderProfile, 'offscreen polygons defer list-only selection');
const cameraBefore = state.cameraTarget; switchView('map');
strictEqual(state.nav.enabled, true); strictEqual(state.cameraTarget, cameraBefore, 'ordinary view switch never focuses camera');
strictEqual(renderInputs().heatmapProfileId, 'cantharellusCibarius'); strictEqual(renderInputs().heatmapTargetDay, 'tomorrow');
species('boletusEdulis'); day('today'); switchView('list');
strictEqual(renderInputs().conditionsContext.targetProfile, 'boletusEdulis'); strictEqual(state.nav.targetDay, 'today');
select({ targetProfile: 'cantharellusCibarius', dayMode: 'tomorrow' });
state.showMyHotspots = false;
show({ id: 'pikovo', latitude: 46.42, longitude: 14.82 }); entry();
strictEqual(state.mode, 'map'); strictEqual(state.selectedId, 'pikovo'); strictEqual(state.showMyHotspots, true);
strictEqual(state.cameraTarget.center.join(','), '14.82,46.42'); strictEqual(state.cameraTarget.zoom, 15);
strictEqual(state.nav.enabled, true); strictEqual(state.nav.profileId, 'cantharellusCibarius'); strictEqual(state.nav.targetDay, 'tomorrow');
ok(!heatmapControlsPanelVisible(state.controls, true, false)); ok(hotspotPopupVisible(true, true, false));
openDetail(); strictEqual(state.navigation.screen, 'HotspotDetail');
strictEqual(state.navigation.params.hotspotId, 'pikovo');
strictEqual(state.navigation.params.conditionsContext.targetProfile, 'cantharellusCibarius');
strictEqual(state.navigation.params.conditionsContext.dayMode, 'tomorrow');
const navBeforeToggle = state.nav, requestsBeforeToggle = state.requests.length;
toggle(); strictEqual(state.showMyHotspots, false); strictEqual(state.selectedId, undefined);
strictEqual(state.nav, navBeforeToggle); strictEqual(state.requests.length, requestsBeforeToggle);
toggle(); strictEqual(state.showMyHotspots, true);
state.setSelectedId(undefined); switchView('list');
strictEqual(state.listSort, 'conditions'); strictEqual(state.nav.profileId, 'cantharellusCibarius'); strictEqual(state.nav.targetDay, 'tomorrow');
deepStrictEqual(conditionsNavigationPatch(conditionsContextFromNavigation(state.nav)), { profileId: 'cantharellusCibarius', targetDay: 'tomorrow' });
ok(source.includes("useState<HotspotSortMode>('recent')")); ok(source.includes('useState(true)'));
ok(!source.includes('setRankingContext')); ok(!source.includes('setMapReady(false)'));
ok(source.includes('visible={!heatmapEnabled || showMyHotspots}'));
ok(source.includes('accessibilityRole="checkbox" accessibilityLabel="Moja rastišča" accessibilityState={{ checked: visible }}'));
ok(source.includes('sort={listSort} onSort={setListSort} onShowMap={showRankingHotspot}'));
// Native source subtree is no longer under a view-switch conditional (no source remount).
let mapConditional = false;
function inspect(n: ts.Node, conditional: boolean) {
  if (ts.isJsxOpeningElement(n) && n.tagName.getText(ast) === 'Map') mapConditional ||= conditional;
  ts.forEachChild(n, child => inspect(child, conditional || ts.isConditionalExpression(n)));
}
inspect(ast, false); ok(!mapConditional);
ok(source.includes("pointerEvents={mode === 'map' ? 'auto' : 'none'}"));
ok(source.includes('hiddenMap: { opacity: 0 }'));
const baseline = execFileSync('git', ['show', '03cf830:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
const slice = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
strictEqual(slice(source, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'), slice(baseline, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'));
strictEqual(slice(source, '  const [heatmapBundle', '  const heatmapAreaLocality').replace("    if (mode !== 'map') return;\n", ''),
  slice(baseline, '  const [heatmapBundle', '  const heatmapAreaLocality'), 'no scoring/visual/LOD rewrite');
for (const file of ['src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/regionalWeather.ts', 'src/domain/locationConditions.ts', 'src/state/AppContext.tsx'])
  strictEqual(readFileSync(file, 'utf8'), execFileSync('git', ['show', `03cf830:${file}`], { encoding: 'utf8' }), file);
console.log('PASS actual list/map context handlers, row focus intent/current context/exclusive popup, ordinary viewport preservation, sort roundtrip, offscreen render deferral, mounted native sources, untouched evaluation/cache/privacy. Physical Android rendering still requires QA.');
