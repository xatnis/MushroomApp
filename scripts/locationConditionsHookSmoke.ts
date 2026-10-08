/// <reference types="node" />
import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../src/domain/types';
import type { HeatmapTargetDay } from '../src/domain/heatmap/types';
import { mapConditionsLocation } from '../src/domain/locationConditions';
import { localDateFor, targetLocalDate } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import { regionalWeatherKey } from '../src/services/heatmap/regionalWeather';
import * as service from '../src/services/heatmap/pilotHeatmap';

const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
const p = { id: 'test', latitude: 46.47045, longitude: 14.85009 }, mapping = mapConditionsLocation(p), date = localDateFor();
const source = { ...mapping.weatherPoint, baseLocalDate: date, fetchedAt: new Date().toISOString(), stale: false, errors: {},
  days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast',
    precipitationMm: 2, temperatureMeanC: 13, evapotranspirationMm: 1 })),
  currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .26 },
  tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .26, soilMoisture7To28Cm: .27 } };
const rows = new Map([[regionalWeatherKey([mapping.weatherPoint], date), { payload: JSON.stringify(source) }]]);
const db = { getFirstAsync: async (_: string, key: string) => rows.get(key) ?? null,
  runAsync: async (_: string, key: string, payload: string) => rows.set(key, { payload }) } as unknown as SQLiteDatabase;
