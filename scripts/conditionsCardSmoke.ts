/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { cardFactors, cardSummary, cardHabitat, cardReliability, cardTechnicalDetails, factorBand } from '../src/domain/heatmap/cardPresentation';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { HEATMAP_HABITAT, HEATMAP_PROFILE_IDS, HEATMAP_PILOT_METADATA, habitatStateFor, areaAssessmentFor } from '../src/domain/heatmap/pilot';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { slNumber } from '../src/domain/format';
import { shiftLocalDate } from '../src/services/weather';
import type { HeatmapAreaAssessment, HeatmapWeatherCellSource } from '../src/domain/heatmap/types';

const date = '2026-10-04';
const source: HeatmapWeatherCellSource = { id: 'fixture', latitude: 46.47, longitude: 14.85, baseLocalDate: date,
  days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' : 'forecast',
    precipitationMm: i < 60 ? 4 : 0, temperatureMeanC: 13, evapotranspirationMm: 1 })),
  currentSoil: { time: date + 'T12:00', soilMoisture0To7Cm: .271, soilMoisture7To28Cm: .29 },
  tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .2, soilMoisture7To28Cm: .21 },
  errors: {}, fetchedAt: date + 'T10:00:00Z', stale: false };
const area = HEATMAP_HABITAT.features.find(f => habitatStateFor(f, 'boletusEdulis') === 'candidate')!;
const make = (profile: HeatmapAreaAssessment['speciesId'], day: HeatmapAreaAssessment['targetDay'] = 'today') =>
  areaAssessmentFor(area, assessHeatmapWeather(source, profile, day));
const assessment = make('boletusEdulis');
for (const [ratio, expected] of [[.85, 3], [.65, 2], [.4, 1], [.399, 0], [NaN, -1], [undefined, -1]] as const) strictEqual(factorBand(ratio), expected);
for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
  const a = make(profile, day), before = JSON.stringify(a);
  const factors = cardFactors(a), technical = cardTechnicalDetails(a);
  strictEqual(factors.length, 4);
  deepStrictEqual(factors.map(f => f.key), ['rain', 'temperature', 'soilMoisture', 'drying']);
  const rain = a.scoreDetails.components.filter(c => c.key.startsWith('rain'));
  strictEqual(factors[0].ratio, rain.reduce((n, c) => n + c.weightedPoints, 0) / rain.reduce((n, c) => n + c.weight, 0));
  strictEqual(technical.length, a.scoreDetails.components.length);
  technical.forEach((row, i) => strictEqual(row.contribution,
    `Prispevek k vremenski oceni: ${slNumber(a.scoreDetails.components[i].weightedPoints, 1)} / ${slNumber(a.scoreDetails.components[i].weight, 1)}`));
  cardSummary(a); cardReliability(a); cardHabitat(a);
  strictEqual(JSON.stringify(a), before, 'presentation must not mutate score, components or habitat');
  strictEqual(a.classLabel, assessHeatmapWeather(source, profile, day).score.label, 'published label unchanged');
  if (profile === 'cantharellusCibarius') ok(factors[1].detail.includes('14 dneh'));
  else ok(factors[1].detail.includes('20 dneh'));
}
ok(cardSummary(assessment).startsWith('Padavine in temperatura so zelo ugodne.'));
const dry = areaAssessmentFor(area, assessHeatmapWeather({ ...source, days: source.days.map(d => ({ ...d, precipitationMm: 0, evapotranspirationMm: 5 })) }, 'boletusEdulis', 'today'));
ok(cardSummary(dry).includes('padavine manj ugodne'));
strictEqual(cardFactors(dry)[3].status, 'Močan neugoden vpliv');
const mixed = { ...make('cantharellusCibarius'), scoreDetails: { ...assessment.scoreDetails, components: [
  { key: 'rain30' as const, label: '30 dni', value: 1, weight: 40, weightedPoints: 40 },
  { key: 'rain7' as const, label: '7 dni', value: 0, weight: 10, weightedPoints: 0 },
  ...assessment.scoreDetails.components.filter(c => !c.key.startsWith('rain')),
] } };
strictEqual(cardFactors(mixed)[0].ratio, .8);
strictEqual(cardFactors(mixed)[0].status, 'Mešani signali');
ok(cardSummary(mixed).startsWith('Padavinski signali so mešani.'));
const missing = { ...assessment, scoreDetails: { ...assessment.scoreDetails, components: [] }, score: null, dataQuality: 'insufficient' as const };
ok(cardFactors(missing).every(f => f.status === 'Ni podatkov'));
ok(cardSummary(missing).includes('ni dovolj podatkov'));
strictEqual(cardReliability(missing).level, 'Omejena');
strictEqual(cardReliability(assessment).level, 'Visoka');
strictEqual(cardReliability(assessment, true).level, 'Omejena');
strictEqual(cardReliability({ ...assessment, habitatState: 'unknown' }).level, 'Srednja');
strictEqual(cardReliability({ ...assessment, dataQuality: 'limited' }).level, 'Srednja');
strictEqual(cardReliability({ ...assessment, dataQuality: 'limited', habitatState: 'unknown' }).level, 'Omejena');
strictEqual(cardReliability({ ...assessment, summary: { ...assessment.summary, stale: true } }).level, 'Srednja');
strictEqual(cardReliability({ ...assessment, summary: { ...assessment.summary, current: { ...assessment.summary.current!, soilMoisture0To7Cm: undefined } } }).level, 'Srednja');
for (const profile of HEATMAP_PROFILE_IDS) for (const state of ['candidate', 'unknown', 'outside-model'] as const) {
  const a = { ...make(profile), habitatState: state };
  ok(cardHabitat(a).title && cardHabitat(a).explanation);
  if (state === 'candidate') strictEqual(cardHabitat(a).title, 'Potencialno ustrezno območje');
  if (state === 'outside-model') strictEqual(cardHabitat(a).title, 'Zunaj habitatnega modela');
  if (state === 'unknown' && profile === 'lactariusDeliciosus') strictEqual(cardHabitat(a).title, 'Bor ni dovolj potrjen');
}

