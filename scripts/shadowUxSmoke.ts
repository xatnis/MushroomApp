import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as data from '../src/experimental/koroskaShadowData';
import { shadowGeometryBounds, shadowRegionRequest } from '../src/experimental/shadowLayout';
import { researchPointContext, type ResearchForecastOrigin } from '../src/components/forecastSourceContext';
import { withoutShadowForecastUx } from './shadowUxSourceGuards';
import { withoutKoroskaShadow } from './koroskaShadowSourceGuards';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
const jsx = (type: any, props: any, key?: string) => ({ type, props, key });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const asset = data.validateShadowArtifact(JSON.parse(readFileSync('src/data/koroskaShadow/snapshot.json', 'utf8')));
let http = 0; const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { http++; throw Error('UX tests are offline'); }) as typeof fetch;
function host() {
  let cursor = 0, dirty = false; const slots: any[] = [], effects: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (v: any) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: (f: () => any, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: f() }; return slots[i].value; },
    useCallback: (f: any, deps: any[]) => hooks.useMemo(() => f, deps),
    useEffect: (f: () => void, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i], deps)) { slots[i] = deps; effects.push(f); } },
  };
  return { hooks, render: (f: () => any) => { let output: any, iterations = 0; do { dirty = false; cursor = 0; output = f(); effects.splice(0).forEach(fn => fn()); if (++iterations > 12) throw Error('unstable effect loop'); } while (dirty); return output; } };
}
function compile(file: string, h: ReturnType<typeof host>, imports: (id: string) => any = () => undefined) {
  const path = resolve(file), here = createRequire(path), Module = here('node:module'), mod = new Module(path);
  mod.filename = path; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  mod.require = (id: string) => imports(id) ?? (id === 'react' ? h.hooks : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : id === 'react-native' ? { ...Object.fromEntries(['Modal','View','Text','ScrollView','Pressable','ActivityIndicator'].map(t => [t,t])), StyleSheet: { create: (s: any) => s, absoluteFill: {} } }
    : id === 'react-native-safe-area-context' ? { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' } : here(id));
  mod._compile(transpile(readFileSync(path, 'utf8')), path); return mod.exports;
}
const layout = (x: number, width: number, y = 0, height = 48) => ({ nativeEvent: { layout: { x, width, y, height } } });
// Actual hook: mount/selection/layout permutations, long fonts, manual browsing and A→B→A obsolete events.
const sh = host(), stripUi = compile('src/components/useSelectedStrip.ts', sh); let key = 'd6', identity = 'A';
let strip = sh.render(() => stripUi.useSelectedStrip(key, identity)); const scrolls: any[] = [];
const native = { scrollTo: (v: any) => scrolls.push(v) }; strip.scrollProps.ref(native);
strip.itemLayout('d6')(layout(900, 150)); strictEqual(scrolls.length, 0);
strip.scrollProps.onLayout(layout(0, 220)); strip.scrollProps.onContentSizeChange(1050); deepStrictEqual(scrolls.at(-1), { x: 830, animated: false });
for (let i = 0; i < 4; i++) strip = sh.render(() => stripUi.useSelectedStrip(key, identity)); strictEqual(scrolls.length, 1, 'stable renders cannot animate/loop');
key = 'd1'; strip = sh.render(() => stripUi.useSelectedStrip(key, identity)); strip.itemLayout('d1')(layout(150, 150)); strictEqual(scrolls.at(-1).x, 150);
const oldA = strip; identity = 'B'; strip = sh.render(() => stripUi.useSelectedStrip(key, identity)); identity = 'A'; strip = sh.render(() => stripUi.useSelectedStrip(key, identity));
oldA.itemLayout('d1')(layout(9999, 20)); oldA.scrollProps.onContentSizeChange(10000);
const prior = scrolls.length; strip.scrollProps.onContentSizeChange(1050); strictEqual(scrolls.length, prior, 'obsolete A callbacks rejected after A→B→A');
strip.itemLayout('d1')(layout(150, 150)); strip.scrollProps.onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
strip = sh.render(() => stripUi.useSelectedStrip(key, identity)); strictEqual(scrolls.length, prior, 'manual browsing alone does not force snapping');
strip.scrollProps.onLayout(layout(0, 100)); strip.itemLayout('d1')(layout(150, 300)); strictEqual(scrolls.at(-1).x, 150, 'overwide large-font item starts visibly, not guessed centering');
strip.scrollProps.ref(null); strip.scrollProps.ref({ scrollTo: (v: any) => scrolls.push(v) }); strictEqual(scrolls.at(-1).x, 150, 'fresh native mount reveals the retained selected item');

const bounds = shadowGeometryBounds(asset); ok(bounds[0] <= asset.bounds[0] || bounds[2] >= asset.bounds[2]);
for (const c of asset.cells) for (const p of c.geometry.type === 'Polygon' ? [c.geometry.coordinates] : c.geometry.coordinates) for (const ring of p) for (const [x,y] of ring) ok(x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]);
strictEqual(shadowRegionRequest(bounds, { width: 320, height: 500 }), undefined);
strictEqual(shadowRegionRequest(bounds, { width: 320, height: 200 }, { y: 8, height: 170 }, { y: 20, height: 170 }), undefined, 'do not fit into a nonexistent free viewport');

const h = host(), actualStrip = compile('src/components/useSelectedStrip.ts', h); let builds = 0, acquisitions = 0;
const camera: any[] = [];
const ui = compile('src/experimental/useKoroskaShadow.tsx', h, id => id === '../components/useSelectedStrip' ? actualStrip
  : id === '@maplibre/maplibre-react-native' ? { GeoJSONSource: 'GeoJSONSource', Layer: 'Layer' }
  : id === '../components/SevenDayConditionsView' ? { SevenDayConditionsModal: 'PointModal' }
  : id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: true, shadowGeometry: (a: any) => { builds++; return data.shadowGeometry(a); } }
  : id.endsWith('snapshot.json') ? (acquisitions++, asset) : undefined);
