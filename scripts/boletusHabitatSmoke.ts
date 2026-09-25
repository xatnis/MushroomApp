/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { boletusHabitatState, lactariusHabitatState } from '../src/domain/heatmap/zgs';
import { HEATMAP_HABITAT, habitatStateFor, areaAssessmentFor, renderStateFor, habitatExplanation } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import type { ZgsHabitatEnrichment, ZgsEnrichmentArtifact, HeatmapWeatherCellSource } from '../src/domain/heatmap/types';

// Pinned pre-change baseline: includes the original pine metadata and habitat policy.
const baseline = JSON.parse(execFileSync('git', ['show', '4cefca15a91a9909678198aa145d160aaeb4ce53:src/data/heatmapPilot/zgs-enrichment.json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })) as ZgsEnrichmentArtifact;
const fixture: ZgsHabitatEnrichment = {
  ...Object.values(baseline.areas).find(a => a.zgsAvailable)!,
  zgsDataCoverageFraction: .6, overlapAreaFraction: 0,
  boletusHostShareAreaWeightedPct: 50, boletusHostEvidenceAreaFraction: .4,
  boletusHostStandCount: 2, boletusHostPositiveStandCount: 2,
  boletusHostIncompleteStandCount: 0, boletusHostInvalidStandCount: 0,
};
strictEqual(boletusHabitatState(true, fixture), 'candidate');
strictEqual(boletusHabitatState(false, fixture), 'outside-model');
strictEqual(boletusHabitatState(true), 'unknown');
for (const patch of [
  { zgsDataCoverageFraction: .29 }, { boletusHostIncompleteStandCount: 1 },
  { boletusHostInvalidStandCount: 1 }, { boletusHostShareAreaWeightedPct: null },
  { boletusHostShareAreaWeightedPct: NaN }, { boletusHostEvidenceAreaFraction: NaN },
  { boletusHostShareAreaWeightedPct: 0, boletusHostEvidenceAreaFraction: 0 },
  { overlapAreaFraction: .01 },
]) strictEqual(boletusHabitatState(true, { ...fixture, ...patch }), 'unknown');
strictEqual(boletusHabitatState(true, { ...fixture, boletusHostShareAreaWeightedPct: 10, boletusHostEvidenceAreaFraction: .01 }), 'candidate');
strictEqual(boletusHabitatState(true, { ...fixture, boletusHostShareAreaWeightedPct: 1, boletusHostEvidenceAreaFraction: .20 }), 'candidate');
ok(habitatExplanation('boletusEdulis', 'unknown', false).includes('ni dovolj podatkov'));

const baseLocalDate = '2026-09-23';
const source: HeatmapWeatherCellSource = {
  id: 'fixture', latitude: 46.47, longitude: 14.85, baseLocalDate,
  days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(baseLocalDate, i - 60),
    kind: i < 60 ? 'historical' : 'forecast', precipitationMm: i < 60 ? 2 : 9,
    temperatureMeanC: 14, evapotranspirationMm: 1 })),
  currentSoil: { time: `${baseLocalDate}T12:00`, soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  tomorrowMorningSoil: { time: '2026-09-24T09:00', soilMoisture0To7Cm: .27, soilMoisture7To28Cm: .28 },
  errors: {}, fetchedAt: `${baseLocalDate}T10:00:00Z`, stale: false,
};
const before = { candidate: 0, unknown: 0, 'outside-model': 0 };
const after = { ...before }, pineCounts = { ...before };
const profiles = ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const;
for (const f of HEATMAP_HABITAT.features) {
  const wooded = f.properties.treeCoverFraction >= .3;
  const oldZgs = baseline.areas[f.properties.id];
  const z = f.properties.zgs!;
  // Every original field stays identical, including pine, coverage and all tree shares.
  for (const key of Object.keys(oldZgs)) deepStrictEqual(z[key as keyof ZgsHabitatEnrichment], oldZgs[key as keyof ZgsHabitatEnrichment], `${f.id}/${key}`);
  const pine = habitatStateFor(f, 'lactariusDeliciosus');
  strictEqual(pine, lactariusHabitatState(wooded, oldZgs));
  pineCounts[pine]++;
  before[wooded ? 'candidate' : 'outside-model']++;
  after[habitatStateFor(f, 'boletusEdulis')]++;
  strictEqual(habitatStateFor(f, 'generic'), f.properties.treeCoverFraction + f.properties.grasslandFraction >= .2 ? 'candidate' : 'outside-model');
  // Chanterelle now has its own host policy, covered by chanterelleHabitatSmoke.
  for (const day of ['today', 'tomorrow'] as const) for (const profile of profiles) {
    const weather = assessHeatmapWeather(source, profile, day);
    const previous = areaAssessmentFor({ ...f, properties: { ...f.properties, zgs: oldZgs } }, weather);
    const current = areaAssessmentFor(f, weather);
    deepStrictEqual(current.scoreDetails, previous.scoreDetails);
    strictEqual(current.score, previous.score);
    strictEqual(current.dataQuality, previous.dataQuality);
    if (current.habitatState === 'unknown') strictEqual(renderStateFor(current), 'unknown');
    if (current.habitatState === 'outside-model') strictEqual(renderStateFor(current), 'outside');
  }
}
deepStrictEqual(pineCounts, { candidate: 808, unknown: 1018, 'outside-model': 135 });
const cells = HEATMAP_HABITAT.features;
const hostKeys = ['spruce', 'fir', 'pine', 'beech', 'oak'] as const;
const share = (f: typeof cells[number], host: typeof hostKeys[number]) => f.properties.zgs?.[`${host}ShareAreaWeightedPct`] ?? 0;
const wooded = cells.filter(f => f.properties.treeCoverFraction >= .3);
const strongest = (host: typeof hostKeys[number]) => [...wooded].filter(f => f.properties.zgs!.zgsDataCoverageFraction >= .3).sort((a, b) => share(b, host) - share(a, host))[0];
const samples = [
  ['spruce', strongest('spruce')], ['beech', strongest('beech')], ['oak (strongest available)', strongest('oak')],
  ['mixed', wooded.find(f => share(f, 'spruce') >= 25 && share(f, 'beech') >= 25 && f.properties.zgs!.zgsDataCoverageFraction >= .3)],
  ['low coverage', wooded.find(f => f.properties.zgs!.zgsDataCoverageFraction > 0 && f.properties.zgs!.zgsDataCoverageFraction < .1)],
  ['zero known hosts', wooded.find(f => f.properties.zgs!.boletusHostShareAreaWeightedPct === 0)],
] as const;
const distribution = { missing: 0, zero: 0, below10: 0, from10to50: 0, from50to90: 0, from90: 0 };
for (const f of cells) {
  const v = f.properties.zgs?.boletusHostShareAreaWeightedPct;
  distribution[v == null ? 'missing' : v === 0 ? 'zero' : v < 10 ? 'below10' : v < 50 ? 'from10to50' : v < 90 ? 'from50to90' : 'from90']++;
}
console.log(JSON.stringify({ before, after, pineCounts, averageCoverage: cells.reduce((n, f) => n + f.properties.zgs!.zgsDataCoverageFraction, 0) / cells.length,
  distribution, evidenceCounts: Object.fromEntries(hostKeys.map(h => [h, cells.filter(f => share(f, h) > 0).length])) }, null, 2));
for (const [kind, f] of samples) {
  ok(f, `Missing real sample: ${kind}`);
  console.log(JSON.stringify({ kind, id: f.properties.id, tree: f.properties.treeCoverFraction,
    coverage: f.properties.zgs!.zgsDataCoverageFraction, ...Object.fromEntries(hostKeys.map(h => [h, share(f, h)])),
    hostShare: f.properties.zgs!.boletusHostShareAreaWeightedPct,
    evidence: f.properties.zgs!.boletusHostEvidenceAreaFraction, state: habitatStateFor(f, 'boletusEdulis') }));
}
console.log('PASS: 1961 cells × Today/Tomorrow; weather unchanged; original ZGS fields and Lactarius unchanged.');
