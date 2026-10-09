/// <reference types="node" />
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { cardFactors, cardSummary, cardHabitat, cardReliability, cardTechnicalDetails, factorBand, compactCardMetadata } from '../src/domain/heatmap/cardPresentation';
import { colors, spacing, radii } from '../src/theme';
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
const oldPresentation = { exports: {} as typeof import('../src/domain/heatmap/cardPresentation') };
const oldHelper = execFileSync('git', ['show', '75fc7e8:src/domain/heatmap/cardPresentation.ts']).toString();
new Function('require', 'module', 'exports', ts.transpileModule(oldHelper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(
  createRequire(resolve('src/domain/heatmap/cardPresentation.ts')), oldPresentation, oldPresentation.exports);
strictEqual(compactCardMetadata('Koroška, Slovenija', 'Jesenski goban'), 'Koroška · Jesenski goban');
strictEqual(compactCardMetadata('Koroška, Slovenia', 'Jesenski goban'), 'Koroška · Jesenski goban');
strictEqual(compactCardMetadata(undefined, 'Navadna lisička'), 'Navadna lisička');
strictEqual(compactCardMetadata('Kärnten, Österreich', 'Užitna sirovka'), 'Kärnten, Österreich · Užitna sirovka');
for (const [ratio, expected] of [[.85, 3], [.65, 2], [.4, 1], [.399, 0], [NaN, -1], [undefined, -1]] as const) strictEqual(factorBand(ratio), expected);
for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
  const a = make(profile, day), before = JSON.stringify(a);
  const factors = cardFactors(a), technical = cardTechnicalDetails(a);
  strictEqual(cardSummary(a), oldPresentation.exports.cardSummary(a), 'summary semantics unchanged');
  deepStrictEqual(technical, oldPresentation.exports.cardTechnicalDetails(a), 'technical values unchanged');
  deepStrictEqual(cardHabitat(a), oldPresentation.exports.cardHabitat(a), 'habitat copy unchanged');
  strictEqual(cardReliability(a).level, oldPresentation.exports.cardReliability(a).level, 'reliability mapping unchanged');
  strictEqual(cardReliability(a).explanation, oldPresentation.exports.cardReliability(a).explanation, 'full reliability explanation preserved');
  deepStrictEqual(factors.map(f => ({ ratio: f.ratio, mixed: f.mixed, detail: f.detail })),
    oldPresentation.exports.cardFactors(a).map(f => ({ ratio: f.ratio, mixed: f.mixed, detail: f.detail })), 'factor semantics/long descriptions unchanged');
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
strictEqual(cardFactors(dry)[3].status, 'Neugodno');
strictEqual(cardFactors(dry)[3].detailedStatus, 'Močan neugoden vpliv');
strictEqual(cardFactors(assessment)[1].compactDetail, '13 °C / 20 dni');
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
strictEqual(cardReliability(assessment).compactExplanation, 'Na voljo so vsi glavni podatki.');
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
// Hotspot Conditions V1 legitimately adds focus context and marker views. Keep
// the existing heatmap computation/native source path pinned, not unrelated routing.
const heatmapLogic = (s: string) => s.slice(s.indexOf('  const selectHeatmapSpecies'), s.indexOf('  const heatmapAreaCardOpen')).replace("    if (mode !== 'map') return;\n", '');
const heatmapSources = (s: string) => s.slice(s.indexOf('<GeoJSONSource id="regional-overview-source"'), s.indexOf('{locationGranted ?'));
strictEqual(heatmapLogic(screen), heatmapLogic(baseline), 'heatmap/LOD/weather calculation untouched');
strictEqual(heatmapSources(screen), heatmapSources(baseline), 'native heatmap sources/layers untouched');
const previousCard = functionText(execFileSync('git', ['show', '1d737ed:src/screens/MapScreen.tsx']).toString(), 'HeatmapAreaCard');
const currentCard = functionText(screen, 'HeatmapAreaCard');
const mainView = (s: string) => s.slice(s.indexOf('return <Card'), s.indexOf('<Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsExpanded }}'));
const withoutScrollHooks = (s: string) => s
  .replace(/onPress=\{\(\) => \{ cancelSectionScroll\(\); setDetailsExpanded\(false\); setOpenSection\(null\); onClose\(\); \}\}/, 'onPress={onClose}')
  .replace(/      ref=\{scrollRef\}[\s\S]*?      onMomentumScrollEnd=\{[^\n]*\}\r?\n/, '');
strictEqual(withoutScrollHooks(mainView(currentCard)), mainView(previousCard), 'fixed header and decision view unchanged except scroll wiring');
const weatherAndHabitat = (s: string) => s.slice(s.indexOf("{section === 'weather' ?"), s.indexOf('</> : <>'));
const withoutGraph = (s: string) => s
  .replace("<><WeatherGraphs summary={assessment.summary} weatherCellId={assessment.weatherCellId} locationLabel={`Vremenska točka območja: ${areaLabel}`} />{presentation.factors", 'presentation.factors')
  .replace("})}</> : section === 'habitat'", "}) : section === 'habitat'");
strictEqual(withoutGraph(weatherAndHabitat(currentCard)), weatherAndHabitat(previousCard), 'Existing Weather/Habitat technical values unchanged; graph added only inside weather');
const sheet = (sourceText: string) => {
  const file = ts.createSourceFile('MapScreen.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(file) === 'styles'))!;
  const recenter = file.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(file) === 'RECENTER_SIZE'));
  return new Function('StyleSheet', 'colors', 'spacing', 'radii', (recenter?.getText(file) ?? '') + '\n' + declaration.getText(file) + '\nreturn styles;')({ create: (v: any) => v, hairlineWidth: 1 }, colors, spacing, radii);
};
const actualStyles = sheet(screen), oldStyles = sheet(execFileSync('git', ['show', '75fc7e8:src/screens/MapScreen.tsx']).toString());
strictEqual(actualStyles.heatmapPreview.maxHeight, oldStyles.heatmapPreview.maxHeight);
strictEqual(actualStyles.heatmapPreview.bottom, oldStyles.heatmapPreview.bottom);
deepStrictEqual(actualStyles.heatmapDetailsScroll, oldStyles.heatmapDetailsScroll);
ok(actualStyles.heatmapFactor.paddingVertical < oldStyles.heatmapFactor.paddingVertical);
ok(actualStyles.heatmapCardSection.paddingVertical < oldStyles.heatmapCardSection.paddingVertical);
ok(actualStyles.heatmapCardDateSwitch.padding < oldStyles.heatmapCardDateSwitch.padding);
ok(actualStyles.heatmapDetailsContent.paddingRight > 0, 'scrollbar clearance');
for (const key of ['heatmapCardDateOption', 'heatmapDetailsToggle', 'heatmapAccordionHeader']) ok(actualStyles[key].minHeight >= 44);
ok(actualStyles.heatmapCardClose.height >= 44);
strictEqual(actualStyles.heatmapAreaScore.fontSize, oldStyles.heatmapAreaScore.fontSize);
ok(!functionText(screen, 'HeatmapAreaCard').includes('numberOfLines='), 'long titles, metadata, states and factor descriptions can wrap without data loss');
type Element = { type: string; props: Record<string, any> };
let cursor = 0, calculations = 0;
const hooks: any[] = [], effects: Array<() => void> = [];
let nextFrame = 0;
const frames = new Map<number, () => void>();
const scrollCommands: Array<{ y: number; animated: boolean }> = [];
const measurements: Array<{ section: string; complete: (x: number, y: number) => void }> = [];
const fakeContent = {};
const fakeScroll = { scrollTo: (command: { y: number; animated: boolean }) => scrollCommands.push(command) };
const flushFrames = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(run => run()); };
const dependenciesChanged = (old: any[], next: any[]) => !old || old.length !== next.length || next.some((d, i) => d !== old[i]);
const bindings = {
  React: { Fragment: 'Fragment', createElement: (type: string, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
  useState: (initial: any) => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial;
    return [hooks[slot], (next: any) => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next; }]; },
  useRef: (initial: any) => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
  useEffect: (effect: () => void, deps: any[]) => { const slot = cursor++; if (dependenciesChanged(hooks[slot]?.deps, deps)) {
    effects.push(() => { hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; });
  } },
  requestAnimationFrame: (run: () => void) => { frames.set(++nextFrame, run); return nextFrame; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
  useMemo: (factory: () => any, deps: any[]) => { const slot = cursor++; if (dependenciesChanged(hooks[slot]?.deps, deps)) { calculations++; hooks[slot] = { deps, value: factory() }; } return hooks[slot].value; },
  Card: 'Card', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', AppButton: 'AppButton', Ionicons: 'Icon', WeatherGraphs: 'WeatherGraphs',
  styles: new Proxy({}, { get: (_, key) => key === 'heatmapDetailsContent' ? actualStyles.heatmapDetailsContent : key }), commonStyles: {}, colors: {}, StyleSheet: { flatten: (v: any) => v },
  MUSHROOM_WEATHER_PROFILES, HEATMAP_PILOT_METADATA, cardFactors, cardSummary, cardHabitat, cardReliability, cardTechnicalDetails, compactCardMetadata,
};
const javascript = ts.transpileModule(functionText(screen, 'HeatmapAreaCard'), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const card = new Function(...Object.keys(bindings), javascript + '\nreturn HeatmapAreaCard;')(...Object.values(bindings));
const nodes = (node: any): Element[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
let closed = 0, navigated = 0, chosenDay = 'today';
const props = { assessment, targetDay: 'today', maxHeight: 520, areaLabel: 'Območje pri Črni na Koroškem', areaDetails: 'Koroška, Slovenija',
  onClose: () => closed++, onOpenConditions: () => navigated++, onTargetDayChange: (day: string) => { chosenDay = day; } };
const render = () => { cursor = 0; let tree = card(props); if (effects.length) { effects.splice(0).forEach(e => e()); cursor = 0; tree = card(props); }
  for (const node of nodes(tree)) {
    if (node.type === 'ScrollView') { node.props.ref.current = fakeScroll; node.props.innerViewRef.current = fakeContent; }
    else if (typeof node.props.ref === 'function') node.props.ref({ measureLayout: (relative: unknown, complete: (x: number, y: number) => void) => {
      strictEqual(relative, fakeContent, 'anchors measured in scroll-content coordinates'); measurements.push({ section: node.props.key, complete });
    } });
  }
  return tree;
};
const button = (tree: any, label: string) => nodes(tree).find(n => n.props.accessibilityLabel === label)!;
let tree = render();
ok(!text(tree).includes('Prispevek k vremenski oceni:'));
ok(!text(tree).includes('DISCLAIMER'));
ok(text(tree).includes('Koroška · Jesenski goban'));
ok(!text(tree).includes('Koroška, Slovenija'));
ok(text(tree).includes(`ZAKAJ ${assessment.score}?`));
ok(!text(tree).includes('Na voljo so vsi glavni podatki.'));
ok(!text(tree).includes('ne statistične gotovosti'));
for (const f of cardFactors(assessment)) {
  ok(!text(tree).includes(f.compactDetail), 'no secondary factor values in main view');
  ok(text(tree).includes(f.status));
}
deepStrictEqual(nodes(tree).filter(n => n.props.style === 'heatmapCompactStatus').map(text),
  ['Habitat Potencialno ustrezno', 'Zanesljivost Visoka']);
ok(!text(tree).includes(cardHabitat(assessment).explanation));
ok(!button(tree, 'Vreme'), 'no details headers before expansion');
ok(text(tree).includes(`${assessment.score} / 100`) && text(tree).includes(assessment.classLabel));
const scroll = nodes(tree).find(n => n.type === 'ScrollView')!;
ok(!nodes(scroll).some(n => n.props.accessibilityRole === 'tab'), 'date remains outside scroll');
ok(!nodes(scroll).some(n => n.props.accessibilityLabel === 'Zapri podrobnosti območja'), 'X remains fixed');
ok(!text(scroll).includes('ne zagotavlja prisotnosti gob.'), 'disclaimer lives in Sources, not duplicated in main');
const beforeToggleCalculations = calculations;
ok(!button(tree, 'Poglej podrobnosti') && !text(tree).includes('Poglej podrobne razmere'), 'old ambiguous CTAs removed');
button(tree, 'Več informacij').props.onPress(); tree = render();
strictEqual(calculations, beforeToggleCalculations, 'details toggle does not rebuild even card presentation');
const sectionLabels = ['Vreme', 'Habitat', 'Zanesljivost in viri'];
const assertOpen = (label: string | null) => {
  for (const sectionLabel of sectionLabels) {
    strictEqual(button(tree, sectionLabel).props.accessibilityState.expanded, sectionLabel === label, 'only the selected section is open');
    strictEqual(nodes(button(tree, sectionLabel)).find(n => n.type === 'Icon')!.props.name, sectionLabel === label ? 'chevron-down' : 'chevron-forward');
  }
};
assertOpen(null);
ok(!text(tree).includes('Prispevek k vremenski oceni:') && !text(tree).includes('DISCLAIMER'), 'outer expansion reveals only collapsed sections');
button(tree, 'Vreme').props.onPress(); tree = render();
assertOpen('Vreme');
strictEqual(calculations, beforeToggleCalculations, 'accordion is UI-only, not even presentation recalculation');
for (const row of cardTechnicalDetails(assessment)) {
  ok(text(tree).includes(row.contribution));
  for (const line of row.lines) ok(text(tree).includes(line));
}
for (const f of cardFactors(assessment)) if (f.key === 'soilMoisture' || f.key === 'drying') ok(text(tree).includes(f.detail));
ok(!text(tree).includes('DISCLAIMER'));
button(tree, 'Habitat').props.onPress(); tree = render();
assertOpen('Habitat');
ok(!text(tree).includes('Prispevek k vremenski oceni:'), 'opening Habitat closes Weather');
ok(text(tree).includes(assessment.limitations[0]));
ok(text(tree).includes(HEATMAP_PILOT_METADATA.worldCover.attribution));
if (assessment.treeCompositionSource) ok(text(tree).includes(assessment.treeCompositionSource));
button(tree, 'Zanesljivost in viri').props.onPress(); tree = render();
strictEqual(calculations, beforeToggleCalculations, 'all section toggles leave presentation and parent data unchanged');
assertOpen('Zanesljivost in viri');
const reliabilityGroups = nodes(tree).filter(n => n.props.style === 'heatmapReliabilityGroup');
deepStrictEqual(reliabilityGroups.map(n => text(n.props.children[0])), ['ZANESLJIVOST', 'OMEJITEV', 'VIRI', 'DISCLAIMER'], 'four separate groups, no nested accordions');
ok(text(reliabilityGroups[0]).includes('Visoka') && text(reliabilityGroups[0]).includes('Na voljo so vsi glavni podatki.'));
ok(text(reliabilityGroups[1]).includes('ne statistične gotovosti'));
for (const source of ['geoBoundaries', 'Open-Meteo', 'ESA WorldCover 2021', 'Zavod za gozdove Slovenije']) ok(text(reliabilityGroups[2]).includes(source));
ok(text(tree).includes('Koroška, Slovenija') && text(tree).includes(assessment.sourceAge) && text(tree).includes(assessment.fetchedAt));
ok(text(tree).includes('ne zagotavlja prisotnosti gob.') && text(tree).includes('Karta ne potrjuje dostopa'));
for (const limitation of assessment.limitations.slice(1)) ok(text(tree).includes(limitation));
strictEqual(text(tree).split('Ocena predstavlja primernost vremenskih razmer').length - 1, 1, 'no duplicate disclaimer');
button(tree, 'Habitat').props.onPress(); tree = render();
assertOpen('Habitat');
ok(text(tree).includes(assessment.limitations[0]), 'Habitat content remains intact after reopening');
ok(!text(tree).includes('DISCLAIMER'), 'opening Habitat closes Reliability');
button(tree, 'Habitat').props.onPress(); tree = render();
assertOpen(null);
button(tree, 'Vreme').props.onPress(); tree = render();
button(tree, 'Prikaži razmere za jutri').props.onPress(); strictEqual(chosenDay, 'tomorrow');
props.targetDay = 'tomorrow'; props.assessment = make('boletusEdulis', 'tomorrow'); tree = render();
ok(button(tree, 'Manj informacij').props.accessibilityState.expanded);
assertOpen('Vreme');
ok(text(tree).includes(cardTechnicalDetails(props.assessment)[0].lines[0]));
props.assessment = make('cantharellusCibarius', 'tomorrow'); tree = render();
ok(text(tree).includes('14 dneh') && button(tree, 'Manj informacij'));
for (const profile of HEATMAP_PROFILE_IDS) {
  props.assessment = make(profile, 'tomorrow'); tree = render();
  ok(text(tree).includes(compactCardMetadata(props.areaDetails, MUSHROOM_WEATHER_PROFILES[profile].label)));
  ok(button(tree, 'Manj informacij').props.accessibilityState.expanded);
  assertOpen('Vreme');
  for (const row of cardTechnicalDetails(props.assessment)) for (const line of row.lines) ok(text(tree).includes(line));
}
button(tree, 'Habitat').props.onPress(); tree = render();
for (const state of ['unknown', 'outside-model', 'candidate'] as const) {
  props.assessment = { ...make('lactariusDeliciosus', 'tomorrow'), habitatState: state }; tree = render();
  assertOpen('Habitat');
  ok(text(tree).includes(cardHabitat(props.assessment).title));
}
props.assessment = { ...missing, areaId: assessment.areaId }; tree = render();
ok(text(tree).includes('ZAKAJ TA OCENA?') && !text(tree).includes('ZAKAJ 0?'));
props.areaDetails = 'Dolgo regionalno ime za preverjanje preloma, Slovenija';
props.assessment = make('cantharellusCibarius', 'tomorrow'); tree = render();
ok(text(tree).includes('Dolgo regionalno ime za preverjanje preloma · Navadna lisička'));
button(tree, 'Manj informacij').props.onPress(); tree = render();
ok(!text(tree).includes('Prispevek k vremenski oceni:'));
button(tree, 'Več informacij').props.onPress(); tree = render();
assertOpen('Habitat');
props.assessment = { ...props.assessment, areaId: 'new-area' }; tree = render();
ok(button(tree, 'Več informacij'), 'new area resets expanded state');
button(tree, 'Več informacij').props.onPress(); tree = render();
assertOpen(null);
button(tree, 'Vreme').props.onPress(); tree = render();
button(tree, 'Zapri podrobnosti območja').props.onPress(); strictEqual(closed, 1);
// Closing the card unmounts it in the unchanged parent; simulate a fresh mount.
hooks.length = 0; effects.length = 0; tree = render();
ok(button(tree, 'Več informacij'));
button(tree, 'Več informacij').props.onPress(); tree = render();
assertOpen(null);
const fullReview = nodes(tree).find(n => n.type === 'AppButton')!;
strictEqual(fullReview.props.title, 'Odpri celoten pregled razmer');
fullReview.props.onPress(); strictEqual(navigated, 1);
// Native-layout simulation: long Weather collapses before measuring the new anchor.
const nativeScroll = () => nodes(tree).find(n => n.type === 'ScrollView')!;
const anchor = (section: string) => nodes(tree).find(n => n.props.key === section && n.props.onLayout)!;
nativeScroll().props.onLayout({ nativeEvent: { layout: { height: 320 } } }); tree = render();
const animatedCount = () => scrollCommands.filter(c => c.animated).length;
strictEqual(animatedCount(), 0, 'outer details expansion and layout alone do not scroll');
const align = (label: string, section: string, y: number) => {
  const count = animatedCount();
  nativeScroll().props.onScroll({ nativeEvent: { contentOffset: { y: 750 } } });
  button(tree, label).props.onPress(); tree = render();
  strictEqual(animatedCount(), count, 'no scrolling in the press handler');
  anchor(section).props.onLayout(); nativeScroll().props.onContentSizeChange(300, 1200);
  strictEqual(animatedCount(), count, 'layout callbacks defer measurement until RAF');
  const style = anchor(section).props.style;
  ok(style.some((s: any) => s?.minHeight === 320), 'short sections have viewport-derived scroll room, not hardcoded height');
  flushFrames();
  const measurement = measurements.pop()!;
  strictEqual(measurement.section, section);
  strictEqual(animatedCount(), count, 'wait for fresh native layout result');
  measurement.complete(0, y);
  deepStrictEqual(scrollCommands.at(-1), { y: Math.max(0, y - actualStyles.heatmapDetailsContent.paddingTop), animated: true });
  nativeScroll().props.onMomentumScrollEnd();
  assertOpen(label);
};
align('Vreme', 'weather', 420);
const staleWeatherLayout = anchor('weather').props.onLayout;
align('Habitat', 'habitat', 475);
align('Zanesljivost in viri', 'reliability', 530);
align('Vreme', 'weather', 420);
const countAfterDirections = animatedCount();
button(tree, 'Vreme').props.onPress(); tree = render();
nativeScroll().props.onContentSizeChange(300, 650); flushFrames();
strictEqual(animatedCount(), countAfterDirections, 'closing an open section does not auto-scroll');
assertOpen(null);
// Rapid selection: old layout events and already-started measurements cannot win.
button(tree, 'Vreme').props.onPress(); tree = render(); flushFrames();
const staleWeatherMeasurement = measurements.pop()!;
button(tree, 'Habitat').props.onPress(); tree = render(); flushFrames();
const staleHabitatMeasurement = measurements.pop()!;
button(tree, 'Zanesljivost in viri').props.onPress(); tree = render();
button(tree, 'Vreme').props.onPress(); tree = render();
staleWeatherLayout(); staleWeatherMeasurement.complete(0, 999); staleHabitatMeasurement.complete(0, 888);
strictEqual(animatedCount(), countAfterDirections, 'stale layout/measurement callbacks ignored');
anchor('weather').props.onLayout(); flushFrames();
const supersededMeasurement = measurements.pop()!;
// A later layout in the same selection supersedes a pending measurement too.
nativeScroll().props.onContentSizeChange(300, 1250); flushFrames();
supersededMeasurement.complete(0, 777);
strictEqual(animatedCount(), countAfterDirections);
measurements.pop()!.complete(0, 425);
strictEqual(animatedCount(), countAfterDirections + 1, 'rapid taps cause one final animated alignment');
nativeScroll().props.onMomentumScrollEnd(); assertOpen('Vreme');
const beforeDataChange = animatedCount();
props.targetDay = 'today'; props.assessment = { ...make('boletusEdulis'), areaId: props.assessment.areaId }; tree = render();
nativeScroll().props.onContentSizeChange(300, 1210); anchor('weather').props.onLayout(); flushFrames();
assertOpen('Vreme'); strictEqual(animatedCount(), beforeDataChange, 'day change does not force alignment');
props.assessment = { ...make('cantharellusCibarius'), areaId: props.assessment.areaId }; tree = render();
nativeScroll().props.onContentSizeChange(300, 1320); flushFrames();
assertOpen('Vreme'); strictEqual(animatedCount(), beforeDataChange, 'species change does not force alignment');
button(tree, 'Habitat').props.onPress(); tree = render(); flushFrames();
const afterCloseCallback = measurements.pop()!;
button(tree, 'Zapri podrobnosti območja').props.onPress(); tree = render();
afterCloseCallback.complete(0, 800); flushFrames();
strictEqual(animatedCount(), beforeDataChange, 'card close invalidates pending native callbacks');
ok(button(tree, 'Več informacij'), 'close resets outer expansion immediately');
button(tree, 'Več informacij').props.onPress(); tree = render(); assertOpen(null);
button(tree, 'Vreme').props.onPress(); tree = render();
for (const hook of hooks) hook?.cleanup?.();
flushFrames();
strictEqual(animatedCount(), beforeDataChange, 'unmount cleanup cancels queued RAF');
console.log('PASS: single-open details, post-layout native anchors, Weather/Habitat/Reliability alignment, viewport-derived scroll room, rapid/stale callbacks, close/unmount cancellation, no day/species auto-scroll; technical values and parent heatmap/LOD/network unchanged. Native animation/scroll still needs phone QA.');
