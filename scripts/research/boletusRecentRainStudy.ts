/// <reference types="node" />
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateMushroomWeatherScore, MUSHROOM_SCORE_V1_CONFIG } from '../../src/domain/mushroomWeather';
import type { MushroomScoreComponent, MushroomWeatherSummary } from '../../src/domain/types';
import { DATASET, auditSpecies, exactDay, qualityTier, strictAssessment, weatherRequest } from './occurrenceValidationV2';
import { scoreDistribution } from './biGbifValidation';
import { ResearchCache, hash } from './researchCache';

export const VARIANTS = [{ name: '40/10', rain26: 40, rain14: 10 }, { name: '35/15', rain26: 35, rain14: 15 }, { name: '30/20', rain26: 30, rain14: 20 }] as const;

/** Generic does not export its individual normalization helper. Isolate its D14 term
 * by evaluating the real production rain component with the other two terms zero.
 * This probe is NOT the weather input used for Boletus or its other components. */
export function genericRain14Signal(summary: MushroomWeatherSummary): number | undefined {
  const historical = summary.historical;
  const mm = historical?.rain14dMm;
  if (!historical || mm == null || !Number.isFinite(mm) || mm < 0) return undefined;
  const probe = calculateMushroomWeatherScore({ ...summary, historical: {
    ...historical, rain7dMm: 0, rain30dMm: 0,
  } }, 'generic');
  return probe.components.find(c => c.key === 'rain')!.value / MUSHROOM_SCORE_V1_CONFIG.rain.horizonWeights.days14;
}

export function researchCandidate(summary: MushroomWeatherSummary, variant: typeof VARIANTS[number] = VARIANTS[1]) {
  const v1 = calculateMushroomWeatherScore(summary, 'boletusEdulis');
  const components: MushroomScoreComponent[] = v1.components.map(c => {
    const weight = c.key === 'rain26' ? variant.rain26 : c.weight;
    return { ...c, weight, weightedPoints: c.value * weight };
  });
  const rain14 = genericRain14Signal(summary);
  if (rain14 != null) components.push({ key: 'rain14', label: 'Recent rain (research only)', value: rain14,
    weight: variant.rain14, weightedPoints: rain14 * variant.rain14 });
  const availableWeight = components.reduce((s, c) => s + c.weight, 0);
  return { score: availableWeight ? Math.round(components.reduce((s, c) => s + c.weightedPoints, 0) / availableWeight * 100) : undefined,
    availableWeight, components };
}

export function numericStats(scores: number[]) {
  const d = scoreDistribution(scores);
  const { bins: _bins, atLeast: _retention, ...stats } = d;
  return { ...stats, min: scores.length ? Math.min(...scores) : null, max: scores.length ? Math.max(...scores) : null };
}
export function distribution(scores: number[]) {
  return { ...numericStats(scores),
    bins: Object.fromEntries([[0,39],[40,59],[60,69],[70,79],[80,89],[90,100]].map(([lo, hi]) => {
      const count = scores.filter(s => s >= lo && s <= hi).length;
      return [`${lo}-${hi}`, { count, percent: scores.length ? 100 * count / scores.length : null }];
    })), atLeast: Object.fromEntries([60,70,80,90].map(t => {
      const count = scores.filter(s => s >= t).length;
      return [t, { count, percent: scores.length ? 100 * count / scores.length : null }];
    })) };
}

export type StudyRow = { row: number; date: string; tier: string; rain14Mm: number; rain26Mm: number;
  rain15To26Mm: number; rain14Signal: number; rain26Signal: number; temperatureSignal: number;
  soilSignal: number; dryingSignal: number; v1: number; candidate: number; delta: number;
  variants: Record<string, number> };
