import type { HeatmapHabitatState, ZgsHabitatEnrichment } from './types';

// Spruce, pine, beech and oak: positive habitat evidence only. Birch cannot be
// isolated in ZGS; fir is deliberately excluded. Cartographic V1 tuning, not biology.
export const ZGS_CHANTERELLE_POLICY = {
  minimumDataCoverageFraction: 0.30,
  minimumGrowingStockSharePct: 10,
  minimumEvidenceAreaFraction: 0.20,
  maximumOverlapAreaFraction: 0.001,
  maximumRoundedSharePct: 100.5,
} as const;

export function chanterelleHabitatState(wooded: boolean, zgs?: ZgsHabitatEnrichment): HeatmapHabitatState {
  if (!wooded) return 'outside-model';
  if (!zgs?.zgsAvailable || zgs.chanterelleHostIncompleteStandCount !== 0
    || zgs.chanterelleHostInvalidStandCount !== 0) return 'unknown';
  const share = zgs.chanterelleKnownHostShareAreaWeightedPct;
  const evidence = zgs.chanterelleHostEvidenceAreaFraction;
  const coverage = zgs.zgsDataCoverageFraction;
  if (share == null || !Number.isFinite(share) || share < 0 || share > ZGS_CHANTERELLE_POLICY.maximumRoundedSharePct
    || evidence == null || !Number.isFinite(evidence) || evidence < 0 || evidence > 1
    || !Number.isFinite(coverage) || coverage < ZGS_CHANTERELLE_POLICY.minimumDataCoverageFraction || coverage > 1
    || !Number.isFinite(zgs.overlapAreaFraction) || zgs.overlapAreaFraction < 0
    || zgs.overlapAreaFraction > ZGS_CHANTERELLE_POLICY.maximumOverlapAreaFraction) return 'unknown';
  return share >= ZGS_CHANTERELLE_POLICY.minimumGrowingStockSharePct
    || evidence >= ZGS_CHANTERELLE_POLICY.minimumEvidenceAreaFraction ? 'candidate' : 'unknown';
}

// Equal evidence from spruce, fir, pine, beech and oak. Engineering heuristics,
// not biological thresholds or bonuses to the weather score.
export const ZGS_BOLETUS_POLICY = {
  minimumDataCoverageFraction: 0.30,
  minimumGrowingStockSharePct: 10,
  minimumEvidenceAreaFraction: 0.20,
  maximumOverlapAreaFraction: 0.001,
  maximumRoundedSharePct: 100.5,
} as const;

export function boletusHabitatState(wooded: boolean, zgs?: ZgsHabitatEnrichment): HeatmapHabitatState {
  if (!wooded) return 'outside-model';
  if (!zgs?.zgsAvailable || zgs.boletusHostIncompleteStandCount !== 0
    || zgs.boletusHostInvalidStandCount !== 0) return 'unknown';
  const share = zgs.boletusHostShareAreaWeightedPct;
  const evidence = zgs.boletusHostEvidenceAreaFraction;
  const coverage = zgs.zgsDataCoverageFraction;
  if (share == null || !Number.isFinite(share) || share < 0 || share > ZGS_BOLETUS_POLICY.maximumRoundedSharePct
    || evidence == null || !Number.isFinite(evidence) || evidence < 0 || evidence > 1
    || !Number.isFinite(coverage) || coverage < ZGS_BOLETUS_POLICY.minimumDataCoverageFraction || coverage > 1
    || !Number.isFinite(zgs.overlapAreaFraction) || zgs.overlapAreaFraction < 0
    || zgs.overlapAreaFraction > ZGS_BOLETUS_POLICY.maximumOverlapAreaFraction) return 'unknown';
  return share >= ZGS_BOLETUS_POLICY.minimumGrowingStockSharePct
    || evidence >= ZGS_BOLETUS_POLICY.minimumEvidenceAreaFraction ? 'candidate' : 'unknown';
}

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
