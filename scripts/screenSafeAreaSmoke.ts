import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { spacing } from '../src/theme';

// Execute the actual shared Screen component with device insets; not a native layout engine.
const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
const filename = resolve('src/components/ui.tsx'), mod = new Module(filename);
mod.filename = filename; mod.paths = Module._nodeModulePaths(resolve('src/components'));
const original = mod.require.bind(mod);
let bottom = 0;
const platform = { OS: 'android' };
const jsx = (type: any, props: any) => ({ type, props });
mod.require = (id: string) => {
  if (id === 'react') return { forwardRef: (fn: any) => fn };
  if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (id === 'react-native') return { ScrollView: 'ScrollView', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Platform: platform, StyleSheet: { create: (x: any) => x }, Pressable: 'Pressable', Text: 'Text' };
  if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView',
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom, left: 0 }) };
  return original(id);
};
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText, filename);
const { Screen, AppButton } = mod.exports;
const flatten = (styles: any[]): any => Object.assign({}, ...styles.filter(Boolean));
let removed = 0;
const last = jsx(AppButton, { title: 'Izbriši rastišče in obiske', variant: 'danger', onPress: () => { removed++; } });
for (const inset of [0, 4, 16, 24, 34, 48]) {
  bottom = inset;
  const tree = Screen({ children: ['content', last], bottomSafeArea: true });
  deepStrictEqual(tree.props.edges, ['left', 'right'], 'SafeAreaView does not apply bottom again');
  const scroll = tree.props.children.props.children;
  strictEqual(scroll.type, 'ScrollView');
  strictEqual(flatten(scroll.props.contentContainerStyle).paddingBottom, spacing.lg + inset);
  strictEqual(scroll.props.contentInsetAdjustmentBehavior, 'never', 'no automatic iOS inset on top of manual inset');
  strictEqual(scroll.props.automaticallyAdjustContentInsets, false);
  strictEqual(scroll.props.children.at(-1), last, 'destructive CTA stays inside scrollable content');
  const button = AppButton(last.props), buttonStyles = flatten(button.props.style({ pressed: false }));
  ok(buttonStyles.minHeight >= 44); strictEqual(button.props.onPress, last.props.onPress);
  button.props.onPress();
  for (const style of [{ paddingBottom: 24 }, { paddingVertical: 12 }, { padding: 8 }]) {
    const custom = Screen({ bottomSafeArea: true, style });
    const designBase = Object.values(style)[0];
    strictEqual(flatten(custom.props.children.props.children.props.contentContainerStyle).paddingBottom, designBase + inset);
  }
  // Tabs and existing manually-inset Record screen must not get a second inset.
  const tab = Screen({ children: 'tab' }).props.children.props.children;
  strictEqual(flatten(tab.props.contentContainerStyle).padding, spacing.lg);
  strictEqual(flatten(tab.props.contentContainerStyle).paddingBottom, undefined);
  const record = Screen({ style: { paddingBottom: spacing.xl + inset } }).props.children.props.children;
  strictEqual(flatten(record.props.contentContainerStyle).paddingBottom, spacing.xl + inset);
  strictEqual(Screen({ scroll: false, bottomSafeArea: true }).props.children.props.children.type, 'View');
}
strictEqual(removed, 6);
platform.OS = 'ios'; bottom = 34;
const ios = Screen({ bottomSafeArea: true });
strictEqual(ios.props.children.props.behavior, 'padding', 'existing keyboard avoidance preserved on iOS');
strictEqual(flatten(ios.props.children.props.children.props.contentContainerStyle).paddingBottom, spacing.lg + bottom);
strictEqual(ios.props.children.props.children.props.automaticallyAdjustContentInsets, false);
for (const [screen, title] of [['HotspotDetailScreen', 'Izbriši rastišče in obiske'], ['FindDetailScreen', 'Izbriši obisk']]) {
  const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
  const baseline = execFileSync('git', ['show', `ca6e88d:src/screens/${screen}.tsx`], { encoding: 'utf8' });
  if (screen === 'FindDetailScreen') strictEqual(source.replaceAll('<Screen bottomSafeArea>', '<Screen>'), baseline, 'visit screen actions/data/UI hierarchy intact');
  else {
    // Ranking may supply an entry profile/day; safe-area ownership and delete/save actions must stay intact.
    strictEqual(source.slice(source.indexOf('  const save ='), source.indexOf('  return <Screen')),
      baseline.slice(baseline.indexOf('  const save ='), baseline.indexOf('  return <Screen')));
    ok(source.includes('return <Screen bottomSafeArea>'));
  }
  ok(source.includes(`title="${title}" variant="danger" onPress={remove}`));
  ok(source.indexOf(`title="${title}"`) < source.lastIndexOf('</Screen>'));
}
const nav = readFileSync('src/navigation/AppNavigator.tsx', 'utf8');
ok(nav.includes('height: 62 + insets.bottom, paddingBottom: insets.bottom'));
ok(nav.includes('<Stack.Screen name="HotspotDetail"') && nav.includes('<Stack.Screen name="FindDetail"'));
const recordSource = readFileSync('src/screens/RecordScreen.tsx', 'utf8');
ok(recordSource.includes('<Screen style={{ paddingBottom: insets.bottom + spacing.xl }}>'));
ok(!recordSource.includes('bottomSafeArea'), 'existing Record bottom-inset ownership unchanged');
console.log('PASS actual Screen: base + live bottom inset once; zero/small/gesture/3-button/home-indicator values; custom design spacing; native auto-inset disabled only for opted-in scrolls; tabs/Record unchanged; final destructive CTA remains scrollable, >=44pt, same action. Native device verification still required.');