export const oldRainSubgroup = (r: StudyRow) => r.rain26Signal >= .8 && r.rain14Signal <= .4;
export const bothHighSubgroup = (r: StudyRow) => r.rain26Signal >= .8 && r.rain14Signal >= .8;
export function subgroup(rows: StudyRow[], variant = '35/15') {
  const v1 = rows.map(r => r.v1), candidate = rows.map(r => r.variants[variant]);
  const delta = rows.map(r => r.variants[variant] - r.v1);
  return { N: rows.length, v1: distribution(v1), candidate: distribution(candidate), delta: numericStats(delta),
    maxDownwardDelta: delta.length ? Math.min(0, ...delta) : null,
    downwardCrossings: Object.fromEntries([90,80,70].map(t => [t, rows.filter(r => r.v1 >= t && r.variants[variant] < t).length])) };
}

const ROOT = resolve(__dirname, '../..');
async function main() {
  if (process.argv.slice(3).length) throw new Error('This study is offline only; no arguments or refetch mode.');
  const output = resolve(ROOT, 'research-output/occurrence-validation-v2');
  const read = (file: string) => JSON.parse(readFileSync(resolve(output, file), 'utf8'));
  const audit = read('audit-summary.json'), provenance = read('private-provenance.json').filter((r: any) => r.species === 'Boletus edulis');
  const saved = read('private-scores.json').filter((r: any) => r.profile === 'boletusEdulis');
  const gbif = new ResearchCache(resolve(ROOT, 'research/.cache/occurrence-validation-v2/gbif'), true);
  const weather = new ResearchCache(resolve(ROOT, 'research/.cache/occurrence-validation-v2/weather'), true);
  const base = `https://api.gbif.org/v1/occurrence/search?datasetKey=${DATASET}&country=SI&taxonKey=5954958`;
  const all = await gbif.get(base + '&limit=300&offset=0');
  const filtered = await gbif.get(base + '&hasCoordinate=true&hasGeospatialIssue=false&limit=300&offset=0');
  ok(all.endOfRecords && filtered.endOfRecords, 'original one-page snapshot must remain complete');
  const sameAudit = auditSpecies(all.results, filtered.results, 5954958, audit.generatedAt.slice(0, 10));
  strictEqual(sameAudit.exactAcceptedSpecies, 43); strictEqual(sameAudit.primaryEligible, 29);
  strictEqual(provenance.length, 29); strictEqual(saved.length, 29);
  deepStrictEqual(sameAudit.eligible.map(r => r.key).sort(), provenance.map((r: any) => r.gbifID).sort(), 'same V2 inclusion set');
  const rows: StudyRow[] = [], privateInputHashes: string[] = [];
  for (const [index, record] of sameAudit.eligible.entries()) {
    const previous = saved.find((r: any) => r.gbifID === record.key);
    const p = provenance.find((r: any) => r.gbifID === record.key);
    strictEqual(p.eventDate, exactDay(record)); strictEqual(p.qualityTier, qualityTier(record.coordinateUncertaintyInMeters));
    const url = weatherRequest(record);
    strictEqual(previous.weatherKey, hash(url), 'same historical request');
    const response = await weather.get(url);
    const assessment = strictAssessment(response, record, 'boletusEdulis');
    deepStrictEqual(assessment.score, previous.score, 'exact production V1 score/components replay');
    strictEqual(assessment.dataQuality, previous.dataQuality);
    // updatedAt is acquisition time, not a model input; everything else must replay identically.
    const { updatedAt: _a, ...inputs } = assessment.summary;
    const { updatedAt: _b, ...oldInputs } = previous.summary;
    deepStrictEqual(JSON.parse(JSON.stringify(inputs)), oldInputs, 'identical historical inputs (JSON omits undefined fields)');
    ok(!assessment.summary.forecast && assessment.summary.current?.time === `${exactDay(record)}T00:00`);
    ok(assessment.summary.historical?.days.every(d => d.date < exactDay(record)!));
    const summary = previous.summary as MushroomWeatherSummary;
    const variants = Object.fromEntries(VARIANTS.map(v => {
      const result = researchCandidate(summary, v);
      strictEqual(result.availableWeight, 100, 'study cohort has all five signals');
      return [v.name, result.score!];
    }));
    const signal = (key: string) => assessment.score.components.find(c => c.key === key)!.value;
    const rain14Mm = summary.historical!.rain14dMm!, rain26Mm = summary.historical!.rain26dMm!;
    rows.push({ row: index + 1, date: exactDay(record)!, tier: p.qualityTier, rain14Mm, rain26Mm,
      rain15To26Mm: rain26Mm - rain14Mm, rain14Signal: genericRain14Signal(summary)!, rain26Signal: signal('rain26'),
      temperatureSignal: signal('temperature'), soilSignal: signal('soilMoisture'), dryingSignal: signal('drying'),
      v1: assessment.score.score!, candidate: variants['35/15'], delta: variants['35/15'] - assessment.score.score!, variants });
    privateInputHashes.push(hash(JSON.stringify(inputs)));
  }
  const deltas = rows.map(r => r.delta), oldRain = rows.filter(oldRainSubgroup), bothHigh = rows.filter(bothHighSubgroup);
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
    source: { dataset: DATASET, doi: '10.15468/ab3s5x', license: 'CC BY-NC 4.0', V2Acquired: '2026-10-04', exactAccepted: 43, tierA: 27, tierB: 2 },
    method: { offline: true, formulaV1: '50/0/30/15/5', candidate: '35/15/30/15/5', rain14TargetMm: MUSHROOM_SCORE_V1_CONFIG.rain.targetsMm.days14,
      normalization: 'Production Generic rain component evaluated with D7/D30 terms zero, divided by its D14 horizon weight; no normalization formula copied.',
      history: 'D-60 <= history < D; soil D00:00 Europe/Ljubljana; era5_seamless; no future-rain or realised forecast',
      high26Low14: 'D26 normalized >=0.80 AND D14 normalized <=0.40 (pre-specified diagnostic, not biological gate)',
      high26High14: 'both normalized >=0.80 (symmetric high-signal diagnostic)', quantiles: 'linear (N-1)*p; rounded production-style scores' },
    cohortHash: hash(JSON.stringify(provenance.map((r: any) => r.gbifID).sort())), inputHashes: privateInputHashes,
    transport: { gbifHTTP: gbif.requests, weatherHTTP: weather.requests, weatherCacheHits: weather.hits },
    v1: distribution(rows.map(r => r.v1)), candidate: distribution(rows.map(r => r.candidate)),
    delta: { ...numericStats(deltas), bins: Object.fromEntries([['zero',0,0],['-1 to -4',-4,-1],['-5 to -9',-9,-5],['-10 to -19',-19,-10],['<=-20',-100,-20],['positive',1,100]].map(([name,lo,hi]) => [name, deltas.filter(d => d >= Number(lo) && d <= Number(hi)).length])) },
    high26Low14: subgroup(oldRain), high26High14: subgroup(bothHigh),
    sensitivity: VARIANTS.map(v => ({ variant: v.name, all: subgroup(rows, v.name), high26Low14: subgroup(oldRain, v.name) })),
    topReductions: [...rows].filter(r => r.delta < 0).sort((a,b) => a.delta - b.delta).slice(0,10),
    topSignalGaps: [...rows].sort((a,b) => (b.rain26Signal - b.rain14Signal) - (a.rain26Signal - a.rain14Signal)).slice(0,10),
    topOldRainRawAmounts: [...rows].sort((a,b) => b.rain15To26Mm - a.rain15To26Mm).slice(0,10),
    increases: rows.filter(r => r.delta > 0), rows };
  const directory = resolve(output, 'boletus-recent-rain'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'boletus_recent_rain_results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ N: rows.length, transport: result.transport, v1: result.v1, candidate: result.candidate,
    delta: result.delta, high26Low14: result.high26Low14, high26High14: result.high26High14,
    sensitivity: result.sensitivity.map(s => ({ variant:s.variant, mean:s.all.candidate.mean, median:s.all.candidate.median,
      retention:s.all.candidate.atLeast, meanDelta:s.all.delta.mean, subgroupMeanDelta:s.high26Low14.delta.mean })),
    topReductions:result.topReductions, increases:result.increases }, null, 2));
}
if (process.argv[2] && resolve(process.argv[2]) === __filename) void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Study failed.'); process.exitCode = 1;
});
