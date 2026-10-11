import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { colors, radii, spacing } from '../src/theme';
import { slNumber, slDateTime } from '../src/domain/format';

const node = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const file = resolve('src/components/WeatherGraphsView.tsx'), nativeRequire = createRequire(file);
const Module = nativeRequire('node:module'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
let focus = 0;
// Native frame cancellation exists on Android; this lightweight discovery harness has no frames.
const originalCancelFrame = globalThis.cancelAnimationFrame;
globalThis.cancelAnimationFrame = () => {};
mod.require = (id: string) => {
  if (id === 'react') return { useRef: (initial: any) => ({ current: initial === null ? 7 : initial }), useState: (initial: any) => [initial, () => {}], useLayoutEffect: () => {} };
  if (id === 'react/jsx-runtime') return { jsx: node, jsxs: node };
  if (id === 'react-native') return { ...Object.fromEntries(['Modal', 'View', 'Text', 'Pressable', 'ScrollView'].map(s => [s, s])),
    useWindowDimensions: () => ({ fontScale: 1 }),
    StyleSheet: { create: (s: any) => s }, AccessibilityInfo: { setAccessibilityFocus: (n: number) => focus = n }, findNodeHandle: (n: number) => n };
  if (id === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
  if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
  if (id === './WeatherGraphs') return { WeatherGraphs: 'WeatherGraphs' };
  return nativeRequire(id);
};
mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, file);
let opened = 0, closed = 0;
const entry = mod.exports.WeatherGraphsEntry({ onPress: () => opened++ });
strictEqual(entry.type, 'Pressable'); strictEqual(entry.props.accessibilityRole, 'button');
ok(entry.props.accessibilityLabel.includes('30 dni')); ok(entry.props.accessibilityHint);
ok(text(entry).includes('Vremenski grafi') && text(entry).includes('Padavine in temperatura') && text(entry).includes('Odpri grafe →'));
ok(entry.props.style({ pressed: false })[0].minHeight >= 48);
entry.props.onPress(); strictEqual(opened, 1);
const location = { latitude: 46.41, longitude: 14.77, name: 'Moje izbrano območje pri Uršlji gori' };
const summary = { latitude: 45, longitude: 15 };
const props = { visible: true, location, summary, weatherCellId: 'grid-1', onClose: () => closed++ };
const view = mod.exports.WeatherGraphsModal(props);
strictEqual(view.type, 'Modal'); strictEqual(view.props.presentationStyle, 'fullScreen');
view.props.onRequestClose(); strictEqual(closed, 1, 'Android Back uses just the close callback');
view.props.onShow(); strictEqual(focus, 7, 'heading gets screen-reader focus on show');
const back = walk(view).find(n => n.type === 'Pressable');
back.props.onPress(); strictEqual(closed, 2); ok(back.props.style({ pressed: false })[0].minHeight >= 48);
const graph = walk(view).find(n => n.type === 'WeatherGraphs');
deepStrictEqual(graph.props.location, location, 'exact source location, not seed/GPS');
strictEqual(graph.props.summary, summary, 'seed passed to existing component which validates its location');
strictEqual(graph.props.weatherCellId, undefined, 'different grid location cannot masquerade as the tapped point');
const matched = mod.exports.WeatherGraphsModal({ ...props, summary: location });
strictEqual(walk(matched).find(n => n.type === 'WeatherGraphs').props.weatherCellId, 'grid-1', 'identical grid point may reuse existing regional batch cache');
strictEqual(walk(view).filter(n => n.type === 'WeatherGraphs').length, 1);
strictEqual(walk(view).filter(n => n.type === 'ScrollView').length, 1, 'single vertical scroll; charts only scroll horizontally');
const safe = walk(view).find(n => n.type === 'SafeAreaView');
deepStrictEqual(safe.props.edges, ['top', 'bottom', 'left', 'right']); ok(safe.props.accessibilityViewIsModal);
ok(walk(view).some(n => n.props.accessibilityRole === 'header' && text(n) === 'Vremenski grafi'));
ok(text(view).includes(location.name));
strictEqual(walk(mod.exports.WeatherGraphsModal({ ...props, visible: false })).filter(n => n.type === 'WeatherGraphs').length, 0, 'closed view does not mount charts');
for (const invalid of [undefined, { ...location, latitude: NaN }, { ...location, longitude: 181 }]) {
  const missing = mod.exports.WeatherGraphsModal({ ...props, location: invalid });
  strictEqual(walk(missing).filter(n => n.type === 'WeatherGraphs').length, 0);
  ok(text(missing).includes('najprej izberi lokacijo'));
}
// Real Razmere JSX: entry is independent of the old Podrobnosti state, origin remains mounted.
const source = readFileSync('src/screens/ConditionsScreen.tsx', 'utf8');
const ast = ts.createSourceFile('ConditionsScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'ConditionsScreen')! as ts.FunctionDeclaration;
const states = screen.body!.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
  .filter(d => d.initializer && ts.isCallExpression(d.initializer) && d.initializer.expression.getText(ast) === 'useState')
  .map(d => ((d.name as ts.ArrayBindingPattern).elements[0] as ts.BindingElement).name.getText(ast));
let cursor = 0;
const values: any[] = [];
const bindings: Record<string, any> = {
  React: { Fragment: 'Fragment', createElement: (type: any, props: any, ...children: any[]) => node(type, { ...props, children }) },
  useState: (initial: any) => { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => values[slot] = typeof next === 'function' ? next(values[slot]) : next]; },
  useEffect() {}, useMemo: (f: any) => f(), useCallback: (f: any) => f, useRef: (n: any) => ({ current: n }),
  useNavigation: () => ({ navigate() { throw new Error('graph opening must not navigate away from origin'); } }),
  useApp: () => ({ hotspots: [], repository: {}, online: true, exploreLocation: { ...location, source: 'place' }, setExploreLocation() { throw new Error('graphs cannot change global location'); } }),
  ...Object.fromEntries(['Screen', 'Text', 'Card', 'SectionTitle', 'Chip', 'View', 'AppButton', 'Notice', 'ActivityIndicator', 'WeatherGraphsEntry', 'WeatherGraphsModal', 'Metric', 'WeatherProfileScoreDetails'].map(s => [s, s])),
  styles: {}, commonStyles: {}, colors, MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore, slNumber, slDateTime,
  placeDetails: () => '',
};
const compiled = ts.transpileModule(screen.getText(ast).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const conditions = new Function(...Object.keys(bindings), `${compiled}; return ConditionsScreen;`)(...Object.values(bindings));
const render = () => { cursor = 0; return conditions(); };
render();
values[states.indexOf('weatherSummary')] = { ...location, source: 'open-meteo', updatedAt: '2026-10-11T08:00:00Z', errors: {}, stale: false,
  current: { temperatureC: 14 }, historical: { days: [] } };
let tree = render();
const ordered = walk(tree);
const start = ordered.findIndex(n => n.type === 'WeatherGraphsEntry');
ok(start > ordered.findIndex(n => n.type === 'SectionTitle' && text(n) === 'Trenutno'));
ok(start < ordered.findIndex(n => n.type === 'SectionTitle' && text(n) === 'Pretekle padavine'));
strictEqual(values[states.indexOf('showWeatherDetails')], false);
ordered[start].props.onPress(); tree = render();
const modal = walk(tree).find(n => n.type === 'WeatherGraphsModal'); strictEqual(modal.props.visible, true);
deepStrictEqual(modal.props.location, location);
modal.props.onClose(); tree = render();
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.visible, false);
strictEqual(values[states.indexOf('showWeatherDetails')], false);
strictEqual(values[states.indexOf('weatherProfileId')], 'generic');
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.summary, values[states.indexOf('weatherSummary')]);
values[states.indexOf('selectedPlace')] = { ...location, latitude: 45.8, name: 'Nova lokacija' };
tree = render(); strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.location.latitude, 45.8);
// Real map source callback records only the tapped point. Camera, scoring and navigation path unchanged.
const mapSource = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const mapAst = ts.createSourceFile('MapScreen.tsx', mapSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let press: ts.ArrowFunction | undefined;
const visit = (n: ts.Node) => {
  if (ts.isJsxOpeningElement(n) && n.tagName.getText(mapAst) === 'GeoJSONSource'
    && n.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(mapAst) === 'id' && p.initializer?.getText(mapAst) === '"mushroom-heatmap-pilot"')) {
    const attr = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(mapAst) === 'onPress') as ts.JsxAttribute;
    press = ((attr.initializer as ts.JsxExpression).expression as ts.ConditionalExpression).whenTrue as ts.ArrowFunction;
  }
  ts.forEachChild(n, visit);
}; visit(mapAst);
const point = { current: undefined as any }; let selection: any;
const tap = new Function('graphMapPoint', 'setSelectedId', 'updateHeatmapNavigation', `return (${press!.getText(mapAst)});`)(point, () => {}, (patch: any) => selection = patch);
tap({ stopPropagation() {}, nativeEvent: { lngLat: [14.9, 46.6], features: [{ properties: { id: 'cell-1' } }] } });
deepStrictEqual(point.current, { areaId: 'cell-1', latitude: 46.6, longitude: 14.9 });
deepStrictEqual(selection, { selectedAreaId: 'cell-1' });
ok(mapSource.includes('graphMapPoint.current && graphMapPoint.current.areaId === selectedHeatmapAreaId'));
ok(!mapSource.includes('<WeatherGraphs summary='), 'no duplicate inline charts');
ok(!source.includes('<WeatherGraphs summary='));
for (const path of ['src/services/weather.ts', 'src/services/weatherGraphs.ts', 'src/domain/weatherSeries.ts', 'src/domain/mushroomWeather.ts',
  'src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/domain/hotspotRanking.ts', 'src/domain/heatmap/controlsState.ts', 'src/navigation/AppNavigator.tsx'])
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `7dcc5cb:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path);
globalThis.cancelAnimationFrame = originalCancelFrame;
console.log('PASS graph discovery before historical summaries; open without Podrobnosti; native modal/back/heading/48pt/safe-area props; exact Razmere and map coordinates; missing-location guard; closed charts unmounted; context preserved; shared transport/model/scorers/cache/navigation/LOD pinned. Native layout/TalkBack still require phone QA.');
