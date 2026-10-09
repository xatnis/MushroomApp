import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { buildWeatherDailySeries, weatherLocalDate, weatherPlotScale, validWeatherDate, summarySeriesInputs } from '../src/domain/weatherSeries';
import { loadWeatherGraphSeries, readWeatherGraphCache } from '../src/services/weatherGraphs';
import { getMushroomWeatherSummary, shiftLocalDate, mapDailyWeather } from '../src/services/weather';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../src/domain/heatmap/config';

const today = '2026-10-09';
const input = (date: string, rain: any = 0, mean: any = -3) => ({ day: { date, kind: 'historical' as const, precipitationMm: rain,
  temperatureMeanC: mean, temperatureMinC: -5, temperatureMaxC: 4 }, source: 'archive' as const, fetchedAt: '2026-10-09T08:00:00Z', stale: false });
for (const date of ['2024-03-01', '2026-03-30', '2026-10-26', '2027-01-01', today]) {
  const series = buildWeatherDailySeries(46, 14, date, []);
  strictEqual(series.points.length, 37); strictEqual(series.points[0].date, shiftLocalDate(date, -30));
  strictEqual(series.points[29].date, shiftLocalDate(date, -1)); strictEqual(series.points[30].date, date);
  strictEqual(series.points[36].date, shiftLocalDate(date, 6)); strictEqual(series.points.filter(p => p.kind === 'historical').length, 30);
  strictEqual(series.points[29].isCompleteDay, true); strictEqual(series.points[30].isProvisional, true);
  strictEqual(new Set(series.points.map(p => p.date)).size, 37); deepStrictEqual(series.points.map(p => p.date), series.points.map(p => p.date).sort());
}
strictEqual(weatherLocalDate(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
strictEqual(weatherLocalDate(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
ok(validWeatherDate('2024-02-29')); ok(!validWeatherDate('2026-02-29'));
let series = buildWeatherDailySeries(46, 14, today, [input('2026-10-08', 2), input('2026-10-08', 0), input(today, 120, undefined)]);
strictEqual(series.points[29].precipitationMm, 0); strictEqual(series.points[28].precipitationMm, null);
strictEqual(series.points[29].temperatureMeanC, -3); strictEqual(series.points[30].temperatureMeanC, -3); // helper default only, not adapter default
series = buildWeatherDailySeries(46, 14, today, [input(today, NaN, null)]);
strictEqual(series.points[30].temperatureMeanC, null); strictEqual(series.points[30].precipitationMm, null);
strictEqual(series.points[30].temperatureMinC, -5); strictEqual(series.points[30].temperatureMaxC, 4);
const malformed = mapDailyWeather({ daily: { time: ['2026-10-08', today], precipitation_sum: [0], temperature_2m_min: [-9] } }, 'forecast');
strictEqual(malformed[1].precipitationMm, undefined); strictEqual(malformed[1].temperatureMeanC, undefined);
strictEqual(buildWeatherDailySeries(46, 14, today, [input(today, '9', Infinity)]).points[30].precipitationMm, null);
strictEqual(buildWeatherDailySeries(46, 14, today, [{ ...input(today), fetchedAt: 'invalid' }]).points[30].fetchedAt, null);
ok(weatherPlotScale(buildWeatherDailySeries(46, 14, today, [input(today, 300)]).points, 'rain').max >= 300);
ok(weatherPlotScale(series.points, 'temperature').min < 0);

const rows = new Map<string, any>();
const db: any = { getFirstAsync: async (sql: string, key: string) => sql.includes('LIKE') ? [...rows.values()].find(row => {
  const regex = '^' + key.split('%').map((s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'; return new RegExp(regex).test(row.cacheKey);
}) : rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { cacheKey: key, payload, fetchedAt, expiresAt }) };
let http = 0, failForecast = false, timeoutForecast = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, options: any) => {
  http++; const parsed = new URL(String(url)), forecast = parsed.pathname.endsWith('forecast');
  if (forecast && failForecast) throw new Error('offline');
  if (forecast && timeoutForecast) return await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const start = forecast ? shiftLocalDate(today, -7) : parsed.searchParams.get('start_date')!;
  const end = forecast ? shiftLocalDate(today, 6) : parsed.searchParams.get('end_date')!;
  const dates: string[] = []; for (let d = start; d <= end; d = shiftLocalDate(d, 1)) dates.push(d);
  const daily = { time: dates, precipitation_sum: dates.map(() => 2), temperature_2m_mean: dates.map(() => 12),
    temperature_2m_min: dates.map(() => 8), temperature_2m_max: dates.map(() => 16) };
  return { ok: true, status: 200, json: async () => ({ daily }) };
}) as any;

async function run() {
  try {
    const location = { latitude: 46.4, longitude: 14.8 };
    const a = loadWeatherGraphSeries(db, location, today), b = loadWeatherGraphSeries(db, location, today);
    strictEqual(a, b, 'concurrent charts join before SQLite reads');
    const cold = await a; strictEqual(http, 2); strictEqual(cold.partial, false); strictEqual(cold.points[29].source, 'recentForecastHistory');
    strictEqual(cold.points[22].source, 'archive'); strictEqual(cold.points[30].source, 'forecast');
    await loadWeatherGraphSeries(db, location, today); strictEqual(http, 2, 'warm reopen has no HTTP');
    const canonical = await getMushroomWeatherSummary(db, location.latitude, location.longitude, { baseLocalDate: today });
    ok(summarySeriesInputs(canonical, today).every(p => p.fetchedAt === null), 'aggregate age is not forecast endpoint retrieval time');
    await loadWeatherGraphSeries(db, location, today, canonical); strictEqual(http, 2, 'existing Conditions cache reused');
    // Existing multi-coordinate heatmap raw payloads include 7 future days even though scorer timeline keeps only 2.
    const archive = [...rows.values()].find(r => r.cacheKey.startsWith('mushroom-archive'));
    const forecast = [...rows.values()].find(r => r.cacheKey.startsWith('mushroom-forecast'));
    rows.clear();
    const cell = { latitude: 46.41, longitude: 14.81, weatherCellId: 'weather-99' }, marker = 'weather-99:46.4100:14.8100';
    for (const [endpoint, row] of [['archive', archive], ['forecast', forecast]] as const) {
      const prefix = endpoint === 'archive' ? `${shiftLocalDate(today, -60)}:${shiftLocalDate(today, -8)}` : today;
      const key = `heatmap-${endpoint}:${HEATMAP_WEATHER_POLICY_VERSION}:${prefix}:other:46.0000:14.0000|${marker}`;
      rows.set(key, { ...row, cacheKey: key, payload: JSON.stringify([{ daily: { time: [] } }, { ...JSON.parse(row.payload), location_id: 1 }]) });
    }
    const warmBatch = await loadWeatherGraphSeries(db, cell, today); strictEqual(warmBatch.partial, false); strictEqual(http, 2, 'warm heatmap archive/forecast reused with no extra HTTP');
    strictEqual(warmBatch.points[36].precipitationMm, 2);
    for (const row of [archive, forecast]) {
      const cacheKey = row.cacheKey.replace('46.40:14.80', '46.41:14.81');
      rows.set(cacheKey, { ...row, cacheKey, expiresAt: '2000-01-01T00:00:00Z' });
    }
    strictEqual((await loadWeatherGraphSeries(db, cell, today)).stale, false);
    strictEqual(http, 2, 'expired point cache must not hide fresh batch data');
    for (const row of rows.values()) row.expiresAt = '2000-01-01T00:00:00Z';
    ok((await readWeatherGraphCache(db, cell, today)).every(p => p.stale));
    // Partial offline cache remains useful, with explicit gaps and per-endpoint age.
    rows.clear(); rows.set(archive.cacheKey, archive); failForecast = true;
    const partial = await loadWeatherGraphSeries(db, location, today);
    ok(partial.partial); strictEqual(partial.points[30].precipitationMm, null); strictEqual(partial.points[0].precipitationMm, 2);
    failForecast = false; timeoutForecast = true;
    const timed = await getMushroomWeatherSummary(db, location.latitude, location.longitude, { baseLocalDate: today, requestTimeoutMs: 5 });
    ok(timed.errors.forecast); timeoutForecast = false;
    // Corrupt payload and inconsistent arrays degrade rather than invent values.
    rows.clear(); rows.set(archive.cacheKey, { ...archive, payload: '{bad json' });
    deepStrictEqual(await readWeatherGraphCache(db, location, today), []);
  } finally { globalThis.fetch = originalFetch; }
  await uiTests();
  console.log('PASS daily calendar/DST/leap/37 slots, zero/null/negative/missing/invalid values, cold 2 HTTP, warm point/batch 0 HTTP, dedupe, partial/offline/timeout/corrupt cache, native chart tap/gaps/scales/font sizing, generation/closed isolation. Phone QA separate.');
}

async function uiTests() {
  const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
  const file = resolve('src/components/WeatherGraphs.tsx'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  const original = mod.require.bind(mod), hooks: any[] = [], effects: Array<() => void> = []; let cursor = 0, scale = 1;
  const loaders: Array<{ location: any; resolve: (value: any) => void; reject: (reason: any) => void }> = [];
  const changed = (a: any[], b: any[]) => !a || a.some((v, i) => v !== b[i]);
  const element = (type: any, props: any) => ({ type, props });
  mod.require = (id: string) => {
    if (id === 'react') return {
      useState: (initial: any) => { const slot = cursor++; hooks[slot] ??= { value: initial }; return [hooks[slot].value, (v: any) => hooks[slot].value = typeof v === 'function' ? v(hooks[slot].value) : v]; },
      useRef: (initial: any) => { const slot = cursor++; hooks[slot] ??= { current: initial }; return hooks[slot]; },
      useMemo: (f: any) => f(), useEffect: (f: any, deps: any[]) => { const slot = cursor++; if (changed(hooks[slot]?.deps, deps)) effects.push(() => { hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: f() }; }); } };
    if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (id === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'ActivityIndicator'].map(s => [s, s])), StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, useWindowDimensions: () => ({ fontScale: scale }) };
    if (id === 'expo-sqlite') return { useSQLiteContext: () => db };
    if (id.endsWith('/weatherGraphs')) return { loadWeatherGraphSeries: (_: any, location: any) => new Promise((resolve, reject) => loaders.push({ location, resolve, reject })) };
    return original(id);
  };
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
  const text = (n: any): string => Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
  const data = buildWeatherDailySeries(46, 14, today, [input('2026-10-07', 2, -3), input('2026-10-08', 0, null), input(today, 60, 13)]);
  let selected = '';
  hooks.length = 0; cursor = 0;
  const tree = mod.exports.DailyWeatherChart({ series: data, metric: 'temperature', selectedDate: today, onSelect: (date: string) => selected = date });
  const targets = walk(tree).filter(n => n.type === 'Pressable'); strictEqual(targets.length, 37);
  targets[29].props.onPress(); strictEqual(selected, '2026-10-08'); ok(targets[30].props.accessibilityState.selected);
  strictEqual(targets[29].props.style[1].width, 44); ok(text(tree).includes('Danes')); ok(text(tree).includes('min:'));
  const lines = walk(tree).filter(n => n.type === 'View' && Array.isArray(n.props.style) && n.props.style[0]?.height === 2 && n.props.style[1]?.transform);
  strictEqual(lines.length, 0, 'no interpolation through missing mean');
  scale = 2; cursor = 0;
  const large = mod.exports.DailyWeatherChart({ series: data, metric: 'rain', selectedDate: '2026-10-08', onSelect() {} });
  strictEqual(walk(large).find(n => n.type === 'Pressable').props.style[1].width, 88); ok(text(large).includes('0 mm'));
  const map = readFileSync('src/screens/MapScreen.tsx', 'utf8'); ok(map.includes("section === 'weather' ? <><WeatherGraphs"));
  ok(readFileSync('src/screens/ConditionsScreen.tsx', 'utf8').includes('showWeatherDetails ? <><WeatherGraphs'));
  for (const file of ['src/domain/mushroomWeather.ts', 'src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/regionalWeather.ts', 'src/domain/hotspotRanking.ts'])
    strictEqual(readFileSync(file, 'utf8'), execFileSync('git', ['show', `b771a23:${file}`], { encoding: 'utf8' }), file);
  // Actual hook effect: context-only rerenders do not load, old location cannot publish.
  hooks.length = 0; cursor = 0; effects.length = 0;
  const summary = { latitude: 46, longitude: 14, updatedAt: new Date().toISOString(), errors: {}, stale: false, source: 'open-meteo' };
  const render = (summary: any) => { cursor = 0; const tree = mod.exports.WeatherGraphs({ summary }); effects.splice(0).forEach(f => f()); return tree; };
  render(summary); strictEqual(loaders.length, 1); render({ ...summary }); strictEqual(loaders.length, 1);
  render({ ...summary, latitude: 47 }); strictEqual(loaders.length, 2);
  loaders[0].resolve(data);
  await Promise.resolve();
  strictEqual(hooks[0].value.key.startsWith('47:'), true, 'stale location response ignored');
  strictEqual(hooks[0].value.series, undefined);
  loaders[1].reject(new Error('offline'));
  await Promise.resolve(); await Promise.resolve();
  const failed = render({ ...summary, latitude: 47 });
  ok(text(failed).includes('Poskusi znova')); ok(text(failed).includes('niso na voljo'));
  strictEqual(hooks[0].value.loading, false, 'failure ends spinner');
  walk(failed).find(n => n.type === 'Pressable').props.onPress();
  render({ ...summary, latitude: 47 }); strictEqual(loaders.length, 3);
  hooks.forEach(h => h?.cleanup?.());
  const before = hooks[0].value;
  loaders[2].resolve(data); await Promise.resolve();
  strictEqual(hooks[0].value, before, 'closing details prevents late UI publication');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
