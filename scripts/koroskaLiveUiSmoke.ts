/** Real manual lifecycle hook and map hook; native frames/components are deterministic test boundaries. */
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { compileLive, jsx, walk, text } from './koroskaLiveTestSupport';
import { selectedStripStub } from './shadowUxSourceGuards';
import * as data from '../src/experimental/koroskaShadowData';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { resolveLjubljanaClock } from '../src/domain/soilSampling';
import { researchPointContext } from '../src/components/forecastSourceContext';
import type { LiveRegionalSnapshot } from '../src/experimental/koroskaLive';
const asset = data.validateShadowArtifact(JSON.parse(readFileSync('src/data/koroskaShadow/snapshot.json', 'utf8')));
function host() {
  let index = 0, dirty = false; const slots: any[] = [], pending: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState: (v: any) => { const i = index++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], (x: any) => {
      const next = typeof x === 'function' ? x(slots[i]) : x; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
    }]; },
    useRef: (v: any) => { const i = index++; return slots[i] ??= { current: v }; },
    useMemo: (fn: any, deps: any[]) => { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback: (fn: any, deps: any[]) => hooks.useMemo(() => fn, deps),
    useEffect: (fn: any, deps: any[]) => { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) { const previous = slots[i]; slots[i] = { deps };
      pending.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  return { hooks, render: (fn: any) => { let v: any, n = 0; do { dirty = false; index = 0; v = fn(); pending.splice(0).forEach(f => f()); if (++n > 15) throw Error('effect loop'); } while (dirty); return v; },
    unmount: () => slots.forEach(s => s?.cleanup?.()) };
}
function deferred<T>() { let resolve!: (v: T) => void, reject!: (v: unknown) => void; const task = new Promise<T>((a,b) => { resolve = a; reject = b; }); return { task, resolve, reject }; }
async function run() {
  const originalFetch = globalThis.fetch, realDate = Date, realTimeout = setTimeout, realClear = clearTimeout;
  let now = resolveLjubljanaClock('2026-10-23T10:45')[0], http = 0;
  class Clock extends realDate { constructor(v?: string | number) { super(v === undefined ? now : v); } static now() { return now; } }
  globalThis.Date = Clock as DateConstructor;
  globalThis.fetch = (async () => { http++; throw Error('UI must not acquire weather implicitly'); }) as any;
  const timers = new Map<number, { fn: () => void; wait: number }>(); let nextTimer = 0;
  globalThis.setTimeout = ((fn: any, wait: number) => { timers.set(++nextTimer, { fn, wait }); return nextTimer; }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  const listeners = new Set<(s: string) => void>();
  const native = { ...Object.fromEntries(['View','Text','ScrollView','Pressable','Modal','ActivityIndicator'].map(t => [t,t])),
    StyleSheet: { create: (s: any) => s, absoluteFill: {} }, AppState: { addEventListener: (_: string, fn: any) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } } };
  const fixture = sevenDayFixture('2026-10-23'), canonical = asset.profiles.flatMap(profile => evaluateSevenDayConditions(fixture, profile));
  const snapshot = { schema: 'koroska-live-regional-v1', contract: 'regional-civil-week-v1', snapshotId: 'synthetic-live-ui-only',
    geometryFingerprint: asset.geometryFingerprint, modelFingerprint: asset.modelFingerprint,
    baseLocalDate: '2026-10-23', dates: canonical.slice(0,7).map(v => v.targetLocalDate), retrievedAt: new Date(now).toISOString(), expiresAt: now + 1800000,
    staleAtAcquisition: false, publicationAllowed: true, sources: [], missing: [], vectors: asset.weather.flatMap(() => canonical.map(v => ({ score: v.score,
      label: v.label, category: data.categoryForLabel(v.label), missing: v.missing, status: v.status }))) } as unknown as LiveRegionalSnapshot;
  const service = compileLive('src/experimental/koroskaLive.ts', id => id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: true } : undefined);
  const h = host(), jobs: Array<ReturnType<typeof deferred<any>>> = []; let calls = 0, cached: LiveRegionalSnapshot | undefined;
  const lifecycle = compileLive('src/experimental/useKoroskaLive.ts', id => id === 'react' ? h.hooks : id === 'react-native' ? native
    : id === './koroskaLive' ? { ...service, peekLiveRegional: () => cached, refreshLiveRegional: () => { calls++; const job = deferred<any>(); jobs.push(job); return job.task; } } : undefined);
  let enabled = false, model = asset, output: any; const database: any = {};
  const render = () => output = h.render(() => lifecycle.useKoroskaLive(database, model, enabled));
  try {
    render(); strictEqual(calls, 0); strictEqual(timers.size, 0); enabled = true; render(); strictEqual(calls, 0);
    ok(output.message.includes('Še ni pridobljeno')); strictEqual(timers.size, 1);
    listeners.forEach(fn => fn('active')); render(); strictEqual(calls, 0, 'foreground updates labels, never acquires');
    const first = output.refresh(); render(); ok(output.loading); strictEqual(output.snapshot, undefined);
    enabled = false; render(); jobs[0].resolve({ snapshot, cached: false }); await first; render(); strictEqual(output.snapshot, undefined); strictEqual(timers.size, 0);
    enabled = true; render(); const old = output.refresh(), newer = output.refresh(); render(); strictEqual(calls, 3);
    const newerSnapshot = { ...snapshot, snapshotId: 'newer' };
    jobs[2].resolve({ snapshot: newerSnapshot, cached: false }); await newer; render(); strictEqual(output.snapshot.snapshotId, 'newer');
    jobs[1].resolve({ snapshot, cached: false }); await old; render(); strictEqual(output.snapshot.snapshotId, 'newer', 'older completion cannot replace latest request');
    const before = calls; now += 31 * 60000; [...timers.values()][0].fn(); render(); ok(output.stale); strictEqual(calls, before);
    now = resolveLjubljanaClock('2026-10-24T00:00')[0]; listeners.forEach(fn => fn('active')); render(); ok(output.stale); strictEqual(output.snapshot.baseLocalDate, '2026-10-23'); strictEqual(calls, before);
    const failed = output.refresh(); render(); jobs[3].reject(Error('forecast offline')); await failed; render(); ok(output.error.includes('offline')); strictEqual(output.snapshot, undefined);
    const lateResult = output.refresh(); render(); jobs[4].resolve({ snapshot, cached: true }); await lateResult; render(); ok(output.error.includes('datum')); strictEqual(output.snapshot, undefined);
    cached = snapshot; enabled = false; render(); enabled = true; render(); strictEqual(output.snapshot, snapshot); ok(output.stale, 'warm old day is not relabelled current');
    h.unmount(); strictEqual(timers.size, 0); strictEqual(listeners.size, 0);

    // Map UI uses the unchanged frozen geometry, with only paint/result selection changing.
    now = resolveLjubljanaClock('2026-10-23T10:45')[0]; const mapHost = host(); let builds = 0, loads = 0, refreshes = 0, camera = 0;
    let liveState: any = { snapshot: undefined, knownDates: snapshot.dates, loading: false, stale: false, message: 'Še ni pridobljeno.', refresh: async () => { refreshes++; } };
    const ui = compileLive('src/experimental/useKoroskaShadow.tsx', id => id === 'react' ? mapHost.hooks : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
      : id === 'react-native' ? native : id === 'react-native-safe-area-context' ? { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }
      : id === '@maplibre/maplibre-react-native' ? { GeoJSONSource: 'GeoJSONSource', Layer: 'Layer' }
      : id === '../components/useSelectedStrip' ? selectedStripStub
      : id === './useKoroskaLive' ? { useKoroskaLive: (_db: any, _asset: any, active: boolean) => ({ ...liveState, snapshot: active ? liveState.snapshot : undefined }) }
      : id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: true, shadowGeometry: (a: any) => { builds++; return data.shadowGeometry(a); } }
      : id.endsWith('snapshot.json') ? (loads++, asset) : id === '../components/SevenDayConditionsView' ? { SevenDayConditionsModal: 'PointModal' } : undefined);
    const props = { available: true, database, initialProfile: 'generic', fillPaint: { 'fill-color': ['get','renderState'] }, borderPaint: {}, selectedPaint: {}, onShowRegion: () => camera++, onConsumeTap() {} };
    let tree: any; const mapRender = () => tree = mapHost.render(() => ui.useKoroskaShadow(props));
    const press = (label: string) => { const button = walk(tree.overlay).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); ok(button, label); button.props.onPress(); mapRender(); };
    mapRender(); tree.entry.props.onPress(); mapRender(); strictEqual(refreshes, 0); ok(text(tree.overlay).includes('ni aktualna napoved'));
    const geo = tree.layer.props.data, cell = asset.cells[0], coordinate = [14.812345,46.456789];
    tree.layer.props.onPress({ stopPropagation() {}, nativeEvent: { features: [{ properties: { id: cell.id } }], lngLat: coordinate } }); mapRender();
    press('Izberi raziskovalni datum in vrsto'); press('Sveža napoved — razvojni pilot'); strictEqual(refreshes, 0); ok(text(tree.overlay).includes('Ocena ni na voljo'));
    press('Pridobi svežo napoved'); strictEqual(refreshes, 1); liveState = { ...liveState, snapshot, message: 'Validiran razvojni zajem.' }; mapRender();
    const profile = 'Užitna sirovka'; press(profile); press(data.shadowDateLabel(snapshot.dates[6])); tree.back(); mapRender();
    ok(text(tree.overlay).includes(data.shadowDateLabel(snapshot.dates[6]))); ok(text(tree.overlay).includes(profile));
    ok(!text(tree.overlay).includes('ni aktualna napoved')); ok(text(tree.overlay).includes('Regionalna ocena:'));
    strictEqual(tree.layer.props.data, geo); strictEqual(builds, 1); strictEqual(camera, 0);
    press('Odpri sedemdnevno napoved za kliknjene koordinate'); strictEqual(tree.modal.props.researchOrigin.mode, 'live');
    deepStrictEqual([tree.modal.props.location.longitude, tree.modal.props.location.latitude], coordinate);
    strictEqual(tree.modal.props.selectedDate, snapshot.dates[6]); strictEqual(tree.modal.props.profileId, 'lactariusDeliciosus');
    ok(researchPointContext(tree.modal.props.researchOrigin, snapshot.dates, snapshot.dates[6]).join(' ').includes('skupnega regionalnega vzorca'));
    ok(researchPointContext({ ...tree.modal.props.researchOrigin, date: '2026-10-20' }, snapshot.dates, snapshot.dates[0]).join(' ').includes('prikazan je Danes'));
    tree.modal.props.onProfileChange('generic'); tree.modal.props.onSelectDate(0, snapshot.dates[0]); mapRender(); tree.back(); mapRender();
    ok(text(tree.overlay).includes(profile)); ok(text(tree.overlay).includes(data.shadowDateLabel(snapshot.dates[6])));
    press('Izberi datum, vrsto in vir napovedi'); press('Raziskovalni posnetek'); tree.back(); mapRender();
    ok(text(tree.overlay).includes('ni aktualna napoved')); strictEqual(tree.layer.props.data, geo); strictEqual(refreshes, 1);
    press('Izberi raziskovalni datum in vrsto'); press('Sveža napoved — razvojni pilot'); tree.back(); mapRender();
    strictEqual(tree.layer.props.data, geo); strictEqual(refreshes, 1); strictEqual(camera, 0);
    liveState = { ...liveState, snapshot: undefined, error: 'mixed cohort', message: 'Napoved ni objavljena.' }; mapRender();
    ok(text(tree.overlay).includes('Ocena ni na voljo')); ok(!text(tree.overlay).includes('ni aktualna napoved'), 'failed live never silently becomes frozen');
    press('Izhod iz razvojnega predogleda'); ok(!tree.active); tree.entry.props.onPress(); mapRender();
    ok(text(tree.overlay).includes('ni aktualna napoved')); ok(!text(tree.overlay).includes('Regionalna ocena:')); strictEqual(builds, 1); strictEqual(loads, 1);
    props.available = false; mapRender(); props.available = true; mapRender(); ok(!tree.active);
    strictEqual(http, 0); mapHost.unmount();
    console.log('PASS live UI/lifecycle: manual only, no startup/mode/day/profile/foreground acquisition, TTL/midnight labels only, stale/no old result/error/dedupe boundary, source toggle and frozen reset, same geometry/camera, exact point independence and Back. Native QA separate.');
  } finally { globalThis.fetch = originalFetch; globalThis.Date = realDate; globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClear; }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
