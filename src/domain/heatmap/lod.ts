import artifact from '../../data/heatmapRegional/overview.json';
import { createHabitatSpatialIndex } from './spatial';
import { buildHeatmapRenderCollection } from './regional';
import { renderStateFor } from './pilot';
import type { MushroomWeatherProfileId } from '../types';
import type { HeatmapHabitatFeature, HeatmapHabitatState, HeatmapTargetDay, HeatmapWeatherAssessment } from './types';

export type HeatmapLod = 'overview' | 'detail';
// Cartographic display policy, NOT species thresholds. ~30–42 km width on a 400pt map.
export const HEATMAP_LOD = { detailEnterZoom: 9.5, overviewEnterZoom: 9.0,
  candidateFraction: 0.60, outsideModelFraction: 0.80 } as const;
export function selectHeatmapLod(zoom: number, previous: HeatmapLod): HeatmapLod {
  if (!Number.isFinite(zoom)) return previous;
  return previous === 'overview' ? zoom >= HEATMAP_LOD.detailEnterZoom ? 'detail' : 'overview'
    : zoom <= HEATMAP_LOD.overviewEnterZoom ? 'overview' : 'detail';
}
export type HabitatFractions = Record<HeatmapHabitatState, number>;
export interface OverviewFeature extends HeatmapHabitatFeature {
  properties: HeatmapHabitatFeature['properties'] & {
    habitatFractions: Record<MushroomWeatherProfileId, HabitatFractions>;
    zgsDataCoverageFraction: number; detailCellCount: number; areaM2: number;
  };
}
export const OVERVIEW_FEATURES = artifact.features as OverviewFeature[];
export const OVERVIEW_WEATHER_POINTS = artifact.weatherCells;
export const OVERVIEW_INDEX = createHabitatSpatialIndex(OVERVIEW_FEATURES);
export const OVERVIEW_SPACING_M = artifact.weatherSamplingSpacingM;

export function overviewHabitatState(fractions: HabitatFractions): HeatmapHabitatState {
  const values = Object.values(fractions);
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 1) || Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.001) return 'unknown';
  if (fractions['outside-model'] >= HEATMAP_LOD.outsideModelFraction) return 'outside-model';
  return fractions.candidate >= HEATMAP_LOD.candidateFraction ? 'candidate' : 'unknown';
}

/** Pure overview renderer; scores use the SAME scorer, habitat uses offline area fractions. */
export function buildOverviewCollection(weather: Record<string, HeatmapWeatherAssessment>, features: HeatmapHabitatFeature[],
  profile: MushroomWeatherProfileId, day: HeatmapTargetDay) {
  const result = buildHeatmapRenderCollection(weather, features, profile, day);
  for (let i = 0; i < features.length; i++) {
    const input = features[i] as OverviewFeature;
    const assessment = result.assessments[input.properties.id];
    assessment.habitatState = overviewHabitatState(input.properties.habitatFractions[profile]);
    assessment.weatherSamplingResolutionM = OVERVIEW_SPACING_M;
    assessment.limitations = ['Regionalni pregled: agregiran habitat in redkejše vremensko vzorčenje. Približaj za podrobnejši prikaz.'];
    const rendered = result.collection.features[i];
    rendered.properties.habitatState = assessment.habitatState;
    rendered.properties.renderState = renderStateFor(assessment);
    // Don't send bulky aggregate metadata to MapLibre.
    const { habitatFractions: _fractions, ...properties } = rendered.properties as typeof rendered.properties & OverviewFeature['properties'];
    rendered.properties = properties;
  }
  return result;
}
