import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { sevenDayFixture } from './sevenDayFixture';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';

const jsx = (type: any, props: any) => ({ type, props });
const expand = (n: any): any => Array.isArray(n) ? n.map(expand) : n?.props ? typeof n.type === 'function'
  ? expand(n.type(n.props)) : { ...n, props: { ...n.props, children: expand(n.props.children) } } : n;
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
function compile(file: string, overrides: (id: string) => any) {
  const path = resolve(file), requireHere = createRequire(path), Module = requireHere('node:module'), mod = new Module(path);
  mod.filename = path; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  mod.require = (id: string) => overrides(id) ?? requireHere(id);
  mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, path);
  return mod.exports;
}
const fixture = sevenDayFixture();
let stateCursor = 0; const states: any[] = [];
let context: MushroomWeatherProfileId = 'generic', closes = 0, requests = 0, focus = 0;
let loading = false, error: string | undefined, data = fixture;
const ui = compile('src/components/SevenDayConditionsView.tsx', id => {
  if (id === 'react') return { useRef: (n: any) => ({ current: n }), useState: (initial: any) => { const slot = stateCursor++; states[slot] ??= initial; return [states[slot], (n: any) => states[slot] = n]; } };
  if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  if (id === 'react-native') return { ...Object.fromEntries(['Modal','View','Text','Pressable','ScrollView','ActivityIndicator'].map(s => [s,s])), StyleSheet: { create: (s: any) => s }, AccessibilityInfo: { setAccessibilityFocus: (n: any) => focus = n }, findNodeHandle: () => 1 };
  if (id === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
  if (id === './ui') return { Card: 'Card', AppButton: 'AppButton', commonStyles: {} };
  if (id === '../services/useSevenDayConditions') return { useSevenDayConditions: () => ({ loading, error, snapshot: data, results: loading || error ? undefined : evaluateSevenDayConditions(data, context), retry: () => requests++ }) };
});
const entry = ui.SevenDayConditionsEntry({ disabled: false, onPress: () => requests++ });
strictEqual(entry.props.accessibilityRole, 'button'); ok(entry.props.style.minHeight >= 48); ok(text(entry).includes('Napoved pogojev'));
const props = () => ({ visible: true, location: { ...fixture, name: 'Ročno izbrana lokacija' }, profileId: context,
  onProfileChange: (id: MushroomWeatherProfileId) => context = id, database: {}, summary: fixture.today, onSnapshot() {}, onClose: () => closes++ });
let modal = ui.SevenDayConditionsModal(props());
strictEqual(modal.type, 'Modal'); strictEqual(modal.props.presentationStyle, 'fullScreen');
modal.props.onRequestClose(); strictEqual(closes, 1, 'Android Back invokes just close callback');
let tree: any; const render = () => { stateCursor = 0; tree = expand(ui.SevenDayContent(props())); return tree; };
render();
const dayButtons = () => walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.includes('od 100'));
strictEqual(dayButtons().length, 7); strictEqual(dayButtons()[0].props.accessibilityState.selected, true);
dayButtons()[5].props.onPress(); render(); strictEqual(dayButtons()[5].props.accessibilityState.selected, true);
ok(text(tree).includes(evaluateSevenDayConditions(data, context)[5].score + '/100'));
strictEqual(requests, 0, 'local day selection cannot request weather');
for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
  walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === MUSHROOM_WEATHER_PROFILES[id].label).props.onPress(); render();
  strictEqual(context, id); ok(text(tree).includes(MUSHROOM_WEATHER_PROFILES[id].label));
  ok(text(tree).includes(evaluateSevenDayConditions(data, id)[5].score + '/100')); strictEqual(requests, 0);
}
data = JSON.parse(JSON.stringify(fixture)); delete data.soilByDate[evaluateSevenDayConditions(data, context)[5].targetLocalDate]; render();
ok(text(tree).includes('Ocena ni na voljo')); ok(text(tree).includes('napovedni podatki o vlagi tal')); ok(!walk(tree).some(n => n.type === 'Text' && text(n) === '0/100'));
data = { ...fixture, stale: true }; render(); ok(text(tree).includes('Starejša predpomnjena napoved'));
loading = true; render(); ok(text(tree).includes('Preračunavam sedemdnevne razmere')); strictEqual(dayButtons().length, 0);
loading = false; error = 'offline'; render(); ok(text(tree).includes('offline')); ok(walk(tree).some(n => n.type === 'AppButton' && n.props.title === 'Poskusi znova'));
modal = ui.SevenDayConditionsModal({ ...props(), visible: false }); strictEqual(walk(modal).filter(n => n.type === ui.SevenDayContent).length, 0, 'closed modal mounts no weekly loader');
const invalid = expand(ui.SevenDayConditionsModal({ ...props(), location: undefined })); ok(text(invalid).includes('najprej izberi lokacijo'));
const safe = walk(expand(ui.SevenDayConditionsModal({ ...props(), location: undefined }))).find(n => n.type === 'SafeAreaView');
deepStrictEqual(safe.props.edges, ['top','bottom','left','right']); ok(safe.props.accessibilityViewIsModal);

