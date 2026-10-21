import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { compactMapForecastHeight, compactForecastHasDateStrip } from '../src/components/mapForecastPresentation';
import { withoutCompactMapForecast } from './mapForecastSourceGuards';
import { colors, radii, spacing } from '../src/theme';

const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
strictEqual(withoutCompactMapForecast(source), execFileSync('git', ['show', '8967e45:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'),
  'only declared header/search presentation and forecast height change; camera/sources/regional effects/nav remain exact');
for (const height of [0, 200, 320, 480, 560, 720, 1000]) {
  const budget = compactMapForecastHeight(height, spacing.lg);
  ok(budget >= 0); if (height >= spacing.lg * 2) ok(budget + spacing.lg <= height / 2);
}
strictEqual(compactMapForecastHeight(NaN, 16), 0);
ok(compactForecastHasDateStrip(280, 1)); ok(compactForecastHasDateStrip(280, 1.3));
ok(!compactForecastHasDateStrip(160, 1)); ok(!compactForecastHasDateStrip(280, 2));

const jsx = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const vars = new Map<string, string>(), elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.initializer) vars.set(n.name.getText(ast), n.initializer.getText(ast));
  if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) elements.push(n);
  ts.forEachChild(n, visit);
} visit(ast);
const tag = (n: typeof elements[number]) => ts.isJsxElement(n) ? n.openingElement : n;
const header = elements.find(n => tag(n).tagName.getText(ast) === 'View' && tag(n).attributes.getText(ast).includes('styles.compactHeader'))!;
const field = elements.find(n => tag(n).tagName.getText(ast) === 'Field')!;
const screen = elements.find(n => tag(n).tagName.getText(ast) === 'Screen')!;
ok(tag(screen).attributes.getText(ast).includes('topSafeArea'), 'headerless map uses the existing local top-inset owner, not extra guessed header padding');
const nativeScreen = readFileSync('node_modules/@react-navigation/elements/src/Screen.tsx', 'utf8');
ok(nativeScreen.includes('{headerShown ? (')); // No header inset is applied by a hidden tab header.
ok(readFileSync('src/components/ui.tsx', 'utf8').includes("edges={topSafeArea ? ['top', 'left', 'right'] : ['left', 'right']}"));
const nativeMap = elements.find(n => tag(n).tagName.getText(ast) === 'Map')!;
const recenter = elements.filter(n => tag(n).tagName.getText(ast) === 'Pressable' && tag(n).attributes.getText(ast).includes('accessibilityLabel="Prikaži mojo lokacijo"'));
strictEqual(recenter.length, 1); strictEqual(recenter[0].parent, nativeMap.parent, 'one existing location control stays outside the occluded detail subtree');
ok(tag(recenter[0]).attributes.getText(ast).includes('accessibilityRole="button"'));
const state: any = { colors, radii, spacing, RECENTER_SIZE: 48, StyleSheet: { create: (v: any) => v },
  View: 'View', Text: 'Text', Chip: 'Chip', Pressable: 'Pressable', Field: 'Field', Ionicons: 'Icon', commonStyles: {},
  mode: 'map', query: '', mapSearchExpanded: false, currentMapForecast: undefined, shadow: { active: false }, hotspots: Array(9).fill({}),
  dismissals: 0, Keyboard: { dismiss: () => state.dismissals++ }, camera: {}, context: {}, source: {}, writes: 0,
  setQuery: (q: string) => state.query = q, setMapSearchExpanded: (v: boolean) => state.mapSearchExpanded = v,
  closeMapForecast: () => state.currentMapForecast = undefined, switchHotspotView: (mode: string) => state.mode = mode,
  exports: {}, require: () => ({ jsx, jsxs: jsx }) };
const evaluate = (code: string) => runInNewContext(`(function () { ${ts.transpileModule(`exports.value = (${code});`, { fileName: 'render.tsx', compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText}; return exports.value; })()`, state);
state.styles = evaluate(vars.get('styles')!);
Object.defineProperty(state, 'mapSearchVisible', { get: () => evaluate(vars.get('mapSearchVisible')!) });
state.toggleMapSearch = evaluate(vars.get('toggleMapSearch')!);
let tree = evaluate(header.getText(ast));
ok(!text(tree).includes('shranjenih lokacij')); strictEqual(evaluate(field.parent.getText(ast)), null, 'map search closed by default');
const preserved = [state.camera, state.context, state.source];
const search = () => walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.includes('Poišči'));
ok(search()); ok(search().props.style.minHeight >= 48); search().props.onPress(); tree = evaluate(header.getText(ast));
const input = evaluate(field.parent.getText(ast)); strictEqual(input.type, 'Field'); ok(input.props.autoFocus);
input.props.onChangeText('Pikovo'); strictEqual(state.query, 'Pikovo');
const close = walk(tree).find(n => n.props.accessibilityLabel === 'Zapri iskanje in počisti poizvedbo'); close.props.onPress();
strictEqual(state.query, ''); strictEqual(evaluate(field.parent.getText(ast)), null); strictEqual(state.dismissals, 1);
state.mode = 'list'; tree = evaluate(header.getText(ast)); ok(text(tree).includes('9 shranjenih lokacij'));
strictEqual(evaluate(field.parent.getText(ast)).type, 'Field'); strictEqual(evaluate(field.parent.getText(ast)).props.autoFocus, false);
strictEqual(walk(tree).filter(n => n.type === 'Chip').length, 2); ok(!search());
state.mode = 'map'; state.query = 'Črna'; ok(evaluate(field.parent.getText(ast)), 'existing query remains visible after list/map switch');
state.currentMapForecast = { location: { latitude: 46, longitude: 14 } };
const ornament = tag(nativeMap).attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'attributionPosition') as ts.JsxAttribute;
const placement = evaluate((ornament.initializer as ts.JsxExpression).expression!.getText(ast));
strictEqual(placement.left, spacing.sm); strictEqual(placement.top, spacing.sm, 'native attribution uses free upper-left corner, not the location control');
strictEqual(evaluate(field.parent.getText(ast)), null); state.toggleMapSearch(); ok(state.mapSearchVisible); strictEqual(state.currentMapForecast, undefined);
deepStrictEqual([state.camera, state.context, state.source], preserved);
Object.assign(state, { locationRequestGate: { cancel() {} }, setLocating() {}, setSelectedId() {}, setMode: (mode: string) => state.mode = mode,
  setPlaceResults() {}, setPlaceSearchError() {}, setExploreLocation: (point: any) => state.explore = point,
  setCameraTarget: () => state.writes++, focusHotspot: (point: any) => state.saved = point });
