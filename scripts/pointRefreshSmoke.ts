import { strictEqual, notStrictEqual, ok, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import * as service from '../src/services/pointConditions';
import { hourlyWeatherFixture } from './sevenDayHourlyFixture';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import { conditionsForLocation, mapConditionsLocation } from '../src/domain/locationConditions';
import { beginPointTiming, markPointTiming } from '../src/services/pointTiming';

async function run(legacy = false) {
  const RealDate = globalThis.Date, fetch = globalThis.fetch, timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  let now = RealDate.parse('2026-10-14T10:45:00Z'), http = 0, loads = 0, offline = false, sourceVersion = 0;
  class TestDate extends RealDate { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  globalThis.Date = TestDate as DateConstructor;
  const timers = new Map<number, { fn: () => void; due: number }>(); let timerId = 0;
  globalThis.setTimeout = ((fn: () => void, delay: number) => { timers.set(++timerId, { fn, due: now + delay }); return timerId; }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  const rows = new Map<string, any>(), db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key),
    runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let hold = false; const held: (() => void)[] = [];
  globalThis.fetch = (async (url: any) => { http++; if (offline) throw new Error('offline');
    if (hold) await new Promise<void>(resolve => held.push(resolve));
    return { ok: true, json: async () => {
      const data = hourlyWeatherFixture(String(url), new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana' }).format(now));
      if (data.hourly?.soil_moisture_0_to_7cm) data.hourly.soil_moisture_0_to_7cm = data.hourly.soil_moisture_0_to_7cm.map(() => sourceVersion ? .32 : .12);
      if (data.hourly?.soil_moisture_7_to_28cm) data.hourly.soil_moisture_7_to_28cm = data.hourly.soil_moisture_7_to_28cm.map(() => sourceVersion ? .31 : .15);
      return data;
    } }; }) as any;
  let cursor = 0, dirty = false, listener: ((state: string) => void) | undefined;
  const slots: any[] = [], effects: (() => void)[] = [], profiles: string[] = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState: (initial: any) => { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (next: any) => {
      const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
    }]; },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: (fn: any, deps: any[]) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect: (fn: any, deps: any[]) => { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) {
      const next = slots[i] = { deps, cleanup: undefined as any }; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); });
    } },
  };
  const path = resolve('src/services/useSevenDayConditions.ts'), requireHere = createRequire(path), Module = requireHere('node:module'), module = new Module(path);
  module.filename = path; module.paths = Module._nodeModulePaths(resolve('src/services'));
  module.require = (id: string) => id === 'react' ? react : id === 'react-native' ? { AppState: { addEventListener: (_: string, fn: any) => { listener = fn; return { remove: () => { listener = undefined; } }; } } }
    : id === './pointConditions' ? { ...service, pointResults: (...args: Parameters<typeof service.pointResults>) => { profiles.push(args[1]); return service.pointResults(...args); } }
    : id === './sevenDayConditions' ? { loadSevenDaySnapshot: (...args: Parameters<typeof service.loadCanonicalPointSnapshot>) => { loads++; return service.loadCanonicalPointSnapshot(...args); } } : requireHere(id);
  const source = legacy ? execFileSync('git', ['show', '9b0c6b1:src/services/useSevenDayConditions.ts'], { encoding: 'utf8' }) : readFileSync(path, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path);
  let point = { latitude: 46.5, longitude: 14.5 }, profile: MushroomWeatherProfileId = 'generic', result: any;
  const render = () => { cursor = 0; dirty = false; result = module.exports.useSevenDayConditions(db, point, profile, undefined, () => {}); return result; };
  const commit = () => { render(); while (effects.length) effects.shift()!(); if (dirty) render(); return result; };
  const settle = async () => { for (let i = 0; i < 50; i++) { await Promise.resolve(); if (dirty || effects.length) commit(); } };
  try {
    const date = '2026-10-14', first = await service.loadCanonicalPointSnapshot(db, point, date); strictEqual(http, 2);
    render(); strictEqual(result.loading, legacy, 'fresh warm snapshot is available on the first render, not after a loading flash');
    commit(); await settle(); strictEqual(result.snapshot, first);
    deepStrictEqual(profiles, legacy ? ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] : ['generic']);
    profile = 'boletusEdulis'; commit(); await settle(); strictEqual(http, 2); strictEqual(loads, 1);
    now += 31 * 60000;
    sourceVersion++;
    const refreshed = await service.loadCanonicalPointSnapshot(db, point, date); notStrictEqual(refreshed, first); await settle(); commit();
    strictEqual(result.snapshot, legacy ? first : refreshed, 'shared point refresh is adopted by the already-open weekly view');
    notStrictEqual(service.pointResults(first, 'generic')[0].score, service.pointResults(refreshed, 'generic')[0].score, 'source fixture really changes the displayed score');
    if (legacy) {
      listener!('active'); commit(); await settle(); strictEqual(loads, 1, 'reproduced: same-day resume never rechecked cache');
      console.log('REPRODUCED committed hook: warm loading flash, no shared-snapshot subscription, no same-day foreground refresh, eager 4-profile evaluation');
      return;
    }
    const freshWeek = result.results;
    for (const id of ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const) {
      for (const day of ['today', 'tomorrow'] as const) {
        const assessment = conditionsForLocation(mapConditionsLocation({ ...point, id: 'private-marker-not-logged' }), refreshed, id, day, date)!;
        const expected = service.pointResults(refreshed, id)[day === 'today' ? 0 : 1];
        deepStrictEqual(assessment.summary, expected.inputs); deepStrictEqual(assessment.scoreDetails, expected.canonical);
        strictEqual(assessment.score, expected.score, 'marker/detail/ranking/Top3 shared assessment equals weekly point result');
      }
    }
    now += 31 * 60000; offline = true; listener!('active'); commit();
    ok(result.snapshot.stale); ok(result.results.every((day: any) => day.score == null || day.status === 'stale'));
    await settle(); strictEqual(loads, 2); strictEqual(http, 6); ok(result.snapshot.stale);
    deepStrictEqual(result.results.map((day: any) => day.score), freshWeek.map((day: any) => day.score), 'stale display does not invent/alter model numbers');
    strictEqual([...timers.values()].filter(t => t.due <= now).length, 0, 'offline refresh does not spin expired-TTL retries');
    offline = false; result.retry(); commit(); await settle(); ok(!result.snapshot.stale); strictEqual(http, 8);
    const refreshedHttp = http;
    // Active-screen TTL deadline. Actual expiry only; no periodic polling/per-day fetch.
    const deadline = [...timers.entries()].find(([, timer]) => timer.due === result.snapshot.expiresAt)!; ok(deadline);
    now = deadline[1].due; timers.delete(deadline[0]); deadline[1].fn(); commit(); await settle();
    strictEqual(http, refreshedHttp + 2); ok(!result.snapshot.stale);
    const a = result.snapshot; hold = true; point = { latitude: 46.50001, longitude: 14.50001 }; commit();
    strictEqual(result.loading, true); strictEqual(result.results, undefined, 'same weather cell is NOT the same exact point'); await settle();
    point = { latitude: 46.5, longitude: 14.5 }; commit(); await settle(); strictEqual(result.snapshot, a);
    hold = false; held.splice(0).forEach(fn => fn()); await settle(); strictEqual(result.snapshot, a, 'late B cannot overwrite A after A-B-A');
    profile = 'lactariusDeliciosus'; commit(); await settle(); strictEqual(result.results[0].profileId, profile);
    const before = http; for (let i = 0; i < 7; i++) strictEqual(result.results[i].targetLocalDate, service.pointResults(a, profile)[i].targetLocalDate);
    strictEqual(http, before, 'all date/profile/return actions remain warm');
    now = RealDate.parse('2026-10-14T22:05:00Z'); listener!('active'); commit(); strictEqual(result.today, '2026-10-15');
    strictEqual(result.results, undefined, 'yesterday never appears under the new horizon'); await settle(); strictEqual(result.snapshot.baseLocalDate, '2026-10-15');
    offline = true;
    const unavailablePoint = { latitude: 46.7, longitude: 15.4 };
    const failed = await service.loadCanonicalPointSnapshot(db, unavailablePoint, '2026-10-15');
    strictEqual(service.cachedPointSnapshot(db, unavailablePoint, '2026-10-15')!.stale, false, 'zero expiry for missing sources is not an old-cache timestamp');
    ok(service.pointResults(failed, profile).every(day => day.score === null && day.status === 'error'));
    console.log('PASS actual hook/service: warm-first-render, source subscription, same-day resume, TTL refresh, offline stale/no-loop, nearby exact identities, A-B-A race, active-profile memo, midnight, 0 date/profile HTTP');
  } finally { slots.forEach(slot => slot?.cleanup?.()); globalThis.Date = RealDate; globalThis.fetch = fetch; globalThis.setTimeout = timeout; globalThis.clearTimeout = clear; }
}
function timingPrivacy() {
  const previousDev = (globalThis as any).__DEV__, info = console.info, logs: any[] = [];
  try {
    console.info = (...args) => logs.push(args);
    const point = { latitude: 46.5123456, longitude: 14.5123456, name: 'Private name', id: 'private-id' };
    (globalThis as any).__DEV__ = false; beginPointTiming(point); markPointTiming(point, '2026-10-14', 'T1 header layout'); strictEqual(logs.length, 0);
    (globalThis as any).__DEV__ = true; beginPointTiming(point, '2026-10-14'); markPointTiming(point, '2026-10-14', 'T1 header layout');
    strictEqual(logs.length, 2); const output = JSON.stringify(logs);
    for (const secret of ['46.5123456', '14.5123456', 'Private name', 'private-id', '2026-10-14']) ok(!output.includes(secret));
    deepStrictEqual(Object.keys(logs[0][1]).sort(), ['elapsedMs', 'request', 'stage']);
  } finally { (globalThis as any).__DEV__ = previousDev; console.info = info; }
}
function markerDeadline() {
  // Execute the real mounted point/marker hook's deadline effect, not a copied scheduler.
  const source = readFileSync('src/services/heatmap/useLocationConditions.ts', 'utf8');
  const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true);
  let body = '';
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('const deadlines')) body = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }; visit(ast); ok(body);
  let deadline: number | undefined, fire: (() => void) | undefined, retries = 0, cleared = 0;
  const context: any = { active: true, snapshots: { A: { stale: false, expiresAt: 1801000 }, B: { stale: false, expiresAt: 1901000 } },
    Date: { now: () => 1000 }, setTimeout: (fn: () => void, delay: number) => { fire = fn; deadline = delay; return 1; },
    clearTimeout: () => cleared++, retry: (fn: (value: number) => number) => retries = fn(retries) };
  const effect = runInNewContext(ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const cleanup = effect(); strictEqual(deadline, 1800000); fire!(); strictEqual(retries, 1); cleanup(); strictEqual(cleared, 1);
  deadline = undefined; context.active = false; effect(); strictEqual(deadline, undefined);
  context.active = true; context.snapshots = { A: { stale: true, expiresAt: 0 } }; effect(); strictEqual(deadline, undefined, 'no stale/offline polling loop');
}
void run(true).then(() => run()).then(() => { timingPrivacy(); markerDeadline(); }).catch(error => { console.error(error); process.exitCode = 1; });
