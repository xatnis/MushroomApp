import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { INITIAL_HEATMAP_CONTROLS, heatmapControlsReducer, heatmapControlsPanelVisible,
  hotspotPopupVisible, hotspotFocusPadding, type HeatmapControlsAction } from '../src/domain/heatmap/controlsState';

// Execute the real Map entry/blur/marker handlers, not a second implementation of them.
const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks: string[] = [];
let markerHandler = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') callbacks.push(node.arguments[0].getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'focusHotspot') markerHandler = node.initializer!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const state: any = { isFocused: true, pendingHotspotFocus: {
  requestId: 'entry-1', hotspotId: 'pikovo', longitude: 14.82, latitude: 46.42,
  conditions: { profileId: 'lactariusDeliciosus', targetDay: 'tomorrow' },
}, consumedHotspotFocus: { current: undefined }, controls: INITIAL_HEATMAP_CONTROLS,
  heatmapEnabled: true, heatmapAreaCardOpen: false, selectedId: undefined,
  locationRequestGate: { cancel() {} }, navigationContext: { enabled: false }, cleared: [] };
state.dispatchHeatmapControls = (action: HeatmapControlsAction) => { state.controls = heatmapControlsReducer(state.controls, action); };
for (const [setter, key] of [['setSelectedId', 'selectedId'], ['setOwnerFilter', 'ownerFilter'], ['setMode', 'mode'],
  ['setCameraTarget', 'cameraTarget'], ['setPopupLayout', 'popupLayout'], ['setContextBottom', 'contextBottom'], ['setLocating', 'locating']]) {
  state[setter] = (value: any) => { state[key] = value; };
}
state.updateHeatmapNavigation = (patch: any) => { state.navigationContext = { ...state.navigationContext, ...patch }; };
state.clearHotspotFocus = (id: string) => { state.cleared.push(id); };
const compile = (callback: string) => runInNewContext(ts.transpileModule(`(${callback})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, state);
const entry = compile(callbacks.find(c => c.includes('consumedHotspotFocus.current = pendingHotspotFocus.requestId'))!);
const leave = compile(callbacks.find(c => c.includes("type: 'leave'"))!);
const marker = compile(markerHandler);
const filter = () => heatmapControlsPanelVisible(state.controls, state.heatmapEnabled, state.heatmapAreaCardOpen);
const popup = () => hotspotPopupVisible(Boolean(state.selectedId), state.heatmapEnabled, filter());
const exclusive = () => ok(!(filter() && popup()), 'one large overlay only');
entry();
strictEqual(state.selectedId, 'pikovo'); strictEqual(state.mode, 'map');
strictEqual(filter(), false); strictEqual(popup(), true); exclusive();
strictEqual(state.navigationContext.profileId, 'lactariusDeliciosus');
strictEqual(state.navigationContext.targetDay, 'tomorrow'); strictEqual(state.navigationContext.enabled, true);
strictEqual(state.cameraTarget.center.join(','), '14.82,46.42'); strictEqual(state.cameraTarget.zoom, 15);
const cameraCalls: any[] = [];
Object.defineProperties(state, {
  heatmapControls: { get: () => state.controls },
  heatmapControlsVisible: { get: () => !state.controls.userDismissedPanel },
  selected: { get: () => state.selectedId ? { id: state.selectedId } : undefined },
});
Object.assign(state, { mapReady: true, mapViewportHeight: 500, contextBottom: 0, popupLayout: undefined,
  spacing: { lg: 16, sm: 8 }, hotspotPopupVisible, heatmapControlsPanelVisible, hotspotFocusPadding,
  setCameraMoving: (moving: boolean) => { state.cameraMoving = moving; },
  camera: { current: { easeTo: (options: any) => cameraCalls.push(options) } },
});
const focus = compile(callbacks.find(c => c.includes('const popupExpected'))!);
focus(); strictEqual(cameraCalls.length, 0, 'wait for actual popup layout');
state.popupLayout = { id: 'pikovo', height: 200 };
focus(); strictEqual(cameraCalls.length, 0, 'wait for compact context layout');
state.contextBottom = 110; focus(); strictEqual(cameraCalls.length, 1);
strictEqual(cameraCalls[0].center.join(','), '14.82,46.42'); strictEqual(cameraCalls[0].zoom, 15);
strictEqual(cameraCalls[0].padding.bottom, 224); strictEqual(cameraCalls[0].padding.top, 118);
strictEqual(state.cameraTarget, undefined, 'focus executes once after layouts');
// Same reducer action used by the compact pill opens the EXISTING filter; selected item survives.
state.dispatchHeatmapControls({ type: 'open' }); strictEqual(filter(), true); strictEqual(popup(), false); exclusive();
state.updateHeatmapNavigation({ profileId: 'boletusEdulis', targetDay: 'today' });
strictEqual(state.selectedId, 'pikovo');
state.dispatchHeatmapControls({ type: 'dismiss' }); strictEqual(popup(), true); exclusive();
strictEqual(state.navigationContext.profileId, 'boletusEdulis'); strictEqual(state.navigationContext.targetDay, 'today');
state.setSelectedId(undefined); strictEqual(popup(), false); strictEqual(state.navigationContext.enabled, true);
state.dispatchHeatmapControls({ type: 'open' });
marker({ id: 'another', longitude: 15.1, latitude: 46.3 });
strictEqual(state.selectedId, 'another'); strictEqual(filter(), false); strictEqual(popup(), true); exclusive();
state.isFocused = false; leave();
strictEqual(state.selectedId, undefined); strictEqual(state.cameraTarget, undefined);
strictEqual(state.popupLayout, undefined); strictEqual(state.contextBottom, 0);
strictEqual(state.controls.beforeHotspotEntry, undefined); strictEqual(filter(), true, 'normal Map visit restores pre-entry filter');
strictEqual(state.cleared[0], 'entry-1');
// An inactive Map cannot consume a newly queued navigation request.
entry(); strictEqual(state.selectedId, undefined);
let dismissed = heatmapControlsReducer(INITIAL_HEATMAP_CONTROLS, { type: 'dismiss' });
dismissed = heatmapControlsReducer(dismissed, { type: 'hotspot-entry' });
dismissed = heatmapControlsReducer(dismissed, { type: 'open' });
dismissed = heatmapControlsReducer(dismissed, { type: 'leave' });
strictEqual(dismissed.userDismissedPanel, true, 'pre-entry user dismissal is not lost');
deepStrictEqual(hotspotFocusPadding(500, 200, 16, 110, 8), { top: 118, right: 0, left: 0, bottom: 224 });
const small = hotspotFocusPadding(300, 200, 16, 110, 8);
ok(300 - small.top - small.bottom >= 44, 'measured insets keep a usable map area');
ok(source.includes('accessibilityLabel="Odpri izbiro pogojev"') && source.includes("MUSHROOM_WEATHER_PROFILES[heatmapProfileId].label} · {heatmapTargetDay"));
ok(source.includes('popupLayout!.height') && source.includes('nativeEvent.layout.height'));
ok(source.includes('previewDensity: { padding: 14, gap: 10 }') && source.includes('styles.closeButton, styles.heatmapControlsClose'));
const baseline = execFileSync('git', ['show', '01b2038:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
const slice = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
strictEqual(slice(source, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'),
  slice(baseline, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'), 'native sources/layers unchanged');
strictEqual(slice(source, '  const { enabled: heatmapEnabled', '  const heatmapAreaLocality'),
  slice(baseline, '  const { enabled: heatmapEnabled', '  const heatmapAreaLocality'), 'weather/GeoJSON/LOD pipeline unchanged');
console.log('PASS: real entry/marker/blur handlers, preserved coordinates/profile/day, compact existing filter, exclusive/restorable popup, close/context, transient cleanup, measured padding, unchanged weather/LOD/native sources. Physical layout still needs Android QA.');
