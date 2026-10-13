import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { calculateMushroomWeatherScore, MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../src/domain/types';
import { advancedExplanation, advancedFactors, advancedInputGroups, advancedInputs } from '../src/components/conditionsAdvancedPresentation';
import { createAdvancedDetailsFocus } from '../src/components/advancedDetailsFocus';
import { spacing } from '../src/theme';

const summary: MushroomWeatherSummary = {
  latitude: 46.41, longitude: 14.77, updatedAt: '2026-10-12T08:00:00Z', stale: false, source: 'open-meteo', errors: {},
  current: { temperatureC: 14, soilMoisture0To7Cm: .271, soilMoisture7To28Cm: .29 },
  historical: { days: [], rain3dMm: 0, rain7dMm: 3, rain14dMm: 14, rain26dMm: 80, rain30dMm: 30, rain60dMm: 60,
    avgTemp7dC: 11, avgTemp14dC: 12, avgTemp20dC: 13, evapotranspiration7dMm: 18.4,
    coverage: { rain3dDays: 3, rain7dDays: 7, rain14dDays: 14, rain26dDays: 26, rain30dDays: 30, rain60dDays: 60,
      temp7dDays: 7, temp14dDays: 14, temp20dDays: 20, evapotranspiration7dDays: 7 } },
  forecast: { days: [{ date: '2026-10-12', kind: 'forecast', precipitationMm: 7 }], rain3dMm: 7, rain7dMm: 7 },
};
const expectedKeys = {
  generic: ['rain', 'temperature', 'soilMoisture', 'drying'], boletusEdulis: ['rain26', 'temperature', 'soilMoisture', 'drying'],
  cantharellusCibarius: ['rain30', 'rain7', 'temperature', 'soilMoisture', 'drying'],
  lactariusDeliciosus: ['rain60', 'rain14', 'soilMoisture', 'temperature', 'drying'],
};
for (const profile of Object.keys(expectedKeys) as MushroomWeatherProfileId[]) {
  const score = calculateMushroomWeatherScore(summary, profile), before = JSON.stringify(score);
  const factors = advancedFactors(score);
  deepStrictEqual(factors.map(f => f.key), expectedKeys[profile]);
  for (const factor of factors) {
    const canonical = score.components.find(c => c.key === factor.key)!;
    strictEqual(factor.label, canonical.label); strictEqual(factor.points, canonical.weightedPoints);
    strictEqual(factor.maximum, canonical.weight); strictEqual(factor.ratio, canonical.weightedPoints / canonical.weight);
  }
  strictEqual(JSON.stringify(score), before, 'presentation cannot mutate canonical scorer output');
  const inputs = advancedInputs(summary, score);
  const temp = inputs[1].rows.filter(row => row.usage === 'Vhod temperaturnega signala');
  strictEqual(temp.length, 1); ok(temp[0].label.includes(profile === 'cantharellusCibarius' ? '14' : '20'));
  const rain = inputs[0].rows.filter(row => row.usage.startsWith('Vhod padavinskega signala')).map(row => row.label);
  deepStrictEqual(rain, (profile === 'generic' ? [7, 14, 30] : profile === 'boletusEdulis' ? [26] : profile === 'cantharellusCibarius' ? [7, 30] : [14, 60]).map(d => `Padavine zadnjih ${d} dni`));
  ok(JSON.stringify(inputs).includes('0,271 m³/m³')); ok(JSON.stringify(inputs).includes('18,4 mm ET₀'));
  ok(JSON.stringify(inputs).includes('0 mm'), 'real zero rain is preserved');
  const groups = advancedInputGroups(summary, score);
  const used = groups.used.flatMap(group => group.rows), additional = groups.additional.flatMap(group => group.rows);
  strictEqual(used.length, profile === 'generic' || profile === 'lactariusDeliciosus' ? 7 : 6);
  strictEqual(new Set([...used, ...additional].map(row => row.label)).size, 12, 'each input appears exactly once');
  strictEqual(used.length + additional.length, 12);
  deepStrictEqual(groups.used.map(group => group.title), ['Padavine', 'Temperatura', 'Vlaga tal', 'Izsuševanje']);
  ok(used.every(row => row.usedInScore)); ok(additional.every(row => !row.usedInScore));
  strictEqual(used.filter(row => row.label === 'Padavine zadnjih 7 dni').length, 1, 'rain/drying dependency shares one row');
  ok(!used.some(row => row.label.includes('3 dni') || row.label.includes('temperatura 7 dni')));
  const noDrying = { ...summary, historical: { ...summary.historical!, evapotranspiration7dMm: undefined } };
  const noDryingScore = calculateMushroomWeatherScore(noDrying, profile);
  const noDryingGroups = advancedInputGroups(noDrying, noDryingScore);
  ok(!noDryingGroups.used.some(group => group.title === 'Izsuševanje'), 'no false used ET0 claim when drying component absent');
  strictEqual(noDryingGroups.used.flatMap(group => group.rows).some(row => row.label === 'Padavine zadnjih 7 dni'), profile === 'generic' || profile === 'cantharellusCibarius');
  const oneSoil = { ...summary, current: { soilMoisture0To7Cm: .271 } };
  const oneSoilScore = calculateMushroomWeatherScore(oneSoil, profile);
  strictEqual(advancedInputGroups(oneSoil, oneSoilScore).used.find(group => group.title === 'Vlaga tal')?.rows.length ?? 0, profile === 'generic' ? 0 : 1,
    'Generic requires both soil layers, species consume the available layer');
  const explanation = advancedExplanation(score);
  const largest = [...score.components].sort((a, b) => b.weightedPoints - a.weightedPoints)[0];
  ok(explanation.includes(largest.label), 'concise statement refers to actual largest weighted contribution');
  ok(!score.reasons.some(reason => explanation.includes(reason)), 'no repeated rain/temperature measurement paragraphs');
  const missing = { ...summary, current: undefined, historical: { ...summary.historical!, evapotranspiration7dMm: undefined } };
  const partial = calculateMushroomWeatherScore(missing, profile);
  ok(advancedFactors(partial).filter(f => f.key === 'soilMoisture' || f.key === 'drying').every(f => f.ratio == null && f.contribution === 'Ni podatka'));
  ok(JSON.stringify(advancedInputs(missing, partial)).includes('Ni podatka'));
  // Forecast rain may affect trend, never today's canonical score.
  strictEqual(calculateMushroomWeatherScore({ ...summary, forecast: { days: [], rain7dMm: 100, rain3dMm: 50 } }, profile).score, score.score);
}
const numeric = calculateMushroomWeatherScore(summary, 'generic');
const controlled = { ...numeric, components: [{ key: 'rain' as const, label: 'Canonical test factor', value: .4, weight: 45, weightedPoints: 14.8 }] };
strictEqual(advancedFactors(controlled)[0].ratio, 14.8 / 45, 'bar is contribution/max, not /100 or guessed normalized value');
strictEqual(advancedFactors({ ...controlled, components: [{ ...controlled.components[0], weightedPoints: 0 }] })[0].ratio, 0);
for (const invalid of [NaN, Infinity, -1, 46]) {
  const factor = advancedFactors({ ...controlled, components: [{ ...controlled.components[0], weightedPoints: invalid }] })[0];
  strictEqual(factor.ratio, undefined); strictEqual(factor.contribution, 'Ni podatka');
}
const unavailable = calculateMushroomWeatherScore(undefined, 'generic');
ok(advancedFactors(unavailable).every(f => f.ratio == null));
strictEqual(advancedExplanation(unavailable), unavailable.reasons[0], 'unavailable reason remains honest');
ok(advancedExplanation({ ...numeric, components: numeric.components.map(c => ({ ...c, value: 0, weightedPoints: 0 })), score: 0 }).includes('ne prispevajo točk'));
ok(advancedExplanation(controlled).includes('Del prispevkov ni na voljo'));

// Execute actual TSX and disclosure callbacks, not copies of the UI logic.
const file = resolve('src/components/ConditionsAdvancedDetails.tsx'), requireHere = createRequire(file);
const Module = requireHere('node:module'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
const jsx = (type: any, props: any) => ({ type, props });
let cursor = 0; const states: any[] = [];
mod.require = (id: string) => {
  if (id === 'react') return { useState: (initial: any) => { const slot = cursor++; if (!(slot in states)) states[slot] = initial;
    return [states[slot], (next: any) => states[slot] = typeof next === 'function' ? next(states[slot]) : next]; } };
  if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (id === 'react-native') return { Pressable: 'Pressable', View: 'View', Text: 'Text', StyleSheet: { create: (s: any) => s, hairlineWidth: .5 } };
  if (id === './ui') return { Card: 'Card', commonStyles: {} };
  return requireHere(id);
};
mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const expand = (n: any): any => Array.isArray(n) ? n.map(expand) : n?.props ? typeof n.type === 'function'
  ? expand(n.type(n.props)) : { ...n, props: { ...n.props, children: expand(n.props.children) } } : n;
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
let openedGraphs = 0;
let props = { summary: summary as MushroomWeatherSummary | undefined, score: numeric, forecastText: 'Podatki za 1 od 7 dni', onOpenGraphs: () => openedGraphs++ };
const render = () => { cursor = 0; return expand(mod.exports.ConditionsAdvancedDetails(props)); };
let tree = render();
const headings = () => walk(tree).filter(n => n.type === 'Text' && n.props.accessibilityRole === 'header').map(text);
deepStrictEqual(headings(), ['Kako je izračunana ocena?']);
const toggle = (label: string) => walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
for (const label of ['Vhodni vremenski podatki', 'Viri in omejitve modela']) {
  strictEqual(toggle(label).props.accessibilityState.expanded, false); ok(toggle(label).props.style.minHeight >= 48);
}
ok(!text(tree).includes('m³/m³') && !text(tree).includes('posodobljeno'), 'raw data and provenance collapsed');
ok(!text(tree).includes(numeric.reasons[0]) && !text(tree).includes(numeric.reasons[1]), 'measurement paragraphs are not repeated before the breakdown');
const visibleFactors = walk(tree).filter(n => n.props.accessible && n.props.accessibilityLabel?.includes('Prispevek:'));
strictEqual(visibleFactors.length, 4); ok(visibleFactors[0].props.accessibilityLabel.includes(advancedFactors(numeric)[0].contribution));
const bars = walk(tree).filter(n => Array.isArray(n.props.style) && n.props.style[1]?.width);
deepStrictEqual(bars.map(n => n.props.style[1].width), advancedFactors(numeric).map(f => `${f.ratio! * 100}%`));
toggle('Vhodni vremenski podatki').props.onPress(); tree = render();
ok(text(tree).includes('0,271 m³/m³') && text(tree).includes('18,4 mm ET₀'));
ok(headings().includes('Uporabljeno pri oceni'));
strictEqual(toggle('Dodatni vremenski podatki').props.accessibilityState.expanded, false);
ok(toggle('Dodatni vremenski podatki').props.style.minHeight >= 48);
ok(!text(tree).includes('Padavine zadnjih 3 dni') && !text(tree).includes('Povprečna temperatura 7 dni'));
ok(!text(tree).includes('Podatki za 1 od 7 dni'), 'forecast context is additional, not used in current score');
toggle('Dodatni vremenski podatki').props.onPress(); tree = render();
strictEqual(toggle('Dodatni vremenski podatki').props.accessibilityState.expanded, true);
ok(text(tree).includes('Padavine zadnjih 3 dni') && text(tree).includes('Povprečna temperatura 7 dni'));
ok(text(tree).includes('Podatki za 1 od 7 dni')); ok(!text(tree).includes('2026-10-12'), 'no duplicate daily forecast table');
for (const label of advancedInputs(summary, numeric).flatMap(group => group.rows).map(row => row.label))
  strictEqual(walk(tree).filter(n => n.type === 'Text' && text(n) === label).length, 1, 'UI input not duplicated: ' + label);
toggle('Vhodni vremenski podatki').props.onPress(); tree = render();
toggle('Vhodni vremenski podatki').props.onPress(); tree = render();
strictEqual(toggle('Dodatni vremenski podatki').props.accessibilityState.expanded, false, 'reopening inputs starts compact again');
toggle('Dodatni vremenski podatki').props.onPress(); tree = render();
walk(tree).find(n => n.props.accessibilityLabel === 'Vremenski grafi za izbrano lokacijo').props.onPress(); strictEqual(openedGraphs, 1);
toggle('Viri in omejitve modela').props.onPress(); tree = render();
ok(text(tree).includes('ne verjetnosti najdbe gob')); ok(text(tree).includes('Open-Meteo')); ok(text(tree).includes('komercialno uporabo'));
ok(text(tree).includes('Napoved vključuje nedokončan današnji dan')); ok(text(tree).includes('pretekle napovedi niso meritve'));
for (const profile of Object.keys(expectedKeys) as MushroomWeatherProfileId[]) {
  props = { ...props, score: calculateMushroomWeatherScore(summary, profile) }; tree = render();
  ok(text(tree).includes(MUSHROOM_WEATHER_PROFILES[profile].label)); ok(text(tree).includes(`${props.score.score}/100`));
  strictEqual(walk(tree).filter(n => n.props.accessible && n.props.accessibilityLabel?.includes('Prispevek:')).length, expectedKeys[profile].length);
  for (const note of [MUSHROOM_WEATHER_PROFILES[profile].tuningNote, MUSHROOM_WEATHER_PROFILES[profile].evidenceNote, MUSHROOM_WEATHER_PROFILES[profile].seasonNote]) if (note) ok(text(tree).includes(note));
  for (const reason of props.score.reasons) ok(text(tree).includes(reason), 'canonical explanation retained');
}
props = { ...props, summary: { ...summary, stale: true }, score: numeric }; tree = render(); ok(text(tree).includes('lahko zastareli podatki'));
props = { ...props, summary: { ...summary, historical: { ...summary.historical!, coverage: { ...summary.historical!.coverage, rain14dDays: 9 } } } };
tree = render(); ok(text(tree).includes('Nepopolna pokritost: 9/14 dni')); ok(!text(tree).includes('Pokritost: 7/7 dni'), 'full-coverage metadata does not add a repeated line to every row');
props = { ...props, summary: undefined, score: unavailable }; tree = render(); ok(text(tree).includes('Ni ocene')); ok(!text(tree).includes('0/100'));
states.length = 0; tree = render(); strictEqual(toggle('Vhodni vremenski podatki').props.accessibilityState.expanded, false, 'unmount/reopen resets secondary UI');

// Measured anchor, post-layout frame, latest selection / close / location / gesture protection.
let id = 0; const frames = new Map<number, () => void>(), scrolls: number[] = [];
const focus = createAdvancedDetailsFocus(y => scrolls.push(y), spacing.lg, fn => { frames.set(++id, fn); return id; }, n => frames.delete(n));
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
focus.request(false); strictEqual(scrolls.length, 0); strictEqual(frames.size, 0, 'opening waits for native layout');
const generation = focus.generation;
focus.layout(734, generation); strictEqual(scrolls.length, 0); flush(); deepStrictEqual(scrolls, [734 - spacing.lg]);
focus.request(true); flush(); strictEqual(scrolls.length, 2, 'Why when already open still reveals explanation');
focus.request(false); const retired = focus.generation; focus.layout(900, retired); const staleFrame = [...frames.values()][0];
focus.request(false); focus.layout(1200, retired); staleFrame(); strictEqual(scrolls.length, 2);
focus.layout(800, focus.generation); flush(); strictEqual(scrolls.at(-1), 800 - spacing.lg);
for (const reason of ['close', 'location switch', 'unmount', 'manual drag']) {
  focus.request(false); focus.layout(1000, focus.generation); const callback = [...frames.values()][0];
  focus.cancel(); callback(); flush(); strictEqual(scrolls.length, 3, `${reason} cancels pending UI scroll`);
}
focus.request(false); focus.layout(2, focus.generation); flush(); strictEqual(scrolls.at(-1), 0);
focus.setContext('place:generic'); focus.layout(650, focus.generation); focus.request(true);
const obsoleteContextFrame = [...frames.values()][0], obsoleteContextToken = focus.generation;
focus.setContext('place:cantharellusCibarius'); focus.layout(700, obsoleteContextToken); obsoleteContextFrame();
const beforeContext = scrolls.length;
focus.layout(810, focus.generation); focus.request(true); flush();
strictEqual(scrolls.length, beforeContext + 1); strictEqual(scrolls.at(-1), 810 - spacing.lg, 'profile layout refreshes anchor, no post-render effect invalidates new coordinates');

const screen = readFileSync('src/screens/ConditionsScreen.tsx', 'utf8');
ok(screen.includes('onPress={openExplanation}') && screen.includes('setShowWeatherDetails(true)'));
ok(screen.includes('event.nativeEvent.layout.y, layoutGeneration')); ok(screen.includes('onScrollBeginDrag={() => focus.cancel(false)}'));
ok(screen.includes('key={`${coords?.latitude}:${coords?.longitude}`}')); ok(!screen.includes('forecast?.days.map'));
ok(screen.includes('style={styles.screenContent} topSafeArea'), 'only headerless Razmere opts into top safe-area handling');
strictEqual((screen.match(/getMushroomWeatherSummary\(/g) || []).length, 1);
ok(screen.includes('[coords?.latitude, coords?.longitude, repository, weatherRetry]'), 'no disclosure/profile dependency in weather acquisition');
ok(screen.includes('[weatherProfileId, displaySummary]'), 'one memoized existing scorer invocation');
const astFunction = (source: string, name: string) => {
  const ast = ts.createSourceFile('presentation.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)?.getText(ast).replace(/\r\n/g, '\n');
};
strictEqual(astFunction(readFileSync('src/components/conditionsAdvancedPresentation.ts', 'utf8'), 'advancedFactors'),
  astFunction(execFileSync('git', ['show', '5ebbdb3:src/components/conditionsAdvancedPresentation.ts'], { encoding: 'utf8' }), 'advancedFactors'), 'V2.1 factor presentation itself unchanged');
for (const path of ['src/domain/mushroomWeather.ts', 'src/services/weather.ts', 'src/services/weatherGraphs.ts', 'src/domain/weatherSeries.ts',
  'src/domain/weatherDetails.ts', 'src/components/WeatherGraphs.tsx', 'src/components/weatherGraphPresentation.ts', 'src/components/WeatherGraphsView.tsx',
  'src/screens/MapScreen.tsx', 'src/navigation/AppNavigator.tsx', 'src/domain/hotspotRanking.ts', 'src/domain/hotspotTopThree.ts',
  'src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/domain/conditionsSnapshot.ts', 'App.tsx', 'src/components/advancedDetailsFocus.ts'])
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `5ebbdb3:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path + ' unchanged');
console.log('PASS Razmere V2.1: canonical factors/weights/total for 4 profiles, ratio/max/zero/invalid/missing, compact inputs/units/coverage, collapsed disclosures, all explanations/attributions retained, profile updates, unavailable/stale, >=48pt/accessibility, measured post-layout focus/stale/close/gesture protection, unchanged models/weather/cache/graphs/Map/LOD/ranking/snapshots. Native layout and TalkBack require device QA.');
