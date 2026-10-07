/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { ConditionsTargetContext } from '../src/domain/hotspotRanking';
import type { Hotspot } from '../src/domain/types';

// Execute the actual list with persistent React hook state. This is not native layout QA.
const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
type Element = { type: any; props: any };
const element = (type: any, props: any): Element => ({ type, props });
let cursor = 0, dirty = false;
const slots: any[] = [], effects: Array<() => void> = [];
const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useState(initial: any) {
    const i = cursor++;
    slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, (value: any) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }];
  },
  useMemo(fn: () => any, deps: any[]) {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
    return slots[i].value;
  },
  useEffect(fn: () => any, deps: any[]) {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) {
      const old = slots[i]; slots[i] = { deps };
      effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    }
  },
};
const hotspots: Hotspot[] = Array.from({ length: 9 }, (_, i) => ({ id: `h${i}`, title: String.fromCharCode(73 - i),
  profileId: 'local:device', latitude: 46.47, longitude: 14.85, locationSource: 'manual', locationSharing: 'private',
  createdAt: '', updatedAt: '', syncState: 'local' }));
let context: ConditionsTargetContext = { targetProfile: 'generic', dayMode: 'today' };
let sort = 'recent';
const mapActions: Hotspot[] = [];
let assessments: Record<string, any> = {}, loading = true, error: string | undefined, retries = 0;
const calls: any[] = [], navigation: any[] = [];
const filename = resolve('src/components/HotspotRankingList.tsx'), mod = new Module(filename);
mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/components'));
const original = mod.require.bind(mod);
mod.require = (id: string) => {
  if (id === 'react') return react;
  if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
  if (id === 'react-native') return { ...Object.fromEntries(['FlatList', 'ScrollView', 'Pressable', 'Text', 'View', 'ActivityIndicator'].map(x => [x, x])), StyleSheet: { create: (x: any) => x } };
  if (id === '@react-navigation/native') return { useNavigation: () => ({ navigate: (...args: any[]) => navigation.push(args) }) };
  if (id === './ui') return { Card: 'Card', StatusPill: 'StatusPill', commonStyles: {} };
  if (id === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
  // Actual segmented/menu presentation is exercised separately by rankingControlsSmoke.
  if (id === './HotspotRankingControls') return { HotspotRankingControls: (props: any) => element('View', { children: [
    ...Object.entries(MUSHROOM_WEATHER_PROFILES).map(([targetProfile, profile]) => element('Pressable', {
      onPress: () => props.onContext({ ...props.context, targetProfile }), children: element('Text', { children: profile.label }) })),
    ...['today', 'tomorrow'].map(dayMode => element('Pressable', { onPress: () => props.onContext({ ...props.context, dayMode }),
      children: element('Text', { children: dayMode === 'today' ? 'Danes' : 'Jutri' }) })),
    ...[['recent', 'Zadnja sprememba'], ['conditions', 'Najboljši pogoji'], ['name', 'Ime']].map(([id, label]) =>
      element('Pressable', { onPress: () => props.onSort(id), children: element('Text', { children: label }) })),
  ] }) };
  if (id.endsWith('/useLocationConditions')) return { useLocationConditions: (...args: any[]) => {
    calls.push(args); return { assessments, loading, error, retry: () => { retries++; } };
  } };
  return original(id);
};
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const { HotspotRankingList } = mod.exports;
let tree!: Element;
function render() {
  let runs = 0;
  do {
    dirty = false; cursor = 0;
    const before = calls.length;
    tree = HotspotRankingList({ hotspots, finds: [{ hotspotId: 'h0' }], context, sort, onSort: (value: string) => { sort = value; },
      onShowMap: (value: Hotspot) => mapActions.push(value), onContext: (next: ConditionsTargetContext) => { context = next; } });
    strictEqual(calls.length - before, 1, 'one grouped hook per render, not one per row');
    strictEqual(calls.at(-1)[0], hotspots, 'request locations stay in original order');
    strictEqual(calls.at(-1)[4], 250);
    effects.splice(0).forEach(fn => fn());
    ok(++runs < 10, 'no render loop');
  } while (dirty);
  return tree!;
}
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const n = node as Element;
  const children = n.type === 'FlatList' ? [n.props.ListHeaderComponent, ...n.props.data.map((item: any) => n.props.renderItem({ item }))]
    : typeof n.type === 'function' ? n.type(n.props) : n.props.children;
  return [n, ...walk(children)];
}
const text = (n: any): string => {
  if (Array.isArray(n)) return n.map(text).join(' ');
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n !== 'object') return String(n);
  return walk(n).filter(e => e.type === 'Text').map(e => text(e.props.children)).join(' ');
};
function press(label: string) {
  const button = walk(tree).find(n => n.type === 'Pressable' && text(n) === label);
  ok(button, label); button.props.onPress(); render();
}
const ids = () => tree.props.data.map((h: Hotspot) => h.id);
const score = (value: number | null) => ({ score: value, classLabel: 'Ugodne razmere', summary: { stale: false } });
const timers: Array<{ fn: () => void; cancelled: boolean; delay: number }> = [];
const realSet = global.setTimeout, realClear = global.clearTimeout;
global.setTimeout = ((fn: () => void, delay: number) => { const timer = { fn, delay, cancelled: false }; timers.push(timer); return timer; }) as any;
global.clearTimeout = ((timer: any) => { timer.cancelled = true; }) as any;
try {
  render(); strictEqual(tree.type, 'FlatList'); strictEqual(tree.props.data.length, 9, 'list is visible before weather');
  deepStrictEqual(ids(), hotspots.map(h => h.id)); ok(text(tree).includes('Pridobivam pogoje')); ok(!text(tree).includes('0 / 100'));
  for (const profile of Object.values(MUSHROOM_WEATHER_PROFILES)) ok(text(tree).includes(profile.label));
  assessments = { h0: score(70), h1: score(90), h2: score(90), h3: score(0), h4: score(null) }; render();
  ok(text(tree).replace(/\s+/g, ' ').includes('4 ocenjenih · 5 brez ocene'));
  ok(text(tree).includes('Razvrstitev primerja pogoje, ne zagotavlja najdb.'));
  deepStrictEqual(ids(), hotspots.map(h => h.id), 'progress does not reorder default');
  ok(text(tree).includes('0 / 100'), 'real score zero differs from missing');
  press('Ime'); deepStrictEqual(ids(), [...hotspots].reverse().map(h => h.id));
  press('Najboljši pogoji'); deepStrictEqual(ids(), ['h1', 'h2', 'h0', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']);
  assessments = { ...assessments, h8: score(100) }; render();
  strictEqual(ids()[0], 'h1', 'progress row labels immediate but order coalesced');
  ok(text(tree).includes('100 / 100'));
  const timer = timers.at(-1)!; strictEqual(timer.delay, 200);
  assessments = { ...assessments, h7: score(99) }; render(); strictEqual(timers.at(-1), timer);
  timer.fn(); render(); deepStrictEqual(ids().slice(0, 2), ['h8', 'h7']);
  assessments = { ...assessments, h6: score(100) }; render(); const stale = timers.at(-1)!;
  press('Jesenski goban'); strictEqual(context.targetProfile, 'boletusEdulis'); ok(stale.cancelled);
  stale.fn(); render(); strictEqual(calls.at(-1)[1], 'boletusEdulis');
  press('Jutri'); strictEqual(context.dayMode, 'tomorrow'); strictEqual(calls.at(-1)[2], 'tomorrow');
  press('Navadna lisička'); press('Užitna sirovka'); strictEqual(calls.at(-1)[1], 'lactariusDeliciosus');
  const row = walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Odpri rastišče I')!;
  row.props.onPress(); deepStrictEqual(navigation.at(-1), ['HotspotDetail', { hotspotId: 'h0', conditionsContext: context }]);
  const mapAction = walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Prikaži I na zemljevidu')!;
  ok(mapAction); mapAction.props.onPress(); strictEqual(mapActions.at(-1), hotspots[0]);
  strictEqual(navigation.length, 1, 'secondary sibling map action does not trigger detail tap');
  loading = false; assessments = {}; error = 'fixture failure'; render();
  ok(text(tree).includes('Trenutno ni mogoče izračunati pogojev')); ok(text(tree).includes('Ni ocene'));
  ok(!text(tree).includes('0 / 100')); strictEqual(tree.props.data.length, 9);
  press('Poskusi znova'); strictEqual(retries, 1);
  assessments = { h0: { ...score(70), summary: { stale: true } } }; render(); ok(text(tree).includes('Starejša ocena'));
  // Simulate leaving the list: pending publications must not update an unmounted child.
  const pending = timers.at(-1)!; slots.forEach(s => s?.cleanup?.()); const count = slots.filter(Boolean).length;
  pending.fn(); strictEqual(slots.filter(Boolean).length, count); ok(pending.cancelled);
  slots.length = 0; assessments = { h0: score(70) }; render();
  strictEqual(sort, 'conditions', 'sort lives above remount for list-map-list roundtrip');
  strictEqual(context.targetProfile, 'lactariusDeliciosus'); strictEqual(context.dayMode, 'tomorrow');
  slots.forEach(s => s?.cleanup?.());
  console.log('PASS actual ranking UI: grouped 9-location hook, immediate list, profiles/days, three sorts, progressive order coalescing, unavailable/real zero/retry/stale, latest context, navigation, cleanup. Native phone layout remains physical QA.');
} finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
