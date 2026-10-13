import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { buildWeatherDailySeries, summarySeriesInputs, weatherLocalDate } from '../src/domain/weatherSeries';
import { graphPeriodSummary } from '../src/components/weatherGraphPresentation';
import { createAdvancedDetailsFocus } from '../src/components/advancedDetailsFocus';
import { colors, spacing } from '../src/theme';
import { slNumber, slDateTime } from '../src/domain/format';

const source = readFileSync('src/screens/ConditionsScreen.tsx', 'utf8');
const ast = ts.createSourceFile('ConditionsScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ConditionsScreen')!;
const compiled = ts.transpileModule(screen.getText(ast).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const node = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const deferred = () => { let resolve!: (data: any) => void, reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const weather = (latitude: number, longitude: number, stale = false): any => ({ latitude, longitude, stale, source: 'open-meteo', errors: {}, updatedAt: '2026-10-13T08:00:00Z',
  historical: { days: [], rain7dMm: 14, rain14dMm: 30, rain26dMm: 80, rain30dMm: 80, rain60dMm: 110, avgTemp14dC: 14, avgTemp20dC: 13, evapotranspiration7dMm: 10 },
  current: { temperatureC: 15, soilMoisture0To7Cm: .3, soilMoisture7To28Cm: .3 }, forecast: { days: [], rain7dMm: 14 } });

async function run() {
  let cursor = 0, dirty = false, online = true, context: any;
  const slots: any[] = [], effects: (() => void)[] = [], requests: any[] = [], positions: any[] = [];
  const repository = { database: {} }; let scorerCalls = 0;
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((n, i) => Object.is(n, b[i]));
  const bindings: Record<string, any> = {
    React: { createElement: node, Fragment: 'Fragment' }, styles: {}, commonStyles: {},
    useState: (initial: any) => { const slot = cursor++; if (!slots[slot]) slots[slot] = { value: initial };
      return [slots[slot].value, (next: any) => { const value = typeof next === 'function' ? next(slots[slot].value) : next;
        if (!Object.is(value, slots[slot].value)) { slots[slot].value = value; dirty = true; } }]; },
    useRef: (initial: any) => { const slot = cursor++; return slots[slot] ??= { current: initial }; },
    useEffect: (fn: any, deps: any[]) => { const slot = cursor++, previous = slots[slot];
      if (!previous || !same(previous.deps, deps)) { const current = { deps, cleanup: undefined as any }; slots[slot] = current;
        effects.push(() => { previous?.cleanup?.(); current.cleanup = fn(); }); } },
    useMemo: (fn: any, deps: any[]) => { const slot = cursor++; if (!slots[slot] || !same(slots[slot].deps, deps)) slots[slot] = { value: fn(), deps }; return slots[slot].value; },
    useCallback: (fn: any, deps: any[]) => bindings.useMemo(() => fn, deps),
    useNavigation: () => ({ navigate() { throw new Error('loading cannot navigate'); } }),
    useApp: () => ({ repository, hotspots: [], online, exploreLocation: context,
      setExploreLocation: (next: any) => { context = next; dirty = true; }, requestHotspotFocus() {} }),
    getMushroomWeatherSummary: (_: any, latitude: number, longitude: number) => { const request = { ...deferred(), latitude, longitude }; requests.push(request); return request.promise; },
    acquireForegroundPosition: () => { const request = deferred(); positions.push(request); return request.promise; },
    Location: { Accuracy: { High: 1 }, reverseGeocodeAsync: async () => [] },
    withTimeout: (promise: any) => promise, REVERSE_GEOCODE_TIMEOUT_MS: 5000,
    resolveGpsLocality: async () => ({}), debugGpsLocality() {},
    buildGpsExploreLocation: (latitude: number, longitude: number) => ({ latitude, longitude, name: 'GPS območje', source: 'gps' }),
    LocationAcquisitionError: class extends Error {},
    useLocationConditions: () => ({ assessments: {}, complete: true }), topThreeHotspots: () => [], conditionsNavigationPatch: () => ({}),
    MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore: (...args: any[]) => { scorerCalls++; return calculateMushroomWeatherScore(args[0], args[1]); },
    buildWeatherDailySeries, summarySeriesInputs, weatherLocalDate, graphPeriodSummary, createAdvancedDetailsFocus, colors, spacing, slNumber, slDateTime,
    debugNumber: (v: any, unit: string) => v == null ? 'ni podatka' : v + ' ' + unit, placeDetails: () => '',
    ...Object.fromEntries(['Screen', 'Text', 'View', 'Card', 'Chip', 'Field', 'Notice', 'SectionTitle', 'Pressable', 'ScrollView', 'ActivityIndicator', 'AppButton', 'ConditionsAdvancedDetails', 'WeatherGraphsEntry', 'WeatherGraphsModal', 'SevenDayConditionsEntry', 'SevenDayConditionsModal'].map(s => [s, s])),
  };
  const component = new Function(...Object.keys(bindings), compiled + '; return ConditionsScreen;')(...Object.values(bindings));
  let tree: any;
  const render = () => { cursor = 0; dirty = false; tree = component(); return tree; };
  const commit = () => { let turns = 0; do { render(); while (effects.length) effects.shift()!(); if (++turns > 30) throw new Error('infinite render loop'); } while (dirty); return tree; };
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty) commit(); } };
  const noInsufficient = () => { ok(!text(tree).includes('Premalo podatkov')); ok(!text(tree).includes('Trend: Ni dovolj podatkov')); };
  const profile = (id: keyof typeof MUSHROOM_WEATHER_PROFILES) => {
    walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === MUSHROOM_WEATHER_PROFILES[id].label).props.onPress(); commit(); };
  const choose = (latitude: number, name: string) => { context = { latitude, longitude: 14, name, source: 'place' }; commit(); };

  render(); noInsufficient(); ok(text(tree).includes('Pridobivam lokacijo ...'), 'before initial GPS effect');
  commit(); strictEqual(positions.length, 1); strictEqual(requests.length, 0); noInsufficient();
  positions[0].resolve({ source: 'fresh', location: { coords: { latitude: 46, longitude: 14, accuracy: 10 }, timestamp: Date.now() } });
  await settle(); strictEqual(requests.length, 1); ok(text(tree).includes('Preračunavam razmere ...')); noInsufficient();
  const countBeforeProfile = requests.length;
  profile('boletusEdulis'); profile('cantharellusCibarius'); noInsufficient(); strictEqual(requests.length, countBeforeProfile);
  requests[0].resolve(weather(46, 14)); await settle();
  ok(text(tree).includes(calculateMushroomWeatherScore(weather(46, 14), 'cantharellusCibarius').score + '/100'));
  const countBeforeUI = requests.length, beforeScorer = scorerCalls;
  walk(tree).find(n => n.type === 'Pressable' && text(n).startsWith('Napredni podatki in razlaga modela')).props.onPress(); commit();
  strictEqual(scorerCalls, beforeScorer, 'opening details does not rescore'); strictEqual(requests.length, countBeforeUI);

  choose(47, 'Lokacija B'); ok(text(tree).includes('Preračunavam razmere ...')); noInsufficient();
  choose(48, 'Lokacija C'); const latest = requests.at(-1), old = requests.at(-2);
  old.resolve(weather(47, 14)); await settle(); noInsufficient(); ok(text(tree).includes('Preračunavam razmere ...'));
  latest.resolve(weather(48, 14, true)); await settle();
  ok(text(tree).includes('Starejši podatki iz predpomnilnika')); ok(text(tree).includes('Lokacija C'));
  strictEqual(walk(tree).find(n => n.type === 'WeatherGraphsModal').props.location.latitude, 48);

  choose(49, 'Brez omrežja'); requests.at(-1).reject(new Error('offline')); await settle(); noInsufficient();
  ok(text(tree).includes('Ocene trenutno ni mogoče pridobiti. Poskusi znova.'));
  walk(tree).find(n => n.type === 'AppButton' && n.props.title === 'Poskusi znova').props.onPress(); commit(); noInsufficient();
  ok(text(tree).includes('Preračunavam razmere ...')); requests.at(-1).reject(new Error('timeout')); await settle(); noInsufficient();
  choose(50, 'Zaključeno, manjkajo vhodi');
  requests.at(-1).resolve({ ...weather(50, 14), historical: undefined, current: undefined, forecast: undefined }); await settle();
  ok(text(tree).includes('Premalo podatkov')); ok(text(tree).includes('Trend: Ni dovolj podatkov')); ok(!text(tree).includes('0/100'));
  choose(51, 'Delna napaka');
  requests.at(-1).resolve({ ...weather(51, 14), historical: undefined, current: { temperatureC: 15 }, errors: { historical: 'Zgodovina ni na voljo' } }); await settle();
  noInsufficient(); ok(text(tree).includes('Ocene trenutno ni mogoče pridobiti'));
  ok(text(tree).includes('Trenutno: 15 °C'), 'usable partial weather is not hidden by unavailable suitability');
  choose(52, 'Uporabni delni podatki');
  const partial = { ...weather(52, 14), current: undefined, errors: { forecast: 'Napoved ni na voljo' } };
  requests.at(-1).resolve(partial); await settle();
  ok(text(tree).includes(calculateMushroomWeatherScore(partial, 'cantharellusCibarius').score + '/100')); ok(text(tree).includes('Napoved ni na voljo'));
  for (const id of Object.keys(MUSHROOM_WEATHER_PROFILES) as (keyof typeof MUSHROOM_WEATHER_PROFILES)[]) {
    const count: number = requests.length; profile(id); strictEqual(requests.length, count); ok(text(tree).includes(calculateMushroomWeatherScore(partial, id).score + '/100'));
  }
  // Cached summary still enters through the same loader, with no secondary acquisition.
  choose(53, 'Svež predpomnilnik'); const warmCount = requests.length;
  requests.at(-1).resolve(weather(53, 14)); await settle(); strictEqual(requests.length, warmCount); noInsufficient();
  ok(!text(tree).includes('Starejši podatki iz predpomnilnika'));
  choose(54, 'Ob zaprtju'); const late = requests.at(-1);
  for (const slot of slots) slot?.cleanup?.();
  late.resolve(weather(54, 14)); await settle(); strictEqual(dirty, false, 'late result after unmount cannot commit');
  slots.length = 0; context = undefined; dirty = false; commit();
  const beforeGpsFailure = requests.length;
  positions.at(-1).reject(new Error('GPS dovoljenje ni na voljo')); await settle(); noInsufficient();
  ok(text(tree).includes('Lokacije trenutno ni mogoče pridobiti.')); strictEqual(requests.length, beforeGpsFailure);
  for (const slot of slots) slot?.cleanup?.();
  slots.length = 0; online = false; context = { latitude: 60, longitude: 14, name: 'Offline izbrana lokacija', source: 'place' };
  commit(); noInsufficient(); ok(text(tree).includes('Ni povezave.')); ok(text(tree).includes('Preračunavam razmere ...'));
  requests.at(-1).resolve(weather(60, 14, true)); await settle(); noInsufficient();
  ok(text(tree).includes('Starejši podatki iz predpomnilnika')); ok(text(tree).includes(calculateMushroomWeatherScore(weather(60, 14), 'generic').score + '/100'));
  for (const slot of slots) slot?.cleanup?.();
  // UI-only additions cannot alter canonical scoring, transports or map infrastructure.
  for (const path of ['src/domain/mushroomWeather.ts','src/services/weather.ts','src/services/weatherGraphs.ts','src/screens/MapScreen.tsx',
    'src/components/ConditionsAdvancedDetails.tsx','src/components/conditionsAdvancedPresentation.ts','src/components/WeatherGraphs.tsx',
    'src/domain/hotspotRanking.ts','src/domain/conditionsSnapshot.ts','src/navigation/AppNavigator.tsx'])
    strictEqual(readFileSync(path,'utf8').replace(/\r\n/g,'\n'), execFileSync('git',['show',`b4559ef:${path}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'),path);
  console.log('PASS actual ConditionsScreen effect/async lifecycle: initial GPS, slow weather, rapid locations/profile switches, stale/warm cache, offline/timeout/retry, genuine insufficient vs source failure, usable partial score, no stale overwrite, no disclosure/profile extra requests or rescore; canonical/transport/map untouched. Native QA separate.');
}
void run();
