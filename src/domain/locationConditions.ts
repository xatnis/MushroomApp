import type { FindItem, FindRecord, ConditionsSnapshot, MushroomWeatherProfileId } from './types';
import type { HeatmapAreaAssessment, HeatmapHabitatFeature, HeatmapTargetDay, HeatmapWeatherCellDefinition } from './heatmap/types';
import { HEATMAP_PILOT_METADATA, REGIONAL_INDEX, regionalAreaAssessmentFor } from './heatmap/regional';
import { MUSHROOM_WEATHER_PROFILES, MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG,
  CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG } from './mushroomWeather';
import { localDateFor } from './heatmap/assessment';
import { HEATMAP_WEATHER_POLICY_VERSION } from './heatmap/config';
import { weatherAssessmentsFor, type HeatmapPilotBundle } from '../services/heatmap/pilotHeatmap';

export interface ConditionsLocation {
  id: string;
  latitude: number;
  longitude: number;
}
export interface ConditionsLocationMapping extends ConditionsLocation {
  feature?: HeatmapHabitatFeature;
  weatherPoint: HeatmapWeatherCellDefinition;
}
export function validConditionsLocation(location: ConditionsLocation): boolean {
  return Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}

/** Exact catalogue IDs only: a group/custom species never acquires an invented species scorer. */
export function conditionsProfileForItems(items: Pick<FindItem, 'speciesId' | 'customName'>[]): MushroomWeatherProfileId {
  const match = items.find(item => !item.customName && Object.values(MUSHROOM_WEATHER_PROFILES)
    .some(profile => profile.speciesId && profile.speciesId === item.speciesId));
  return Object.values(MUSHROOM_WEATHER_PROFILES).find(profile => match && profile.speciesId && profile.speciesId === match.speciesId)?.id ?? 'generic';
}
export function initialHotspotProfile(finds: FindRecord[]): MushroomWeatherProfileId {
  // Prefer the latest visit that identifies a supported species; never modify the diary.
  for (const find of [...finds].sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    const profile = conditionsProfileForItems(find.items);
    if (profile !== 'generic') return profile;
  }
  return 'generic';
}
export function mapConditionsLocation(location: ConditionsLocation): ConditionsLocationMapping {
  if (!validConditionsLocation(location)) throw new Error('Neveljavna lokacija.');
  const feature = REGIONAL_INDEX.atPoint([location.longitude, location.latitude]);
  const weatherPoint = feature && HEATMAP_PILOT_METADATA.weatherCells.find(p => p.id === feature.properties.weatherCellId);
  return { ...location, feature, weatherPoint: weatherPoint ?? {
    // Outside prepared habitat: query the saved coordinate, not a distant regional centre.
    // ID includes exact public-to-provider coordinate; no coordinate is logged.
    id: `location-${location.latitude}-${location.longitude}`, latitude: location.latitude, longitude: location.longitude,
    projectedX: 0, projectedY: 0,
  } };
}

/** Same point/profile/day/source => same production assessment. No transport or rendering side effects. */
export function conditionsForLocation(mapping: ConditionsLocationMapping, bundle: HeatmapPilotBundle | undefined,
  profile: MushroomWeatherProfileId, day: HeatmapTargetDay, baseLocalDate = localDateFor()): HeatmapAreaAssessment | undefined {
  if (!bundle || bundle.baseLocalDate !== baseLocalDate) return undefined;
  const weather = weatherAssessmentsFor(bundle, profile, day)[mapping.weatherPoint.id];
  if (!weather) return undefined;
  if (mapping.feature) return regionalAreaAssessmentFor(mapping.feature, weather);
  return { areaId: mapping.id, weatherCellId: weather.weatherCellId, speciesId: profile, targetDay: day,
    targetLocalDate: weather.targetLocalDate, score: weather.dataQuality === 'insufficient' ? null : weather.score.score ?? null,
    classLabel: weather.score.label, dataQuality: weather.dataQuality, habitatState: 'unknown', scoreDetails: weather.score,
    summary: weather.summary, limitations: ['Za to lokacijo habitatni podatki še niso pripravljeni.', ...weather.limitations],
    sourceAge: weather.summary.stale ? 'Zastarel predpomnilnik' : 'Sveži podatki', fetchedAt: weather.summary.updatedAt,
    weatherSamplingResolutionM: 0, habitatSource: 'Ni podatkov za to lokacijo', habitatSourceVintage: '',
    modelledHistoryDays: weather.modelledHistoryDays };
}

/** Save only a ready assessment for the actual visit day. Never backfill old visits from today's forecast. */
export function createConditionsSnapshot(mapping: ConditionsLocationMapping, assessment: HeatmapAreaAssessment | undefined,
  observedAt: string, recordedAt = new Date().toISOString()): ConditionsSnapshot | undefined {
  if (!assessment || assessment.score == null || assessment.dataQuality === 'insufficient'
    || !Number.isFinite(Date.parse(observedAt)) || assessment.targetLocalDate !== localDateFor(new Date(observedAt))) return undefined;
  const h = assessment.summary.historical;
  if (!h) return undefined;
  const { days: _days, ...weather } = h;
  // JSON copy isolates the immutable diary value from mutable live cache/UI objects.
  return JSON.parse(JSON.stringify({ schemaVersion: 1, recordedAt, evaluatedLocalDate: assessment.targetLocalDate,
    observedAt, targetProfile: assessment.speciesId, dayMode: assessment.targetDay, score: assessment.score,
    label: assessment.classLabel, scorerId: assessment.speciesId,
    scorerVersion: assessment.speciesId === 'generic' ? 'generic-v2' : 'species-v1',
    scorerConfig: { generic: MUSHROOM_SCORE_V1_CONFIG, boletusEdulis: BOLETUS_EDULIS_SCORE_V1_CONFIG,
      cantharellusCibarius: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, lactariusDeliciosus: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG }[assessment.speciesId],
    inputPolicyVersion: HEATMAP_WEATHER_POLICY_VERSION,
    location: { latitude: mapping.latitude, longitude: mapping.longitude, areaId: mapping.feature?.properties.id,
      weatherPointId: mapping.weatherPoint.id, samplingLatitude: mapping.weatherPoint.latitude, samplingLongitude: mapping.weatherPoint.longitude },
    weather: { ...weather, soilMoisture0To7Cm: assessment.summary.current?.soilMoisture0To7Cm,
      soilMoisture7To28Cm: assessment.summary.current?.soilMoisture7To28Cm, soilTime: assessment.summary.current?.time },
    normalizedComponents: assessment.scoreDetails.components, habitat: { classification: assessment.habitatState,
      properties: mapping.feature?.properties, source: assessment.habitatSource, vintage: assessment.habitatSourceVintage,
      treeCompositionSource: assessment.treeCompositionSource, treeCompositionFetchedAt: assessment.treeCompositionFetchedAt },
    inputCompleteness: assessment.dataQuality, modelledHistoryDays: assessment.modelledHistoryDays,
    weatherSource: assessment.summary.source, weatherFetchedAt: assessment.fetchedAt, stale: assessment.summary.stale,
  })) as ConditionsSnapshot;
}
