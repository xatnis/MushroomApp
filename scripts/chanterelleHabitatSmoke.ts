/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { chanterelleHabitatState, boletusHabitatState, lactariusHabitatState } from '../src/domain/heatmap/zgs';
import { HEATMAP_HABITAT, habitatStateFor, areaAssessmentFor, habitatExplanation } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import type { ZgsHabitatEnrichment, ZgsEnrichmentArtifact, HeatmapWeatherCellSource } from '../src/domain/heatmap/types';

const baselineRef = '5567ee8';
const previousFile = (path: string) => execFileSync('git', ['show', `${baselineRef}:${path}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const baseline = JSON.parse(previousFile('src/data/heatmapPilot/zgs-enrichment.json')) as ZgsEnrichmentArtifact;
// Exact source regression plus assessment comparison below: no new weather formula.
for (const path of ['src/domain/mushroomWeather.ts', 'src/services/weather.ts', 'src/domain/heatmap/assessment.ts', 'src/domain/heatmap/config.ts', 'src/services/heatmap/pilotHeatmap.ts']) {
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), previousFile(path).replace(/\r\n/g, '\n'), path);
}
const fixture: ZgsHabitatEnrichment = {
  ...Object.values(baseline.areas).find(a => a.zgsAvailable)!,
  zgsDataCoverageFraction: .6, overlapAreaFraction: 0,
  chanterelleKnownHostShareAreaWeightedPct: 50, chanterelleHostEvidenceAreaFraction: .4,
  chanterelleHostStandCount: 2, chanterelleHostPositiveStandCount: 2,
  chanterelleHostIncompleteStandCount: 0, chanterelleHostInvalidStandCount: 0,
};
strictEqual(chanterelleHabitatState(true, fixture), 'candidate');
strictEqual(chanterelleHabitatState(false, fixture), 'outside-model');
strictEqual(chanterelleHabitatState(true), 'unknown');
for (const patch of [
  { zgsDataCoverageFraction: .29 }, { chanterelleHostIncompleteStandCount: 1 },
  { chanterelleHostInvalidStandCount: 1 }, { chanterelleKnownHostShareAreaWeightedPct: null },
  { chanterelleKnownHostShareAreaWeightedPct: NaN }, { chanterelleKnownHostShareAreaWeightedPct: 101 },
  { chanterelleHostEvidenceAreaFraction: NaN }, { chanterelleHostEvidenceAreaFraction: 1.1 },
  { chanterelleKnownHostShareAreaWeightedPct: 0, chanterelleHostEvidenceAreaFraction: 0 },
  { overlapAreaFraction: .01 }, { zgsDataCoverageFraction: NaN },
]) strictEqual(chanterelleHabitatState(true, { ...fixture, ...patch }), 'unknown');
strictEqual(chanterelleHabitatState(true, { ...fixture, chanterelleKnownHostShareAreaWeightedPct: 10, chanterelleHostEvidenceAreaFraction: .01 }), 'candidate');
strictEqual(chanterelleHabitatState(true, { ...fixture, chanterelleKnownHostShareAreaWeightedPct: 1, chanterelleHostEvidenceAreaFraction: .20 }), 'candidate');
ok(habitatExplanation('cantharellusCibarius', 'candidate', true).includes('ZGS'));
ok(habitatExplanation('cantharellusCibarius', 'unknown', false).includes('ni dovolj podatkov'));

const baseLocalDate = '2026-09-24';
const source: HeatmapWeatherCellSource = {
  id: 'fixture', latitude: 46.47, longitude: 14.85, baseLocalDate,
  days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(baseLocalDate, i - 60),
    kind: i < 60 ? 'historical' : 'forecast', precipitationMm: i < 60 ? 2 : 9,
    temperatureMeanC: 14, evapotranspirationMm: 1 })),
  currentSoil: { time: `${baseLocalDate}T12:00`, soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 },
  tomorrowMorningSoil: { time: '2026-09-25T09:00', soilMoisture0To7Cm: .27, soilMoisture7To28Cm: .28 },
  errors: {}, fetchedAt: `${baseLocalDate}T10:00:00Z`, stale: false,
};
const counts = () => ({ candidate: 0, unknown: 0, 'outside-model': 0 });
const before = counts(), after = counts(), boletus = counts(), lactarius = counts();
let differentFromBoletus = 0;
const profiles = ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const;
for (const f of HEATMAP_HABITAT.features) {
  const wooded = f.properties.treeCoverFraction >= .3;
  const oldZgs = baseline.areas[f.properties.id];
  const z = f.properties.zgs!;
  for (const key of Object.keys(oldZgs)) deepStrictEqual(z[key as keyof ZgsHabitatEnrichment], oldZgs[key as keyof ZgsHabitatEnrichment], `${f.id}/${key}`);
  strictEqual(habitatStateFor(f, 'boletusEdulis'), boletusHabitatState(wooded, oldZgs));
  strictEqual(habitatStateFor(f, 'lactariusDeliciosus'), lactariusHabitatState(wooded, oldZgs));
  strictEqual(habitatStateFor(f, 'generic'), f.properties.treeCoverFraction + f.properties.grasslandFraction >= .2 ? 'candidate' : 'outside-model');
  before[wooded ? 'candidate' : 'outside-model']++;
  after[habitatStateFor(f, 'cantharellusCibarius')]++;
  boletus[habitatStateFor(f, 'boletusEdulis')]++;
  lactarius[habitatStateFor(f, 'lactariusDeliciosus')]++;
  differentFromBoletus += Number(habitatStateFor(f, 'cantharellusCibarius') !== habitatStateFor(f, 'boletusEdulis'));
  for (const day of ['today', 'tomorrow'] as const) for (const profile of profiles) {
    const weather = assessHeatmapWeather(source, profile, day);
    const old = areaAssessmentFor({ ...f, properties: { ...f.properties, zgs: oldZgs } }, weather);
    const current = areaAssessmentFor(f, weather);
    deepStrictEqual(current.scoreDetails, old.scoreDetails);
    strictEqual(current.score, old.score);
    strictEqual(current.dataQuality, old.dataQuality);
  }
}
const cells = HEATMAP_HABITAT.features;
const wooded = cells.filter(f => f.properties.treeCoverFraction >= .3);
const hosts = ['spruce', 'pine', 'beech', 'oak'] as const;
const share = (f: typeof cells[number], h: typeof hosts[number]) => f.properties.zgs?.[`${h}ShareAreaWeightedPct`] ?? 0;
const strongest = (h: typeof hosts[number]) => [...wooded].filter(f => f.properties.zgs!.zgsDataCoverageFraction >= .3).sort((a,b) => share(b,h)-share(a,h))[0];
const distribution = (values: (number | null | undefined)[], bounds: number[]) => {
  const result: Record<string, number> = { missing: 0, zero: 0 };
  for (const v of values) {
    const key = v == null ? 'missing' : v === 0 ? 'zero' : String(bounds.find(b => v < b) ?? 'above');
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
};
console.log(JSON.stringify({ before, after, boletus, lactarius, differentFromBoletus,
  averageCoverage: cells.reduce((n,f) => n + f.properties.zgs!.zgsDataCoverageFraction,0)/cells.length,
  hostShareDistribution: distribution(cells.map(f => f.properties.zgs!.chanterelleKnownHostShareAreaWeightedPct),[10,50,90,101]),
  evidenceDistribution: distribution(cells.map(f => f.properties.zgs!.chanterelleHostEvidenceAreaFraction),[.2,.5,.9,1.01]),
  candidateRate: after.candidate/cells.length, unknownRate: after.unknown/cells.length,
  woodedEvidenceCounts: Object.fromEntries(hosts.map(h=>[h,wooded.filter(f=>share(f,h)>0).length])),
}, null, 2));
for (const [kind, f] of [
  ['spruce',strongest('spruce')], ['pine',strongest('pine')], ['beech',strongest('beech')], ['oak',strongest('oak')],
  ['mixed',wooded.find(f=>share(f,'spruce')>=25 && share(f,'beech')>=25 && f.properties.zgs!.zgsDataCoverageFraction>=.3)],
  ['low coverage',wooded.find(f=>f.properties.zgs!.zgsDataCoverageFraction>0 && f.properties.zgs!.zgsDataCoverageFraction<.1)],
  ['zero selected hosts',wooded.find(f=>f.properties.zgs!.chanterelleKnownHostShareAreaWeightedPct===0)],
] as const) {
  ok(f,kind);
  console.log(JSON.stringify({kind,id:f.properties.id,tree:f.properties.treeCoverFraction,coverage:f.properties.zgs!.zgsDataCoverageFraction,
    ...Object.fromEntries(hosts.map(h=>[h,share(f,h)])),hostShare:f.properties.zgs!.chanterelleKnownHostShareAreaWeightedPct,
    evidence:f.properties.zgs!.chanterelleHostEvidenceAreaFraction,state:habitatStateFor(f,'cantharellusCibarius')}));
}
console.log('PASS: 1961 cells × Today/Tomorrow × 4 profiles; weather and other habitats unchanged; fixture weather, real habitat.');
