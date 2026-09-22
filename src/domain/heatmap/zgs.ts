import type { HeatmapHabitatState, ZgsHabitatEnrichment } from './types';

// Cartographic pilot engineering heuristics; not biological thresholds.
export const ZGS_PINE_POLICY = {
  minimumDataCoverageFraction: 0.30,
  minimumGrowingStockSharePct: 10,
  minimumEvidenceAreaFraction: 0.20,
  maximumOverlapAreaFraction: 0.001,
} as const;

export function lactariusHabitatState(wooded: boolean, zgs?: ZgsHabitatEnrichment): HeatmapHabitatState {
  if (!wooded) return 'outside-model';
  if (!zgs?.zgsAvailable || zgs.invalidPineStandCount > 0) return 'unknown';
  const fractions = [zgs.zgsDataCoverageFraction, zgs.zgsForestCoveredAreaFraction, zgs.pineEvidenceAreaFraction, zgs.overlapAreaFraction];
  if (fractions.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return 'unknown';
  const share = zgs.pineShareAreaWeightedPct;
  if (share == null || !Number.isFinite(share) || share < 0 || share > 100
    || zgs.overlapAreaFraction > ZGS_PINE_POLICY.maximumOverlapAreaFraction
    || zgs.zgsDataCoverageFraction < ZGS_PINE_POLICY.minimumDataCoverageFraction) return 'unknown';
  return share >= ZGS_PINE_POLICY.minimumGrowingStockSharePct
    || zgs.pineEvidenceAreaFraction >= ZGS_PINE_POLICY.minimumEvidenceAreaFraction ? 'candidate' : 'unknown';
  // Even valid zero pine is only evidence about surveyed stands, not all wooded habitat.
}