const props = { available: true, initialProfile: 'generic', database: {}, fillPaint: { 'fill-color': ['get','renderState'] }, borderPaint: {}, selectedPaint: {}, onShowRegion: (v: any) => camera.push(v), onConsumeTap() {} };
let tree: any; const render = () => tree = h.render(() => ui.useKoroskaShadow(props));
const press = (label: string) => { const n = walk(tree.overlay).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); ok(n, label); n.props.onPress(); render(); };
render(); tree.entry.props.onPress(); render(); ok(tree.active);
strictEqual(walk(tree.overlay).filter(n => n.type === 'ScrollView').length, 0, 'collapsed default: no date/profile/debug scrolling');
ok(text(tree.overlay).includes('Raziskovalni posnetek — ni aktualna napoved')); ok(text(tree.overlay).includes(data.shadowDateLabel(asset.dates[0])));
press('Prikaži Koroško'); strictEqual(camera.length, 0, 'no guessed offsets before measured layout');
tree.overlay.props.onLayout(layout(0, 320, 0, 540));
walk(tree.overlay).find(n => n.type === 'View' && n.props.onLayout && n !== tree.overlay).props.onLayout(layout(8, 304, 8, 122.5));
press('Prikaži Koroško'); deepStrictEqual(camera.at(-1), { bounds, padding: { top: 139, bottom: 24, left: 16, right: 16 } });
const cell = asset.cells.find(c => c.habitat[0] === 'unknown') ?? asset.cells[0], clicked = [14.812345,46.456789];
tree.layer.props.onPress({ stopPropagation() {}, nativeEvent: { features: [{ properties: { id: cell.id } }], lngLat: clicked } }); render();
const sourceData = tree.layer.props.data;
const main = walk(tree.overlay).find(n => n.type === 'View' && n.props.onLayout && text(n).includes('Regionalna ocena:') && n !== tree.overlay)!;
main.props.onLayout(layout(8, 304, 422.25, 110));
strictEqual(walk(main).filter(n => n.type === 'ScrollView').length, 0, 'score/date in fixed summary, never in technical scroll container');
press('Prikaži Koroško'); strictEqual(camera.at(-1).padding.bottom, 126);
press('Izberi raziskovalni datum in vrsto'); ok(walk(tree.overlay).some(n => n.type === 'Modal'));
const researchRows = walk(tree.overlay).filter(n => n.type === 'ScrollView' && n.props.horizontal);
strictEqual(researchRows.length, 2); ok(researchRows[0].key && researchRows[0].key !== researchRows[1].key, 'date/profile sibling strips need distinct React keys');
press('Užitna sirovka'); press(data.shadowDateLabel(asset.dates[6])); strictEqual(camera.length, 2); strictEqual(tree.layer.props.data, sourceData);
ok(text(tree.overlay).includes('Užitna sirovka')); ok(text(tree.overlay).includes(data.shadowDateLabel(asset.dates[6])));
tree.back(); render(); strictEqual(walk(tree.overlay).filter(n => n.type === 'Modal').length, 0);
press('Viri in omejitve regionalnega posnetka'); ok(text(tree.overlay).includes(asset.snapshotId));
const detailsModal = walk(tree.overlay).find(n => n.type === 'Modal')!;
detailsModal.props.onRequestClose(); render(); ok(!text(tree.overlay).includes(asset.snapshotId));
strictEqual(walk(tree.overlay).filter(n => n.type === 'ScrollView').length, 0, 'collapse unmounts the technical scroll; heading cannot retain its offset');
press('Viri in omejitve regionalnega posnetka'); ok(walk(tree.overlay).find(n => n.type === 'Modal') !== detailsModal, 'fresh mounted technical surface'); tree.back(); render();
press('Odpri sedemdnevno napoved za kliknjene koordinate'); const origin = tree.modal.props.researchOrigin;
deepStrictEqual([tree.modal.props.location.longitude, tree.modal.props.location.latitude], clicked); strictEqual(origin.date, asset.dates[6]); strictEqual(origin.profileId, 'lactariusDeliciosus');
tree.modal.props.onProfileChange('boletusEdulis'); tree.modal.props.onSelectDate(5, '2026-10-26'); render(); strictEqual(tree.modal.props.researchOrigin, origin);
tree.back(); render(); ok(tree.active); ok(text(tree.overlay).includes('Užitna sirovka')); tree.back(); render(); ok(!text(tree.overlay).includes('Regionalna ocena:')); tree.back(); render(); ok(!tree.active);
tree.entry.props.onPress(); render(); ok(!text(tree.overlay).includes('Regionalna ocena:')); ok(text(tree.overlay).includes(data.shadowDateLabel(asset.dates[0]))); ok(!text(tree.overlay).includes(asset.snapshotId));
props.available = false; render(); props.available = true; render(); ok(!tree.active); strictEqual(builds, 1); strictEqual(acquisitions, 1);

