import type { MushroomWeatherProfileId } from './types';
import type { HeatmapHabitatFeature, HeatmapHabitatState } from './heatmap/types';

export const POINT_HABITAT_CONTEXT_VERSION = 'point-area-habitat-context-v1';
export type PointHabitatState = HeatmapHabitatState | 'outside-coverage';
export interface PointHabitatProvenance {
  datasetId: string; coverageLabel: string; cellCount: number; cellSizeM: number;
  bounds: readonly number[]; landCover: { source: string; vintage: string; resolutionM: number; attribution: string };
  treeComposition: { source: string; schema: string; retrievedAt: string; legacyRetrievedAt?: string; dataVintage: null };
}
/** Injectable ONLY for deterministic geometry tests; production reuses the canonical static index and classifiers. */
export interface PointHabitatSource {
  atPoint: (point: [number, number]) => HeatmapHabitatFeature | undefined;
  stateFor: (feature: HeatmapHabitatFeature, profile: MushroomWeatherProfileId) => HeatmapHabitatState;
  explanationFor: (profile: MushroomWeatherProfileId, state: HeatmapHabitatState, zgsAvailable: boolean) => string;
  provenance: PointHabitatProvenance;
}
export interface PointHabitatContext {
  contextVersion: typeof POINT_HABITAT_CONTEXT_VERSION; profileId: MushroomWeatherProfileId;
  state: PointHabitatState; cellId?: string; explanation: string; reason?: 'invalid-coordinate' | 'no-polygon';
  provenance: PointHabitatProvenance; zgsAvailable: boolean; treeCompositionRetrievedAt?: string;
}
let source: PointHabitatSource | undefined;
function regionalSource(): PointHabitatSource {
  if (source) return source;
  // No eager geometry import into the forecast module and no new index/geometry copy.
  // AppNavigator already imports MapScreen/regional; standalone callers load it once, on demand.
  const { REGIONAL_INDEX, HEATMAP_PILOT_METADATA: m } = require('./heatmap/regional') as typeof import('./heatmap/regional');
  const { habitatStateFor, habitatExplanation } = require('./heatmap/pilot') as typeof import('./heatmap/pilot');
  const zgs = require('../data/heatmapRegional/zgs-enrichment.json') as {
    source: string; sourceSchemaVersion: string; fetchedAt: string; legacyFetchedAt?: string;
  };
  source = { atPoint: point => REGIONAL_INDEX.atPoint(point), stateFor: habitatStateFor, explanationFor: habitatExplanation,
    provenance: { datasetId: m.pilotId, coverageLabel: m.label, cellCount: m.habitatPolygonCount, cellSizeM: m.habitatCellSizeM,
      bounds: m.bbox, landCover: { source: m.worldCover.dataset, vintage: m.worldCover.version, resolutionM: m.worldCover.resolutionM, attribution: m.worldCover.attribution },
      treeComposition: { source: zgs.source, schema: zgs.sourceSchemaVersion, retrievedAt: zgs.fetchedAt,
        legacyRetrievedAt: zgs.legacyFetchedAt, dataVintage: null } } };
  return source;
}

/** Static AREA context only. No weather, date, score, network, persistence, logging or nearest-centre fallback. */
export function resolvePointHabitat(latitude: number, longitude: number, profileId: MushroomWeatherProfileId, input = regionalSource()): PointHabitatContext {
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const feature = valid ? input.atPoint([longitude, latitude]) : undefined;
  const state = feature ? input.stateFor(feature, profileId) : 'outside-coverage';
  const zgsAvailable = feature?.properties.zgs?.zgsAvailable === true;
  return { contextVersion: POINT_HABITAT_CONTEXT_VERSION, profileId, state, cellId: feature?.properties.id,
    explanation: feature ? input.explanationFor(profileId, state as HeatmapHabitatState, zgsAvailable) : valid
      ? 'Za te koordinate v obstoječem regionalnem sloju ni podprtega poligona. To ni negativna habitatna ocena.' : 'Koordinate niso veljavne; habitat ni ocenjen.',
    reason: feature ? undefined : valid ? 'no-polygon' : 'invalid-coordinate', provenance: input.provenance, zgsAvailable,
    // Same provenance distinction as regional.ts: inherited pilot areas retain their original ZGS capture.
    treeCompositionRetrievedAt: zgsAvailable ? feature!.properties.id.startsWith('area-')
      ? input.provenance.treeComposition.legacyRetrievedAt ?? input.provenance.treeComposition.retrievedAt
      : input.provenance.treeComposition.retrievedAt : undefined };
}
export function pointHabitatLabel(state: PointHabitatState) {
  return state === 'candidate' ? 'Habitat območja: potencialno primeren'
    : state === 'unknown' ? 'Habitat območja: ni dovolj podatkov'
    : state === 'outside-model' ? 'Habitat območja: zunaj habitatnega modela'
    : 'Habitat: za to območje še nimamo podatkov';
}
