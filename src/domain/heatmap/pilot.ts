import habitatArtifact from '../../data/heatmapPilot/habitat.geojson.json';
import metadataArtifact from '../../data/heatmapPilot/metadata.json';
import zgsArtifact from '../../data/heatmapPilot/zgs-enrichment.json';
import { boletusHabitatState, chanterelleHabitatState, lactariusHabitatState } from './zgs';
import type { MushroomWeatherProfileId } from '../types';
import type {
  HeatmapAreaAssessment,
  HeatmapHabitatFeature,
  HeatmapHabitatFeatureCollection,
  HeatmapHabitatState,
  HeatmapPilotMetadata,
  HeatmapRenderFeatureCollection,
  HeatmapTargetDay,
  HeatmapWeatherAssessment,
  ZgsEnrichmentArtifact,
} from './types';
import {
  HEATMAP_WEATHER_POLICY_VERSION,
  PILOT_MIN_TREE_COVER_FRACTION,
  PILOT_MIN_VEGETATION_FRACTION,
} from './config';

export { HEATMAP_WEATHER_POLICY_VERSION, PILOT_MIN_TREE_COVER_FRACTION, PILOT_MIN_VEGETATION_FRACTION } from './config';

export const HEATMAP_PILOT_METADATA = metadataArtifact as HeatmapPilotMetadata;
export const ZGS_ENRICHMENT = zgsArtifact as ZgsEnrichmentArtifact;
export const HEATMAP_HABITAT: HeatmapHabitatFeatureCollection = {
  ...(habitatArtifact as HeatmapHabitatFeatureCollection),
  features: (habitatArtifact as HeatmapHabitatFeatureCollection).features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, zgs: ZGS_ENRICHMENT.schemaVersion === 1
      && ZGS_ENRICHMENT.pilotId === HEATMAP_PILOT_METADATA.pilotId
      ? ZGS_ENRICHMENT.areas[feature.properties.id] : undefined },
  })),
};

export const HEATMAP_PROFILE_IDS: MushroomWeatherProfileId[] = [
  'generic',
  'boletusEdulis',
  'cantharellusCibarius',
  'lactariusDeliciosus',
];

export const HEATMAP_TARGET_DAYS: HeatmapTargetDay[] = ['today', 'tomorrow'];

export function habitatStateFor(
  feature: HeatmapHabitatFeature,
  profileId: MushroomWeatherProfileId,
): HeatmapHabitatState {
  const { treeCoverFraction, grasslandFraction } = feature.properties;
  const wooded = treeCoverFraction >= PILOT_MIN_TREE_COVER_FRACTION;
  if (profileId === 'generic') {
    return treeCoverFraction + grasslandFraction >= PILOT_MIN_VEGETATION_FRACTION
      ? 'candidate'
      : 'outside-model';
  }
  if (profileId === 'lactariusDeliciosus') {
    return lactariusHabitatState(wooded, feature.properties.zgs);
  }
  if (profileId === 'boletusEdulis') return boletusHabitatState(wooded, feature.properties.zgs);
  if (profileId === 'cantharellusCibarius') return chanterelleHabitatState(wooded, feature.properties.zgs);
  return wooded ? 'candidate' : 'outside-model';
}

export function habitatExplanation(profileId: MushroomWeatherProfileId, state: HeatmapHabitatState, zgsAvailable = false): string {
  if (state === 'outside-model') return 'Območje nima dovolj ustreznega vegetacijskega oziroma drevesnega pokrova za habitatni model.';
  if (profileId === 'lactariusDeliciosus') {
    if (state === 'candidate') return 'ZGS podatki potrjujejo prisotnost bora v delu območja.';
    return zgsAvailable
      ? 'Območje je gozdnato, vendar ni dovolj podatkov za zanesljivo potrditev bora.'
      : 'Za to območje ni dovolj podatkov o drevesni sestavi.';
  }
  if (profileId === 'generic') return 'Območje ima dovolj vegetacijskega pokrova za splošno vremensko oceno.';
  if (profileId === 'cantharellusCibarius' && state === 'candidate') return 'ZGS podatki potrjujejo prisotnost drevesnih skupin, s katerimi je navadna lisička lahko mikorizno povezana.';
  if (state === 'candidate') return 'ZGS podatki potrjujejo prisotnost drevesnih skupin, s katerimi je jesenski goban pogosto povezan.';
  return zgsAvailable
    ? 'Območje je gozdnato, vendar podatki o drevesni sestavi niso dovolj popolni za zanesljivo habitatno oceno.'
    : 'Za to območje ni dovolj podatkov o drevesni sestavi.';
}

