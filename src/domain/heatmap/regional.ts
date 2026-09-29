import habitat from '../../data/heatmapRegional/habitat.geojson.json';
import metadata from '../../data/heatmapRegional/metadata.json';
import coverage from '../../data/heatmapRegional/coverage.geojson.json';
import zgs from '../../data/heatmapRegional/zgs-enrichment.json';
import { buildHeatmapRenderCollection as buildCollection } from './pilot';
import { containsPoint, createHabitatSpatialIndex } from './spatial';
import type { HeatmapHabitatFeatureCollection, HeatmapPilotMetadata, HeatmapPolygonGeometry, HeatmapMultiPolygonGeometry, ZgsEnrichmentArtifact, HeatmapWeatherAssessment } from './types';

export const HEATMAP_PILOT_METADATA: HeatmapPilotMetadata = {
  ...metadata,
  bbox: [metadata.bbox[0], metadata.bbox[1], metadata.bbox[2], metadata.bbox[3]],
};
const enrichment = zgs as ZgsEnrichmentArtifact & { legacyFetchedAt?: string };
export const HEATMAP_HABITAT: HeatmapHabitatFeatureCollection = {
  type: 'FeatureCollection',
  features: (habitat as HeatmapHabitatFeatureCollection).features.map(feature => ({ ...feature,
    properties: { ...feature.properties, zgs: enrichment.schemaVersion === 1 && enrichment.pilotId === metadata.pilotId
      ? enrichment.areas[feature.properties.id] : undefined },
  })),
};
export const REGIONAL_INDEX = createHabitatSpatialIndex(HEATMAP_HABITAT.features);
export const isRegionalPoint = (point: [number, number]) => containsPoint(
  coverage.geometry as HeatmapPolygonGeometry | HeatmapMultiPolygonGeometry, point,
);

export function buildHeatmapRenderCollection(weather: Record<string, HeatmapWeatherAssessment>) {
  const result = buildCollection(weather, undefined, HEATMAP_HABITAT.features);
  for (const assessment of Object.values(result.assessments)) {
    if (assessment.treeCompositionSource) {
      assessment.treeCompositionFetchedAt = assessment.areaId.startsWith('area-')
        ? enrichment.legacyFetchedAt ?? enrichment.fetchedAt : enrichment.fetchedAt;
    }
  }
  return result;
}
