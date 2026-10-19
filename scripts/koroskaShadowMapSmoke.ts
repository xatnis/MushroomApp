/** Execute the real isolated hook, frozen adapter and MapScreen event handlers. No native FPS claims. */
import { strictEqual, deepStrictEqual, ok, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as data from '../src/experimental/koroskaShadowData';
import { withoutKoroskaShadow } from './koroskaShadowSourceGuards';
import { selectPilot, buildPrototype, digest, cellResult } from './research/koroskaRegionalPrototype';
import { loadSnapshot, SHADOW_ROOT, codeDigests } from './research/koroskaShadowStore';
import type { ContractCapture } from './research/koroskaContractCapture';

const jsx = (type: any, props: any) => ({ type, props });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let escapedHttp = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { escapedHttp++; throw Error('Offline preview tests prohibit HTTP'); }) as typeof fetch;
const artifact = data.validateShadowArtifact(JSON.parse(readFileSync('src/data/koroskaShadow/snapshot.json', 'utf8')));
const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
strictEqual(withoutKoroskaShadow(source), execFileSync('git', ['show', '8a790ca:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'only enumerated opt-in UI integration changes to production map');
strictEqual(data.KOROSKA_SHADOW_ENABLED, process.env.EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW === '1');
for (const value of [undefined, '0', 'true', '1']) {
  const exports: any = {};
  runInNewContext(transpile(readFileSync('src/experimental/koroskaShadowData.ts', 'utf8')), { exports, process: { env: { EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW: value } }, __DEV__: true });
  strictEqual(exports.KOROSKA_SHADOW_ENABLED, value === '1', '__DEV__ alone never enables preview');
}
const pilot = selectPilot(); strictEqual(artifact.cells.length, 696); strictEqual(artifact.weather.length, 11);
deepStrictEqual(artifact.cells.map(c => [c.id, c.geometry]), pilot.cells.map(c => [c.properties.id, c.geometry]));
deepStrictEqual(artifact.dates, ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
strictEqual(artifact.modelIssuedAt, null); ok(data.shadowIsStale(artifact, artifact.expiresAt));
strictEqual(data.shadowDateLabel('2026-10-25'), 'ned., 25. 10.');
strictEqual(data.pointForecastDate('2026-10-25', '2026-10-19'), '2026-10-25');
strictEqual(data.pointForecastDate('2026-10-19', '2026-10-26'), undefined, 'expired snapshot date cannot pretend to be current forecast date');
for (const change of [(a: any) => a.cells.pop(), (a: any) => a.dates[0] = '2026-10-18', (a: any) => a.modelIssuedAt = a.capturedAt,
  (a: any) => a.vectors[0].score = 101, (a: any) => a.vectors[0].score = null, (a: any) => a.provenance.pop()]) {
  const bad = structuredClone(artifact); change(bad); throws(() => data.validateShadowArtifact(bad));
}
const geo = JSON.parse(data.shadowGeometry(artifact)); strictEqual(geo.features.length, 696);
for (const f of geo.features) deepStrictEqual(Object.keys(f.properties), ['id', ...Array.from({ length: 28 }, (_, i) => 's' + i)]);
const paint: any = { 'fill-color': ['match', ['get', 'renderState'], 'good', '#7EA46E', '#A6A6A6'] };
const original = JSON.stringify(paint);
for (let p = 0; p < 4; p++) for (let d = 0; d < 7; d++) deepStrictEqual(data.shadowPaint(paint, p, d)['fill-color'][1], ['get', `s${p * 7 + d}`]);
strictEqual(JSON.stringify(paint), original, 'production paint not mutated');
// Public allowlist: no raw response, hotspot identity, note, visit, user or GPS trace fields can leak into asset.
deepStrictEqual(Object.keys(artifact).sort(), ['schema','researchOnly','contract','snapshotId','captureId','capturedAt','expiresAt','modelIssuedAt','modelFingerprint','geometryFingerprint','dates','profiles','bounds','attribution','weather','provenance','cells','vectors'].sort());
for (const c of artifact.cells) deepStrictEqual(Object.keys(c).sort(), ['id','weatherIndex','habitat','geometry'].sort());

/** Small deterministic hook runner: effects/state/memo retain actual dependency semantics. */
function harness(enabled: boolean) {
  const file = resolve('src/experimental/useKoroskaShadow.tsx'), requireHere = createRequire(file), Module = requireHere('node:module'), mod = new Module(file);
  mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/experimental'));
  let cursor = 0, dirty = false, loads = 0, geometryBuilds = 0, camera = 0, taps = 0, fontScale = 1;
  const slots: any[] = [], effects: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (v: any) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef: (v: any) => { const i = cursor++; return slots[i] ??= { current: v }; },
    useMemo: (f: () => any, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: f() }; return slots[i].value; },
    useCallback: (f: any, deps: any[]) => hooks.useMemo(() => f, deps),
    useEffect: (f: () => void, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i], deps)) { slots[i] = deps; effects.push(f); } },
  };
  mod.require = (id: string) => id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === 'react' ? hooks
    : id === 'react-native' ? { ...Object.fromEntries(['View','Text','ScrollView','Pressable','ActivityIndicator'].map(t => [t,t])), StyleSheet: { create: (s: any) => s, absoluteFill: {} }, useWindowDimensions: () => ({ width: 360, height: 800, fontScale }) }
    : id === '@maplibre/maplibre-react-native' ? { GeoJSONSource: 'GeoJSONSource', Layer: 'Layer' }
    : id === '../components/SevenDayConditionsView' ? { SevenDayConditionsModal: 'PointModal' }
    : id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: enabled, shadowGeometry: (a: any) => { geometryBuilds++; return data.shadowGeometry(a); } }
    : id.endsWith('snapshot.json') ? (loads++, artifact) : requireHere(id);
  mod._compile(transpile(readFileSync(file, 'utf8')), file);
  const props = { available: true, initialProfile: 'generic', database: {}, fillPaint: paint, borderPaint: {}, selectedPaint: {}, onShowRegion: () => camera++, onConsumeTap: () => taps++ };
  let output: any;
  const render = () => { let limit = 0; do { dirty = false; cursor = 0; output = mod.exports.useKoroskaShadow(props); effects.splice(0).forEach(f => f()); if (++limit > 10) throw Error('effect loop'); } while (dirty); return output; };
  const press = (label: string, tree = output.overlay) => { const b = walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); ok(b, label); b.props.onPress(); render(); };
  return { render, press, props, output: () => output, counts: () => ({ loads, geometryBuilds, camera, taps }), font: (v: number) => { fontScale = v; render(); } };
}
async function main() {
  const raw = loadSnapshot(SHADOW_ROOT, artifact.captureId).data as ContractCapture;
  const built = await buildPrototype(raw.hourlyBatch, digest(codeDigests()));
  const stats = { numeric: 0, unknown: 0, outside: 0 };
  for (let c = 0; c < 696; c++) for (let p = 0; p < 4; p++) for (let day = 0; day < 7; day++) {
    const actual = data.shadowCellResult(artifact, artifact.cells[c].id, p, day)!;
    const canonical = cellResult(built.data, c, p, day);
    strictEqual(actual.score, canonical.score); strictEqual(actual.label, canonical.label); strictEqual(actual.date, canonical.targetLocalDate);
    strictEqual(actual.weather.id, canonical.weatherId); strictEqual(actual.habitat, canonical.habitatState);
    strictEqual(geo.features[c].properties[data.shadowColumn(p, day)], actual.category);
    actual.habitat === 'unknown' ? stats.unknown++ : actual.habitat === 'outside-model' ? stats.outside++ : stats.numeric++;
  }
  deepStrictEqual(stats, { numeric: 16716, unknown: 2646, outside: 126 });
  const missing = structuredClone(artifact); const candidate = missing.cells.find(c => c.habitat[0] === 'candidate')!;
  missing.vectors[candidate.weatherIndex * 28] = { score: null, label: null, status: 'insufficient_data', missing: ['soil'], category: 'insufficient' };
  strictEqual(data.shadowCellResult(data.validateShadowArtifact(missing), candidate.id, 0, 0)!.score, null);
  missing.vectors[candidate.weatherIndex * 28] = { score: 0, label: 'Slabe razmere', status: 'ready', missing: [], category: 'poor' };
  strictEqual(data.shadowCellResult(data.validateShadowArtifact(missing), candidate.id, 0, 0)!.score, 0, 'real zero distinct from missing');
  const disabled = harness(false); const off = disabled.render(); strictEqual(off.entry, null); strictEqual(off.layer, null); strictEqual(off.overlay, null); strictEqual(disabled.counts().loads, 0);
  const h = harness(true); let ui = h.render(); strictEqual(ui.active, false); strictEqual(h.counts().loads, 0); ui.entry.props.onPress(); ui = h.render();
  ok(ui.active); strictEqual(h.counts().loads, 1); strictEqual(h.counts().geometryBuilds, 1); strictEqual(h.counts().camera, 0);
  ui.overlay.props.onLayout({ nativeEvent: { layout: { height: 500 } } }); ui = h.render();
  ok(text(ui.overlay).includes('Raziskovalni posnetek — ni aktualna napoved'));
  const nativeData = ui.layer.props.data, id = candidate.id, clicked = [14.812345, 46.456789];
  ui.layer.props.onPress({ stopPropagation() {}, nativeEvent: { features: [{ properties: { id } }], lngLat: clicked } }); ui = h.render();
  for (const profile of artifact.profiles) {
    const profileLabel = (require('../src/domain/mushroomWeather') as any).MUSHROOM_WEATHER_PROFILES[profile].label;
    h.press(profileLabel);
    for (let d = 0; d < 7; d++) {
      h.press(data.shadowDateLabel(artifact.dates[d])); ui = h.output();
      strictEqual(ui.layer.props.data, nativeData, 'date/profile do not rebuild geometry');
      const layers = walk(ui.layer).filter(n => n.type === 'Layer');
      deepStrictEqual(layers[0].props.paint['fill-color'][1], ['get', data.shadowColumn(artifact.profiles.indexOf(profile), d)]);
      ok(text(ui.overlay).includes(data.shadowDateLabel(artifact.dates[d]))); ok(text(ui.overlay).includes(profileLabel));
      const result = data.shadowCellResult(artifact, id, artifact.profiles.indexOf(profile), d)!;
      ok(text(ui.overlay).includes(result.score == null ? 'Ocena ni na voljo' : `${result.score}/100`));
      ok(walk(ui.overlay).find(n => n.props.accessibilityLabel === data.shadowDateLabel(artifact.dates[d])).props.accessibilityState.selected);
    }
  }
  h.press('Viri in omejitve regionalnega posnetka'); ui = h.output(); ok(text(ui.overlay).includes(artifact.snapshotId));
  ok(walk(ui.overlay).find(n => n.props.accessibilityLabel === 'Viri in omejitve regionalnega posnetka').props.accessibilityState.expanded);
  h.press('Odpri sedemdnevno napoved za kliknjene koordinate'); ui = h.output();
  deepStrictEqual([ui.modal.props.location.longitude, ui.modal.props.location.latitude], clicked); strictEqual(ui.modal.props.location.source, 'map-point');
  const regionalPaint = walk(ui.layer).find(n => n.type === 'Layer').props.paint;
  ui.modal.props.onProfileChange('generic'); ui.modal.props.onSelectDate(3, '2026-10-22'); ui = h.render();
  deepStrictEqual(walk(ui.layer).find(n => n.type === 'Layer').props.paint, regionalPaint, 'exact-point local profile/date cannot recolor shadow');
  ui.back(); ui = h.render(); strictEqual(ui.modal, null); ok(ui.active); ui.back(); ui = h.render(); ok(!text(ui.overlay).includes('Regionalna ocena:'));
  h.press('Prikaži Koroško'); strictEqual(h.counts().camera, 1, 'only explicit camera action');
  ui = h.output(); ui.rememberViewport({ center: clicked, zoom: 11 }); deepStrictEqual(ui.consumeViewport(), { center: clicked, zoom: 11 }); strictEqual(ui.consumeViewport(), undefined);
  for (const font of [1, 1.3, 2]) { h.font(font); for (const n of walk(h.output().overlay).filter(n => n.type === 'Pressable')) ok(n.props.style[0].minHeight >= 48); }
  h.output().back(); ui = h.render(); ok(!ui.active); strictEqual(ui.layer, null);
  ui.entry.props.onPress(); h.render(); strictEqual(h.counts().loads, 1); strictEqual(h.counts().geometryBuilds, 1, 'warm reopen reuses immutable asset');
  h.props.available = false; ui = h.render(); ok(!ui.active); h.props.available = true; ui = h.render(); ok(!ui.active, 'never auto-reactivate on tab return');
  const hookSource = readFileSync('src/experimental/useKoroskaShadow.tsx', 'utf8');
  ok(!/fetch\(|useSevenDayConditions\(|evaluateSevenDay|loadHeatmap|updateHeatmapNavigation/.test(hookSource), 'no alternate weather, scoring, global navigation or acquisition');
  const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const maps: ts.JsxOpeningElement[] = []; const visit = (n: ts.Node) => { if (ts.isJsxOpeningElement(n) && n.tagName.getText(ast) === 'Map') maps.push(n); ts.forEachChild(n, visit); }; visit(ast);
  strictEqual(maps.length, 1); ok(!maps[0].attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'key'));
  let remembers = 0, clears = 0;
  const context = { shadow: { active: true, rememberViewport: () => remembers++, clearSelection: () => clears++ }, mapWasMoved: { current: false }, suppressMapPressUntil: { current: 0 }, Date, exports: {} as any };
  for (const event of ['onRegionWillChange','onRegionIsChanging','onRegionDidChange','onPress','onLongPress']) {
    const a = maps[0].attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === event) as ts.JsxAttribute;
    const expr = (a.initializer as ts.JsxExpression).expression!.getText(ast);
    runInNewContext(transpile('exports.fn = ' + expr), context); context.exports.fn({ nativeEvent: { center: clicked, zoom: 11 } });
  }
  strictEqual(remembers, 1); strictEqual(clears, 1, 'shadow gestures do not execute production viewport/LOD/weather handlers');
  strictEqual(escapedHttp, 0, 'all 28 switches/reopen/cell actions perform zero HTTP');
  console.log('Koroška shadow map PASS: 19,488 authentic result mappings; 28 date/profile interactions; flag isolation, immutable source, cell/point/Back/viewport/a11y guards. No HTTP. Native render unverified.');
}
void main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
