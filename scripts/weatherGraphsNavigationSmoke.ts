import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { withoutConditionsListEntry } from './conditionsListEntryFixture';
import { buildWeatherDailySeries, weatherLocalDate, weatherPlotScale } from '../src/domain/weatherSeries';
import { shiftLocalDate } from '../src/services/weather';
import { graphPresetRange, graphScrollOffset, graphSelectionVisible, graphPhase, graphPeriodSummary, graphSummary, graphNumber, type WeatherGraphPreset } from '../src/components/weatherGraphPresentation';

const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : n == null || typeof n === 'boolean' ? '' : String(n);
const jsx = (type: any, props: any) => ({ type, props });
let fontScale = 1, http = 0;
const native = { ...Object.fromEntries(['Modal', 'View', 'Text', 'Pressable', 'ScrollView', 'ActivityIndicator'].map(s => [s, s])),
  StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, useWindowDimensions: () => ({ fontScale }),
  AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => 7 };

function harness(path: string, overrides: Record<string, any> = {}) {
  const hooks: any[] = [], effects: Array<() => void> = []; let cursor = 0;
  const react = {
    useState(initial: any) { const slot = cursor++; hooks[slot] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, (value: any) => { hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }]; },
    useRef(initial: any) { const slot = cursor++; hooks[slot] ??= { current: initial }; return hooks[slot]; },
    useMemo: (f: any) => f(),
    useEffect(f: any, deps: any[]) { const slot = cursor++;
      if (!hooks[slot] || deps.some((v, i) => v !== hooks[slot].deps[i])) effects.push(() => { hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: f() }; }); },
    useLayoutEffect(f: any, deps: any[]) { const slot = cursor++;
      if (!hooks[slot] || deps.some((v, i) => v !== hooks[slot].deps[i])) effects.push(() => { hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: f() }; }); },
  };
  const file = resolve(path), requireHere = createRequire(file), Module = requireHere('node:module');
  const mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/components'));
  mod.require = (id: string) => id in overrides ? overrides[id] : id === 'react' ? react
    : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === 'react-native' ? native
    : id === 'expo-sqlite' ? { useSQLiteContext: () => ({}) }
    : id === './useWeatherGraphLocalDate' ? { useWeatherGraphLocalDate: () => weatherLocalDate() }
    : id === '../services/weatherGraphs' ? { loadWeatherGraphSeries: () => { http++; throw new Error('UI navigation must not fetch'); } }
    : id === 'react-native-safe-area-context' ? { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }
    : id === '@expo/vector-icons' ? { Ionicons: 'Icon' } : requireHere(id);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return { exports: mod.exports, hooks, render(name: string, props: any) { cursor = 0; return mod.exports[name](props); },
    flush() { effects.splice(0).forEach(f => f()); }, close() { hooks.forEach(h => h?.cleanup?.()); } };
}

const today = '2026-10-11';
const series = buildWeatherDailySeries(46, 14, today, Array.from({ length: 37 }, (_, i) => ({
  day: { date: shiftLocalDate(today, i - 30), kind: 'historical' as const, precipitationMm: i === 30 ? 0 : i === 24 ? undefined : i,
    temperatureMeanC: i === 24 ? undefined : i - 15, temperatureMinC: i - 18, temperatureMaxC: i - 12 },
  source: 'archive' as const, fetchedAt: '2026-10-11T08:00:00Z', stale: false,
})));
const before = JSON.stringify(series);
for (const preset of ['history7', 'history30', 'forecast7'] as WeatherGraphPreset[]) {
  const range = graphPresetRange(series, preset);
  strictEqual(range.points.length, preset === 'history30' ? 30 : 7);
  strictEqual(range.selectedDate, range.points[0].date);
  ok(range.points.every(p => preset === 'forecast7' ? p.date >= today && p.kind === 'forecast' : p.date < today && p.isCompleteDay));
  strictEqual(range.startIndex, preset === 'history7' ? 23 : preset === 'history30' ? 0 : 30);
}
strictEqual(graphPresetRange(series, 'forecast7').points.at(-1)!.date, shiftLocalDate(today, 6));
strictEqual(graphPresetRange(series, 'history7').points.at(-1)!.date, shiftLocalDate(today, -1));
strictEqual(graphPresetRange(series, 'history7').points[1].precipitationMm, null, 'nullable days stay in the navigable period');
for (const date of ['2024-03-01', '2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26', '2027-01-01']) {
  const empty = buildWeatherDailySeries(46, 14, date, []);
  strictEqual(graphPresetRange(empty, 'history7').points[0].date, shiftLocalDate(date, -7));
  strictEqual(graphPresetRange(empty, 'forecast7').points.length, 7);
  strictEqual(empty.points[30].kind, 'forecast'); ok(empty.points[30].isProvisional);
  ok(graphPhase(empty.points[30], date).includes('nedokončan dan'));
}
// Exact local-midnight and DST boundaries, no UTC-date parsing in presentation.
for (const [utc, expected] of [
  ['2026-10-10T21:59:59Z', '2026-10-10'], ['2026-10-10T22:00:00Z', today],
  ['2026-03-28T22:59:59Z', '2026-03-28'], ['2026-03-28T23:00:00Z', '2026-03-29'],
  ['2026-03-29T22:00:00Z', '2026-03-30'], ['2026-10-25T23:00:00Z', '2026-10-26'],
]) strictEqual(weatherLocalDate(new Date(utc)), expected);

