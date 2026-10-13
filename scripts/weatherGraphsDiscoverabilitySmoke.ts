import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { colors, radii, spacing } from '../src/theme';
import { slNumber, slDateTime } from '../src/domain/format';
import { buildWeatherDailySeries, summarySeriesInputs, weatherLocalDate } from '../src/domain/weatherSeries';
import { graphPeriodSummary } from '../src/components/weatherGraphPresentation';
import { topThreeHotspots } from '../src/domain/hotspotTopThree';
import { conditionsNavigationPatch } from '../src/domain/hotspotHeatmap';
import { withoutConditionsListEntry } from './conditionsListEntryFixture';
import { createAdvancedDetailsFocus } from '../src/components/advancedDetailsFocus';

const node = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const file = resolve('src/components/WeatherGraphsView.tsx'), nativeRequire = createRequire(file);
const Module = nativeRequire('node:module'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
let focus = 0;
// Native frame cancellation exists on Android; this lightweight discovery harness has no frames.
const originalCancelFrame = globalThis.cancelAnimationFrame;
const originalFrame = globalThis.requestAnimationFrame;
let frameId = 0;
const pendingFrames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = fn => { pendingFrames.set(++frameId, fn); return frameId; };
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
let refCursor = 0;
const refs: any[] = [];
let overviewHotspots: any[] = [], overviewAssessments: any = {}, overviewComplete = true;
const navigationCalls: any[] = [], focusCalls: any[] = [], hookContexts: any[] = [];
const bindings: Record<string, any> = {
  React: { Fragment: 'Fragment', createElement: (type: any, props: any, ...children: any[]) => node(type, { ...props, children }) },
  useState: (initial: any) => { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => values[slot] = typeof next === 'function' ? next(values[slot]) : next]; },
  useEffect() {}, useMemo: (f: any) => f(), useCallback: (f: any) => f, useRef: (n: any) => { const slot = refCursor++; return refs[slot] ??= { current: n }; },
  useNavigation: () => ({ navigate: (...args: any[]) => navigationCalls.push(args) }),
  useApp: () => ({ hotspots: overviewHotspots, repository: {}, online: true, exploreLocation: { ...location, source: 'place' }, requestHotspotFocus: (...args: any[]) => focusCalls.push(args), setExploreLocation() { throw new Error('graphs cannot change global location'); } }),
  ...Object.fromEntries(['Screen', 'Text', 'Card', 'SectionTitle', 'Chip', 'View', 'AppButton', 'Notice', 'ActivityIndicator', 'WeatherGraphsEntry', 'WeatherGraphsModal', 'SevenDayConditionsEntry', 'SevenDayConditionsModal', 'Metric', 'ConditionsAdvancedDetails'].map(s => [s, s])),
  styles: {}, commonStyles: {}, colors, spacing, createAdvancedDetailsFocus, MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore, slNumber, slDateTime,
  useLocationConditions: (_: any, profile: any, day: any) => { hookContexts.push([profile, day]); return { assessments: overviewAssessments, complete: overviewComplete }; }, topThreeHotspots, buildWeatherDailySeries, summarySeriesInputs, weatherLocalDate, graphPeriodSummary, conditionsNavigationPatch,
  ScrollView: 'ScrollView', Pressable: 'Pressable', DetailLine: 'DetailLine', debugNumber: (v: any, unit: string) => v == null ? 'ni podatka' : v + ' ' + unit,
  placeDetails: () => '',
};
const compiled = ts.transpileModule(screen.getText(ast).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const conditions = new Function(...Object.keys(bindings), `${compiled}; return ConditionsScreen;`)(...Object.values(bindings));
const render = () => { cursor = 0; refCursor = 0; return conditions(); };
render();
values[states.indexOf('weatherSummary')] = { ...location, source: 'open-meteo', updatedAt: '2026-10-11T08:00:00Z', errors: {}, stale: false,
  current: { temperatureC: 14 }, historical: { days: [] } };
let tree = render();
strictEqual(tree.props.topSafeArea, true, 'headerless Razmere owns its top safe-area without changing navigation');
const ordered = walk(tree);
const start = ordered.findIndex(n => n.type === 'WeatherGraphsEntry');
ok(start > ordered.findIndex(n => n.type === 'SectionTitle' && text(n) === 'Gobarski signal'));
ok(start < ordered.findIndex(n => n.type === 'SectionTitle' && text(n) === 'Vreme na kratko'));
strictEqual(values[states.indexOf('showWeatherDetails')], false);
ordered[start].props.onPress(); tree = render();
const modal = walk(tree).find(n => n.type === 'WeatherGraphsModal'); strictEqual(modal.props.visible, true);
deepStrictEqual(modal.props.location, location);
modal.props.onClose(); tree = render();
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.visible, false);
strictEqual(values[states.indexOf('showWeatherDetails')], false);
strictEqual(values[states.indexOf('weatherProfileId')], 'generic');
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.summary, values[states.indexOf('weatherSummary')]);
strictEqual(navigationCalls.length, 0, 'graph opening/closing stays on the originating screen');
// Seven-day entry uses the same exact selected location/profile; it does not mutate the map day context.
walk(tree).find(n => n.type === 'SevenDayConditionsEntry').props.onPress(); tree = render();
let weekly = walk(tree).find(n => n.type === 'SevenDayConditionsModal');
strictEqual(weekly.props.visible, true); deepStrictEqual(weekly.props.location, location);
strictEqual(weekly.props.profileId, 'generic');
weekly.props.onProfileChange('boletusEdulis'); tree = render();
strictEqual(walk(tree).find(n => n.type === 'SevenDayConditionsModal').props.profileId, 'boletusEdulis');
values[states.indexOf('weatherError')] = 'Predhodna omrežna napaka'; values[states.indexOf('weatherLoading')] = true;
const refreshedSummary = { ...values[states.indexOf('weatherSummary')], updatedAt: new Date().toISOString() };
weekly.props.onSnapshot(refreshedSummary); tree = render();
strictEqual(values[states.indexOf('weatherSummary')], refreshedSummary); strictEqual(values[states.indexOf('weatherLoading')], false);
strictEqual(values[states.indexOf('weatherError')], undefined, 'a successful weekly canonical refresh clears the previous error, not the profile/context');
walk(tree).find(n => n.type === 'SevenDayConditionsModal').props.onSnapshot({ ...refreshedSummary, updatedAt: '2020-01-01T00:00:00Z' });
strictEqual(values[states.indexOf('weatherSummary')], refreshedSummary, 'older same-location callback cannot replace a newer canonical snapshot');
weekly.props.onClose(); tree = render(); strictEqual(walk(tree).find(n => n.type === 'SevenDayConditionsModal').props.visible, false);
strictEqual(navigationCalls.length, 0, 'weekly close/Android Back stays on the same screen');
values[states.indexOf('weatherProfileId')] = 'generic';
values[states.indexOf('selectedPlace')] = { ...location, latitude: 45.8, name: 'Nova lokacija' };
tree = render(); strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.location.latitude, 45.8);
const preservedSummary = values[states.indexOf('weatherSummary')];
weekly.props.onSnapshot({ ...preservedSummary, latitude: location.latitude, longitude: location.longitude });
strictEqual(values[states.indexOf('weatherSummary')], preservedSummary, 'late old-location weekly callback cannot replace new-location data');