// Execute actual acquisition hook: no profile-dependent fetching, current-key/cleanup guards, clock/resume lifecycle.
async function hooks() {
  let cursor = 0, dirty = false; const slots: any[] = [], effects: (() => void)[] = [], fetches: any[] = [], callbacks: any[] = [];
  let coordinates = { latitude: 46.5, longitude: 14.5 }, profile: MushroomWeatherProfileId = 'generic';
  const db: any = {}, same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const originalTimer = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>(); let timerId = 0, removed = 0;
  globalThis.setTimeout = ((fn: any) => { timers.set(++timerId, fn); return timerId; }) as any;
  globalThis.clearTimeout = ((id: any) => timers.delete(id)) as any;
  const hook = compile('src/services/useSevenDayConditions.ts', id => {
    if (id === 'react') return {
      useState: (initial: any) => { const slot = cursor++; slots[slot] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[slot].value, (next: any) => { slots[slot].value = typeof next === 'function' ? next(slots[slot].value) : next; dirty = true; }]; },
      useRef: (initial: any) => { const slot = cursor++; return slots[slot] ??= { current: initial }; },
      useMemo: (fn: any, deps: any[]) => { const slot = cursor++; if (!slots[slot] || !same(slots[slot].deps, deps)) slots[slot] = { deps, value: fn() }; return slots[slot].value; },
      useEffect: (fn: any, deps: any[]) => { const slot = cursor++, previous = slots[slot]; if (!previous || !same(previous.deps, deps)) { const current = { deps, cleanup: undefined as any }; slots[slot] = current; effects.push(() => { previous?.cleanup?.(); current.cleanup = fn(); }); } },
    };
    if (id === 'react-native') return { AppState: { addEventListener: () => ({ remove: () => removed++ }) } };
    if (id === './sevenDayConditions') return { loadSevenDaySnapshot: (...args: any[]) => new Promise((resolve, reject) => fetches.push({ args, resolve, reject })) };
  });
  let result: any;
  const renderHook = () => { cursor = 0; dirty = false; result = hook.useSevenDayConditions(db, coordinates, profile, undefined, (summary: any) => callbacks.push(summary)); return result; };
  const commit = () => { renderHook(); while (effects.length) effects.shift()!(); if (dirty) renderHook(); return result; };
  const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); if (dirty) commit(); } };
  try {
    ok(commit().loading); strictEqual(fetches.length, 1); ok(timers.size === 1);
    profile = 'boletusEdulis'; commit(); strictEqual(fetches.length, 1);
    coordinates = { latitude: 47, longitude: 15 }; ok(commit().loading); strictEqual(fetches.length, 2);
    fetches[0].resolve(fixture); await settle(); ok(result.loading); strictEqual(callbacks.length, 0, 'obsolete location callback ignored');
    const next = { ...fixture, latitude: 47, longitude: 15, today: { ...fixture.today, latitude: 47, longitude: 15 } };
    fetches[1].resolve(next); await settle(); strictEqual(result.snapshot, next); strictEqual(result.loading, false); strictEqual(callbacks.length, 1);
    for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) { profile = id; commit(); strictEqual(fetches.length, 2); strictEqual(result.results[0].profileId, id); }
    result.retry(); commit(); strictEqual(fetches.length, 3); fetches[2].reject(new Error('timeout')); await settle(); strictEqual(result.error, 'timeout'); strictEqual(result.loading, false);
    coordinates = { latitude: 48, longitude: 16 }; commit(); strictEqual(result.error, undefined);
    for (const slot of slots) slot?.cleanup?.(); fetches.at(-1).resolve(fixture); await settle(); strictEqual(callbacks.length, 1); strictEqual(timers.size, 0); strictEqual(removed, 1);
    strictEqual(new Date(hook.nextWeatherMidnight(new Date('2026-03-29T00:30:00Z'))).toISOString(), '2026-03-29T22:00:00.000Z');
    strictEqual(new Date(hook.nextWeatherMidnight(new Date('2026-10-25T00:30:00Z'))).toISOString(), '2026-10-25T23:00:00.000Z');
  } finally { globalThis.setTimeout = originalTimer; globalThis.clearTimeout = originalClear; }
}
void hooks().then(() => console.log('PASS actual weekly modal/content/hook: 7 accessible dates, local selection, controlled 4 profiles, unavailable/loading/error/stale, full-screen Back/close and safe area, no closed mount, latest location, one snapshot/all-profile memo, 0 day/profile acquisition, unmount guards, exact DST midnight/resume cleanup. Native layout/TalkBack need device QA.'));
