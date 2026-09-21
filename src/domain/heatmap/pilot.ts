import habitatArtifact from '../../data/heatmapPilot/habitat.geojson.json';
import metadataArtifact from '../../data/heatmapPilot/metadata.json';
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
} from './types';
import {
  HEATMAP_WEATHER_POLICY_VERSION,
  PILOT_MIN_TREE_COVER_FRACTION,
  PILOT_MIN_VEGETATION_FRACTION,
} from './config';

export { HEATMAP_WEATHER_POLICY_VERSION, PILOT_MIN_TREE_COVER_FRACTION, PILOT_MIN_VEGETATION_FRACTION } from './config';

export const HEATMAP_PILOT_METADATA = metadataArtifact as HeatmapPilotMetadata;
export const HEATMAP_HABITAT = habitatArtifact as HeatmapHabitatFeatureCollection;

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
    // WorldCover tree cover does not identify pine. Without verified tree-species
    // data the honest state is unknown, never candidate.
    return wooded ? 'unknown' : 'outside-model';
  }
  return wooded ? 'candidate' : 'outside-model';
}

export function habitatExplanation(profileId: MushroomWeatherProfileId, state: HeatmapHabitatState): string {
  if (state === 'outside-model') return 'Ta celica nima dovolj ustreznega vegetacijskega oziroma drevesnega pokrova za pilotni habitatni model.';
  if (profileId === 'lactariusDeliciosus') {
    return 'Na voljo je podatek o drevesnem pokrovu, vendar vrsta dreves ni potrjena. Za užitno sirovko habitat zato ostaja neznan.';
  }
  if (profileId === 'generic') return 'Celica ima dovolj vegetacijskega pokrova, da jo pilot obravnava kot območje za splošno vremensko oceno.';
  return 'Območje ima dovolj drevesnega pokrova, da ga pilot obravnava kot potencialno gozdno rastišče.';
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
    limitations: [habitatExplanation(weather.speciesId, habitatState), ...weather.limitations],
    sourceAge: weather.summary.stale ? 'predpomnjeni podatki' : 'sveži podatki',
    fetchedAt: weather.summary.updatedAt,
    weatherSamplingResolutionM: HEATMAP_PILOT_METADATA.weatherSamplingSpacingM,
    habitatSource: HEATMAP_PILOT_METADATA.worldCover.dataset,
    habitatSourceVintage: HEATMAP_PILOT_METADATA.worldCover.version,
    modelledHistoryDays: weather.modelledHistoryDays,
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
    return {
      ...feature,
      properties: {
        ...feature.properties,
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