// Razmere V2 actual overview render: one selector, same scorer, compact weather, complete-only Top 3.
const day = weatherLocalDate();
values[states.indexOf('weatherSummary')] = { ...values[states.indexOf('selectedPlace')], source: 'open-meteo', updatedAt: new Date().toISOString(), errors: {}, stale: false,
  current: { temperatureC: 14, weatherDescription: 'Delno oblačno', soilMoisture0To7Cm: .271, soilMoisture7To28Cm: .29 },
  historical: { days: [], rain3dMm: 3, rain7dMm: 7, rain14dMm: 14, rain26dMm: 80, rain30dMm: 30, rain60dMm: 60, avgTemp7dC: 11, avgTemp14dC: 12, avgTemp20dC: 13, evapotranspiration7dMm: 18.4 },
  forecast: { days: Array.from({ length: 7 }, (_, i) => ({ date: new Date(new Date(day + 'T12:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10), precipitationMm: 2 })), rain3dMm: 6, rain7dMm: 14 },
};
overviewHotspots = Array.from({ length: 5 }, (_, i) => ({ id: 'hotspot-' + i, title: 'Rastišče ' + i, latitude: 46 + i / 100, longitude: 14 }));
overviewAssessments = Object.fromEntries(overviewHotspots.map((h, i) => [h.id, { score: i === 4 ? null : 80 + i, classLabel: 'Dobre razmere' }]));
tree = render();
ok(!text(tree).includes('m³/m³') && !text(tree).includes('ET₀'));
ok(text(tree).includes('Padavine zadnjih 14 dni: 14 mm')); ok(text(tree).includes('Padavine naslednjih 7 dni: 14 mm'));
const headings = walk(tree).filter(n => n.type === 'SectionTitle').map(text);
deepStrictEqual(headings, ['Lokacija', 'Gobarski signal', 'Vreme na kratko', 'Najboljša rastišča']);
strictEqual(walk(tree).filter(n => n.type === 'ScrollView' && n.props.horizontal).length, 1);
const overviewRows = () => walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Prikaži Rastišče'));
strictEqual(overviewRows().length, 3); ok(text(overviewRows()[0]).includes('83/100'));
overviewRows()[0].props.onPress(); strictEqual(focusCalls.at(-1)[0].id, 'hotspot-3'); deepStrictEqual(focusCalls.at(-1)[1], { profileId: 'generic', targetDay: 'today' });
for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES)) {
  walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === MUSHROOM_WEATHER_PROFILES[profile as keyof typeof MUSHROOM_WEATHER_PROFILES].label).props.onPress();
  tree = render(); strictEqual(values[states.indexOf('weatherProfileId')], profile);
  ok(text(tree).includes(calculateMushroomWeatherScore(values[states.indexOf('weatherSummary')], profile as any).score + '/100'));
  deepStrictEqual(hookContexts.at(-1), [profile, 'today']);
}
walk(tree).find(n => n.type === 'AppButton' && n.props.title === 'Poglej vsa rastišča').props.onPress();
const allParams = navigationCalls.at(-1); strictEqual(allParams[0], 'Tabs'); strictEqual(allParams[1].screen, 'Map');
deepStrictEqual(allParams[1].params.conditionsListRequest.context, { targetProfile: 'lactariusDeliciosus', dayMode: 'today' });
walk(tree).find(n => n.type === 'Pressable' && text(n) === 'Zakaj ta ocena?').props.onPress(); tree = render();
const detailProps = walk(tree).find(n => n.type === 'ConditionsAdvancedDetails').props;
const scrollCalls: any[] = [];
tree.props.scrollRef.current = { scrollTo: (value: any) => scrollCalls.push(value) };
strictEqual(scrollCalls.length, 0);
walk(tree).find(n => n.type === 'View' && n.props.onLayout).props.onLayout({ nativeEvent: { layout: { y: 900 } } });
strictEqual(scrollCalls.length, 0, 'actual Why handler waits for layout and next frame');
for (const fn of pendingFrames.values()) fn(0); pendingFrames.clear();
deepStrictEqual(scrollCalls, [{ y: 900 - spacing.lg, animated: true }]);
strictEqual(detailProps.score.score, calculateMushroomWeatherScore(detailProps.summary, 'lactariusDeliciosus').score);
detailProps.onOpenGraphs(); tree = render();
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.visible, true);
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.location.latitude, detailProps.summary.latitude);
strictEqual(detailProps.summary.current.soilMoisture0To7Cm, .271); strictEqual(detailProps.summary.current.soilMoisture7To28Cm, .29);
strictEqual(detailProps.summary.historical.evapotranspiration7dMm, 18.4, 'technical values passed to the unchanged model details without duplicating their table');
ok(walk(tree).some(n => n.type === 'ConditionsAdvancedDetails' && n.props.score.profile === 'lactariusDeliciosus'));
walk(tree).find(n => n.type === 'Pressable' && text(n) === 'Zakaj ta ocena?').props.onPress(); tree = render();
strictEqual(values[states.indexOf('showWeatherDetails')], true, 'Why is a reveal action, not an accidental close');
for (const fn of pendingFrames.values()) fn(0); pendingFrames.clear(); strictEqual(scrollCalls.length, 2);
walk(tree).find(n => n.type === 'Pressable' && text(n).startsWith('Napredni podatki in razlaga modela')).props.onPress(); tree = render();
strictEqual(values[states.indexOf('showWeatherDetails')], false);
overviewComplete = false; tree = render(); strictEqual(overviewRows().length, 0); ok(text(tree).includes('Izračunavam pogoje'));
overviewComplete = true; overviewAssessments = {}; tree = render(); strictEqual(overviewRows().length, 0); ok(text(tree).includes('Trenutno ni mogoče izračunati'));
overviewAssessments = { 'hotspot-0': { score: 0, classLabel: 'Neugodne razmere' } }; tree = render(); strictEqual(overviewRows().length, 1); ok(text(overviewRows()[0]).includes('0/100'), 'valid zero differs from unavailable');
values[states.indexOf('weatherSummary')].forecast.days.pop(); values[states.indexOf('weatherSummary')].historical.rain14dMm = undefined;
tree = render(); ok(text(tree).includes('Podatki za 6 od 7 dni')); ok(text(tree).includes('Padavine zadnjih 14 dni: ni podatka'));
// Weather acquisitions stay outside presentation state: only the selected-location loader remains.
strictEqual((screen.getText(ast).match(/getMushroomWeatherSummary\(/g) || []).length, 1);
values[states.indexOf('error')] = 'GPS dovoljenje ni na voljo'; values[states.indexOf('locationSettingsRequired')] = true; tree = render();
ok(text(tree).includes('GPS dovoljenje ni na voljo')); ok(walk(tree).some(n => n.type === 'AppButton' && n.props.title === 'Odpri nastavitve aplikacije'));
values[states.indexOf('selectedPlace')] = { ...location, latitude: 47, name: 'Druga lokacija' }; tree = render();
ok(text(tree).includes('Preračunavam razmere ...')); ok(!text(tree).includes('Premalo podatkov')); ok(!text(tree).includes('Padavine zadnjih 14 dni: 14 mm'), 'old weather cannot appear under a new location');
strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.location.latitude, 47);
// Real map source callback records only the tapped point. Camera, scoring and navigation path unchanged.
const mapSource = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const mapAst = ts.createSourceFile('MapScreen.tsx', mapSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let listEntry: ts.ArrowFunction | undefined;
const listVisitor = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(mapAst) === 'useEffect' && n.arguments[0]?.getText(mapAst).includes('const intent = route.params?.conditionsListRequest')) listEntry = n.arguments[0] as ts.ArrowFunction; ts.forEachChild(n, listVisitor); }; listVisitor(mapAst);
const listState: any = { route: { params: allParams[1].params }, isFocused: true, consumedConditionsListRequest: { current: undefined } };
const listCalls: any[] = [];
const listBindings = { ...listState, conditionsNavigationPatch, switchHotspotView: (v: any) => listCalls.push(['view', v]), setOwnerFilter: (v: any) => listCalls.push(['owner', v]), setQuery: (v: any) => listCalls.push(['query', v]), setListSort: (v: any) => listCalls.push(['sort', v]), updateHeatmapNavigation: (v: any) => listCalls.push(['context', v]) };
const enterList = new Function(...Object.keys(listBindings), 'return (' + listEntry!.getText(mapAst) + ');')(...Object.values(listBindings));
enterList(); deepStrictEqual(listCalls, [['view', 'list'], ['owner', 'mine'], ['query', ''], ['sort', 'conditions'], ['context', { profileId: 'lactariusDeliciosus', targetDay: 'today' }]]);
enterList(); strictEqual(listCalls.length, 5, 'consumed entry intent cannot reset a later ordinary map visit');
strictEqual(withoutConditionsListEntry(mapSource).replace(/\r\n/g, '\n'), execFileSync('git', ['show', 'b04d47b:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'map/camera/LOD/source code unchanged outside additive list entry');
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
globalThis.requestAnimationFrame = originalFrame;
console.log('PASS Razmere V2 hierarchy/same scorer/4 profiles, compact weather/coverage, preserved advanced inputs/model explanations, complete-only Top 3/valid zero/unavailable/loading, context/list-sort entry consumed once, graph origin/location/back, GPS errors, unchanged Map outside list intent and unchanged weather/cache/LOD. Native layout/TalkBack require phone QA.');
