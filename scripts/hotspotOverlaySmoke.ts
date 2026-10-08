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
const variables = new Map<string, string>();
let markerHandler = '';
let popupClose = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') callbacks.push(node.arguments[0].getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'focusHotspot') markerHandler = node.initializer!.getText(ast);
  if (ts.isVariableDeclaration(node) && node.initializer) variables.set(node.name.getText(ast), node.initializer.getText(ast));
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'HotspotMapCard') {
    const close = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'onClose') as ts.JsxAttribute;
    popupClose = (close.initializer as ts.JsxExpression).expression!.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const state: any = { isFocused: true, pendingHotspotFocus: {
  requestId: 'entry-1', hotspotId: 'pikovo', longitude: 14.82, latitude: 46.42,
  conditions: { profileId: 'lactariusDeliciosus', targetDay: 'tomorrow' },
}, consumedHotspotFocus: { current: undefined }, mapWasMoved: { current: false }, controls: INITIAL_HEATMAP_CONTROLS,
  heatmapEnabled: true, heatmapAreaCardOpen: false, selectedId: undefined,
  cameraTargetRef: { current: undefined }, focusLayout: undefined, HOTSPOT_MARKER_HEIGHT: 52,
  focusLayoutRevision: 0,
  heatmapProfileId: 'lactariusDeliciosus', heatmapTargetDay: 'tomorrow',
  locationRequestGate: { cancel() {} }, navigationContext: { enabled: false }, cleared: [] };
