/** Research only. Nothing under src/ imports this module. No network or persistent DB access. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SQLiteDatabase } from 'expo-sqlite';
import { HEATMAP_HABITAT, HEATMAP_PILOT_METADATA } from '../../src/domain/heatmap/regional';
import { HEATMAP_PROFILE_IDS, habitatStateFor } from '../../src/domain/heatmap/pilot';
import { assessHeatmapWeather } from '../../src/domain/heatmap/assessment';
import { CANONICAL_POINT_POLICY, evaluateSevenDayConditions, type SevenDaySnapshot, type SevenDayResult } from '../../src/domain/sevenDayConditions';
import { withCivilHourlyWeather, type HourlyFetchResult } from '../../src/services/sevenDayHourlyWeather';
import { shiftLocalDate } from '../../src/services/weather';
import { validWeatherDate } from '../../src/domain/weatherSeries';
import type { HeatmapHabitatState, HeatmapWeatherCellDefinition, HeatmapWeatherCellSource } from '../../src/domain/heatmap/types';
import type { MushroomWeatherProfileId, MushroomScoreComponent } from '../../src/domain/types';

export const REGIONAL_WEEK_CONTRACT = 'regional-civil-week-v1';
export const PILOT_BBOX = [14.65, 46.35, 15.05, 46.59] as const;
export const PROFILES = [...HEATMAP_PROFILE_IDS];
export const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data) ?? 'undefined').digest('hex');
export function selectPilot() {
  // Existing representative centres, inclusive bbox; retain WHOLE existing clipped polygons.
  const cells = HEATMAP_HABITAT.features.filter(({ properties: p }) => p.centerLongitude >= PILOT_BBOX[0]
    && p.centerLongitude <= PILOT_BBOX[2] && p.centerLatitude >= PILOT_BBOX[1] && p.centerLatitude <= PILOT_BBOX[3])
    .sort((a, b) => a.properties.id.localeCompare(b.properties.id, 'en'));
  const ids = new Set(cells.map(c => c.properties.weatherCellId));
  const weather = HEATMAP_PILOT_METADATA.weatherCells.filter(p => ids.has(p.id)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (!cells.length || cells.length > 700 || weather.length > 13 || weather.length !== ids.size
    || new Set(weather.map(p => `${p.latitude}:${p.longitude}`)).size !== weather.length) throw new Error('Invalid bounded pilot geometry/weather identities');
  return { cells, weather };
}
export interface FrozenLocation {
  definition: HeatmapWeatherCellDefinition;
  sources: HourlyFetchResult[];
}
export interface FrozenBatch {
  baseLocalDate: string;
  evidence: 'synthetic-fixture' | 'frozen-public-weather';
  locations: FrozenLocation[];
  sourceContract: string;
}
export interface WeatherVector {
  weatherIndex: number; profileId: MushroomWeatherProfileId; targetLocalDate: string;
  score: number | null; label: string | null; status: SevenDayResult['status'];
  factors: MushroomScoreComponent[]; componentsVerified: boolean; missing: string[];
  snapshotId: string; inputRef: number; canonicalReasons: string[];
}
export interface PrototypeDataset {
  schema: 'koroska-regional-week-artifact-v1'; researchOnly: true; evidence: FrozenBatch['evidence'];
  inputVersion: typeof REGIONAL_WEEK_CONTRACT; sourceContract: string; batchId: string;
  modelFingerprint: string; geometryFingerprint: string; baseLocalDate: string; dates: string[];
  profiles: MushroomWeatherProfileId[]; weather: HeatmapWeatherCellDefinition[];
  snapshotValidity: Array<{weatherIndex:number;assessmentAsOf:string;expiresAt:number;staleAtCapture:boolean}>;
  sourceManifest: Array<{ weatherId: string; endpoint: 'archive' | 'forecast'; status: 'fulfilled' | 'rejected';
    sha256: string | null; retrievedAt: string | null; stale: boolean; hourlyCount: number;
    firstEpoch: number | null; lastEpoch: number | null; units: Record<string,string>; requestedCoordinates: [number,number] }>;
  cells: Array<{ id: string; weatherIndex: number; habitat: HeatmapHabitatState[] }>;
  inputs: Array<{ weatherIndex: number; targetLocalDate: string; historical: Omit<NonNullable<SevenDayResult['inputs']['historical']>,'days'> | undefined;
    soil: SevenDayResult['targetSoil']; soilSampling: SevenDayResult['soilSampling']; provenance: SevenDayResult['provenance'];
    forecastRetrievedAt: string | null; archiveRetrievedAt: string | null; forecastIssuedAt: null; stale: boolean }>;
  vectors: WeatherVector[];
  attribution: string[];
}
export interface RegionalCellResult {
  cellId: string; weatherId: string; profileId: MushroomWeatherProfileId; targetLocalDate: string;
  score: number | null; weatherScore: number | null; label: string | null;
  availability: SevenDayResult['status'] | 'habitat_unknown' | 'outside_model';
  habitatState: HeatmapHabitatState; factors: MushroomScoreComponent[]; missing: string[];
  inputVersion: string; modelFingerprint: string; snapshotId: string;
  provenance: PrototypeDataset['inputs'][number];
}
export function cellResult(data: PrototypeDataset, cellIndex: number, profileIndex: number, day: number): RegionalCellResult {
  const cell = data.cells[cellIndex], profileId = data.profiles[profileIndex];
  if (!cell || !profileId || !Number.isInteger(day) || day < 0 || day > 6) throw new Error('Invalid cell/profile/date index');
  const vector = data.vectors[(cell.weatherIndex * 4 + profileIndex) * 7 + day], habitatState = cell.habitat[profileIndex];
  const publish = habitatState === 'candidate' && vector.score != null;
  return { cellId: cell.id, weatherId: data.weather[cell.weatherIndex].id, profileId, targetLocalDate: data.dates[day],
    score: publish ? vector.score : null, weatherScore: vector.score, label: publish ? vector.label : null,
    availability: habitatState === 'outside-model' ? 'outside_model' : habitatState === 'unknown' ? 'habitat_unknown' : vector.status,
    habitatState, factors: vector.componentsVerified ? vector.factors : [], missing: [...vector.missing,
      ...(habitatState === 'candidate' ? [] : [`Habitat: ${habitatState}; no numeric map publication.`])],
    inputVersion: data.inputVersion, modelFingerprint: data.modelFingerprint, snapshotId: vector.snapshotId, provenance: data.inputs[vector.inputRef] };
}
export async function buildPrototype(batch: FrozenBatch, modelFingerprint: string) {
  const start = performance.now(), pilot = selectPilot();
  batch=structuredClone(batch); // Isolate all seven evaluations from caller mutation during async assembly.
  if (!validWeatherDate(batch.baseLocalDate) || !['synthetic-fixture','frozen-public-weather'].includes(batch.evidence) || batch.locations.length !== pilot.weather.length)
    throw new Error('Invalid research batch/date/evidence');
  const identities = new Set(batch.locations.map(row => row.definition.id));
  if (identities.size !== pilot.weather.length) throw new Error('Duplicate/missing weather identity');
  // No invisible cross-vintage mixing. Endpoint retrieval times must be identical throughout this bounded batch.
  for (const endpoint of [0, 1]) {
    const times = new Set(batch.locations.flatMap(row => row.sources[endpoint]?.status === 'fulfilled' ? [row.sources[endpoint].value.fetchedAt] : []));
    if (times.size > 1) throw new Error('Mixed retrieval vintages; create separate coherent batches');
  }
  const batchId = digest(batch), inputs: PrototypeDataset['inputs'] = [], vectors: WeatherVector[] = [];
  const snapshots: SevenDaySnapshot[] = [], results: SevenDayResult[][] = [];
  let adapterMs = 0, evaluateMs = 0;
  for (const [weatherIndex, definition] of pilot.weather.entries()) {
    const source = batch.locations.find(row => row.definition.id === definition.id);
    if (!source || source.definition.latitude !== definition.latitude || source.definition.longitude !== definition.longitude
      || source.sources.length !== 2) throw new Error('Wrong exact public sampling coordinate/source pair');
    const time = source.sources.find(s => s.status === 'fulfilled')?.value.fetchedAt ?? `${batch.baseLocalDate}T12:00:00Z`;
    const empty: SevenDaySnapshot = { ...definition, baseLocalDate: batch.baseLocalDate, timezone: 'Europe/Ljubljana',
      today: { ...definition, source: 'open-meteo', stale: false, errors: {}, updatedAt: time },
      daily: [], dailyPeriods: {}, soilByDate: {}, forecastRetrievedAt: null, archiveRetrievedAt: null, forecastIssuedAt: null,
      snapshotId: `${REGIONAL_WEEK_CONTRACT}:${batchId}:${definition.id}`, assembledAt: time,
      expiresAt: Date.parse(time) + 1800000, stale: false, blockers: [] };
    const a = performance.now();
    const snapshot = await withCivilHourlyWeather({} as SQLiteDatabase, empty, undefined, source.sources);
    // These are the VALIDATED weather-domain gates, not a claim that the geographic cell is an exact point.
    snapshot.pointPolicyVersion = CANONICAL_POINT_POLICY;
    snapshot.today.inputPolicyVersion = CANONICAL_POINT_POLICY; snapshot.today.evaluationLocalDate = batch.baseLocalDate;
    snapshot.assembledAt = time; // Deterministic research artifact, NOT a fabricated provider initialization.
    delete snapshot.legacyDaily; delete snapshot.legacyToday;
    snapshots.push(snapshot); adapterMs += performance.now() - a;
    const b = performance.now();
    const perProfile = PROFILES.map(profile => evaluateSevenDayConditions(snapshot, profile));
    evaluateMs += performance.now() - b; results.push(perProfile.flat());
    for (let day = 0; day < 7; day++) {
      const reference = perProfile[0][day];
      // Inputs are profile-neutral aggregate VALUES. Profile-specific gates/results remain independent.
      if (perProfile.some(p => digest(p[day].inputs.historical) !== digest(reference.inputs.historical))) throw new Error('Unexpected profile-dependent weather aggregation');
      const compactHistorical=(historical:SevenDayResult['inputs']['historical'])=>{
        if(!historical)return undefined;const {days,...rollups}=historical;return rollups;
      };
      inputs.push({ weatherIndex, targetLocalDate: reference.targetLocalDate, historical: compactHistorical(reference.inputs.historical),
        soil: reference.targetSoil, soilSampling: reference.soilSampling, provenance: reference.provenance,
        forecastRetrievedAt: snapshot.forecastRetrievedAt, archiveRetrievedAt: snapshot.archiveRetrievedAt,
        forecastIssuedAt: null, stale: snapshot.stale });
    }
    for (const profile of perProfile) for (const result of profile) vectors.push({ weatherIndex, profileId: result.profileId,
      targetLocalDate: result.targetLocalDate, score: result.score, label: result.label, status: result.status,
      factors: result.canonical.components, componentsVerified: result.componentsVerified, missing: result.missing,
      snapshotId: result.snapshotId, inputRef: weatherIndex * 7 + result.horizonDay, canonicalReasons: result.canonical.reasons });
  }
  const joinStart = performance.now();
  const data: PrototypeDataset = { schema: 'koroska-regional-week-artifact-v1', researchOnly: true, evidence: batch.evidence,
    inputVersion: REGIONAL_WEEK_CONTRACT, sourceContract: batch.sourceContract, batchId, modelFingerprint,
    geometryFingerprint: digest(pilot.cells), baseLocalDate: batch.baseLocalDate,
    dates: Array.from({ length: 7 }, (_, day) => shiftLocalDate(batch.baseLocalDate, day)), profiles: PROFILES,
    weather: pilot.weather, snapshotValidity:snapshots.map((s,weatherIndex)=>({weatherIndex,assessmentAsOf:s.assembledAt,
      expiresAt:s.expiresAt,staleAtCapture:s.stale})), sourceManifest: batch.locations.flatMap(row => row.sources.map((source,index) => {
      const value=source.status==='fulfilled'?source.value:undefined, times=value?.data.hourly?.time;
      return {weatherId:row.definition.id,endpoint:index===0?'archive' as const:'forecast' as const,status:source.status,
        sha256:value?digest(value.data):null,retrievedAt:value?.fetchedAt??null,stale:value?.stale??false,
        hourlyCount:times?.length??0,firstEpoch:times?.[0]??null,lastEpoch:times?.at(-1)??null,
        units:value?.data.hourly_units??{},requestedCoordinates:[row.definition.latitude,row.definition.longitude] as [number,number]};
    })), cells: pilot.cells.map(cell => ({ id: cell.properties.id,
      weatherIndex: pilot.weather.findIndex(w => w.id === cell.properties.weatherCellId), habitat: PROFILES.map(p => habitatStateFor(cell, p)) })),
    inputs, vectors, attribution: ['ESA WorldCover 2021 v200 / modified Copernicus Sentinel data 2021; CC BY 4.0',
      'Zavod za gozdove Slovenije; existing repository stand aggregates', 'geoBoundaries / Wikipedia; pinned 2009 boundary',
      batch.evidence==='synthetic-fixture' ? 'Synthetic weather fixture, NOT a live Open-Meteo forecast or observed mushroom data'
        : 'Weather data by Open-Meteo.com / https://open-meteo.com / CC BY 4.0; modified into experimental suitability scores, NOT mushroom-find probabilities'] };
  const joinMs = performance.now() - joinStart;
  return { data, snapshots, results, metrics: { adapterMs, evaluateIncludingInputWindowsMs: evaluateMs, joinMs,
    totalBuildMs: performance.now() - start, hourlyLocationAdapters: snapshots.length, civilDailyAggregates: snapshots.reduce((n,s)=>n+s.daily.length,0),
    targetInputBuilds: snapshots.length * 28, scoreEvaluations: vectors.length, distinctStoredDateInputs: inputs.length,
    cellDateProfileEntries: data.cells.length * 28, naiveCellScoreEvaluations: data.cells.length * 28,
    note: 'Hourly daily aggregates and weather scores shared across cells; production target-window validation still runs independently per profile (not claimed deduplicated CPU).' } };
}

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    median: values.length ? (sorted[Math.floor((values.length - 1) / 2)] + sorted[Math.floor(values.length / 2)]) / 2 : null,
    min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}
export function compareLegacy(data: PrototypeDataset, legacy: Record<string, HeatmapWeatherCellSource>) {
  const comparisons = data.vectors.filter(v => v.targetLocalDate <= data.dates[1]).map(v => {
    const source = legacy[data.weather[v.weatherIndex].id];
    if (!source || source.latitude !== data.weather[v.weatherIndex].latitude || source.longitude !== data.weather[v.weatherIndex].longitude)
      throw new Error('Legacy comparison coordinate mismatch');
    const old = assessHeatmapWeather(source, v.profileId, v.targetLocalDate === data.dates[0] ? 'today' : 'tomorrow');
    const oldScore = old.dataQuality === 'insufficient' ? null : old.score.score ?? null;
    const historical = data.inputs[v.inputRef].historical;
    const keys = [...new Set([...Object.keys(historical ?? {}), ...Object.keys(old.summary.historical ?? {})])].filter(key=>key!=='days');
    const inputs = keys.flatMap(key => {
      const a = (historical as Record<string, unknown> | undefined)?.[key], b = (old.summary.historical as Record<string, unknown> | undefined)?.[key];
      return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ key, experimental: a ?? null, legacy: b ?? null }];
    });
    const factorDeltas = v.factors.map(f => { const previous = old.score.components.find(p => p.key === f.key);
      return { key: f.key, experimental: f.weightedPoints, legacy: previous?.weightedPoints ?? null,
        delta: previous ? f.weightedPoints - previous.weightedPoints : null, weight: f.weight, legacyWeight: previous?.weight ?? null }; });
    const experimentalSoil=data.inputs[v.inputRef].soil, legacySoil=v.targetLocalDate===data.dates[0]?source.currentSoil:source.tomorrowMorningSoil;
    const soilChanged=digest(experimentalSoil)!==digest(legacySoil);
    return { weatherId: source.id, profile: v.profileId, date: v.targetLocalDate, experimental: v.score, legacy: oldScore,
      delta: v.score != null && oldScore != null ? v.score - oldScore : null,
      categoryChanged: v.label != null && oldScore != null ? v.label !== old.score.label : null,
      availabilityChanged: (v.score == null) !== (oldScore == null), inputs,
      soilChanged,soil:{experimental:experimentalSoil??null,legacy:legacySoil??null},
      cause:inputs.length||soilChanged?'deliberate_input_policy_difference':'identical_input_values',
      factorDeltas, sameCoordinates: true, evidence: 'same frozen hourly field; legacy fixed-offset daily bins reconstructed, not live provider daily-product parity' };
  });
  const deltas = comparisons.flatMap(c => c.delta == null ? [] : [c.delta]);
  const cellWeighted = data.cells.flatMap(cell => comparisons.filter(c => c.weatherId === data.weather[cell.weatherIndex].id));
  const candidateWeighted = data.cells.flatMap(cell => comparisons.filter(c => c.weatherId === data.weather[cell.weatherIndex].id
    && cell.habitat[data.profiles.indexOf(c.profile)] === 'candidate'));
  const summary = (rows: typeof comparisons) => ({ cases: rows.length, comparable: rows.filter(c => c.delta != null).length,
    exact: rows.filter(c => c.delta === 0).length, different: rows.filter(c => c.delta != null && c.delta !== 0).length,
    categoryChanges: rows.filter(c => c.categoryChanged).length, availabilityChanges: rows.filter(c => c.availabilityChanged).length,
    absoluteDelta: distribution(rows.flatMap(c => c.delta == null ? [] : [Math.abs(c.delta)])),
    deltaHistogram: Object.fromEntries([...new Set(rows.flatMap(c => c.delta == null ? [] : [c.delta]))].sort((a,b) => a-b).map(d => [d, rows.filter(c => c.delta === d).length])) });
  return { methodology: 'Production getHeatmapWeatherBatch + assessHeatmapWeather; identical public coordinates and frozen source field. Legacy daily bins reconstructed with explicit base-date fixed offset. No live provider daily-product equality claimed.',
    weatherSummary: summary(comparisons), cellWeightedSummary: summary(cellWeighted), candidateWeightedSummary:summary(candidateWeighted),
    byProfileDate:data.profiles.flatMap(profile=>data.dates.slice(0,2).map(date=>({profile,date,...summary(comparisons.filter(c=>c.profile===profile&&c.date===date))}))),
    signedDelta: distribution(deltas), comparisons };
}