// Execute the actual card function with a tiny hook/element harness (not a native renderer).
// No React Native runtime, network mocks or new test dependency required.
const screen = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const functionText = (text: string, name: string) => {
  const file = ts.createSourceFile('MapScreen.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)!.getText(file);
};
const baseline = execFileSync('git', ['show', '8c70834:src/screens/MapScreen.tsx']).toString();
strictEqual(functionText(screen, 'MapScreen'), functionText(baseline, 'MapScreen'), 'parent heatmap/LOD/network/navigation code untouched');
type Element = { type: string; props: Record<string, any> };
let cursor = 0, calculations = 0;
const hooks: any[] = [], effects: Array<() => void> = [];
const dependenciesChanged = (old: any[], next: any[]) => !old || old.length !== next.length || next.some((d, i) => d !== old[i]);
const bindings = {
  React: { createElement: (type: string, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
  useState: (initial: any) => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial;
    return [hooks[slot], (next: any) => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next; }]; },
  useEffect: (effect: () => void, deps: any[]) => { const slot = cursor++; if (dependenciesChanged(hooks[slot], deps)) effects.push(effect); hooks[slot] = deps; },
  useMemo: (factory: () => any, deps: any[]) => { const slot = cursor++; if (dependenciesChanged(hooks[slot]?.deps, deps)) { calculations++; hooks[slot] = { deps, value: factory() }; } return hooks[slot].value; },
  Card: 'Card', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', AppButton: 'AppButton', Ionicons: 'Icon',
  styles: new Proxy({}, { get: (_, key) => key }), commonStyles: {}, colors: {}, StyleSheet: { flatten: (v: any) => v },
  MUSHROOM_WEATHER_PROFILES, HEATMAP_PILOT_METADATA, cardFactors, cardSummary, cardHabitat, cardReliability, cardTechnicalDetails,
};
const javascript = ts.transpileModule(functionText(screen, 'HeatmapAreaCard'), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const card = new Function(...Object.keys(bindings), javascript + '\nreturn HeatmapAreaCard;')(...Object.values(bindings));
const nodes = (node: any): Element[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
let closed = 0, navigated = 0, chosenDay = 'today';
const props = { assessment, targetDay: 'today', maxHeight: 520, areaLabel: 'Območje pri Črni na Koroškem', areaDetails: 'Koroška, Slovenija',
  onClose: () => closed++, onOpenConditions: () => navigated++, onTargetDayChange: (day: string) => { chosenDay = day; } };
const render = () => { cursor = 0; let tree = card(props); if (effects.length) { effects.splice(0).forEach(e => e()); cursor = 0; tree = card(props); } return tree; };
const button = (tree: any, label: string) => nodes(tree).find(n => n.props.accessibilityLabel === label)!;
let tree = render();
ok(!text(tree).includes('Prispevek k vremenski oceni:'));
ok(!text(tree).includes('VIRI PODATKOV'));
ok(text(tree).includes(`${assessment.score} / 100`) && text(tree).includes(assessment.classLabel));
const scroll = nodes(tree).find(n => n.type === 'ScrollView')!;
ok(!nodes(scroll).some(n => n.props.accessibilityRole === 'tab'), 'date remains outside scroll');
ok(!nodes(scroll).some(n => n.props.accessibilityLabel === 'Zapri podrobnosti območja'), 'X remains fixed');
ok(text(scroll).includes('ne zagotavlja prisotnosti gob.'));
const beforeToggleCalculations = calculations;
button(tree, 'Poglej podrobnosti').props.onPress(); tree = render();
strictEqual(calculations, beforeToggleCalculations, 'details toggle does not rebuild even card presentation');
ok(text(tree).includes('VIRI PODATKOV') && text(tree).includes('geoBoundaries') && text(tree).includes('Prispevek k vremenski oceni:'));
button(tree, 'Prikaži razmere za jutri').props.onPress(); strictEqual(chosenDay, 'tomorrow');
props.targetDay = 'tomorrow'; props.assessment = make('boletusEdulis', 'tomorrow'); tree = render();
ok(button(tree, 'Skrij podrobnosti').props.accessibilityState.expanded);
ok(text(tree).includes(cardTechnicalDetails(props.assessment)[0].lines[0]));
props.assessment = make('cantharellusCibarius', 'tomorrow'); tree = render();
ok(text(tree).includes('14 dneh') && button(tree, 'Skrij podrobnosti'));
button(tree, 'Skrij podrobnosti').props.onPress(); tree = render();
ok(!text(tree).includes('Prispevek k vremenski oceni:'));
button(tree, 'Poglej podrobnosti').props.onPress(); tree = render();
props.assessment = { ...props.assessment, areaId: 'new-area' }; tree = render();
ok(button(tree, 'Poglej podrobnosti'), 'new area resets expanded state');
button(tree, 'Zapri podrobnosti območja').props.onPress(); strictEqual(closed, 1);
nodes(tree).find(n => n.type === 'AppButton')!.props.onPress(); strictEqual(navigated, 1);
console.log('PASS: presentation, species/day, missing data, reliability, habitat states, actual card expand/collapse; parent MapScreen unchanged (0 new weather/LOD/source side effects). Native scroll/touch layout still requires phone QA.');