export function renderStateFor(assessment: HeatmapAreaAssessment): HeatmapRenderFeatureCollection['features'][number]['properties']['renderState'] {
  if (assessment.habitatState === 'unknown') return 'unknown';
  if (assessment.habitatState === 'outside-model') return 'outside';
  if (assessment.dataQuality === 'insufficient' || assessment.score == null) return 'insufficient';
  if (assessment.dataQuality === 'limited') return 'limited';
  if (assessment.classLabel === 'Odlične razmere') return 'excellent';
  if (assessment.classLabel === 'Zelo dobre razmere') return 'very-good';
  if (assessment.classLabel === 'Dobre razmere') return 'good';
  if (assessment.classLabel === 'Povprečne razmere') return 'average';
  return 'poor';
}

export function areaAssessmentFor(
  feature: HeatmapHabitatFeature,
  weather: HeatmapWeatherAssessment,
): HeatmapAreaAssessment {
  const habitatState = habitatStateFor(feature, weather.speciesId);
  return {
    areaId: feature.properties.id,
    weatherCellId: feature.properties.weatherCellId,
    speciesId: weather.speciesId,
    targetDay: weather.targetDay,
    targetLocalDate: weather.targetLocalDate,
    score: weather.dataQuality === 'insufficient' ? null : weather.score.score ?? null,
    classLabel: weather.dataQuality === 'insufficient' ? 'Ni dovolj podatkov' : weather.score.label,
    dataQuality: weather.dataQuality,
    habitatState,
    scoreDetails: weather.score,
    summary: weather.summary,
    limitations: [habitatExplanation(weather.speciesId, habitatState, feature.properties.zgs?.zgsAvailable), ...weather.limitations],
    sourceAge: weather.summary.stale ? 'predpomnjeni podatki' : 'sveži podatki',
    fetchedAt: weather.summary.updatedAt,
    weatherSamplingResolutionM: HEATMAP_PILOT_METADATA.weatherSamplingSpacingM,
    habitatSource: HEATMAP_PILOT_METADATA.worldCover.dataset,
    habitatSourceVintage: HEATMAP_PILOT_METADATA.worldCover.version,
    modelledHistoryDays: weather.modelledHistoryDays,
    treeCompositionSource: feature.properties.zgs?.zgsAvailable ? ZGS_ENRICHMENT.source : undefined,
    treeCompositionFetchedAt: feature.properties.zgs?.zgsAvailable ? ZGS_ENRICHMENT.fetchedAt : undefined,
  };
}

export function buildHeatmapRenderCollection(
  weatherByCell: Record<string, HeatmapWeatherAssessment>,
  selectedAreaId?: string,
): { collection: HeatmapRenderFeatureCollection; assessments: Record<string, HeatmapAreaAssessment> } {
  const assessments: Record<string, HeatmapAreaAssessment> = {};
  const features = HEATMAP_HABITAT.features.map((feature) => {
    const weather = weatherByCell[feature.properties.weatherCellId];
    if (!weather) throw new Error(`Manjka vremenska celica ${feature.properties.weatherCellId}.`);
    const assessment = areaAssessmentFor(feature, weather);
    assessments[feature.properties.id] = assessment;
    // Composition stays in the static domain index, not in every MapLibre source update.
    const { zgs: _zgs, ...renderProperties } = feature.properties;
    return {
      ...feature,
      properties: {
        ...renderProperties,
        score: assessment.score ?? -1,
        scoreLabel: assessment.classLabel,
        renderState: renderStateFor(assessment),
        dataQuality: assessment.dataQuality,
        habitatState: assessment.habitatState,
        selected: feature.properties.id === selectedAreaId,
      },
    };
  });
  return { collection: { type: 'FeatureCollection', features }, assessments };
}