const chart = harness('src/components/WeatherGraphs.tsx');
const commands: any[] = [];
for (const width of [320, 360, 412]) for (const scale of [1, 1.6, 2]) {
  fontScale = scale;
  for (const preset of ['history7', 'history30', 'forecast7'] as WeatherGraphPreset[]) {
    for (const metric of ['rain', 'temperature']) {
      const props = { series, metric, selectedDate: graphPresetRange(series, preset).selectedDate, onSelect() {}, navigation: { preset, generation: commands.length + 1 } };
      let tree = chart.render('DailyWeatherChart', props);
      const horizontal = walk(tree).find(n => n.type === 'ScrollView');
      horizontal.props.ref.current = { scrollTo: (value: any) => commands.push(value) };
      horizontal.props.onLayout({ nativeEvent: { layout: { width: width - 24 - 44 * scale } } });
      tree = chart.render('DailyWeatherChart', props); chart.flush();
      const range = graphPresetRange(series, preset), viewport = width - 24 - 44 * scale;
      const expected = graphScrollOffset(range.startIndex, 48 * scale, viewport, 37);
      strictEqual(commands.at(-1).x, expected);
      ok(graphSelectionVisible(range.startIndex, 48 * scale, viewport, expected));
      strictEqual(walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith(metric === 'rain' ? 'Padavine,' : 'Temperatura,')).length, 37, 'no truncation/remount for a time preset');
    }
  }
}
fontScale = 1;
let selected = today;
const chartProps = { series, metric: 'rain', selectedDate: today, onSelect: (date: string) => selected = date };
let tree = chart.render('DailyWeatherChart', chartProps);
const horizontal = walk(tree).find(n => n.type === 'ScrollView');
horizontal.props.onLayout({ nativeEvent: { layout: { width: 288 } } });
tree = chart.render('DailyWeatherChart', chartProps); chart.flush();
walk(tree).find(n => n.type === 'ScrollView').props.onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
tree = chart.render('DailyWeatherChart', chartProps); chart.flush();
strictEqual(selected, today, 'manual scrolling never changes the selected date');
const returnToDay = walk(tree).find(n => n.props.accessibilityLabel?.startsWith('Na izbrani dan:'));
ok(returnToDay); ok(returnToDay.props.style.minHeight >= 48);
returnToDay.props.onPress(); strictEqual(commands.at(-1).x, graphScrollOffset(30, 48, 288, 37, true));
tree = chart.render('DailyWeatherChart', chartProps); chart.flush();
ok(!walk(tree).some(n => n.props.accessibilityLabel?.startsWith('Na izbrani dan:')));
const forecastBar = walk(tree).find(n => n.props.testID === 'weather-forecast-bar');
strictEqual(forecastBar.props.style[1].backgroundColor, 'transparent'); strictEqual(forecastBar.props.style[1].borderStyle, 'dashed');
ok(!forecastBar.props.style[2], 'forecast does not inherit the historical thick active border');
const historyBar = walk(tree).find(n => n.props.testID === 'weather-history-bar'); strictEqual(historyBar.props.style[1].borderStyle, 'solid');
const dayTargets = walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Padavine,'));
ok(text(dayTargets[30]).includes('Danes')); ok(dayTargets[30].props.accessibilityLabel.includes('0 mm'));
ok(dayTargets[24].props.accessibilityLabel.includes('Ni podatka'));
ok(walk(tree).some(n => n.props.accessibilityLabel?.startsWith('Izbrani dan:') && n.props.accessibilityLabel.includes('0 mm') && n.props.accessibilityLabel.includes('nedokončan')));
dayTargets[24].props.onPress(); strictEqual(selected, series.points[24].date);
chart.close();
const pair = harness('src/components/WeatherGraphs.tsx');
for (const [generation, preset] of ['history30', 'history7', 'forecast7'].entries()) {
  const props = { series, navigation: { preset, generation } };
  pair.render('WeatherGraphPair', props); pair.flush();
  const both = walk(pair.render('WeatherGraphPair', props)).filter(n => n.type === pair.exports.DailyWeatherChart);
  strictEqual(both.length, 2); ok(both.every(n => n.props.selectedDate === graphPresetRange(series, preset as WeatherGraphPreset).selectedDate));
  ok(both.every(n => n.props.navigation === props.navigation));
}
pair.close(); strictEqual(JSON.stringify(series), before); strictEqual(http, 0, 'time navigation, scrolling and selection have no acquisition path');

