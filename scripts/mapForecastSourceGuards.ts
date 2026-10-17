import { withoutPointDiagnostics } from './pointRefreshSourceGuards';
/** Strip only the declared map forecast presentation/selection additions for older full-source guards.
 * mapForecastSmoke independently exercises those actual handlers; canonical services stay byte-pinned. */
export function withoutMapForecast(text: string): string {
  let s = withoutMapForecastUx(text);
  s = s.replace(/^import .* from '..\/(components\/(SevenDayMapForecast|SevenDayConditionsView)|domain\/mapForecast)';\n/gm, '')
    .replace('  const [mapForecast, setMapForecast] = useState<MapForecastRequest>();\n', '');
  const start = s.indexOf('  const forecastEnvironment =');
  if (start >= 0) s = s.slice(0, start) + s.slice(s.indexOf('  const heatmapProfileId', start));
  const resolver = s.indexOf('  const selectedForecastLocation =');
  if (resolver >= 0) s = s.slice(0, resolver) + s.slice(s.indexOf('\n\n', resolver) + 1);
  s = s.replace(/^    closeMapForecast\(\);\n/gm, '').replace(/^          closeMapForecast\(\);\n/gm, '').replace(/^            closeMapForecast\(\);\n/gm, '')
    .replace('attributionPosition={currentMapForecast ? { top: spacing.sm, right: spacing.sm } : { bottom: spacing.sm, left: spacing.sm }}', 'attributionPosition={{ bottom: spacing.sm, left: spacing.sm }}')
    .replace('(!heatmapEnabled && !currentMapForecast)', '!heatmapEnabled')
    .replace(/      if \(currentMapForecast\) \{\n[\s\S]*?        return true;\n      \}\n/, '')
    .replace(', topThreeVisible, currentMapForecast]', ', topThreeVisible]')
    .replace("<View style={styles.mapModeRow}><View style={styles.mapModeSwitch}", '<View style={styles.mapModeSwitch}')
    .replace('<\/View><MapForecastEntry onPress={openMapForecast} expanded={Boolean(currentMapForecast)} /><\/View>', '</View>')
    .replace("onPress={() => { closeMapForecast(); graphMapPoint.current = undefined; updateHeatmapNavigation({ enabled: false }); }}", 'onPress={() => updateHeatmapNavigation({ enabled: false })}')
    .replace('            graphMapPoint.current = undefined;\n', '')
    .replace('        onPress={(event) => {\n          if (Date.now() <= suppressMapPressUntil.current)', '        onPress={() => {\n          if (Date.now() <= suppressMapPressUntil.current)');
  s = s.replace(/^(\s*)if \(currentMapForecast\?\.phase === 'picking'\) \{\n[\s\S]*?^\1\}\n/gm, '')
    .replace(/        \{currentMapForecast\?\.location\?\.source === 'map-point'[\s\S]*?        <\/Marker> : null\}\n/, '')
    .replace("          const pickingForecast = currentMapForecast?.phase === 'picking';\n", '')
    .replace(/          if \(pickingForecast\) showPointForecast\([^\n]*\n[^\n]*\n/, '')
    .replace(/      <View pointerEvents=\{currentMapForecast[^\n]*\n[^\n]*\n/, '')
    .replace('          forecastAction={<MapForecastEntry compact onPress={openMapForecast} />}\n', '')
    .replace('        onOpenForecast={openMapForecast}\n', '');
  const preview = s.indexOf("      </View>\n      {currentMapForecast?.phase === 'picking'");
  if (preview >= 0) s = s.slice(0, preview) + s.slice(s.indexOf("    </View>{mode === 'list'", preview));
  s = s.replace(/    \{currentMapForecast\?\.phase === 'full'[\s\S]*?onClose=\{[^\n]*\n/, '')
    .replace(', onOpenConditions, onOpenForecast }', ', onOpenConditions }').replace('; onOpenForecast?: () => void', '')
    .replace('      {onOpenForecast ? <MapForecastEntry onPress={() => { cancelSectionScroll(); onOpenForecast(); }} /> : null}\n', '')
    .replace(/  mapModeRow: \{[^\n]*\n  forecastOccluded: \{[^\n]*\n/, '')
    .replace("mapModeSwitch: { flex: 1, minWidth: 170, flexDirection:", 'mapModeSwitch: { flexDirection:')
    .replace('mapModeText: { flexShrink: 1, color:', 'mapModeText: { color:');
  return s;
}

export function withoutForecastModalInputs(text: string): string {
  return text.replace(/\r\n/g, '\n')
    .replaceAll(', selectedDate, onSelectDate }', ' }')
    .replaceAll('  selectedDate?: string; onSelectDate?: (index: number, date: string) => void;\n', '')
    .replace(' selectedDate={selectedDate} onSelectDate={onSelectDate}', '')
    .replace('week.results?.find(day => day.targetLocalDate === selectedDate) ?? week.results?.[selectedIndex]', 'week.results?.[selectedIndex]')
    .replaceAll('selected === day', 'selectedIndex === index')
    .replace('() => { setSelectedIndex(index); onSelectDate?.(index, day.targetLocalDate); }', '() => setSelectedIndex(index)')
    .replace("export interface SevenDayLocation { latitude: number; longitude: number; name: string; source?: 'conditions' | 'map-point' | 'hotspot' }", 'interface Location { latitude: number; longitude: number; name: string }')
    .replaceAll('location?: SevenDayLocation', 'location?: Location').replaceAll('location: SevenDayLocation', 'location: Location')
    .replaceAll(', initialDay = 0 }', ' }').replaceAll('; initialDay?: number', '')
    .replace(' onSnapshot={onSnapshot} initialDay={initialDay}', ' onSnapshot={onSnapshot}')
    .replace('useState(Number.isInteger(initialDay) && initialDay >= 0 && initialDay <= 6 ? initialDay : 0)', 'useState(0)');
}

/** V1.1 allowlist: only forecast request presentation callbacks, not native map or data effects. */
export function withoutMapForecastUx(text: string): string {
  return withoutCompactMapForecast(text)
    .replace("currentMapForecast.phase === 'full' || currentMapForecast.phase === 'graphs'", "currentMapForecast.phase === 'full'")
    .replace(/          selectedDate=\{currentMapForecast.selectedDate\}[^\n]*\n/, '')
    .replace(/          onSelectDate=\{[^\n]*\n          onWeatherGraphs=\{[^\n]*\n          onHotspotDetail=\{[^\n]*\n          onSavePoint=\{[\s\S]*?          \} : undefined\}\n/, '')
    .replace(/          onFull=\{\(day, date\)[^\n]*/, "          onFull={day => setMapForecast(previous => previous && ({ ...previous, phase: 'full', initialDay: day }))} />")
    .replace('      selectedDate={currentMapForecast.selectedDate}\n', '')
    .replace(/      onSelectDate=\{[^\n]*\n/, '')
    .replace(/    \{currentMapForecast\?\.phase === 'graphs'[^\n]*\n[^\n]*\n/, '');
}

/** V1.2 allowlist. Its actual header/search handlers and panel sizing are exercised separately. */
export function withoutCompactMapForecast(text: string): string {
  let s = withoutPointDiagnostics('src/screens/MapScreen.tsx', text)
    .replace('<Screen scroll={false} topSafeArea style={styles.screen}>', '<Screen scroll={false} style={styles.screen}>')
    .replace('attributionPosition={currentMapForecast ? { top: spacing.sm, left: spacing.sm }', 'attributionPosition={currentMapForecast ? { top: spacing.sm, right: spacing.sm }')
    .replace('      <Pressable accessibilityRole="button" accessibilityLabel="Prikaži mojo lokacijo" onPress={() => void recenter()} style={styles.recenter}><Ionicons name="locate" size={25} color={colors.primary} /></Pressable>\n', '')
    .replace("importantForAccessibility={currentMapForecast ? 'no-hide-descendants' : 'auto'} style={[StyleSheet.absoluteFill, currentMapForecast && styles.forecastOccluded]}>\n",
      match => match + (text.includes('accessibilityRole="button" accessibilityLabel="Prikaži mojo lokacijo"') ? '      <Pressable accessibilityLabel="Prikaži mojo lokacijo" onPress={() => void recenter()} style={styles.recenter}><Ionicons name="locate" size={25} color={colors.primary} /></Pressable>\n' : ''))
    .replace("import { compactMapForecastHeight } from '../components/mapForecastPresentation';\n", '')
    .replace("  const [mapSearchExpanded, setMapSearchExpanded] = useState(false);\n", '')
    .replace(/^    setMapSearchExpanded\(false\);\n/gm, '')
    .replace(/  const mapSearchVisible =[^\n]*\n  const toggleMapSearch = \(\) => \{[\s\S]*?\n  \};\n/, '');
  const header = s.indexOf('    <View style={[styles.header,');
  if (header >= 0) s = s.slice(0, header) + `    <View style={styles.header}>
      <View><Text style={commonStyles.title}>Rastišča</Text><Text style={commonStyles.muted}>{hotspots.length} shranjenih lokacij</Text></View>
      <View style={commonStyles.row}><Chip label="Zemljevid" selected={mode === 'map'} onPress={() => switchHotspotView('map')} /><Chip label="Seznam" selected={mode === 'list'} onPress={() => switchHotspotView('list')} /></View>
    </View>
` + s.slice(s.indexOf('    <View style={styles.controls}>', header));
  return s.replace(/      \{mapSearchVisible && !currentMapForecast \? <Field([^\n]*) autoFocus=\{mode === 'map'\} \/> : null\}/,
      '      <Field$1 />')
    .replace('{searchOpen && !currentMapForecast ? <View', '{searchOpen ? <View')
    .replace('maxHeight={compactMapForecastHeight(mapViewportHeight, spacing.lg)} onClose={closeMapForecast}',
      'maxHeight={topThreePanelMaxHeight(mapViewportHeight, 0, spacing.lg, spacing.sm, HOTSPOT_MARKER_HEIGHT)} onClose={closeMapForecast}')
    .replace(/  compactHeader: \{[^\n]*\n  mapSearchButton: \{[^\n]*\n/, '');
}
