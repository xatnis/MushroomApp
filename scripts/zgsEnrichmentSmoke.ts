import { lactariusHabitatState } from '../src/domain/heatmap/zgs';
import { HEATMAP_HABITAT, HEATMAP_PROFILE_IDS, HEATMAP_TARGET_DAYS, habitatStateFor, areaAssessmentFor } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import type { HeatmapWeatherCellSource, ZgsHabitatEnrichment } from '../src/domain/heatmap/types';
import { shiftLocalDate } from '../src/services/weather';

const assert: (v: unknown, message: string) => asserts v = (v, message) => { if (!v) throw new Error(message); };
const zgs: ZgsHabitatEnrichment = {
  zgsAvailable: true, zgsForestCoveredAreaFraction: .8, zgsDataCoverageFraction: .8,
  pineEvidenceAreaFraction: .25, pineShareAreaWeightedPct: 15, spruceShareAreaWeightedPct: 60,
  firShareAreaWeightedPct: 5, beechShareAreaWeightedPct: 20, zgsStandCount: 10,
  zgsPinePositiveStandCount: 4, overlapAreaFraction: 0, invalidPineStandCount: 0,
};
assert(lactariusHabitatState(true, zgs) === 'candidate', 'Verified pine must be candidate');
assert(lactariusHabitatState(false, zgs) === 'outside-model', 'Open habitat remains outside');
assert(lactariusHabitatState(true) === 'unknown', 'WorldCover only remains unknown');
assert(lactariusHabitatState(true, { ...zgs, zgsDataCoverageFraction: .29 }) === 'unknown', 'Low coverage');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: 0, pineEvidenceAreaFraction: 0 }) === 'unknown', 'Zero pine does not prove absence throughout cell');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: 1, pineEvidenceAreaFraction: .001 }) === 'unknown', 'Tiny pine evidence');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: null }) === 'unknown', 'Missing pine');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: NaN }) === 'unknown', 'Invalid pine');
assert(lactariusHabitatState(true, { ...zgs, invalidPineStandCount: 1 }) === 'unknown', 'Invalid source stand');
assert(lactariusHabitatState(true, { ...zgs, overlapAreaFraction: .01 }) === 'unknown', 'Ambiguous overlapping data');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: 5, pineEvidenceAreaFraction: .20 }) === 'candidate', 'Area evidence alternative');
assert(lactariusHabitatState(true, { ...zgs, pineShareAreaWeightedPct: 10, pineEvidenceAreaFraction: .1 }) === 'candidate', 'Stock-share alternative');

const baseLocalDate = '2026-09-22';
const source: HeatmapWeatherCellSource = {
  id: 'fixture', latitude: 46.47, longitude: 14.85, baseLocalDate,
  days: Array.from({ length: 62 }, (_, index) => ({
    date: shiftLocalDate(baseLocalDate, index - 60), kind: index < 60 ? 'historical' : 'forecast',
    precipitationMm: index < 60 ? 2 : 9, temperatureMeanC: 14, evapotranspirationMm: 1,
  })),
  currentSoil: { time: `${baseLocalDate}T12:00`, soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  tomorrowMorningSoil: { time: '2026-09-23T09:00', soilMoisture0To7Cm: .27, soilMoisture7To28Cm: .28 },
  errors: {}, fetchedAt: `${baseLocalDate}T10:00:00Z`, stale: false,
};
const beforeCounts: Record<string, number> = {}, afterCounts: Record<string, number> = {};
for (const feature of HEATMAP_HABITAT.features) {
  const before = { ...feature, properties: { ...feature.properties, zgs: undefined } };
  const oldState = habitatStateFor(before, 'lactariusDeliciosus');
  const newState = habitatStateFor(feature, 'lactariusDeliciosus');
  beforeCounts[oldState] = (beforeCounts[oldState] ?? 0) + 1;
  afterCounts[newState] = (afterCounts[newState] ?? 0) + 1;
  for (const profile of HEATMAP_PROFILE_IDS) {
    if (profile === 'generic' || profile === 'cantharellusCibarius') assert(habitatStateFor(feature, profile) === habitatStateFor(before, profile), `${profile}: habitat changed`);
    for (const day of HEATMAP_TARGET_DAYS) {
      const weather = assessHeatmapWeather(source, profile, day);
      const old = areaAssessmentFor(before, weather), next = areaAssessmentFor(feature, weather);
      assert(old.score === next.score && old.dataQuality === next.dataQuality, 'ZGS changed weather score/quality');
      assert(JSON.stringify(old.scoreDetails) === JSON.stringify(next.scoreDetails), 'Weather components changed');
    }
  }
}
const wooded = HEATMAP_HABITAT.features.filter(f => f.properties.treeCoverFraction >= .3);
const order = [...wooded].sort((a, b) => (b.properties.zgs?.pineShareAreaWeightedPct ?? -1) - (a.properties.zgs?.pineShareAreaWeightedPct ?? -1));
const samples = [
  ['high', order.find(f => habitatStateFor(f, 'lactariusDeliciosus') === 'candidate')],
  ['low', wooded.find(f => f.properties.zgs && f.properties.zgs.zgsDataCoverageFraction >= .3 && (f.properties.zgs.pineShareAreaWeightedPct ?? 0) > 0 && habitatStateFor(f, 'lactariusDeliciosus') === 'unknown')],
  ['zero', wooded.find(f => f.properties.zgs && f.properties.zgs.zgsDataCoverageFraction >= .3 && f.properties.zgs.pineShareAreaWeightedPct === 0)],
  ['lowCoverage', wooded.find(f => f.properties.zgs && f.properties.zgs.zgsDataCoverageFraction > 0 && f.properties.zgs.zgsDataCoverageFraction < .1)],
  ['noData', wooded.find(f => !f.properties.zgs?.zgsAvailable)],
] as const;
console.log('ZGS state counts', { beforeCounts, afterCounts });
for (const [kind, feature] of samples) {
  assert(feature, `Missing real sample ${kind}`);
  const p = feature.properties;
  console.log(JSON.stringify({ kind, id: p.id, tree: p.treeCoverFraction, coverage: p.zgs?.zgsDataCoverageFraction,
    pineShare: p.zgs?.pineShareAreaWeightedPct, pineEvidence: p.zgs?.pineEvidenceAreaFraction,
    state: habitatStateFor(feature, 'lactariusDeliciosus') }));
}
console.log('ZGS tests passed; all cells, four profiles, Today/Tomorrow weather scores unchanged.');