// V4.1: calendar-period summaries are independent of selection and viewport.
const completeSeries = buildWeatherDailySeries(46, 14, today, Array.from({ length: 37 }, (_, i) => ({
  day: { date: shiftLocalDate(today, i - 30), kind: 'forecast' as const, precipitationMm: i < 30 ? 2 : 3,
    temperatureMeanC: i < 30 ? 10 : 12, temperatureMinC: -5, temperatureMaxC: 30 },
  source: i < 30 ? 'archive' as const : 'forecast' as const, fetchedAt: null, stale: false,
})));
for (const [preset, rain, temperature] of [['history7', 14, 10], ['history30', 60, 10], ['forecast7', 21, 12]] as const) {
  strictEqual(graphPeriodSummary(completeSeries, 'rain', preset).value, rain);
  strictEqual(graphPeriodSummary(completeSeries, 'temperature', preset).value, temperature);
  strictEqual(graphSummary(completeSeries, 'rain', preset).signals.length, 1);
  strictEqual(graphSummary(completeSeries, 'rain', preset).signals[0].value, rain);
}
const varied = { ...completeSeries, points: completeSeries.points.map((p, i) => ({ ...p, precipitationMm: i, temperatureMeanC: i - 35 })) };
deepStrictEqual((['history7', 'history30', 'forecast7'] as const).map(preset => graphPeriodSummary(varied, 'rain', preset).value), [182, 435, 231]);
strictEqual(graphPeriodSummary(varied, 'temperature', 'forecast7').value, -2, 'average all valid means, including negative and zero temperatures');
const missing = { ...completeSeries, points: completeSeries.points.filter((_, i) => i !== 31).map((p, i) => i === 32 ? { ...p, precipitationMm: null, temperatureMeanC: null } : p) };
const partialRain = graphPeriodSummary(missing, 'rain', 'forecast7');
strictEqual(partialRain.value, null); strictEqual(partialRain.availableDays, 5); strictEqual(partialRain.expectedDays, 7);
ok(partialRain.text.includes('5 od 7 dni') && partialRain.text.includes('nepopolni'));
const partialTemperature = graphPeriodSummary(missing, 'temperature', 'forecast7');
strictEqual(partialTemperature.value, 12); ok(!partialTemperature.complete); ok(partialTemperature.text.includes('delno povprečje'));
strictEqual(graphPeriodSummary({ ...completeSeries, points: completeSeries.points.filter((_, i) => i !== 0) }, 'rain', 'history30').value, null);
const zeroForecast = { ...completeSeries, points: completeSeries.points.map(p => ({ ...p, precipitationMm: 0 })) };
strictEqual(graphPeriodSummary(zeroForecast, 'rain', 'forecast7').value, 0);
const noMeans = { ...completeSeries, points: completeSeries.points.map(p => ({ ...p, temperatureMeanC: null })) };
strictEqual(graphPeriodSummary(noMeans, 'temperature', 'forecast7').value, null, 'min/max cannot substitute for missing mean');
ok(graphPeriodSummary(noMeans, 'temperature', 'forecast7').text.includes('0 od 7 dni'));
strictEqual(graphPeriodSummary({ ...completeSeries, points: [...completeSeries.points, completeSeries.points[30]] }, 'rain', 'forecast7').value, 21, 'one contribution per date');
const heavyToday = { ...completeSeries, points: completeSeries.points.map(p => p.date === today ? { ...p, precipitationMm: 100 } : p) };
strictEqual(graphPeriodSummary(heavyToday, 'rain', 'history7').value, 14); strictEqual(graphPeriodSummary(heavyToday, 'rain', 'forecast7').value, 118);
for (const date of ['2024-03-01', '2026-03-30', '2026-10-26', '2027-01-01']) {
  const calendar = { ...completeSeries, today: date, points: completeSeries.points.map((p, i) => ({ ...p, date: shiftLocalDate(date, i - 30) })) };
  strictEqual(graphPeriodSummary(calendar, 'rain', 'history7').value, 14);
  strictEqual(graphPeriodSummary(calendar, 'rain', 'history30').value, 60);
  strictEqual(graphPeriodSummary(calendar, 'temperature', 'forecast7').value, 12);
}
const cleanup = harness('src/components/WeatherGraphs.tsx');
const tinySeries = { ...series, points: series.points.map((p, i) => i >= 30 && i <= 33 ? { ...p, precipitationMm: [0, .1, .4, null][i - 30] } : p) };
let picked = today;
for (const index of [30, 31, 32, 33]) {
  const props = { series: tinySeries, metric: 'rain', selectedDate: tinySeries.points[index].date, onSelect: (date: string) => picked = date, navigation: { preset: 'forecast7', generation: 1 } };
  const rendered = cleanup.render('DailyWeatherChart', props); cleanup.flush();
  const points = walk(rendered).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Padavine,'));
  const target = points[index], value = tinySeries.points[index].precipitationMm;
  ok(target.props.accessibilityState.selected); ok(target.props.style[1].width >= 48);
  const highlight = walk(target).find(n => n.props.testID === 'weather-selected-slot');
  strictEqual(highlight.props.style[1].height, 144); ok(highlight.props.style[0].borderWidth >= 1);
  const bar = walk(target).find(n => n.props.testID === 'weather-forecast-bar');
  if (value != null && value > 0) {
    const exactHeight = 144 * value / weatherPlotScale(tinySeries.points, 'rain').max;
    ok(Math.abs(bar.props.style[1].height - exactHeight) < 1e-10); ok(bar.props.style[1].height < 2, 'no artificial minimum bar height');
    ok(bar.props.style[1].borderWidth <= exactHeight / 2 + 1e-10);
  } else strictEqual(bar, undefined);
  strictEqual(walk(target).some(n => n.props.testID === 'weather-zero-rain'), value === 0);
  if (value == null) ok(text(target).includes('—'));
  ok(target.props.accessibilityLabel.includes(graphNumber(value, 'mm')));
  ok(walk(rendered).find(n => n.props.accessibilityLabel?.startsWith('Izbrani dan:')).props.accessibilityLabel.includes(graphNumber(value, 'mm')));
  target.props.onPress(); strictEqual(picked, tinySeries.points[index].date);
}
for (const preset of ['history7', 'history30', 'forecast7'] as WeatherGraphPreset[]) {
  const props = { series: completeSeries, metric: 'rain', selectedDate: today, onSelect() {}, navigation: { preset, generation: 1 } };
  let rendered = cleanup.render('DailyWeatherChart', props); cleanup.flush();
  const summaryLabel = () => walk(rendered).find(n => n.props.accessibilityLabel?.startsWith('Padavine. 30 preteklih dni')).props.accessibilityLabel;
  const originalSummary = summaryLabel(); ok(originalSummary.includes(graphPeriodSummary(completeSeries, 'rain', preset).text));
  walk(rendered).find(n => n.type === 'ScrollView').props.onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
  rendered = cleanup.render('DailyWeatherChart', { ...props, selectedDate: completeSeries.points[0].date }); cleanup.flush();
  strictEqual(summaryLabel(), originalSummary, 'selected date and manual scrolling cannot change period totals');
}
cleanup.close(); strictEqual(http, 0);