// Actual full and compact views wire selected keys/layouts to the real strip hook.
const fh = host(), fs = compile('src/components/useSelectedStrip.ts', fh), fixture = sevenDayFixture('2026-10-21');
const baselineScores = ['generic','boletusEdulis','cantharellusCibarius','lactariusDeliciosus'].map(p => evaluateSevenDayConditions(fixture, p as any));
const full = compile('src/components/SevenDayConditionsView.tsx', fh, id => id === './useSelectedStrip' ? fs
  : id === './PointHabitatContext' ? { PointHabitatContext: 'PointHabitatContext' }
  : id === './ui' ? { Card: 'Card', AppButton: 'AppButton', commonStyles: {} }
  : id === '../services/useSevenDayConditions' ? { useSevenDayConditions: (_db: any, _location: any, p: any) => ({ snapshot: fixture, results: evaluateSevenDayConditions(fixture, p) }) } : undefined);
const fp: any = { location: { latitude: 46.5, longitude: 14.5, name: 'Točka', source: 'map-point' }, database: {}, profileId: 'lactariusDeliciosus', selectedDate: '2026-10-26', onProfileChange() {}, onSnapshot() {}, researchOrigin: { ...origin, date: '2026-10-20' } };
const fullRender = () => fh.render(() => full.SevenDayContent(fp)); let view = fullRender();
const rows = walk(view).filter(n => n.type === 'ScrollView' && n.props.horizontal); strictEqual(rows.length, 2);
const measured: any[][] = [[],[]];
rows.forEach((r, i) => { r.props.ref({ scrollTo: (v: any) => measured[i].push(v) }); r.props.onLayout(layout(0, 220)); r.props.onContentSizeChange(i ? 7 * 160 : 4 * 160);
  walk(r).filter(n => n.type === 'Pressable').forEach((n, index) => n.props.onLayout(layout(index * 160, 160))); });
strictEqual(measured[0].at(-1).x, 420); strictEqual(measured[1].at(-1).x, 740, '26 October selection at index5 is visible, not only first three dates');
fp.selectedDate = '2026-10-27'; view = fullRender(); strictEqual(measured[1].at(-1).x, 900);
fp.profileId = 'generic'; view = fullRender(); strictEqual(measured[0].at(-1).x, 0); ok(text(view).includes('produkcijski regionalni indeks'));
fp.selectedDate = '2026-10-21'; view = fullRender(); ok(text(view).includes('Danes')); ok(text(view).includes('Raziskovalni datum ni v tem oknu'));
const noteOrigin: ResearchForecastOrigin = { ...origin, date: '2026-10-20' };
ok(researchPointContext(noteOrigin, ['2026-10-21','2026-10-27'], '2026-10-21').join(' ').includes('prikazan je Danes'));
ok(researchPointContext({ ...noteOrigin, date: '2026-10-25' }, ['2026-10-21','2026-10-25'], '2026-10-25').join(' ').includes('Isti datum ne pomeni istega vremenskega posnetka'));
deepStrictEqual(researchPointContext(undefined, undefined), []); strictEqual(data.pointForecastDate('2026-10-20', '2026-10-21'), undefined);

