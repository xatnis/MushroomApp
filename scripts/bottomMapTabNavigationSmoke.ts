import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { withoutPointDiagnostics } from './pointRefreshSourceGuards';
import { readFileSync } from 'node:fs';
import { withoutPointMigration } from './pointMigrationSourceGuards';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { withoutBottomMapTabEntry } from './conditionsListEntryFixture';

const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let switchBody = '', registerBody = '', focusBody = '';
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'switchHotspotView') switchBody = node.initializer!.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'showRankingHotspot') focusBody = node.initializer!.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes("navigation.addListener('tabPress'")) registerBody = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}; visit(ast); ok(registerBody); ok(switchBody);
const listeners = new Set<() => void>(); let writes = 0, cancels = 0;
const state: any = {
  mode: 'list', ownerFilter: 'mine', isFocused: true, mapWasMoved: { current: false },
  conditionsContext: { targetProfile: 'boletusEdulis', dayMode: 'tomorrow' },
  camera: { center: [14.8, 46.5], zoom: 11.5 }, heatmapEnabled: true, sort: 'conditions',
  selectedId: 'saved-hotspot', weatherCache: {}, sourceIdentity: {}, actions: [], focusRequests: [],
  setMode: (next: string) => { writes++; state.mode = next; },
  cancelPendingHotspotFocus: () => cancels++, setCameraMoving: () => {},
  dispatchHeatmapControls: (action: any) => state.actions.push(action),
  conditionsNavigationPatch: (context: any) => ({ profileId: context.targetProfile, targetDay: context.dayMode }),
  requestHotspotFocus: (...args: any[]) => state.focusRequests.push(args),
  navigation: { addListener: (event: string, listener: () => void) => {
    strictEqual(event, 'tabPress'); listeners.add(listener); return () => listeners.delete(listener);
  } },
};
const compile = (body: string): any => runInNewContext(ts.transpileModule('(' + body + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, state);
state.switchHotspotView = compile(switchBody);
const register = compile(registerBody), focus = compile(focusBody);
const original = { camera: state.camera, context: state.conditionsContext, cache: state.weatherCache, source: state.sourceIdentity, mode: state.heatmapEnabled, sort: state.sort, selected: state.selectedId };
let unsubscribe = register(); strictEqual(listeners.size, 1);
const pressBottom = () => listeners.forEach(callback => callback());
pressBottom(); strictEqual(state.mode, 'map'); strictEqual(writes, 1); ok(state.mapWasMoved.current);
pressBottom(); strictEqual(writes, 1, 'already-map tab press is a no-op');
state.switchHotspotView('list'); strictEqual(state.mode, 'list'); strictEqual(cancels, 1);
state.switchHotspotView('map'); strictEqual(state.mode, 'map');
for (const heatmap of [false, true]) {
  state.heatmapEnabled = heatmap; state.mode = 'list'; state.isFocused = false;
  pressBottom(); strictEqual(state.mode, 'map', 'inactive Map tab also switches its mounted internal view');
  strictEqual(state.heatmapEnabled, heatmap, 'Rastišča/Pogoji preserved');
}
strictEqual(state.camera, original.camera); strictEqual(state.conditionsContext, original.context);
strictEqual(state.weatherCache, original.cache); strictEqual(state.sourceIdentity, original.source);
strictEqual(state.sort, original.sort); strictEqual(state.selectedId, original.selected);
const hotspot = { id: 'hotspot-2', latitude: 46.42, longitude: 14.85 }; focus(hotspot);
deepStrictEqual(state.focusRequests, [[hotspot, { profileId: 'boletusEdulis', targetDay: 'tomorrow' }]]);
unsubscribe(); strictEqual(listeners.size, 0, 'cleanup removes the old subscription');
unsubscribe = register(); strictEqual(listeners.size, 1, 'mode/owner rerender cannot accumulate listeners');
state.mode = 'list'; const previousWrites = writes; pressBottom(); strictEqual(writes, previousWrites + 1);
unsubscribe(); const afterUnmount = writes; pressBottom(); strictEqual(writes, afterUnmount);
ok(!/fetch|loadHeatmap|setCamera|updateHeatmapNavigation|navigate\(/.test(registerBody), 'listener has only a view-switch path');
// Everything else in MapScreen, including camera/source/LOD/loading hooks, remains exact.
strictEqual(withoutPointMigration('src/screens/MapScreen.tsx', withoutBottomMapTabEntry(source)), execFileSync('git', ['show', '5ae2089:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'));
for (const path of ['src/navigation/AppNavigator.tsx', 'src/navigation/types.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/services/weather.ts', 'src/domain/mushroomWeather.ts'])
  strictEqual(withoutPointDiagnostics(path, readFileSync(path, 'utf8')).replace('export async function cachedFetch<T>', 'async function cachedFetch<T>'), execFileSync('git', ['show', `5ae2089:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path);
// Installed tab bar emits the route-targeted event even if the Map tab is already focused.
const tabBar = readFileSync('node_modules/@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx', 'utf8');
ok(tabBar.includes("type: 'tabPress'")); ok(tabBar.includes('if (!focused && !event.defaultPrevented)'));
console.log('PASS bottom Map reselect/from-other-tab, top Map/List unchanged, map no-op, both map modes/profile/day/camera/sort preserved, explicit hotspot focus, single subscription/cleanup; no listener weather/camera path and native source/LOD/tab appearance byte-identical. Physical Android QA remains separate.');