// Actual modal callbacks and native measureLayout command: delayed/stale layouts, latest anchor wins.
const originalFrame = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => { if (id != null) frames.delete(id); };
const flushFrames = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(f => f(0)); };
try {
  const modal = harness('src/components/WeatherGraphsView.tsx', { './WeatherGraphs': { WeatherGraphs: 'WeatherGraphs' } });
  const location = { latitude: 46.41, longitude: 14.77, name: 'Izbrano rastišče' };
  let closed = 0; const props = { visible: true, location, onClose: () => closed++ };
  let view = modal.render('WeatherGraphsModal', props); modal.flush(); view = modal.render('WeatherGraphsModal', props); modal.flush();
  const verticalCommands: any[] = [], measures: Array<{ relative: any; callback: (x: number, y: number) => void }> = [];
  const scroller = walk(view).find(n => n.type === 'ScrollView'); scroller.props.ref.current = { scrollTo: (v: any) => verticalCommands.push(v) };
  const content = walk(view).find(n => n.type === 'View' && n.props.collapsable === false); content.props.ref.current = {};
  content.props.onLayout({ nativeEvent: { layout: { y: 12 } } });
  const node = { measureLayout: (relative: any, callback: any) => measures.push({ relative, callback }) };
  let graph = walk(view).find(n => n.type === 'WeatherGraphs');
  graph.props.onSectionLayout('rain', node); graph.props.onSectionLayout('temperature', node);
  const buttons = () => walk(view).filter(n => n.type === 'Pressable');
  const press = (label: string) => buttons().find(n => n.props.accessibilityLabel === label)!.props.onPress();
  press('Padavine'); strictEqual(verticalCommands.length, 0, 'wait until the next layout frame'); flushFrames();
  strictEqual(measures[0].relative, content.props.ref.current);
  press('Temperatura'); measures[0].callback(0, 200); strictEqual(verticalCommands.length, 0, 'older measurement cannot move the latest anchor');
  flushFrames(); measures[1].callback(0, 820); deepStrictEqual(verticalCommands.at(-1), { y: 820, animated: true });
  content.props.onLayout({ nativeEvent: { layout: { y: 16 } } });
  press('Padavine'); flushFrames(); measures[2].callback(0, 180); strictEqual(verticalCommands.at(-1).y, 184, 'measured content origin is included exactly once');
  for (const label of ['7 dni nazaj', '30 dni nazaj', 'Napoved 7 dni']) {
    press(label); view = modal.render('WeatherGraphsModal', props); modal.flush();
    const button = buttons().find(n => n.props.accessibilityLabel === label)!; ok(button.props.accessibilityState.selected); ok(button.props.style({ pressed: false })[0].minHeight >= 48);
    strictEqual(text(button), label === '7 dni nazaj' ? '7 dni' : label === '30 dni nazaj' ? '30 dni' : 'Napoved');
    graph = walk(view).find(n => n.type === 'WeatherGraphs'); strictEqual(graph.props.navigation.preset, label === '7 dni nazaj' ? 'history7' : label === '30 dni nazaj' ? 'history30' : 'forecast7');
  }
  ok(text(view).includes('Izberi obdobje'));
  for (const scale of [1, 1.6, 2]) {
    fontScale = scale; view = modal.render('WeatherGraphsModal', props); modal.flush();
    const styles = buttons().find(n => n.props.accessibilityLabel === 'Napoved 7 dni')!.props.style({ pressed: false });
    strictEqual(styles[1].flexBasis, 80 * scale); ok(styles[0].minHeight >= 48);
    if (scale === 1) for (const width of [320, 360, 412]) ok(3 * styles[1].flexBasis + 16 <= width - 24, 'short labels fit one normal-size row');
  }
  fontScale = 1;
  strictEqual(http, 0); strictEqual(verticalCommands.length, 2, 'time presets do not secretly move the vertical page');
  press('Padavine'); flushFrames();
  scroller.props.onScrollBeginDrag(); measures.at(-1)!.callback(0, 500); strictEqual(verticalCommands.length, 2, 'user drag cancels a pending anchor');
  press('Temperatura'); flushFrames(); view.props.onRequestClose(); measures.at(-1)!.callback(0, 900);
  strictEqual(closed, 1); strictEqual(verticalCommands.length, 2, 'Back cancels pending scroll and only closes this native modal');
  const switched = { ...props, location: { ...location, latitude: 45 } };
  modal.render('WeatherGraphsModal', switched); modal.flush(); view = modal.render('WeatherGraphsModal', switched); modal.flush();
  strictEqual(walk(view).find(n => n.type === 'WeatherGraphs').props.navigation, undefined, 'old location navigation state is cleared');
  press('Temperatura'); flushFrames(); strictEqual(verticalCommands.length, 2, 'loading anchor remains pending until its new section is laid out');
  graph = walk(view).find(n => n.type === 'WeatherGraphs'); graph.props.onSectionLayout('temperature', node); flushFrames();
  measures.at(-1)!.callback(0, 740); strictEqual(verticalCommands.at(-1).y, 744);
  ok(walk(view).filter(n => n.type === 'ScrollView').length === 1); modal.close();
} finally { globalThis.requestAnimationFrame = originalFrame; globalThis.cancelAnimationFrame = originalCancel; }

