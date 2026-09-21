import type {
  DailyWeatherPoint,
  MushroomConditionsScore,
  MushroomWeatherProfileId,
  MushroomWeatherSummary,
} from '../types';

export type HeatmapTargetDay = 'today' | 'tomorrow';
export type HeatmapDataQuality = 'complete' | 'limited' | 'insufficient';
export type HeatmapHabitatState = 'candidate' | 'unknown' | 'outside-model';

export interface HeatmapWeatherCellDefinition {
  id: string;
  latitude: number;
  longitude: number;
  projectedX: number;
  projectedY: number;
}

export interface HeatmapPilotMetadata {
  schemaVersion: number;
  pilotId: string;
  label: string;
  center: { latitude: number; longitude: number; source: string };
  radiusM: number;
  bbox: [number, number, number, number];
  habitatCellSizeM: number;
  habitatPolygonCount: number;
  weatherSamplingSpacingM: number;
  weatherCellCount: number;
  weatherCells: HeatmapWeatherCellDefinition[];
  worldCover: {
    dataset: string;
    version: string;
    resolutionM: number;
    crs: string;
    classCodes: { treeCover: number; grassland: number };
    license: string;
    attribution: string;
    sourceUrls: string[];
  };
  generatedBy: string;
}

export interface HeatmapHabitatProperties {
  id: string;
  weatherCellId: string;
  centerLatitude: number;
  centerLongitude: number;
  treeCoverFraction: number;
  grasslandFraction: number;
  sourcePixelCount: number;
  sourceVersion: string;
  sourceResolutionM: number;
}

export interface HeatmapPolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface HeatmapHabitatFeature {
  type: 'Feature';
  id: string;
  properties: HeatmapHabitatProperties;
  geometry: HeatmapPolygonGeometry;
}

export interface HeatmapHabitatFeatureCollection {
  type: 'FeatureCollection';
  features: HeatmapHabitatFeature[];
}

export interface HeatmapSoilPoint {
  time: string;
  soilMoisture0To7Cm?: number;
  soilMoisture7To28Cm?: number;
}

export interface HeatmapWeatherCellSource {
  id: string;
  latitude: number;
  longitude: number;
  baseLocalDate: string;
  days: DailyWeatherPoint[];
  currentSoil?: HeatmapSoilPoint;
  tomorrowMorningSoil?: HeatmapSoilPoint;
  errors: { historical?: string; forecast?: string };
  fetchedAt: string;
  stale: boolean;
}

export interface HeatmapWeatherBatch {
  policyVersion: string;
  baseLocalDate: string;
  fetchedAt: string;
  stale: boolean;
  coldRequestCount: number;
  cells: Record<string, HeatmapWeatherCellSource>;
}

export interface HeatmapWeatherAssessment {
  weatherCellId: string;
  speciesId: MushroomWeatherProfileId;
  targetDay: HeatmapTargetDay;
  targetLocalDate: string;
  summary: MushroomWeatherSummary;
  score: MushroomConditionsScore;
  dataQuality: HeatmapDataQuality;
  modelledHistoryDays: number;
  limitations: string[];
}

export interface HeatmapAreaAssessment {
  areaId: string;
  weatherCellId: string;
  speciesId: MushroomWeatherProfileId;
  targetDay: HeatmapTargetDay;
  targetLocalDate: string;
  score: number | null;
  classLabel: string;
  dataQuality: HeatmapDataQuality;
  habitatState: HeatmapHabitatState;
  scoreDetails: MushroomConditionsScore;
  summary: MushroomWeatherSummary;
  limitations: string[];
  sourceAge: string;
  fetchedAt: string;
  weatherSamplingResolutionM: number;
  habitatSource: string;
  habitatSourceVintage: string;
  modelledHistoryDays: number;
}

export interface HeatmapRenderProperties extends HeatmapHabitatProperties {
  score: number;
  scoreLabel: string;
  renderState: 'poor' | 'average' | 'good' | 'very-good' | 'excellent' | 'limited' | 'insufficient' | 'unknown' | 'outside';
  dataQuality: HeatmapDataQuality;
  habitatState: HeatmapHabitatState;
  selected: boolean;
}

export interface HeatmapRenderFeature extends Omit<HeatmapHabitatFeature, 'properties'> {
  properties: HeatmapRenderProperties;
}

export interface HeatmapRenderFeatureCollection {
  type: 'FeatureCollection';
  features: HeatmapRenderFeature[];
}
