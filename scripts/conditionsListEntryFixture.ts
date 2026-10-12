import ts from 'typescript';

/** Remove only the additive Razmere -> existing list navigation intent for legacy source pins. */
export function withoutConditionsListEntry(source: string) {
  const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const spans: Array<[number, number]> = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'consumedConditionsListRequest')
      || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
      && node.expression.arguments[0]?.getText(ast).includes('const intent = route.params?.conditionsListRequest')) spans.push([node.getFullStart(), node.end]);
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + source.slice(end);
  return withoutBottomMapTabEntry(source);
}

/** Strip exactly the targeted tabPress subscription and its compile-time navigation typing. */
export function withoutBottomMapTabEntry(source: string) {
  const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const spans: Array<[number, number]> = [];
  function visit(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
      && node.expression.arguments[0]?.getText(ast).includes("navigation.addListener('tabPress'")) spans.push([node.getFullStart(), node.end]);
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + source.slice(end);
  return source.replace(', type CompositeNavigationProp', '')
    .replace("import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';\n", '')
    .replace("useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabsParamList, 'Map'>, NativeStackNavigationProp<RootStackParamList>>>()", 'useNavigation<NativeStackNavigationProp<RootStackParamList>>()');
}