// Mounted graph calendar timer follows Ljubljana midnight/resume and is removed on close.
const OriginalDate = Date, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
let now = new OriginalDate('2026-10-10T21:59:50Z').getTime(), task: (() => void) | undefined, delay = 0, listener: ((state: string) => void) | undefined, removed = false;
class ClockDate extends OriginalDate { constructor(value?: any) { super(value === undefined ? now : value); } static now() { return now; } }
globalThis.Date = ClockDate as DateConstructor;
globalThis.setTimeout = ((callback: () => void, ms: number) => { task = callback; delay = ms; return 1; }) as any;
globalThis.clearTimeout = (() => { task = undefined; }) as any;
try {
  const appState = { currentState: 'active', addEventListener: (_: string, callback: any) => { listener = callback; return { remove: () => removed = true }; } };
  const calendar = harness('src/components/useWeatherGraphLocalDate.ts', { 'react-native': { AppState: appState } });
  strictEqual(calendar.render('useWeatherGraphLocalDate', {}), '2026-10-10'); calendar.flush(); strictEqual(delay, 10000);
  now = new OriginalDate('2026-10-10T22:00:00Z').getTime(); task!(); strictEqual(calendar.render('useWeatherGraphLocalDate', {}), today);
  appState.currentState = 'background'; listener!('background'); strictEqual(task, undefined);
  now = new OriginalDate('2026-10-25T23:00:00Z').getTime(); appState.currentState = 'active'; listener!('active');
  strictEqual(calendar.render('useWeatherGraphLocalDate', {}), '2026-10-26'); calendar.close(); strictEqual(task, undefined); ok(removed);
} finally { globalThis.Date = OriginalDate; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }

