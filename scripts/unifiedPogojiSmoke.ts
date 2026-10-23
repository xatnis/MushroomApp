/** Real presentation hook + actual MapScreen integration/gesture JSX; no native render/FPS claim. */
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { compileLive, jsx, walk, text } from './koroskaLiveTestSupport';
import { selectedStripStub } from './shadowUxSourceGuards';
import { withoutKoroskaShadow } from './koroskaShadowSourceGuards';
import * as data from '../src/experimental/koroskaShadowData';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { regionalPreviewResult } from '../src/experimental/koroskaLivePresentation';
import type { LiveRegionalSnapshot } from '../src/experimental/koroskaLive';

const asset = data.validateShadowArtifact(JSON.parse(readFileSync('src/data/koroskaShadow/snapshot.json', 'utf8')));
const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const base = (path: string) => execFileSync('git', ['show', `d830f0b:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
// Keep the old numerical/source assertions; allow only the enumerated, separately executed opt-in UI.
strictEqual(withoutKoroskaShadow(source), withoutKoroskaShadow(base('src/screens/MapScreen.tsx')));
for (const path of ['src/experimental/koroskaLive.ts','src/experimental/useKoroskaLive.ts','src/experimental/koroskaLivePresentation.ts',
  'src/experimental/koroskaShadowData.ts','src/data/koroskaShadow/snapshot.json','src/services/pointConditions.ts',
  'src/services/weather.ts','src/domain/sevenDayConditions.ts','src/domain/heatmap/regional.ts','src/domain/heatmap/pilot.ts',
  'src/services/heatmap/useHeatmapVisuals.ts','src/domain/mushroomWeather.ts','src/domain/soilSampling.ts','src/domain/weatherIntervals.ts'])
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), base(path), `${path} byte-identical`);

function host() {
  let cursor = 0, dirty = false; const slots: any[] = [], effects: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState: (v: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v;
      return [slots[i], (x: any) => { const next = typeof x === 'function' ? x(slots[i]) : x; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef: (v: any) => { const i = cursor++; return slots[i] ??= { current: v }; },
    useMemo: (f: any, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: f() }; return slots[i].value; },
    useCallback: (f: any, deps: any[]) => hooks.useMemo(() => f, deps),
    useEffect: (f: any, deps: any[]) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = f(); }); } },
  };
  return { hooks, render: (f: any) => { let tree: any, count = 0; do { dirty = false; cursor = 0; tree = f(); effects.splice(0).forEach(e => e()); if (++count > 15) throw Error('effect loop'); } while (dirty); return tree; } };
}
const native = { ...Object.fromEntries(['View','Text','Pressable','ScrollView','Modal','ActivityIndicator'].map(t => [t, t])), StyleSheet: { create: (s: any) => s, absoluteFill: {} } };
const fixture = sevenDayFixture('2026-10-23');
const canonical = asset.profiles.flatMap(profile => evaluateSevenDayConditions(fixture, profile));
const snapshot = { contract: 'regional-civil-week-v1', snapshotId: 'synthetic-unified-ui-only',
  dates: canonical.slice(0, 7).map(r => r.targetLocalDate), retrievedAt: '2026-10-23T08:45:00Z', expiresAt: Date.parse('2026-10-23T09:15:00Z'),
  geometryFingerprint: asset.geometryFingerprint, modelFingerprint: asset.modelFingerprint,
  sources: [], missing: [], publicationAllowed: true,
  vectors: asset.weather.flatMap(() => canonical.map(r => ({ score: r.score, label: r.label, category: data.categoryForLabel(r.label), missing: r.missing, status: r.status }))) } as unknown as LiveRegionalSnapshot;
const originalFetch = globalThis.fetch, realDate = Date; let http = 0;
const now = Date.parse('2026-10-23T08:45:00Z');
class Clock extends realDate { constructor(v?: string | number) { super(v === undefined ? now : v); } static now() { return now; } }
globalThis.Date = Clock as DateConstructor;
globalThis.fetch = (async () => { http++; throw Error('UI cannot acquire implicitly'); }) as any;
function harness(enabled: boolean) {
  const h = host(); let geometryBuilds = 0, loads = 0, refreshes = 0, cameraCalls = 0, activeLive = false;
  let liveState: any = { snapshot: undefined, knownDates: undefined, message: 'Še ni pridobljeno. Potreben je ročni zajem.', refresh: async () => { refreshes++; } };
  let fitted: any;
  const ui = compileLive('src/experimental/useKoroskaShadow.tsx', id => id === 'react' ? h.hooks : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : id === 'react-native' ? native : id === 'react-native-safe-area-context' ? { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' }
    : id === '@maplibre/maplibre-react-native' ? { GeoJSONSource: 'GeoJSONSource', Layer: 'Layer' }
    : id === '../components/useSelectedStrip' ? selectedStripStub
    : id === '../components/SevenDayConditionsView' ? { SevenDayConditionsModal: 'PointModal' }
    : id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: enabled, shadowGeometry: (a: any) => { geometryBuilds++; return data.shadowGeometry(a); } }
    : id.endsWith('snapshot.json') ? (loads++, asset)
    : id === './useKoroskaLive' ? { useKoroskaLive: (_db: any, _asset: any, active: boolean) => { activeLive = active; return { ...liveState, snapshot: active ? liveState.snapshot : undefined }; } } : undefined);
  const props = { available: true, pogojiAvailable: true, initialProfile: 'cantharellusCibarius', database: {},
    fillPaint: { 'fill-color': ['get', 'renderState'] }, borderPaint: {}, selectedPaint: {}, onConsumeTap() {}, onShowRegion: (v: any) => { cameraCalls++; fitted = v; } };
  let tree: any; const render = () => tree = h.render(() => ui.useKoroskaShadow(props));
  const press = (label: string) => { const b = walk([tree.pogojiControls, tree.overlay]).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); ok(b, label); b.props.onPress(); render(); };
  return { props, render, tree: () => tree, press, setLive: (v: any) => { liveState = { ...liveState, ...v }; render(); },
    counts: () => ({ geometryBuilds, loads, refreshes, cameraCalls, activeLive }), fitted: () => fitted };
}
try {
  const off = harness(false); let tree = off.render(); strictEqual(tree.pogojiEntry, null); strictEqual(tree.pogojiControls, null); strictEqual(tree.layer, null);
  strictEqual(off.counts().loads, 0); strictEqual(off.counts().activeLive, false);
  const h = harness(true); tree = h.render(); ok(tree.pogojiEntry); strictEqual(h.counts().loads, 0); strictEqual(h.counts().refreshes, 0);
  h.props.pogojiAvailable = false; tree = h.render(); strictEqual(tree.pogojiEntry, null, 'internal Pogoji entry only in Pogoji');
  h.props.pogojiAvailable = true; tree = h.render(); tree.pogojiEntry.props.onPress(); tree = h.render();
  ok(tree.active && tree.unified); ok(h.counts().activeLive); strictEqual(h.counts().refreshes, 0, 'entry does not acquire');
  ok(text(tree.pogojiControls).includes('Samo Koroška')); ok(text(tree.pogojiControls).includes('696 celic'));
  ok(text(tree.pogojiControls).includes('Še ni pridobljeno')); ok(!text(tree.pogojiControls).includes('Raziskovalni posnetek'));
  const geometry = tree.layer.props.data; strictEqual(JSON.parse(geometry).features.length, 696);
  tree.overlay.props.onLayout({ nativeEvent: { layout: { width: 360, height: 500 } } });
  h.press('Prikaži Koroško'); strictEqual(h.counts().cameraCalls, 1);
  strictEqual(h.fitted().padding.top, 8, 'controls above map are not counted twice as an overlay');
  h.press('Pridobi svežo napoved'); strictEqual(h.counts().refreshes, 1);
  h.setLive({ snapshot, message: 'Veljavna predpomnjena napoved.' }); tree = h.tree();
  ok(text(tree.pogojiControls).includes('pridobljeno')); ok(text(tree.pogojiControls).includes('predpomnjena'));
  const coordinate = [14.812345, 46.456789], cell = asset.cells.find(c => c.habitat.every(s => s === 'candidate'))!;
  const tap = (id: string) => { h.tree().layer.props.onPress({ stopPropagation() {}, nativeEvent: { features: [{ properties: { id } }], lngLat: coordinate } }); h.render(); };
  tap(cell.id);
  const switchStarted = performance.now();
  for (let p = 0; p < 4; p++) {
    h.press('Izberi vrsto v internem načinu Pogoji');
    ok(!walk(h.tree().overlay).some(n => n.props.accessibilityLabel === 'Raziskovalni posnetek'), 'unified mode cannot become frozen');
    h.press(MUSHROOM_WEATHER_PROFILES[asset.profiles[p]].label); h.tree().back(); h.render();
    for (let day = 0; day < 7; day++) {
      h.press(data.shadowDateLabel(snapshot.dates[day])); tree = h.tree();
      ok(text(tree.pogojiControls).includes(data.shadowDateLabel(snapshot.dates[day])));
      ok(text(tree.pogojiControls).includes(MUSHROOM_WEATHER_PROFILES[asset.profiles[p]].label));
      const selected = walk(tree.pogojiControls).find(n => n.props.accessibilityLabel === data.shadowDateLabel(snapshot.dates[day])); ok(selected.props.accessibilityState.selected);
      const expected = regionalPreviewResult(asset, 'live', snapshot, cell.id, p, day, snapshot.dates, '');
      ok(text(tree.overlay).includes(`${expected!.score}/100`)); strictEqual(tree.layer.props.data, geometry);
    }
  }
  const switch28Ms = performance.now() - switchStarted;
  ok(text(tree.overlay).includes('Habitat območja · statični podatki'));
  const bottom = walk(tree.overlay).find(n => n !== tree.overlay && n.props.onLayout)!;
  bottom.props.onLayout({ nativeEvent: { layout: { y: 300, height: 180 } } }); h.press('Prikaži Koroško');
  strictEqual(h.fitted().padding.bottom, 208, 'actual selected-card frame excluded from camera viewport');
  h.press('Viri in omejitve regionalnega posnetka'); ok(text(h.tree().overlay).includes(snapshot.snapshotId));
  h.tree().back(); h.render(); ok(!text(h.tree().overlay).includes(snapshot.snapshotId), 'provenance collapsed again');
  h.press('Odpri sedemdnevno napoved za kliknjene koordinate'); tree = h.tree();
  deepStrictEqual([tree.modal.props.location.longitude, tree.modal.props.location.latitude], coordinate);
  strictEqual(tree.modal.props.profileId, asset.profiles[3]); strictEqual(tree.modal.props.selectedDate, data.pointForecastDate(snapshot.dates[6], fixture.baseLocalDate));
  strictEqual(tree.modal.props.researchOrigin.mode, 'live'); strictEqual(tree.modal.props.researchOrigin.snapshotId, snapshot.snapshotId);
  const beforePaint = walk(tree.layer).find(n => n.type === 'Layer').props.paint;
  tree.modal.props.onProfileChange('generic'); tree.modal.props.onSelectDate(0, snapshot.dates[0]); tree = h.render(); tree.back(); tree = h.render();
  strictEqual(tree.modal, null); strictEqual(walk(tree.layer).find(n => n.type === 'Layer').props.paint, beforePaint);
  ok(text(tree.pogojiControls).includes(data.shadowDateLabel(snapshot.dates[6])));
  // All habitat masks still apply; weather failure never borrows a research value or makes a fake zero.
  tap(asset.cells.find(c => c.habitat[3] === 'unknown')!.id); ok(text(h.tree().overlay).includes('ni potrjen'));
  ok(text(h.tree().overlay).includes('Ocena ni na voljo'));
  tap(asset.cells.find(c => c.habitat[3] === 'outside-model')!.id); ok(text(h.tree().overlay).includes('zunaj modela'));
  tap(cell.id); h.setLive({ snapshot: undefined, error: 'offline', message: 'Napoved ni objavljena — napaka pri virih.' });
  ok(text(h.tree().overlay).includes('Ocena ni na voljo')); ok(!text(h.tree().pogojiControls).includes('Raziskovalni posnetek'));
  h.setLive({ snapshot, stale: true, message: 'Starejša predpomnjena napoved — ni sveža.' }); ok(text(h.tree().pogojiControls).includes('ni sveža'));
  strictEqual(h.counts().refreshes, 1, '28 switches, sheets, point/modal/Back and stale labels acquire nothing');

  // Execute the actual MapScreen controls branch; integrated controls occupy its existing slot only.
  const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes: ts.Node[] = []; const visit = (n: ts.Node) => { nodes.push(n); ts.forEachChild(n, visit); }; visit(ast);
  const mapNodes = nodes.filter(n => ts.isJsxOpeningElement(n) && n.tagName.getText(ast) === 'Map') as ts.JsxOpeningElement[];
  strictEqual(mapNodes.length, 1); ok(!mapNodes[0].attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'key'));
  const cameras = nodes.filter(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'Camera'); strictEqual(cameras.length, 1);
  const controls = nodes.find(n => ts.isJsxElement(n) && n.openingElement.getText(ast).includes('styles.controls,'))!;
  const ctx: any = { exports: {}, shadow: h.tree(), View: 'View', styles: { controls: 'controls' }, require: () => ({ jsx, jsxs: jsx }) };
  const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(transpile('exports.render = () => (' + controls.getText(ast) + ');'), ctx);
  const mounted = ctx.exports.render(); ok(walk(mounted).includes(ctx.shadow.pogojiControls), 'existing controls slot mounts unified controls');
  ok(!walk(h.tree().overlay).some(n => n.props.accessibilityRole === 'header' && text(n).includes('RAZVOJNI PREDOGLED')), 'no second floating top toolbar');
  const events: any = { ...ctx, mapWasMoved: { current: false }, suppressMapPressUntil: { current: 0 }, Date };
  for (const event of ['onRegionWillChange','onRegionIsChanging','onRegionDidChange','onLongPress']) {
    const attr = mapNodes[0].attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === event) as ts.JsxAttribute;
    runInNewContext(transpile('exports.fn = ' + (attr.initializer as ts.JsxExpression).expression!.getText(ast)), events);
    events.exports.fn({ nativeEvent: { center: coordinate, zoom: 11, bounds: [14,46,15,47] } });
  }
  deepStrictEqual(h.tree().consumeViewport().center, coordinate, 'gesture only remembers viewport, not weather/LOD');
  tree = h.tree(); tree.back(); tree = h.render(); ok(tree.unified); ok(!text(tree.overlay).includes('Regionalna ocena:'));
  tree.back(); tree = h.render(); ok(!tree.active); strictEqual(tree.layer, null); strictEqual(tree.pogojiControls, null);
  strictEqual(h.props.initialProfile, 'cantharellusCibarius', 'local species never writes ordinary context');
  tree.pogojiEntry.props.onPress(); tree = h.render(); ok(!text(tree.overlay).includes('Regionalna ocena:')); strictEqual(h.counts().geometryBuilds, 1);
  h.props.pogojiAvailable = false; tree = h.render(); ok(!tree.active); h.props.pogojiAvailable = true; tree = h.render(); ok(!tree.active, 'mode return never reactivates');
  tree.pogojiEntry.props.onPress(); h.render(); h.props.available = false; h.render(); h.props.available = true; tree = h.render(); ok(!tree.active, 'tab departure resets');
  strictEqual(h.counts().geometryBuilds, 1); strictEqual(h.counts().loads, 1); strictEqual(h.counts().refreshes, 1); strictEqual(http, 0);
  ok(!/Slovenija.*7 dni|vseslovenska napoved/.test(text(tree.pogojiControls)));
  console.log(JSON.stringify({ environment: 'Windows/Node deterministic JSX boundary, not Android render', switch28Ms, ...h.counts(), http }));
  console.log('PASS unified Pogoji: default-off, live-only existing controls slot, 696/11, 28 date/profile updates, manual-only acquisition, fixed habitat masks, point/date/source independence, measured camera viewport, reset/Back/tab, same Map/Camera/source, 0 HTTP. Native layout/performance separate.');
} finally { globalThis.fetch = originalFetch; globalThis.Date = realDate; }
