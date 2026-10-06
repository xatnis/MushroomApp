/// <reference types="node" />
import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import { regionalAreaAssessmentFor, REGIONAL_INDEX, HEATMAP_PILOT_METADATA } from '../src/domain/heatmap/regional';
import { shiftLocalDate } from '../src/services/weather';
import type { HeatmapAreaAssessment } from '../src/domain/heatmap/types';
import type { Hotspot, MushroomWeatherProfileId } from '../src/domain/types';

// Execute actual UI functions, using a tiny JSX/native harness, not a device renderer.
const requireHere = createRequire(__filename);
const Module = requireHere('node:module').Module;
interface Element { type: string | ((props: any) => Element); props: any }
const element = (type: Element['type'], props: any): Element => ({ type, props });
const ui = Object.fromEntries(['AppButton', 'Card', 'Chip'].map(name => [name, name]));
const hotspot: Hotspot = { id: 'test-hotspot', profileId: 'local:device', latitude: 46.47045, longitude: 14.85009,
  locationSource: 'manual', locationSharing: 'private', createdAt: '', updatedAt: '', syncState: 'local' };
const date = localDateFor();
let assessment: HeatmapAreaAssessment | undefined;
let loading = false, retries = 0;
const calls: Array<{ profile: MushroomWeatherProfileId; day: string; enabled: boolean | undefined }> = [];
function compile(relative: string) {
  const filename = resolve(relative), mod = new Module(filename);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  const original = mod.require.bind(mod);
  mod.require = (id: string) => {
    if (id === 'react') return { useMemo: (fn: () => unknown) => fn() };
    if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (id === 'react-native') return { View: 'View', Text: 'Text', Image: 'Image', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (x: unknown) => x } };
    if (id === '@maplibre/maplibre-react-native') return { Marker: 'Marker' };
    if (id === './ui') return { ...ui, commonStyles: {} };
    if (id.endsWith('/useLocationConditions')) return { useLocationConditions: (_locations: unknown, profile: MushroomWeatherProfileId, day: string, enabled?: boolean) => {
      calls.push({ profile, day, enabled }); return { assessments: { [hotspot.id]: assessment }, loading, retry: () => { retries++; } };
    } };
    if (id.endsWith('.png')) return 'mushroom-icon';
    return original(id);
  };
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { HotspotConditionsCard, LocationConditionsSummary, HotspotConditionsPopup } = compile('src/components/HotspotConditions.tsx');
const { HotspotConditionsMarkers } = compile('src/components/HotspotConditionsMarkers.tsx');
function walk(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const n = node as Element;
  return [n, ...walk(typeof n.type === 'function' ? n.type(n.props) : n.props.children)];
}
const text = (node: unknown) => walk(node).filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).join(' ');
const findButton = (node: unknown, name: string) => walk(node).find(n => n.type === 'AppButton' && n.props.title === name)!;

let selectedProfile: MushroomWeatherProfileId = 'generic', selectedDay = 'today', opened = 0;
const props = { hotspot, profile: selectedProfile, day: selectedDay, fallbackNames: 'Marela',
  onProfile: (profile: MushroomWeatherProfileId) => { selectedProfile = profile; },
  onDay: (day: string) => { selectedDay = day; }, onOpenMap: () => { opened++; } };
let tree = HotspotConditionsCard(props);
ok(text(tree).includes('še ni ločenega modela')); ok(text(tree).includes('Ocene trenutno ni mogoče izračunati.'));
ok(!text(tree).includes('0 / 100'), 'unavailable UI does not fabricate zero');
findButton(tree, 'Poskusi znova').props.onPress(); strictEqual(retries, 1);
loading = true; tree = HotspotConditionsCard(props); ok(text(tree).includes('Pridobivam pogoje ...'));
ok(!walk(tree).some(n => n.type === 'AppButton' && n.props.title === 'Poskusi znova'));
const feature = REGIONAL_INDEX.atPoint([hotspot.longitude, hotspot.latitude])!;
const point = HEATMAP_PILOT_METADATA.weatherCells.find(p => p.id === feature.properties.weatherCellId)!;
for (const profile of ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const) {
  for (const day of ['today', 'tomorrow'] as const) {
    assessment = regionalAreaAssessmentFor(feature, assessHeatmapWeather({ ...point, baseLocalDate: date, fetchedAt: new Date().toISOString(),
      errors: {}, stale: false, days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60),
        kind: i < 60 ? 'historical' : 'forecast', precipitationMm: 2, temperatureMeanC: 13, evapotranspirationMm: 1 })),
      currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
      tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
    }, profile, day));
    loading = false; tree = HotspotConditionsCard({ ...props, profile, day });
    strictEqual(walk(tree).filter(n => n.type === 'Chip').length, 6, 'all supported profiles and both days');
    ok(text(tree).includes(assessment.classLabel));
    ok(text(tree).includes('Padavine') && text(tree).includes('Izsuševanje'));
    findButton(tree, 'Odpri pogoje na zemljevidu').props.onPress();
    const markerTree = HotspotConditionsMarkers({ hotspots: [hotspot], enabled: true, profile, day,
      bounds: [14, 46, 15, 47], onSelect: (h: Hotspot) => { strictEqual(h.id, hotspot.id); } });
    const marker = walk(markerTree).find(n => n.type === 'Marker')!;
    strictEqual(marker.props.id, hotspot.id);
    marker.props.onPress({ stopPropagation: () => undefined });
    ok(text(markerTree).includes(String(assessment.score)));
    strictEqual(calls.at(-1)!.profile, profile); strictEqual(calls.at(-1)!.day, day, 'badge owns map selection, not stored species');
    const popup = HotspotConditionsPopup({ hotspot, profile, day });
    ok(text(popup).includes(assessment.classLabel));
  }
}
strictEqual(opened, 8);
tree = HotspotConditionsCard(props);
walk(tree).find(n => n.type === 'Chip' && n.props.label === 'Užitna sirovka')!.props.onPress();
walk(tree).find(n => n.type === 'Chip' && n.props.label === 'Jutri')!.props.onPress();
strictEqual(selectedProfile, 'lactariusDeliciosus'); strictEqual(selectedDay, 'tomorrow');
assessment = undefined;
const noScore = HotspotConditionsMarkers({ hotspots: [hotspot], enabled: true, profile: 'generic', day: 'today', onSelect: () => undefined });
strictEqual(walk(noScore).filter(n => n.type === 'Marker').length, 1, 'marker survives missing weather');
strictEqual(walk(noScore).filter(n => n.type === 'Text').length, 0, 'no fake score badge');
const stale = regionalAreaAssessmentFor(feature, assessHeatmapWeather({ ...point, baseLocalDate: date, fetchedAt: new Date().toISOString(),
  errors: {}, stale: true, days: [{ date: shiftLocalDate(date, -1), kind: 'historical', precipitationMm: 20, temperatureMeanC: 13 }] }, 'generic', 'today'));
ok(text(LocationConditionsSummary({ assessment: { ...stale, score: 80 }, loading: false })).includes('starejša ocena'));
console.info('PASS actual compact card/popup/marker UI: four profiles, both days, exact callbacks, unavailable/loading/stale, supported fallback copy, preserved missing-score markers. Native placement/taps need physical QA.');