const conditions = readFileSync('src/screens/ConditionsScreen.tsx', 'utf8');
ok(conditions.includes('<Screen style={styles.screenContent}')); ok(conditions.includes('screenContent: { gap: spacing.sm }'));
ok(conditions.includes('introCard: { padding: spacing.md, gap: spacing.sm }')); ok(conditions.includes('locationActions: { flexDirection: \'row\', flexWrap: \'wrap\''));
ok(conditions.indexOf('<WeatherGraphsEntry') > conditions.indexOf('<Card style={styles.suitabilityCard}>'));
for (const path of ['src/services/weather.ts', 'src/services/weatherGraphs.ts', 'src/domain/weatherSeries.ts', 'src/domain/mushroomWeather.ts',
  'src/screens/MapScreen.tsx', 'src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/domain/hotspotRanking.ts', 'src/domain/heatmap/controlsState.ts', 'src/navigation/AppNavigator.tsx'])
  strictEqual((path.endsWith('MapScreen.tsx') ? withoutConditionsListEntry(readFileSync(path, 'utf8')) : readFileSync(path, 'utf8')).replace(/\r\n/g, '\n'), execFileSync('git', ['show', `9f3257c:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), `V4 UI-only: ${path}`);
// Anchor implementation is intentionally byte-for-byte unchanged from physically verified V4.
function anchorStatements(source: string) {
  const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modal = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WeatherGraphsModal') as ts.FunctionDeclaration;
  return modal.body!.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d =>
    ts.isIdentifier(d.name) && ['cancelAnchor', 'alignSection', 'navigateSection', 'onSectionLayout', 'close'].includes(d.name.text))).map(n => n.getText(ast));
}
deepStrictEqual(anchorStatements(readFileSync('src/components/WeatherGraphsView.tsx', 'utf8')), anchorStatements(execFileSync('git', ['show', 'e091e2e:src/components/WeatherGraphsView.tsx'], { encoding: 'utf8' })));
console.log('PASS V4.1 7/30/forecast summaries, zero/null/missing date coverage and explicit partial means, DST/calendar, compact 48pt presets, 0/0.1/0.4/null true-height bars/full-slot selection, independent summary/selection/scroll, 0 navigation HTTP; physically verified V4 anchors unchanged; cache/model/map/LOD pinned. Native layout/TalkBack remains phone QA.');