let focused = true, loads = 0, foregroundListener: ((state: string) => void) | undefined;
let holdLoads = false;
const heldLoads: Array<{ reject: (error: Error) => void }> = [];
let index = 0;
const hooks: any[] = [], effects: Array<() => void> = [];
const equal = (a: unknown[], b: unknown[]) => a?.length === b?.length && a.every((v, i) => v === b[i]);
const react = {
  useState(initial: unknown) { const i = index++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [hooks[i].value, (value: unknown) => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
  useRef(initial: unknown) { const i = index++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
  useMemo(fn: () => unknown, deps: unknown[]) { const i = index++; if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() }; return hooks[i].value; },
  useEffect(fn: () => (() => void) | undefined, deps: unknown[]) { const i = index++; if (hooks[i] && equal(hooks[i].deps, deps)) return;
    const old = hooks[i]; hooks[i] = { deps }; effects.push(() => { old?.cleanup?.(); hooks[i].cleanup = fn(); }); },
};
const filename = resolve('src/services/heatmap/useLocationConditions.ts'), mod = new Module(filename);
mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/services/heatmap'));
const original = mod.require.bind(mod);
mod.require = (id: string) => {
  if (id === 'react') return react;
  if (id === 'react-native') return { AppState: { addEventListener: (_name: string, fn: (state: string) => void) => {
    foregroundListener = fn; return { remove: () => { foregroundListener = undefined; } };
  } } };
  if (id === '@react-navigation/native') return { useIsFocused: () => focused };
  if (id === 'expo-sqlite') return { useSQLiteContext: () => db };
  if (id === './pilotHeatmap') return { ...service, loadHeatmapPilot: (...args: Parameters<typeof service.loadHeatmapPilot>) => {
    loads++;
    return holdLoads ? new Promise((_, reject) => heldLoads.push({ reject })) : service.loadHeatmapPilot(...args);
  } };
  return original(id);
};
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const useLocationConditions = mod.exports.useLocationConditions as typeof import('../src/services/heatmap/useLocationConditions').useLocationConditions;
(globalThis as any).__DEV__ = false;
function render(profile: MushroomWeatherProfileId = 'generic', day: HeatmapTargetDay = 'today', locations = [p]) {
  index = 0; const value = useLocationConditions(locations, profile, day, true, 5);
  for (const effect of effects.splice(0)) effect(); return value;
}
async function run() {
  let http = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { http++; throw new Error('Warm selection must never fetch'); };
  try {
    strictEqual(render().complete, false, 'initial render is pending BEFORE loading effect commits');
    render('boletusEdulis'); render('cantharellusCibarius', 'tomorrow');
    await new Promise(resolve => setTimeout(resolve, 25));
    const ready = render('cantharellusCibarius', 'tomorrow');
    strictEqual(loads, 1, 'rapid profile/day updates do not restart transport');
    ok(ready.assessments[p.id]?.score != null);
    strictEqual(ready.complete, true, 'all attempts settled');
    strictEqual(ready.assessments[p.id]!.speciesId, 'cantharellusCibarius');
    strictEqual(ready.assessments[p.id]!.targetLocalDate, targetLocalDate(date, 'tomorrow'), 'latest selection wins');
    for (const profile of ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const) for (const day of ['today', 'tomorrow'] as const) render(profile, day);
    await new Promise(resolve => setTimeout(resolve, 10)); strictEqual(loads, 1); strictEqual(http, 0);
    focused = false; render(); await new Promise(resolve => setTimeout(resolve, 10)); strictEqual(loads, 1, 'hidden screen cannot fetch');
    focused = true; strictEqual(render().complete, false); await new Promise(resolve => setTimeout(resolve, 20)); render();
    strictEqual(loads, 2); strictEqual(http, 0, 'focus freshness check reuses cache');
    foregroundListener!('active'); strictEqual(render().complete, false); await new Promise(resolve => setTimeout(resolve, 20)); render();
    strictEqual(loads, 3); strictEqual(http, 0, 'foreground cache reuse');
    render('generic', 'today', [{ ...p, latitude: NaN }]); await new Promise(resolve => setTimeout(resolve, 10));
    strictEqual(loads, 3, 'transient invalid manual input cannot query weather or crash');
    render('generic', 'today', [p]); render('generic', 'today', []);
    await new Promise(resolve => setTimeout(resolve, 15)); strictEqual(loads, 3, 'cancelled stale coordinate work never starts');
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...p, id: `top-${i}` }));
    strictEqual(render('generic', 'today', nine).complete, false);
    await new Promise(resolve => setTimeout(resolve, 20));
    const top = render('generic', 'today', nine); strictEqual(top.complete, true); strictEqual(Object.keys(top.assessments).length, 9);
    const loaded = loads;
    for (const profile of ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const) for (const day of ['today', 'tomorrow'] as const) {
      const next = render(profile, day, nine); strictEqual(next.complete, true);
      for (const value of Object.values(next.assessments)) strictEqual(value!.speciesId, profile);
    }
    render('generic', 'today', nine); render('generic', 'today', nine);
    strictEqual(loads, loaded, 'closing/reopening retained Top 3 never restarts transport'); strictEqual(http, 0);
    console.info('Top 3 warm hook fixture', { hotspots: 9, uniqueWeatherPoints: 1, extraHttp: http,
      speciesDayExtraLoads: loads - loaded, reopenExtraLoads: loads - loaded });
    holdLoads = true;
    const oldLocations = [{ id: 'old-generation', latitude: 45.1, longitude: 13.1 }];
    const latestLocations = [{ id: 'latest-generation', latitude: 46.9, longitude: 16.9 }];
    strictEqual(render('boletusEdulis', 'today', oldLocations).complete, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    strictEqual(render('lactariusDeliciosus', 'tomorrow', latestLocations).complete, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    heldLoads[0].reject(new Error('late obsolete failure')); await new Promise(resolve => setTimeout(resolve, 0));
    const waiting = render('lactariusDeliciosus', 'tomorrow', latestLocations);
    strictEqual(waiting.complete, false); strictEqual(waiting.error, undefined, 'stale failure cannot finish/error latest generation');
    heldLoads[1].reject(new Error('current failure')); await new Promise(resolve => setTimeout(resolve, 0));
    const failed = render('lactariusDeliciosus', 'tomorrow', latestLocations);
    strictEqual(failed.complete, true, 'failed attempt completes instead of infinite loading');
    ok(failed.error); strictEqual(failed.assessments[latestLocations[0].id], undefined, 'failure never fabricates zero');
  } finally { for (const hook of hooks) hook?.cleanup?.(); globalThis.fetch = fetch; }
  strictEqual(foregroundListener, undefined, 'listener cleanup');
  console.info('PASS actual location hook: latest species/day selection, zero refetch, grouped load, focus/foreground cache, invalid input, stale cancellation, cleanup. No Map/GeoJSON/LOD call path.');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
