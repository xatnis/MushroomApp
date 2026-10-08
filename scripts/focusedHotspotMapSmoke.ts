import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { colors, radii, spacing } from '../src/theme';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';

const source = readFileSync('src/screens/MapScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MapScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let toggleFunction = '', entryFunction = '', stylesExpression = '', contextJsx = '';
function inspect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'MyHotspotsToggle') toggleFunction = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'TopThreeEntry') entryFunction = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'styles') stylesExpression = node.initializer!.getText(ast);
  if (ts.isJsxElement(node) && node.openingElement.getText(ast).includes('ref={contextView}')) contextJsx = node.getText(ast);
  ts.forEachChild(node, inspect);
}
inspect(ast);
const element = (type: any, props: any) => ({ type, props });
let toggles = 0, opens = 0, cancellations = 0;
const state: any = { colors, radii, spacing, RECENTER_SIZE: 48, StyleSheet: { create: (styles: any) => styles },
  exports: {},
  Ionicons: 'Icon', View: 'View', Text: 'Text', Pressable: 'Pressable', contextView: {}, showMyHotspots: true,
  MUSHROOM_WEATHER_PROFILES, toggleMyHotspots: () => toggles++, cancelPendingHotspotFocus: () => cancellations++,
  refreshPendingFocusLayout: () => undefined,
  setMapControlsBottom: () => undefined, openTopThree: () => undefined, topThreeVisible: false, TopThreeEntry: 'TopThreeEntry',
  dispatchHeatmapControls: (action: any) => { strictEqual(action.type, 'open'); opens++; },
  require: () => ({ jsx: element, jsxs: element }),
};
const compile = (code: string) => runInNewContext(`(() => { ${ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText} })()`, state);
compile(`const styles = ${stylesExpression}; ${toggleFunction} ${entryFunction} globalThis.styles = styles; globalThis.toggle = MyHotspotsToggle; globalThis.entry = TopThreeEntry;`);
state.MyHotspotsToggle = state.toggle;
state.TopThreeEntry = state.entry;
let entryPresses = 0;
const entry = state.entry({ selected: true, onPress: () => entryPresses++ });
strictEqual(entry.props.accessibilityState.expanded, true); strictEqual(entry.props.accessibilityLabel, 'Top 3 moja rastišča');
strictEqual(entry.props.style({ pressed: false })[0].minHeight, 44); entry.props.onPress(); strictEqual(entryPresses, 1);
const flatten = (values: any): any => Array.isArray(values) ? Object.assign({}, ...values.map(flatten)) : values || {};
for (const visible of [false, true]) {
  const control = state.toggle({ visible, onToggle: () => toggles++ });
  strictEqual(control.props.accessibilityLabel, 'Prikaži moja rastišča');
  strictEqual(control.props.accessibilityState.checked, visible);
  const style = flatten(control.props.style({ pressed: false }));
  strictEqual(style.width, 44); strictEqual(style.height, 44);
  strictEqual(style.backgroundColor, visible ? colors.primary : colors.surface);
  strictEqual(control.props.children[0].props.name, visible ? 'layers' : 'layers-outline');
  strictEqual(Boolean(control.props.children[1]), visible, 'ON has a checkmark, not just a color');
  control.props.onPress();
}
strictEqual(toggles, 2);
for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES)) for (const day of ['today', 'tomorrow']) {
  state.heatmapProfileId = profile; state.heatmapTargetDay = day;
  compile(`globalThis.result = (${contextJsx});`);
  const context = state.result, pill = context.props.children[0];
  strictEqual(pill.props.children[0].props.children.join(''), `${MUSHROOM_WEATHER_PROFILES[profile as keyof typeof MUSHROOM_WEATHER_PROFILES].label} · ${day === 'today' ? 'Danes' : 'Jutri'}`);
  ok(!pill.props.children[0].props.numberOfLines, 'long profiles/font scaling wrap instead of clipping');
  pill.props.onPress();
}
strictEqual(opens, 8); strictEqual(cancellations, 8, 'existing filter action cancels a pending camera focus');
const layout = state.styles.contextControls, pillStyle = state.styles.contextControl;
strictEqual(layout.flexDirection, 'row'); strictEqual(layout.flexWrap, 'wrap');
for (const screenWidth of [320, 360, 412]) {
  const mapWidth = screenWidth - 2 * spacing.lg;
  const controlsWidth = mapWidth - layout.left - layout.right;
  ok(pillStyle.minWidth + 44 + layout.gap <= controlsWidth);
  ok(pillStyle.flexGrow === 1 && pillStyle.flexShrink === 1);
  const topThreeSameRow = pillStyle.minWidth + 44 + state.styles.topThreeEntry.minWidth + 2 * layout.gap <= controlsWidth;
  console.log('Focused map STYLE BUDGET', { screenWidth, controlsWidth, topThreeSameRow,
    estimatedPillWidth: controlsWidth - 44 - layout.gap - (topThreeSameRow ? state.styles.topThreeEntry.minWidth + layout.gap : 0),
    fontScalesRequiringNativeQA: [1, 1.3, 2], nativeTextLayoutMeasured: false });
}
ok(layout.right >= state.styles.recenter.right + state.styles.recenter.width + spacing.sm, 'reserve actual location-button footprint');
const old = execFileSync('git', ['show', 'e4cff79:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
const slice = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
strictEqual(slice(source, '  const conditionsContext =', '  const [heatmapBundle'), slice(old, '  const conditionsContext =', '  const [heatmapBundle'));
strictEqual(slice(source, '  const selectHeatmapSpecies', '  const heatmapAreaCardOpen'), slice(old, '  const selectHeatmapSpecies', '  const heatmapAreaCardOpen'));
strictEqual(slice(source, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'), slice(old, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'));
for (const file of ['src/domain/mushroomWeather.ts', 'src/domain/locationConditions.ts',
  'src/services/heatmap/regionalWeather.ts', 'src/domain/hotspotRanking.ts', 'src/navigation/AppNavigator.tsx', 'src/components/ui.tsx', 'src/state/AppContext.tsx'])
  strictEqual(readFileSync(file, 'utf8'), execFileSync('git', ['show', `e4cff79:${file}`], { encoding: 'utf8' }), file);
ok(source.includes('style={styles.preview}') && !source.includes('insets.bottom'), 'popup remains inside already tab-inset map; no double bottom safe-area');
console.log('PASS actual icon/context UI, current selection, existing filter, responsive wrap/44pt contract, location clearance, unchanged selection/weather/scoring/GeoJSON/LOD/sources/privacy/tab insets. Native text/GPU/camera projection needs phone QA.');
