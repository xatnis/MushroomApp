/// <reference types="node" />
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { colors } from '../src/theme';
import type { ConditionsTargetContext, HotspotSortMode } from '../src/domain/hotspotRanking';

// Actual controls/handlers and style contracts, not a native font/Yoga renderer.
const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
const element = (type: any, props: any) => ({ type, props });
let menuOpen = false, changes = 0;
let context: ConditionsTargetContext = { targetProfile: 'generic', dayMode: 'today' }, sort: HotspotSortMode = 'recent';
const filename = resolve('src/components/HotspotRankingControls.tsx'), mod = new Module(filename);
mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/components'));
const original = mod.require.bind(mod);
mod.require = (id: string) => {
  if (id === 'react') return { memo: (fn: any) => fn, useState: () => [menuOpen, (value: boolean) => { menuOpen = value; }] };
  if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
  if (id === 'react-native') return { ...Object.fromEntries(['Modal', 'ScrollView', 'Pressable', 'Text', 'View'].map(v => [v, v])),
    StyleSheet: { create: (v: any) => v, absoluteFill: {} } };
  if (id === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
  if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
  return original(id);
};
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const { HotspotRankingControls } = mod.exports;
let tree: any;
const render = () => { tree = HotspotRankingControls({ context, sort,
  onContext: (v: ConditionsTargetContext) => { context = v; changes++; }, onSort: (v: HotspotSortMode) => { sort = v; changes++; } }); };
function walk(n: any): any[] {
  if (Array.isArray(n)) return n.flatMap(walk);
  if (!n || typeof n !== 'object' || !('props' in n)) return [];
  return [n, ...(n.type === 'Modal' && !n.props.visible ? [] : walk(n.props.children))];
}
const text = (n: any): string => Array.isArray(n) ? n.map(text).join(' ') : n == null || typeof n === 'boolean' ? ''
  : typeof n !== 'object' ? String(n) : walk(n).filter(v => v.type === 'Text').map(v => text(v.props.children)).join(' ');
const flat = (s: any): any => Object.assign({}, ...(Array.isArray(s) ? s.filter(Boolean) : [s]));
const button = (label: string) => walk(tree).find(n => n.type === 'Pressable' && text(n) === label);
const trigger = () => walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Razvrsti:'));
function press(label: string) { const n = button(label); ok(n, label); n.props.onPress(); render(); }
render();
strictEqual(trigger().props.accessibilityLabel, 'Razvrsti: Zadnja sprememba');
strictEqual(walk(tree).filter(n => n.type === 'Pressable').length, 7, 'four chips + two segments + ONE sort trigger');
const scroll = walk(tree).find(n => n.type === 'ScrollView');
ok(scroll.props.horizontal); strictEqual(scroll.props.showsHorizontalScrollIndicator, false); ok(scroll.props.accessibilityHint.includes('podrsajte'));
ok(walk(tree).some(n => n.type === 'Ionicons' && n.props.name === 'swap-horizontal-outline'), 'scroll discovery cue preserved');
const chips = walk(scroll).filter(n => n.type === 'Pressable');
deepStrictEqual(chips.map(text), Object.values(MUSHROOM_WEATHER_PROFILES).map(p => p.label));
strictEqual(chips.filter(n => n.props.accessibilityState.selected).length, 1);
const segmented = walk(tree).find(n => n.props.accessibilityRole === 'radiogroup');
const days = walk(segmented).filter(n => n.type === 'Pressable');
strictEqual(days.length, 2); strictEqual(days[0].props.accessibilityState.checked, true);
function assertDayStyles() {
  for (const [day, label] of [['today', 'Danes'], ['tomorrow', 'Jutri']]) {
    const segment = button(label), selected = context.dayMode === day;
    strictEqual(segment.props.accessibilityState.selected, selected, 'visual/accessible selection matches dayMode');
    strictEqual(segment.props.accessibilityState.checked, selected);
    strictEqual(flat(segment.props.style).backgroundColor, selected ? colors.primary : colors.surface);
    const caption = walk(segment).find(n => n.type === 'Text');
    strictEqual(flat(caption.props.style).color, selected ? colors.white : colors.text);
  }
}
assertDayStyles();
for (const n of [...chips, ...days, trigger()]) ok(flat(n.props.style).minHeight >= 44);
press('Jutri'); strictEqual(context.dayMode, 'tomorrow');
strictEqual(button('Jutri').props.accessibilityState.checked, true);
assertDayStyles(); press('Danes'); assertDayStyles(); press('Jutri'); assertDayStyles();
press('Jesenski goban'); strictEqual(context.targetProfile, 'boletusEdulis');
strictEqual(button('Jesenski goban').props.accessibilityState.selected, true);
const before = changes; trigger().props.onPress(); render(); strictEqual(changes, before, 'menu open is UI-only');
strictEqual(trigger().props.accessibilityState.expanded, true);
const options = walk(tree).filter(n => n.type === 'Pressable' && n.props.accessibilityRole === 'radio' && !['Danes', 'Jutri'].includes(text(n)));
deepStrictEqual(options.map(text), ['Zadnja sprememba', 'Najboljši pogoji', 'Ime']);
strictEqual(options.length, 3); ok(!text(tree).includes('Prekliči'));
ok(options[0].props.accessibilityState.checked);
for (const n of options) ok(flat(n.props.style).minHeight >= 44);
press('Najboljši pogoji'); strictEqual(sort, 'conditions'); ok(!menuOpen);
strictEqual(text(trigger()), 'Najboljši pogoji');
trigger().props.onPress(); render(); press('Ime'); strictEqual(sort, 'name');
trigger().props.onPress(); render(); const count = changes;
walk(tree).find(n => n.type === 'Modal').props.onRequestClose(); render();
ok(!menuOpen); strictEqual(changes, count, 'Android back dismisses without changing sort/profile/day');
trigger().props.onPress(); render();
walk(tree).find(n => n.props.accessibilityLabel === 'Zapri možnosti razvrščanja').props.onPress(); render(); ok(!menuOpen);
strictEqual(changes, count); strictEqual(sort, 'name', 'outside dismissal preserves sort');
// Responsive style contract: normal phone widths share a row; narrower widths wrap, never truncate.
const row = walk(tree).find(n => n.type === 'View' && flat(n.props.style).flexWrap === 'wrap');
ok(row); const dayWidth = flat(segmented.props.style).flexBasis, sortStyle = flat(trigger().props.style);
for (const screenWidth of [320, 360, 412]) {
  const usable = screenWidth - 32, shared = dayWidth + sortStyle.minWidth + flat(row.props.style).gap <= usable;
  console.log('Ranking controls style budget', { screenWidth, usable, sharedRow: shared, nativeLayoutMeasured: false });
  ok(dayWidth <= usable && sortStyle.minWidth <= usable);
  if (screenWidth >= 360) ok(shared);
}
ok(sortStyle.flexGrow === 1 && sortStyle.flexShrink === 1);
ok(!walk(trigger()).find(n => n.type === 'Text').props.numberOfLines, 'long sort label wraps instead of aggressive truncation');
const source = readFileSync(filename, 'utf8');
for (const forbidden of ['useLocationConditions', 'fetch(', 'GeoJSON', 'heatmapNavigation', 'scoreHotspot']) ok(!source.includes(forbidden));
const current = readFileSync('src/components/HotspotRankingList.tsx', 'utf8');
const baseline = execFileSync('git', ['show', 'db27240:src/components/HotspotRankingList.tsx'], { encoding: 'utf8' });
strictEqual(current.slice(current.indexOf('  const navigation ='), current.indexOf('  return <FlatList')),
  baseline.slice(baseline.indexOf('  const navigation ='), baseline.indexOf('  return <FlatList'))
    .replace("  const [sort, setSort] = useState<HotspotSortMode>('recent');\n", ''), 'only sort ownership moved above view switch; evaluation/cache unchanged');
ok(current.includes("navigation.navigate('HotspotDetail', rankingDetailParams(item.id, context))"));
ok(current.includes('onPress={() => onShowMap(item)}'));
strictEqual(readFileSync('src/domain/hotspotRanking.ts', 'utf8'), execFileSync('git', ['show', 'db27240:src/domain/hotspotRanking.ts'], { encoding: 'utf8' }));
console.log('PASS hidden scrollbar + scroll cue, actual active/inactive colors and selected/checked day, exactly three sort options, selection/back/outside, 44pt targets, UI-only menu, byte-identical evaluation/order/rows/navigation. Physical font/layout QA still required.');
