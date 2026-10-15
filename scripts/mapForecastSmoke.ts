import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { mapForecastLocation, forecastPointFromTap } from '../src/domain/mapForecast';
import { heatmapControlsReducer, heatmapControlsPanelVisible, INITIAL_HEATMAP_CONTROLS } from '../src/domain/heatmap/controlsState';
import { withoutMapForecast, withoutMapForecastUx } from './mapForecastSourceGuards';
import { forecastComparison, forecastDateLabel, forecastFactorInsights } from '../src/components/mapForecastPresentation';
import { CANONICAL_POINT_POLICY } from '../src/domain/sevenDayConditions';
import { HOURLY_INTERVAL_CONTRACT } from '../src/domain/weatherIntervals';
import { advancedFactors } from '../src/components/conditionsAdvancedPresentation';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';

const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const baseline = execFileSync('git', ['show', '6c80905:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
strictEqual(withoutMapForecast(source), baseline, 'only declared forecast UI/selection changes; original camera, regional effects, data and source wiring remain exact');
strictEqual(withoutMapForecastUx(source), execFileSync('git', ['show', '1b71f11:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'V1.1 changes only preview/modal presentation callbacks and graphs phase');
for (const path of ['src/domain/sevenDayConditions.ts','src/domain/soilSampling.ts','src/domain/weatherIntervals.ts','src/domain/mushroomWeather.ts',
  'src/services/pointConditions.ts','src/services/sevenDayConditions.ts','src/services/sevenDayHourlyWeather.ts','src/services/useSevenDayConditions.ts',
  'src/services/weather.ts','src/services/heatmap/useLocationConditions.ts','src/services/heatmap/regionalWeather.ts','src/services/heatmap/useHeatmapVisuals.ts',
  'src/domain/hotspotRanking.ts','src/domain/hotspotTopThree.ts','src/domain/heatmap/controlsState.ts','src/state/AppContext.tsx','src/storage/database.ts','src/domain/conditionsSnapshot.ts'])
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `6c80905:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path);

const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const vars = new Map<string, string>(), effects: string[] = [], elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
function inspect(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.initializer) vars.set(n.name.getText(ast), n.initializer.getText(ast));
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect') effects.push(n.arguments[0].getText(ast));
  if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) elements.push(n);
  ts.forEachChild(n, inspect);
} inspect(ast);
const tag = (n: typeof elements[number]) => ts.isJsxElement(n) ? n.openingElement : n;
const attrs = (n: typeof elements[number], key: string) => {
  const attr = tag(n).attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === key) as ts.JsxAttribute;
  return (attr.initializer as ts.JsxExpression).expression!.getText(ast);
};
const element = (name: string, condition: (n: typeof elements[number]) => boolean = () => true) => elements.find(n => tag(n).tagName.getText(ast) === name && condition(n))!;
const state: any = { isFocused: true, mode: 'map', ownerFilter: 'mine', heatmapEnabled: true, forecastEnvironment: 'true/mine', mapForecast: undefined,
  selectedId: undefined, graphMapPoint: { current: undefined }, selectedHeatmapAreaId: undefined, heatmapAreaLocality: undefined,
  conditionsContext: { targetProfile: 'cantharellusCibarius', dayMode: 'tomorrow' }, mapForecastLocation, forecastPointFromTap,
  spacing: { sm: 8 },
  controls: { ...INITIAL_HEATMAP_CONTROLS, userDismissedPanel: true, topThreeOriginId: 'private-A' },
  heatmapAreaCardOpen: false, topThreeVisible: false, topThreeOriginPopup: false, heatmapControlsPanelVisible,
  suppressMapPressUntil: { current: 0 }, exploreLocation: { name: 'Unrelated GPS', latitude: 1, longitude: 2 },
  camera: { current: { center: [14, 46], zoom: 13, bearing: 28 } }, listSort: 'conditions', cameraWrites: 0, navWrites: 0,
  gpsCancelled: 0, locationRequestGate: { cancel: () => state.gpsCancelled++ }, setLocating() {}, cancelPendingHotspotFocus() {}, mapWasMoved: { current: true },
  setOwnerFilter: (v: string) => state.ownerFilter = v, setShowMyHotspots() {}, setMode: (v: string) => state.mode = v,
  setCameraTarget: () => state.cameraWrites++, setSelectedId: (v: string) => state.selectedId = v,
  updateHeatmapNavigation: (v: any) => { state.navWrites++; Object.assign(state, v.selectedAreaId === undefined ? { selectedHeatmapAreaId: undefined } : {}); },
  dispatchHeatmapControls: (a: any) => state.controls = heatmapControlsReducer(state.controls, a),
};
const hotspots = [{ id: 'private-A', title: 'Zasebno rastišče A', latitude: 46.1, longitude: 14.2 }, { id: 'private-B', title: 'Drugo rastišče', latitude: 46.7, longitude: 15.3 }];
state.hotspots = hotspots;
Object.defineProperty(state, 'selected', { get: () => hotspots.find(h => h.id === state.selectedId) });
Object.defineProperty(state, 'heatmapControls', { get: () => state.controls });
const compile = (code: string) => runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, state);
Object.defineProperty(state, 'currentMapForecast', { get: () => compile(vars.get('currentMapForecast')!) });
state.setMapForecast = (v: any) => state.mapForecast = typeof v === 'function' ? v(state.mapForecast) : v;
for (const name of ['closeMapForecast','showPointForecast','selectedForecastLocation','openMapForecast','focusHotspot']) state[name] = compile(vars.get(name)!);

state.openMapForecast(); strictEqual(state.mapForecast.phase, 'picking'); strictEqual(state.mapForecast.location, undefined, 'no GPS/map centre fallback');
strictEqual(state.gpsCancelled, 1, 'late GPS acquisition cannot override a newer explicit forecast selection');
strictEqual(compile(attrs(element('Map'), 'attributionPosition')).top, 8, 'attribution stays above the compact bottom panel');
strictEqual(state.navWrites, 0); strictEqual(state.cameraWrites, 0);
const mapPress = compile(attrs(element('Map'), 'onPress'));
mapPress({ nativeEvent: { lngLat: [15.17, 46.33] } });
strictEqual(state.mapForecast.phase, 'preview'); strictEqual(state.mapForecast.location.latitude, 46.33); strictEqual(state.mapForecast.location.longitude, 15.17);
strictEqual(state.mapForecast.location.source, 'map-point'); strictEqual(state.mapForecast.profileId, 'cantharellusCibarius'); strictEqual(state.mapForecast.initialDay, 1);
strictEqual(state.navWrites, 0); strictEqual(state.cameraWrites, 0);
state.closeMapForecast(); state.graphMapPoint.current = { areaId: 'cell-A', latitude: 46.24, longitude: 14.37 }; state.selectedHeatmapAreaId = 'cell-A';
state.openMapForecast(); strictEqual(state.mapForecast.location.latitude, 46.24, 'actual tapped point, not polygon centre');
state.closeMapForecast(); state.selectedHeatmapAreaId = 'cell-B'; state.openMapForecast(); strictEqual(state.mapForecast.phase, 'picking', 'stale area reference rejected');
state.closeMapForecast(); state.heatmapEnabled = false; state.openMapForecast(); strictEqual(state.mapForecast.phase, 'picking', 'old conditions point cannot leak into Rastišča mode'); state.heatmapEnabled = true;
ok(!forecastPointFromTap([NaN, 46])); ok(!forecastPointFromTap([181, 46])); ok(!mapForecastLocation({ hotspot: hotspots[0], owner: 'friends', conditionsEnabled: true }));

for (const id of ['regional-overview-source', 'mushroom-heatmap-pilot']) {
  state.closeMapForecast(); state.openMapForecast(); let stops = 0;
  const press = compile(attrs(element('GeoJSONSource', n => tag(n).attributes.getText(ast).includes(`id="${id}"`)), 'onPress').replace(/visual.interactionLod === '(overview|detail)'/, 'true'));
  press({ stopPropagation: () => stops++, nativeEvent: { lngLat: [14.67, 46.41], features: [] } });
  strictEqual(stops, 1); strictEqual(state.mapForecast.phase, 'preview'); strictEqual(state.mapForecast.location.longitude, 14.67);
}
state.suppressMapPressUntil.current = 0; state.closeMapForecast(); state.openMapForecast();
const markerPress = compile(attrs(element('HotspotConditionsMarkers'), 'onSelect'));
markerPress(hotspots[1]); strictEqual(state.selectedId, hotspots[1].id); strictEqual(state.mapForecast.location.latitude, hotspots[1].latitude);
strictEqual(state.mapForecast.location.source, 'hotspot'); strictEqual(state.cameraWrites, 1, 'only existing explicit hotspot focus animates');
state.closeMapForecast(); state.selectedId = hotspots[0].id;
state.controls = { userDismissedPanel: true, topThreeOriginId: hotspots[0].id };
const preserved = { camera: state.camera.current, controls: state.controls, selected: state.selectedId, context: state.conditionsContext, writes: state.navWrites };
state.openMapForecast(); const forecast = element('SevenDayConditionsModal');
strictEqual(state.mapForecast.hotspotId, hotspots[0].id);
const originalLatitude = hotspots[0].latitude; hotspots[0].latitude += .01; strictEqual(state.currentMapForecast, undefined, 'edited/deleted saved coordinates cannot retain an old forecast under current selection');
compile(effects.find(e => e.includes('if (mapForecast && !currentMapForecast)'))!)(); strictEqual(state.mapForecast, undefined);
hotspots[0].latitude = originalLatitude; strictEqual(state.currentMapForecast, undefined, 'invalidated origin cannot silently resurrect'); state.openMapForecast();
state.setMapForecast({ ...state.mapForecast, phase: 'full' });
compile(attrs(forecast, 'onProfileChange'))('lactariusDeliciosus'); strictEqual(state.mapForecast.profileId, 'lactariusDeliciosus');
strictEqual(state.conditionsContext, preserved.context, 'full-view profile is local; regional map context stays unchanged');
compile(attrs(forecast, 'onSnapshot'))({ latitude: 99 }); strictEqual(state.navWrites, preserved.writes, 'no Razmere snapshot synchronization');
compile(attrs(forecast, 'onClose'))(); strictEqual(state.mapForecast.phase, 'preview'); strictEqual(state.selectedId, preserved.selected);
const preview = element('SevenDayMapForecastPreview');
compile(attrs(preview, 'onSelectDate'))(5, '2026-10-19'); strictEqual(state.mapForecast.selectedDate, '2026-10-19');
const rapidSelection = compile(`((currentMapForecast) => (${attrs(preview, 'onSelectDate')}))(currentMapForecast)`);
rapidSelection(4, '2026-10-18'); rapidSelection(5, '2026-10-19'); strictEqual(state.mapForecast.selectedDate, '2026-10-19', 'latest batched day tap wins within the same point intent');
compile(attrs(preview, 'onFull'))(5, '2026-10-19'); strictEqual(state.mapForecast.phase, 'full');
compile(attrs(forecast, 'onSelectDate'))(6, '2026-10-20'); compile(attrs(forecast, 'onClose'))();
strictEqual(state.mapForecast.selectedDate, '2026-10-20'); strictEqual(state.mapForecast.initialDay, 6, 'full-screen selection survives return');
const obsoleteSelection = compile(`((currentMapForecast) => (${attrs(preview, 'onSelectDate')}))(currentMapForecast)`); // React render's lexical A, not the VM's dynamic global getter.
state.closeMapForecast(); state.selectedId = hotspots[1].id; state.openMapForecast(); obsoleteSelection(2, '2026-10-16');
strictEqual(state.mapForecast.selectedDate, undefined, 'a stale native callback cannot update B with A date');
state.closeMapForecast(); state.selectedId = hotspots[0].id; state.openMapForecast();
compile(attrs(preview, 'onWeatherGraphs'))(); strictEqual(state.mapForecast.phase, 'graphs');
const graphs = element('WeatherGraphsModal', n => tag(n).attributes.getText(ast).includes('currentMapForecast.location'));
strictEqual(compile(attrs(graphs, 'location')), state.mapForecast.location, 'graphs use exact selected point, not GPS');
compile(attrs(graphs, 'onClose'))(); strictEqual(state.mapForecast.phase, 'preview');
const obsoleteSamePoint = compile(`((currentMapForecast) => (${attrs(preview, 'onSelectDate')}))(currentMapForecast)`);
state.closeMapForecast(); state.openMapForecast(); obsoleteSamePoint(4, '2026-10-18');
strictEqual(state.mapForecast.selectedDate, undefined, 'reopening the same coordinates creates a new UI intent, not a stale date callback target');
strictEqual(compile(attrs(preview, 'onSavePoint')), undefined, 'saved hotspots do not expose another save-point action');
const navigations: any[] = []; state.navigation = { navigate: (...args: any[]) => navigations.push(args) };
state.showPointForecast({ latitude: 46.33, longitude: 15.17, name: 'Ročno izbrana točka', source: 'map-point' });
compile(attrs(preview, 'onSavePoint'))(); strictEqual(navigations[0][0], 'Record'); strictEqual(navigations[0][1].latitude, 46.33); strictEqual(navigations[0][1].longitude, 15.17);
state.openMapForecast();
let back: (() => boolean) | undefined, removed = 0;
state.BackHandler = { addEventListener: (_: string, f: () => boolean) => { back = f; return { remove: () => removed++ }; } };
const cleanup = compile(effects.find(e => e.includes("'hardwareBackPress'"))!)(); ok(back!()); strictEqual(state.mapForecast, undefined); cleanup(); strictEqual(removed, 1);
strictEqual(state.controls, preserved.controls); strictEqual(state.controls.topThreeOriginId, hotspots[0].id); strictEqual(state.camera.current, preserved.camera);
strictEqual(state.listSort, 'conditions'); strictEqual(state.cameraWrites, 1);
state.openMapForecast(); state.mode = 'list'; strictEqual(state.currentMapForecast, undefined); state.mode = 'map';
state.isFocused = false; strictEqual(state.currentMapForecast, undefined); state.isFocused = true;
state.forecastEnvironment = 'false/mine'; strictEqual(state.currentMapForecast, undefined); state.forecastEnvironment = 'true/mine';
compile(effects.find(e => e === '() => { closeMapForecast(); }')!)(); strictEqual(state.mapForecast, undefined);
compile(effects.find(e => e.includes('graphMapPoint.current = undefined;') && !e.includes('heatmapNavigation.selectedAreaId'))!)(); strictEqual(state.graphMapPoint.current, undefined);
state.selectedId = undefined; state.openMapForecast(); state.suppressMapPressUntil.current = 0; mapPress({ nativeEvent: { lngLat: [NaN, 0] } }); strictEqual(state.mapForecast.phase, 'picking');
for (const label of ['Način Rastišča','Način Pogoji']) ok(attrs(element('Pressable', n => tag(n).attributes.getText(ast).includes(`accessibilityLabel="${label}"`)), 'onPress').includes('closeMapForecast()'), 'even reselecting the same layer invalidates a transient forecast');
// Normal gestures retain the original handlers and have no forecast acquisition path.
for (const event of ['onRegionWillChange','onRegionIsChanging','onRegionDidChange']) ok(!attrs(element('Map'), event).includes('showPointForecast'));

// Execute actual preview/entry/picker JSX with the existing scorer fixture and a mocked hook.
const jsx = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const expand = (n: any): any => Array.isArray(n) ? n.map(expand) : n?.props ? typeof n.type === 'function' ? expand(n.type(n.props)) : { ...n, props: { ...n.props, children: expand(n.props.children) } } : n;
const file = resolve('src/components/SevenDayMapForecast.tsx'), requireHere = createRequire(file), Module = requireHere('node:module'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
let cursor = 0, hookCalls = 0, fontScale = 1, width = 360, selectedDay: number | undefined, selectedDate: string | undefined, closed = 0, fullDay: number | undefined, focused = 0;
let loading = false, error: string | undefined, data = sevenDayFixture(), profile: any = 'generic';
mod.require = (id: string) => id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === 'react' ? { useRef: (initial: any) => ({ current: initial }), useState: (initial: number) => { cursor++; selectedDay ??= initial; return [selectedDay, (v: number) => selectedDay = v]; } }
  : id === 'react-native' ? { ...Object.fromEntries(['View','Text','ScrollView','Pressable','ActivityIndicator'].map(t => [t,t])), StyleSheet: { create: (s: any) => s }, useWindowDimensions: () => ({ width, fontScale }), AccessibilityInfo: { setAccessibilityFocus: () => focused++ }, findNodeHandle: () => 1 }
  : id === '@expo/vector-icons' ? { Ionicons: 'Icon' } : id === '../services/useSevenDayConditions' ? { useSevenDayConditions: (_db: any, location: any, p: any) => {
    hookCalls++; strictEqual(location.latitude, hotspots[0].latitude); strictEqual(p, profile);
    return { loading, error, snapshot: data, results: loading || error ? undefined : evaluateSevenDayConditions(data, p), retry: () => {} };
  } } : requireHere(id);
mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
const ui = mod.exports, location = { ...hotspots[0], name: 'Moje najljubše rastišče pri Uršlji gori', source: 'hotspot' };
for (width of [320,360,412]) for (fontScale of [1,1.3,2]) {
  const entry = ui.MapForecastEntry({ onPress() {} }); const styles = entry.props.style({ pressed: false });
  ok(styles[0].minHeight >= 48); ok(styles[1].minWidth <= width - 48); strictEqual(entry.props.accessibilityRole, 'button');
}
const pick = expand(ui.MapForecastPicker({ onClose: () => closed++ })); ok(text(pick).includes('Izberi točko')); strictEqual(hookCalls, 0);
const render = () => expand(ui.SevenDayMapForecastPreview({ location, database: {}, profileId: profile, initialDay: selectedDay ?? 1, selectedDate, maxHeight: 220,
  onSelectDate: (index: number, date: string) => { selectedDay = index; selectedDate = date; }, onWeatherGraphs() {}, onClose: () => closed++, onFull: (v: number) => fullDay = v }));
let tree = render();
const previewHeading = walk(tree).find(n => n.type === 'Text' && n.props.onLayout); previewHeading.props.ref.current = {};
previewHeading.props.onLayout(); previewHeading.props.onLayout(); strictEqual(focused, 1, 'preview announces its heading once after real layout, not on every weather update');
const days = () => walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.includes('od 100'));
strictEqual(days().length, 7); ok(days()[1].props.accessibilityState.selected);
days()[5].props.onPress(); tree = render(); ok(days()[5].props.accessibilityState.selected);
walk(tree).find(n => n.props.accessibilityLabel === `Vseh 7 dni za ${location.name}`).props.onPress(); strictEqual(fullDay, 5);
for (profile of Object.keys(MUSHROOM_WEATHER_PROFILES)) { tree = render(); ok(text(tree).includes(MUSHROOM_WEATHER_PROFILES[profile as keyof typeof MUSHROOM_WEATHER_PROFILES].label)); }
for (profile of Object.keys(MUSHROOM_WEATHER_PROFILES)) for (let index = 0; index < 7; index++) {
  tree = render(); days()[index].props.onPress(); tree = render();
  const result = evaluateSevenDayConditions(data, profile)[index];
  ok(days()[index].props.accessibilityState.selected); strictEqual(selectedDate, result.targetLocalDate);
  const detail = walk(tree).find(n => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite');
  ok(text(detail).includes(forecastDateLabel(result.targetLocalDate))); ok(text(detail).includes(`${result.score}/100`));
  for (const f of forecastFactorInsights(result)) ok(text(detail).includes(`${f.label}: ${f.status} · ${f.contribution}`));
  walk(tree).find(n => n.props.accessibilityLabel === `Vseh 7 dni za ${location.name}`).props.onPress(); strictEqual(fullDay, index);
}
ok(text(tree).includes('Vremenski grafi')); ok(text(tree).includes('Nazaj na zemljevid')); ok(text(tree).includes('Zemljevid: Danes'));

// Delta tests use real scorer results; only comparison identity/score edge cases are altered.
const fixtureWeek = evaluateSevenDayConditions(data, 'generic'), today = fixtureWeek[0];
const comparisonSnapshot: typeof data = { ...data, pointPolicyVersion: CANONICAL_POINT_POLICY, inputContract: HOURLY_INTERVAL_CONTRACT };
const candidate = { ...fixtureWeek[5], score: today.score! + 8 };
strictEqual(forecastComparison(candidate, today, comparisonSnapshot), '+8 točk glede na danes');
strictEqual(forecastComparison({ ...candidate, score: today.score! - 4 }, today, comparisonSnapshot), '−4 točke glede na danes');
strictEqual(forecastComparison({ ...candidate, score: today.score }, today, comparisonSnapshot), 'Enaka ocena kot danes');
strictEqual(forecastComparison({ ...candidate, score: 0 }, { ...today, score: 0 }, comparisonSnapshot), 'Enaka ocena kot danes', 'real zero is comparable, not missing');
for (const invalid of [undefined, { ...today, score: null }, { ...today, status: 'error' }, { ...today, componentsVerified: false },
  { ...today, latitude: today.latitude + 1 }, { ...today, profileId: 'boletusEdulis' }, { ...today, snapshotId: 'old' },
  { ...today, forecastRetrievedAt: 'old' }, { ...today, assembledAt: 'old' }])
  strictEqual(forecastComparison(candidate, invalid as any, comparisonSnapshot), 'Primerjava z današnjim dnem ni na voljo.');
strictEqual(forecastComparison(candidate, today, data), 'Primerjava z današnjim dnem ni na voljo.', 'unknown contract is not assumed comparable');
const normalized = { ...candidate, canonical: { ...candidate.canonical, components: candidate.canonical.components.map((c, index) => ({ ...c, weightedPoints: c.weight * (index ? .9 : .1) })) } };
const normalizedFactors = forecastFactorInsights(normalized), all = advancedFactors(normalized.canonical).filter(f => f.ratio != null);
strictEqual(normalizedFactors[0].ratio, Math.max(...all.map(f => f.ratio!))); strictEqual(normalizedFactors[1].ratio, Math.min(...all.map(f => f.ratio!)));
deepStrictEqual(forecastFactorInsights({ ...candidate, componentsVerified: false }), []);
strictEqual(forecastDateLabel('2026-10-16'), 'petek, 16. oktober');
for (const date of ['2026-03-29', '2026-10-25', '2024-02-29', '2026-12-31']) ok(forecastDateLabel(date).includes(String(Number(date.slice(8)))));
data = { ...data, soilByDate: {} }; tree = render(); ok(text(tree).includes('Ocena ni na voljo')); ok(!text(tree).includes('0/100'));
data = { ...sevenDayFixture(), stale: true }; tree = render(); ok(text(tree).includes('Starejša predpomnjena napoved'));
loading = true; tree = render(); ok(text(tree).includes('Preračunavam')); strictEqual(days().length, 0);
loading = false; error = 'Ni povezave'; tree = render(); ok(text(tree).includes('Ni povezave')); ok(text(tree).includes('Poskusi znova'));
ok(walk(tree).find(n => n.type === 'ScrollView').props.style.minHeight === 0, 'bounded outer scroll keeps last content reachable with large fonts');
walk(tree).find(n => n.props.accessibilityLabel === 'Zapri predogled napovedi').props.onPress(); strictEqual(closed, 1);
console.log('PASS real map entry/tap/marker/full/back handlers: explicit coordinates/no GPS/centre, mode/blur invalidation, profile/day/camera/Top3 restoration, 7-day preview/full preselection, loading/null/stale/error, 48dp/font-wrap/scroll accessibility; canonical weather/weights/gates/cache/native sources unchanged. Native layout requires device QA.');
