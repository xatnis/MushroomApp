import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withoutMapForecast, withoutForecastModalInputs } from './mapForecastSourceGuards';
import { withoutPointDiagnostics } from './pointRefreshSourceGuards';

/** Exact informational UI additions only; pointHabitatSmoke executes them and pins the remaining view to 6c54e0a. */
export function withoutPointHabitatUi(text: string) {
  return text.replace(/\r\n/g, '\n')
    .replace("import { PointHabitatContext } from './PointHabitatContext';\n", '')
    .replace('    {!week.results ? <PointHabitatContext latitude={location.latitude} longitude={location.longitude} profileId={profileId} /> : null}\n', '')
    .replace('        <PointHabitatContext latitude={location.latitude} longitude={location.longitude} profileId={profileId} />\n', '')
    .replace('        {showDates ? <PointHabitatContext compact latitude={location.latitude} longitude={location.longitude} profileId={profileId} /> : null}\n', '')
    .replace('`Vremenski pogoji: ${selected.score}/100 · ${selected.label}`', '`${selected.score}/100 · ${selected.label}`');
}

/** Permit ONLY the explicitly tested V1.3 point wiring, never changes to native sources/camera/regional scorers. */
export function withoutPointMigration(path: string, text: string): string {
  let source = withoutPointDiagnostics(path, text).replace('export async function cachedFetch<T>', 'async function cachedFetch<T>');
  if (path === 'src/components/SevenDayConditionsView.tsx') source = withoutForecastModalInputs(withoutPointHabitatUi(source));
  if (path === 'src/screens/MapScreen.tsx') {
    source = withoutMapForecast(source);
    source = source.replace("import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../domain/mushroomWeather';", "import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';")
      .replace("import { useLocationConditions } from '../services/heatmap/useLocationConditions';\n", '')
      .replace('assessment: regionalAssessment, graphLocation, weatherPending: regionalWeatherPending', 'assessment, graphLocation, weatherPending');
    source = source.replace("{assessment.inputPolicyVersion ? 'Point poizvedba za izbrano koordinato; ločljivost modelske mreže določa ponudnik.' : `Vremensko vzorčenje: ${assessment.weatherSamplingResolutionM / 1000} km`}", 'Vremensko vzorčenje: {assessment.weatherSamplingResolutionM / 1000} km');
    const start = source.indexOf('  const point = useLocationConditions([{ id: regionalAssessment.areaId');
    if (start >= 0) source = source.slice(0, start) + source.slice(source.indexOf('  const [detailsExpanded', start));
    source = source.replace(/          setExploreLocation\(\{ \.\.\.areaLocation,\n            latitude: graphMapPoint[^\n]*\n            longitude: graphMapPoint[^\n]*\n            source: 'heatmap' \}\);/, "          setExploreLocation({ ...areaLocation, source: 'heatmap' });");
  }
  if (path === 'src/domain/locationConditions.ts') {
    source = source.replace("import { pointResults, pointLocationKey } from '../services/pointConditions';\n", '')
      .replace("import { CANONICAL_POINT_POLICY, type SevenDaySnapshot } from './sevenDayConditions';\n", '')
      .replace('export function legacyConditionsForLocation', 'export function conditionsForLocation');
    const start = source.indexOf('/** Exact-coordinate point contract.');
    if (start >= 0) source = source.slice(0, start) + source.slice(source.indexOf('/** Save only a ready assessment', start));
    source = source.replace('inputPolicyVersion: assessment.inputPolicyVersion ?? HEATMAP_WEATHER_POLICY_VERSION', 'inputPolicyVersion: HEATMAP_WEATHER_POLICY_VERSION')
      .replace('    weatherSnapshotId: assessment.weatherSnapshotId, soilSampling: assessment.soilSampling,\n', '')
      .replace('weatherPointId: assessment.inputPolicyVersion ? assessment.weatherCellId : mapping.weatherPoint.id,\n      samplingLatitude: assessment.inputPolicyVersion ? mapping.latitude : mapping.weatherPoint.latitude,\n      samplingLongitude: assessment.inputPolicyVersion ? mapping.longitude : mapping.weatherPoint.longitude',
        'weatherPointId: mapping.weatherPoint.id, samplingLatitude: mapping.weatherPoint.latitude, samplingLongitude: mapping.weatherPoint.longitude');
  }
  return source;
}
export function assertPointMigrationAwareSource(path: string, baseline: string) {
  const source = readFileSync(path, 'utf8');
  if (path === 'src/services/heatmap/useLocationConditions.ts') {
    // This exact acquisition hook IS migrated, with runtime generation/cache tests in locationConditionsHookSmoke.
    ok(source.includes('loadPointSnapshots(db, mappings, baseDate)'));
    ok(source.includes('generation.current === loadKey'));
    ok(!source.includes('loadHeatmapPilot(') && !source.includes('cachedHeatmapBundle('));
    ok(source.includes('[db, key, baseDate, active, attempt, foreground, debounceMs]'));
    return;
  }
  strictEqual(withoutPointMigration(path, source), execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path);
}
