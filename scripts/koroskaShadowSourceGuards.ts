/** Only this declared opt-in integration is removed for older production-source pins.
 * koroskaShadowMapSmoke executes its active/disabled handlers; models/services remain pinned. */
export function withoutKoroskaShadow(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/^.*KOROSKA_SHADOW_BEGIN.*\n[\s\S]*?^.*KOROSKA_SHADOW_END.*\n/gm, '')
    .replaceAll(', shadow.active]', ']')
    .replace('(!heatmapEnabled && !currentMapForecast && !shadow.active)', '(!heatmapEnabled && !currentMapForecast)')
    .replace("<View style={[styles.controls, shadow.active && { display: 'none' }]}>", '<View style={styles.controls}>')
    .replaceAll('!shadow.active && visual.', 'visual.')
    .replace('visible={(!heatmapEnabled || showMyHotspots) && !shadow.active}', 'visible={!heatmapEnabled || showMyHotspots}')
    .replaceAll('currentMapForecast || shadow.active', 'currentMapForecast')
    .replace('(currentMapForecast) && styles.forecastOccluded', 'currentMapForecast && styles.forecastOccluded');
}