const ch = host(), cs = compile('src/components/useSelectedStrip.ts', ch);
const compact = compile('src/components/SevenDayMapForecast.tsx', ch, id => id === './useSelectedStrip' ? cs
  : id === '@expo/vector-icons' ? { Ionicons: 'Icon' }
  : id === './PointHabitatContext' ? { PointHabitatContext: 'PointHabitatContext' }
  : id === 'react-native' ? { ...Object.fromEntries(['Modal','View','Text','ScrollView','Pressable','ActivityIndicator'].map(t => [t,t])),
    StyleSheet: { create: (s: any) => s }, useWindowDimensions: () => ({ width: 360, height: 800, fontScale: 1 }) }
  : id === '../services/useSevenDayConditions' ? { useSevenDayConditions: () => ({ snapshot: fixture, results: baselineScores[0] }) } : undefined);
const cp = { ...fp, maxHeight: 400, initialDay: 6, selectedDate: '2026-10-27', onClose() {}, onFull() {}, onSelectDate() {}, onWeatherGraphs() {} };
const compactRender = () => ch.render(() => compact.SevenDayMapForecastPreview(cp)); let compactView = compactRender();
const compactRow = walk(compactView).find(n => n.type === 'ScrollView' && n.props.horizontal); ok(compactRow);
const compactScrolls: any[] = [];
compactRow.props.ref({ scrollTo: (v: any) => compactScrolls.push(v) }); compactRow.props.onLayout(layout(0, 220)); compactRow.props.onContentSizeChange(7 * 160);
walk(compactRow).filter(n => n.type === 'Pressable').forEach((n, index) => n.props.onLayout(layout(index * 160, 160)));
strictEqual(compactScrolls.at(-1).x, 900); cp.selectedDate = '2026-10-21'; compactView = compactRender(); strictEqual(compactScrolls.at(-1).x, 0);

const mapSource = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('Map.tsx', mapSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let bridge = '';
function visit(n: ts.Node) { if (ts.isPropertyAssignment(n) && n.name.getText(ast) === 'onShowRegion') bridge = n.initializer.getText(ast); ts.forEachChild(n, visit); } visit(ast);
const nativeCalls: any[] = [], vm = { exports: {} as any, camera: { current: { fitBounds: (...args: any[]) => nativeCalls.push(args) } } };
runInNewContext(transpile('exports.fn = ' + bridge), vm); vm.exports.fn(camera[1]); strictEqual(JSON.stringify(nativeCalls[0]), JSON.stringify([bounds, { padding: camera[1].padding, duration: 500, easing: 'ease' }]));
for (const file of ['src/screens/MapScreen.tsx','src/domain/sevenDayConditions.ts','src/domain/mushroomWeather.ts','src/domain/heatmap/regional.ts','src/domain/heatmap/pilot.ts','src/domain/heatmap/spatial.ts','src/domain/heatmap/zgs.ts','src/domain/pointHabitat.ts','src/domain/weatherIntervals.ts','src/domain/soilSampling.ts','src/services/weather.ts','src/services/pointConditions.ts','src/services/useSevenDayConditions.ts','src/experimental/koroskaShadowData.ts','src/data/koroskaShadow/snapshot.json']) {
  const normalize = (s: string) => file === 'src/screens/MapScreen.tsx' ? withoutKoroskaShadow(s) : s.replace(/\r\n/g, '\n');
  strictEqual(normalize(readFileSync(file, 'utf8')), normalize(execFileSync('git', ['show', `8efa381:${file}`], { encoding: 'utf8' })), file + ' production numerical/data path unchanged');
}
for (const file of ['src/components/SevenDayConditionsView.tsx','src/components/SevenDayMapForecast.tsx']) strictEqual(withoutShadowForecastUx(readFileSync(file, 'utf8')), execFileSync('git', ['show', `8efa381:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), file + ' unchanged outside declared strip/notice UI');
deepStrictEqual(['generic','boletusEdulis','cantharellusCibarius','lactariusDeliciosus'].map(p => evaluateSevenDayConditions(fixture, p as any)), baselineScores);
strictEqual(http, 0); globalThis.fetch = originalFetch;
console.log('PASS shadow UX: compact default, fixed score/unmounted technical scroll, measured polygon fit/padding bridge, real date/profile strip visibility + stale layout guards, frozen/live and habitat provenance, reset/Back, immutable geometry/28 scores, 0 HTTP. Native layout/fit/scroll still requires Redmi QA.');