state.dispatchHeatmapControls = (action: HeatmapControlsAction) => { state.controls = heatmapControlsReducer(state.controls, action); };
for (const [setter, key] of [['setSelectedId', 'selectedId'], ['setOwnerFilter', 'ownerFilter'], ['setMode', 'mode'],
  ['setCameraTarget', 'cameraTarget'], ['setFocusLayout', 'focusLayout'], ['setFocusLayoutRevision', 'focusLayoutRevision'], ['setLocating', 'locating'], ['setShowMyHotspots', 'showMyHotspots']]) {
  state[setter] = (value: any) => { state[key] = typeof value === 'function' ? value(state[key]) : value; if (key === 'cameraTarget') state.cameraTargetRef.current = value; };
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
const frames: Array<{ run: () => void; cancelled: boolean }> = [], measurements: Array<{ type: string; run: (...args: number[]) => void }> = [];
Object.assign(state, { mapReady: true, mapViewportHeight: 500,
  spacing: { lg: 16, sm: 8 }, hotspotPopupVisible, heatmapControlsPanelVisible, hotspotFocusPadding,
  setCameraMoving: (moving: boolean) => { state.cameraMoving = moving; },
  camera: { current: { easeTo: (options: any) => cameraCalls.push(options) } },
  popupView: { current: { measure: (run: any) => measurements.push({ type: 'popup', run }) } },
  contextView: { current: { measure: (run: any) => measurements.push({ type: 'context', run }) } },
  requestAnimationFrame: (run: () => void) => { frames.push({ run, cancelled: false }); return frames.length - 1; },
  cancelAnimationFrame: (id: number) => { frames[id].cancelled = true; },
});
const focus = compile(callbacks.find(c => c.includes('const popupExpected'))!);
const measure = compile(callbacks.find(c => c.includes('const commit ='))!);
const cancelFocus = compile(variables.get('cancelPendingHotspotFocus')!);
const layoutChanged = compile(variables.get('refreshPendingFocusLayout')!);
state.cancelPendingHotspotFocus = cancelFocus;
focus(); strictEqual(cameraCalls.length, 0, 'wait for actual popup layout');
const cleanup = measure(); strictEqual(measurements.length, 0, 'measure only after commit/RAF');
frames.at(-1)!.run(); measurements.shift()!.run(0, 0, 280, 124);
focus(); strictEqual(cameraCalls.length, 0, 'wait for both current overlay measurements');
measurements.shift()!.run(8, 16, 200, 48); focus(); strictEqual(cameraCalls.length, 1);
strictEqual(cameraCalls[0].center.join(','), '14.82,46.42'); strictEqual(cameraCalls[0].zoom, 15);
strictEqual(cameraCalls[0].padding.bottom, 148); strictEqual(cameraCalls[0].padding.top, 124);
strictEqual(state.cameraTarget, undefined, 'focus executes once after layouts');
cleanup(); layoutChanged(); strictEqual(state.focusLayoutRevision, 0, 'completed focus ignores later layouts');
focus(); strictEqual(cameraCalls.length, 1, 'no second snap after new layout');

// Native measurement callbacks may arrive after a newer hotspot or manual pan.
marker({ id: 'old', longitude: 15, latitude: 46 }); const oldCleanup = measure(); frames.at(-1)!.run();
const stale = measurements.splice(0);
marker({ id: 'latest', longitude: 15.2, latitude: 46.5 }); oldCleanup();
const previousPacket = state.focusLayout; stale[0].run(0, 0, 280, 200); stale[1].run(8, 16, 200, 100);
strictEqual(state.focusLayout, previousPacket, 'old measurements never overwrite latest request');
state.focusLayout = { target: state.cameraTarget, layoutKey: 'wrong-context', popupHeight: 124, contextBottom: 64 };
focus(); strictEqual(cameraCalls.length, 1, 'old context/viewport metrics cannot focus current target');
const latestCleanup = measure(); frames.at(-1)!.run();
measurements.shift()!.run(0, 0, 280, 0); measurements.shift()!.run(8, 16, 200, 48);
focus(); strictEqual(cameraCalls.length, 1, 'zero-height pre-layout packet cannot focus');
layoutChanged(); latestCleanup();
const settledCleanup = measure(); frames.at(-1)!.run();
measurements.shift()!.run(0, 0, 280, 124); measurements.shift()!.run(8, 16, 200, 48);
const currentTarget = state.cameraTarget;
state.cameraTargetRef.current = undefined; focus();
strictEqual(cameraCalls.length, 1, 'cancelled token blocks camera even before its state commit');
state.cameraTargetRef.current = currentTarget;
focus(); strictEqual(cameraCalls.length, 2); strictEqual(cameraCalls[1].center.join(','), '15.2,46.5'); settledCleanup();
marker({ id: 'manual', longitude: 15.4, latitude: 46.4 }); const manualCleanup = measure(); frames.at(-1)!.run();
const manualPending = measurements.splice(0); cancelFocus();
manualPending[0].run(0, 0, 280, 124); manualPending[1].run(8, 16, 200, 48); focus();
strictEqual(cameraCalls.length, 2, 'manual gesture cancels pending focus; no delayed snap'); manualCleanup();
ok(source.includes('if (event.nativeEvent.userInteraction) cancelPendingHotspotFocus()'));
// Same reducer action used by the compact pill opens the EXISTING filter; selected item survives.
state.setSelectedId('pikovo');
state.dispatchHeatmapControls({ type: 'open' }); strictEqual(filter(), true); strictEqual(popup(), false); exclusive();
state.updateHeatmapNavigation({ profileId: 'boletusEdulis', targetDay: 'today' });
strictEqual(state.selectedId, 'pikovo');
state.dispatchHeatmapControls({ type: 'dismiss' }); strictEqual(popup(), true); exclusive();
strictEqual(state.navigationContext.profileId, 'boletusEdulis'); strictEqual(state.navigationContext.targetDay, 'today');
const beforeCloseContext = state.navigationContext;
compile(popupClose)(); strictEqual(popup(), false); strictEqual(state.navigationContext.enabled, true);
strictEqual(state.navigationContext, beforeCloseContext, 'X is popup-only, preserving profile/day/conditions');
state.dispatchHeatmapControls({ type: 'open' });
marker({ id: 'another', longitude: 15.1, latitude: 46.3 });
strictEqual(state.selectedId, 'another'); strictEqual(filter(), false); strictEqual(popup(), true); exclusive();
state.isFocused = false; leave();
strictEqual(state.selectedId, undefined); strictEqual(state.cameraTarget, undefined);
strictEqual(state.focusLayout, undefined); strictEqual(state.cameraTargetRef.current, undefined);
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
ok(source.includes('focusLayout!.popupHeight') && source.includes('popupView.current?.measure'));
ok(source.includes('<HotspotMapCard hotspot={selected}') && !source.includes('title="Odpri rastišče"'));
for (const [height, popupHeight, controlsEnd] of [[300, 124, 80], [400, 150, 96], [500, 124, 64]]) {
  const inset = hotspotFocusPadding(height, popupHeight, 16, controlsEnd, 8, 52);
  const projectedCoordinateY = (inset.top + height - inset.bottom) / 2;
  ok(projectedCoordinateY - 52 >= controlsEnd + 8, 'entire bottom-anchored marker below top controls');
  ok(projectedCoordinateY < height - popupHeight - 16, 'marker coordinate above card');
}
const baseline = execFileSync('git', ['show', '01b2038:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
const slice = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
strictEqual(slice(source, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'),
  slice(baseline, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'), 'native sources/layers unchanged');
strictEqual(slice(source, '  const selectHeatmapSpecies', '  const heatmapAreaCardOpen').replace("    if (mode !== 'map') return;\n", ''),
  slice(baseline, '  const selectHeatmapSpecies', '  const heatmapAreaCardOpen'), 'weather/GeoJSON/LOD pipeline unchanged apart from hidden camera event guard');
console.log('PASS: real entry/marker/blur handlers, preserved coordinates/profile/day, compact existing filter, exclusive/restorable popup, close/context, transient cleanup, measured padding, unchanged weather/LOD/native sources. Physical layout still needs Android QA.');