state.mapSearchExpanded = true; state.query = 'Črna';
evaluate(vars.get('selectPlace')!)({ name: 'Črna', latitude: 46.5, longitude: 14.8 });
strictEqual(state.mapSearchExpanded, false); strictEqual(state.query, ''); strictEqual(state.explore.latitude, 46.5); strictEqual(state.writes, 1);
state.mapSearchExpanded = true; state.query = 'Pikovo'; evaluate(vars.get('selectHotspot')!)({ id: 'private-A', latitude: 46.4, longitude: 14.7 });
strictEqual(state.mapSearchExpanded, false); strictEqual(state.query, ''); strictEqual(state.saved.id, 'private-A');
ok(state.styles.compactHeader.paddingTop < state.styles.header.paddingTop);
ok(state.styles.compactHeader.paddingBottom < state.styles.header.paddingBottom);

// Actual context-action component, not another forecast evaluator or navigation stack.
const file = resolve('src/components/SevenDayMapForecast.tsx'), requireHere = createRequire(file), Module = requireHere('node:module'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
let open = false, hookCalls = 0, graphs = 0, saves = 0, details = 0, restores = 0;
mod.require = (id: string) => id === './PointHabitatContext' ? { PointHabitatContext: 'PointHabitatContext' } : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === 'react' ? {
  useState: () => [open, (v: boolean) => open = v], useRef: (initial: any) => ({ current: initial }) }
  : id === 'react-native' ? { ...Object.fromEntries(['View','Text','Pressable','Modal','ScrollView'].map(t => [t,t])), StyleSheet: { create: (v: any) => v, absoluteFill: {} } }
  : id === '@expo/vector-icons' ? { Ionicons: 'Icon' }
  : id === 'react-native-safe-area-context' ? { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }
  : id === '../services/useSevenDayConditions' ? { useSevenDayConditions: () => hookCalls++ } : requireHere(id);
mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const props = { location: { latitude: 46.5, longitude: 14.5, name: 'Moje dolgo zasebno rastišče' }, profileLabel: 'Jesenski goban', currentLabel: 'Pogoji točke · Danes: 72/100',
  onWeatherGraphs: () => graphs++, onSavePoint: () => saves++, onHotspotDetail: () => details++, onClose: () => restores++, hasPointDetails: true };
const render = () => { tree = mod.exports.ForecastPointActions(props); };
const trigger = () => walk(tree).find(n => n.props.accessibilityLabel === 'Dejanja točke');
const modal = () => walk(tree).find(n => n.type === 'Modal');
const press = (label: string) => walk(tree).find(n => n.type === 'Pressable' && text(n) === label).props.onPress();
render(); strictEqual(trigger().props.accessibilityState.expanded, false); strictEqual(modal().props.visible, false);
for (const label of ['Vremenski grafi', 'Shrani rastišče', 'Odpri rastišče', 'Pogoji in dejanja točke']) {
  trigger().props.onPress(); render(); ok(trigger().props.accessibilityState.expanded); ok(text(tree).includes(props.currentLabel)); ok(text(tree).includes(props.profileLabel));
  const safe = walk(tree).find(n => n.type === 'SafeAreaView'); deepStrictEqual(safe.props.edges, ['top','bottom','left','right']);
  const option = walk(tree).find(n => n.type === 'Pressable' && text(n) === label); ok(option.props.style.minHeight >= 48);
  press(label); render(); strictEqual(modal().props.visible, false);
}
deepStrictEqual([graphs, saves, details, restores], [1,1,1,1]);
trigger().props.onPress(); render(); modal().props.onRequestClose(); render(); ok(!open); strictEqual(restores, 1, 'Back closes menu only');
trigger().props.onPress(); render(); walk(tree).find(n => n.props.accessibilityLabel === 'Zapri dejanja točke').props.onPress(); render(); ok(!open);
strictEqual(hookCalls, 0, 'opening/dismissing context actions mounts no weather/scoring hook');
console.log('PASS compact default/header/search/list preservation; measured half-map budget, large-font full-view fallback, pinned primary CTA, context menu actions/Back/outside/48dp/safe area; original map/scoring/cache/camera byte-pinned. Style budgets are not physical Android measurements.');
