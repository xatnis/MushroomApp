import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { buildWeatherDailySeries, weatherLocalDate } from '../src/domain/weatherSeries';
import { shiftLocalDate } from '../src/services/weather';
import { graphPresetRange, graphScrollOffset, graphSelectionVisible, graphPhase, type WeatherGraphPreset } from '../src/components/weatherGraphPresentation';

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
strictEqual(forecastBar.props.style[2], false, 'selected forecast does not inherit the historical thick active border');
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
    graph = walk(view).find(n => n.type === 'WeatherGraphs'); strictEqual(graph.props.navigation.preset, label === '7 dni nazaj' ? 'history7' : label === '30 dni nazaj' ? 'history30' : 'forecast7');
  }
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
ok(conditions.includes('<Screen style={styles.screenContent}>')); ok(conditions.includes('screenContent: { gap: spacing.sm }'));
ok(conditions.includes('introCard: { padding: spacing.md, gap: spacing.sm }')); ok(conditions.includes('locationActions: { flexDirection: \'row\', flexWrap: \'wrap\''));
ok(conditions.indexOf('<WeatherGraphsEntry') > conditions.indexOf('<SectionTitle>Trenutno'));
for (const path of ['src/services/weather.ts', 'src/services/weatherGraphs.ts', 'src/domain/weatherSeries.ts', 'src/domain/mushroomWeather.ts',
  'src/screens/MapScreen.tsx', 'src/services/heatmap/useLocationConditions.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/domain/hotspotRanking.ts', 'src/domain/heatmap/controlsState.ts', 'src/navigation/AppNavigator.tsx'])
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `9f3257c:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), `V4 UI-only: ${path}`);
console.log('PASS V4 canonical today/outline/dashes, Ljubljana midnight/DST/resume/cleanup, 37 dates and 3 presets, 320/360/412 widths and 1/1.6/2 fonts, both chart offsets/selection, manual scrolling/return, measured anchors/loading/stale/latest/gesture/Back, 48pt accessibility, compact Razmere, 0 navigation HTTP and pinned model/cache/map/LOD. Native Yoga/TalkBack QA remains separate.');
