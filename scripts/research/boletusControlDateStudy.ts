/// <reference types="node" />
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateMushroomWeatherScore, MUSHROOM_SCORE_V1_CONFIG } from '../../src/domain/mushroomWeather';
import type { MushroomWeatherSummary } from '../../src/domain/types';
import { shiftLocalDate } from '../../src/services/weather';
import { DATASET, auditSpecies, exactDay, qualityTier, strictAssessment, weatherRequest, type Occurrence } from './occurrenceValidationV2';
import { genericRain14Signal, researchCandidate, VARIANTS, numericStats, distribution } from './boletusRecentRainStudy';
import { ResearchCache, hash } from './researchCache';

export const STUDY_CUTOFF = '2026-09-30'; // Frozen five-day archive-lag cutoff for the 2026-10-05 study.
export const MODELS = ['V1', '40/10', '35/15', '30/20'] as const;
export type Model = typeof MODELS[number];
export type Evaluation = { date: string; tier: string; rain14Mm: number | null; rain26Mm: number | null;
  rain14Signal: number | null; rain26Signal: number | null; scores: Record<Model, number>;
  dataQuality: string; availableWeights: Record<Model, number> };
export type MatchedSet = { case: number; occurrence: Evaluation; controls: Evaluation[] };
const countBy = (values: (string | number)[]) => values.reduce<Record<string, number>>((out, value) => {
  out[value] = (out[value] ?? 0) + 1; return out;
}, {});

/** Weather-blind deterministic sampling: two interior tercile positions per available side.
 * April-November is a broad calendar study boundary, NOT an inferred fruiting threshold.
 * Fewer controls are retained at season/archive edges, without substituting another year. */
export function selectControls(date: string, exclusion = 21, cutoff = STUDY_CUTOFF): string[] {
  if (!exactDay({ eventDate: date }) || !Number.isInteger(exclusion) || exclusion < 0 || exclusion >= 60) throw new Error('Invalid matching configuration.');
  const year = date.slice(0, 4), start = `${year}-04-01`, end = `${year}-11-30`;
  const candidates = Array.from({ length: 121 }, (_, i) => shiftLocalDate(date, i - 60))
    .filter((d, i) => Math.abs(i - 60) > exclusion && d >= start && d <= end && d <= cutoff);
  const choose = (dates: string[]) => dates.length <= 2 ? dates : [dates[Math.floor((dates.length - 1) / 3)], dates[Math.floor(2 * (dates.length - 1) / 3)]];
  return [...choose(candidates.filter(d => d < date)), ...choose(candidates.filter(d => d > date))];
}

/** Deliberately no occurrence identity/date metadata on pseudo-controls. Public location is unchanged. */
export function controlTarget(record: Occurrence, date: string): Occurrence {
  return { eventDate: date, decimalLatitude: record.decimalLatitude, decimalLongitude: record.decimalLongitude };
}

/** An interval response is transport-only; present exactly the same D-60..D window to V2's adapter. */
export function sliceTarget(response: Occurrence, date: string): Occurrence {
  const lower = shiftLocalDate(date, -60);
  const slice = (section: Occurrence = {}, hourly = false) => {
    const indices = (section.time ?? []).map((time: string, i: number) => ({ time, i }))
      .filter(({ time }: { time: string }) => time >= (hourly ? `${lower}T00:00` : lower) && time <= (hourly ? `${date}T23:59` : date));
    return Object.fromEntries(Object.entries(section).map(([key, values]) => [key, Array.isArray(values)
      ? indices.map(({ i }: { i: number }) => values[i]) : values]));
  };
  return { ...response, daily: slice(response.daily), hourly: slice(response.hourly, true) };
}

export function evaluate(summary: MushroomWeatherSummary, date: string, tier: string, dataQuality: string): Evaluation {
  const production = calculateMushroomWeatherScore(summary, 'boletusEdulis');
  if (production.score == null || dataQuality === 'insufficient') throw new Error('Insufficient weather; do not invent a score.');
  const candidates = VARIANTS.map(v => [v.name, researchCandidate(summary, v)] as const);
  if (candidates.some(([, r]) => r.score == null)) throw new Error('Candidate cannot be scored.');
  return { date, tier, rain14Mm: summary.historical?.rain14dMm ?? null, rain26Mm: summary.historical?.rain26dMm ?? null,
    rain14Signal: genericRain14Signal(summary) ?? null, rain26Signal: production.components.find(c => c.key === 'rain26')?.value ?? null,
    dataQuality, scores: { V1: production.score, ...Object.fromEntries(candidates.map(([name, r]) => [name, r.score!])) } as Record<Model, number>,
    availableWeights: { V1: production.components.reduce((s, c) => s + c.weight, 0),
      ...Object.fromEntries(candidates.map(([name, r]) => [name, r.availableWeight])) } as Record<Model, number> };
}

export function quadrant(r: Evaluation): string {
  if (r.rain26Signal == null || r.rain14Signal == null) return 'missing';
  const a = r.rain26Signal, b = r.rain14Signal;
  if (a >= .8 && b >= .8) return 'Q1 high/high';
  if (a >= .8 && b <= .4) return 'Q2 high/low';
  if (a <= .4 && b >= .8) return 'Q3 low/high';
  if (a <= .4 && b <= .4) return 'Q4 low/low';
  return 'mixed/mid';
}
const signedStats = (values: number[]) => ({ ...numericStats(values), positive: values.filter(v => v > 0).length,
  zero: values.filter(v => v === 0).length, negative: values.filter(v => v < 0).length });

export function rainSubgroup(rows: Evaluation[]) {
  return { N: rows.length, rain26: numericStats(rows.flatMap(r => r.rain26Mm == null ? [] : [r.rain26Mm])),
    rain14: numericStats(rows.flatMap(r => r.rain14Mm == null ? [] : [r.rain14Mm])),
    models: Object.fromEntries(MODELS.map(model => [model, { scores: distribution(rows.map(r => r.scores[model])),
      deltaVsV1: numericStats(rows.map(r => r.scores[model] - r.scores.V1)),
      downwardCrossings: Object.fromEntries([90, 80, 70].map(t => [t, rows.filter(r => r.scores.V1 >= t && r.scores[model] < t).length])),
      fromV1High: Object.fromEntries([90, 80].map(from => [from, Object.fromEntries([90, 80, 70].map(to => [to,
        rows.filter(r => r.scores.V1 >= from && r.scores[model] < to).length]))])) }])) };
}

export function analyze(sets: MatchedSet[]) {
  const matched = sets.filter(s => s.controls.length), controls = matched.flatMap(s => s.controls);
  const modelResults = Object.fromEntries(MODELS.map(model => {
    const differences = matched.map(s => ({ case: s.case,
      minusMean: s.occurrence.scores[model] - numericStats(s.controls.map(c => c.scores[model])).mean!,
      minusMedian: s.occurrence.scores[model] - numericStats(s.controls.map(c => c.scores[model])).median! }));
    const pairs = matched.flatMap(s => s.controls.map(c => s.occurrence.scores[model] - c.scores[model]));
    const wins = pairs.filter(d => d > 0).length, ties = pairs.filter(d => d === 0).length, losses = pairs.filter(d => d < 0).length;
    const ranks = matched.map(s => {
      const own = s.occurrence.scores[model], above = s.controls.filter(c => c.scores[model] > own).length,
        same = s.controls.filter(c => c.scores[model] === own).length;
      return above === 0 ? same ? 'tied rank 1' : 'rank 1 unique' : above === 1 ? 'rank 2' : 'rank 3+';
    });
    return [model, { occurrence: distribution(sets.map(s => s.occurrence.scores[model])), controls: distribution(controls.map(c => c.scores[model])),
      pairedMinusMean: signedStats(differences.map(d => d.minusMean)), pairedMinusMedian: signedStats(differences.map(d => d.minusMedian)),
      pairwise: { N: pairs.length, wins, ties, losses, winPct: pairs.length ? wins / pairs.length * 100 : null,
        tiePct: pairs.length ? ties / pairs.length * 100 : null, lossPct: pairs.length ? losses / pairs.length * 100 : null },
      ranks: { 'rank 1 unique': 0, 'tied rank 1': 0, 'rank 2': 0, 'rank 3+': 0, ...countBy(ranks) },
      absolutePairDifference: { ...numericStats(pairs.map(Math.abs)), bands: countBy(pairs.map(d => Math.abs(d) <= 5 ? '0-5' : Math.abs(d) <= 10 ? '6-10' : Math.abs(d) <= 20 ? '11-20' : '>20')) },
      differences }];
  }));
  return { occurrenceN: sets.length, matchedOccurrenceN: matched.length, controlN: controls.length,
    controlsPerOccurrence: countBy(sets.map(s => s.controls.length)), models: modelResults,
    high26Low14Controls: rainSubgroup(controls.filter(r => quadrant(r) === 'Q2 high/low')),
    high26High14Controls: rainSubgroup(controls.filter(r => quadrant(r) === 'Q1 high/high')),
    quadrants: Object.fromEntries(['Q1 high/high', 'Q2 high/low', 'Q3 low/high', 'Q4 low/low', 'mixed/mid', 'missing'].map(q => {
      const occurrences = sets.map(s => s.occurrence).filter(r => quadrant(r) === q), rows = controls.filter(r => quadrant(r) === q);
      return [q, { occurrenceN: occurrences.length, controlN: rows.length,
        occurrenceMeans: Object.fromEntries(MODELS.map(m => [m, numericStats(occurrences.map(r => r.scores[m])).mean])),
        controlMeans: Object.fromEntries(MODELS.map(m => [m, numericStats(rows.map(r => r.scores[m])).mean])) }];
    })) };
}

/** Mechanical rainfall sensitivity only: the fixture never represents a full weather score. */
export function syntheticRain(d14: number, d26: number) {
  if (d14 > d26 || d14 < 0 || !Number.isFinite(d14) || !Number.isFinite(d26)) throw new Error('Impossible rainfall pair.');
  const summary = { latitude: 0, longitude: 0, source: 'open-meteo', updatedAt: 'synthetic', stale: false, errors: {},
    historical: { rain14dMm: d14, rain26dMm: d26 } } as MushroomWeatherSummary;
  const n14 = genericRain14Signal(summary)!, n26 = calculateMushroomWeatherScore(summary, 'boletusEdulis').components.find(c => c.key === 'rain26')!.value;
  return { rain14: d14, rain26: d26, n14, n26, rainPoints: { V1: n26 * 50,
    ...Object.fromEntries(VARIANTS.map(v => [v.name, n26 * v.rain26 + n14 * v.rain14])) } as Record<Model, number> };
}
export function syntheticGrid() {
  return [0, 3, 10, 20, 40, 60, 80].flatMap(d14 => [20, 40, 60, 80, 100, 120, 160].filter(d26 => d14 <= d26).map(d26 => syntheticRain(d14, d26)));
}

const ROOT = resolve(__dirname, '../..');
async function main() {
  const flags = process.argv.slice(3);
  if (flags.some(f => !['--plan', '--fetch', '--offline'].includes(f)) || flags.includes('--fetch') && flags.includes('--offline')) throw new Error('Use --plan, --fetch, or --offline (default).');
  const v2 = resolve(ROOT, 'research-output/occurrence-validation-v2'), output = resolve(ROOT, 'research-output/occurrence-validation-v3');
  const cacheDirectory = resolve(ROOT, 'research/.cache/occurrence-validation-v2/weather');
  const read = (file: string) => JSON.parse(readFileSync(resolve(v2, file), 'utf8'));
  const audit = read('audit-summary.json'), previous = read('private-scores.json').filter((r: Occurrence) => r.profile === 'boletusEdulis');
  const gbif = new ResearchCache(resolve(ROOT, 'research/.cache/occurrence-validation-v2/gbif'), true);
  const weather = new ResearchCache(cacheDirectory, !flags.includes('--fetch'));
  const base = `https://api.gbif.org/v1/occurrence/search?datasetKey=${DATASET}&country=SI&taxonKey=5954958`;
  const all = await gbif.get(base + '&limit=300&offset=0'), filtered = await gbif.get(base + '&hasCoordinate=true&hasGeospatialIssue=false&limit=300&offset=0');
  ok(all.endOfRecords && filtered.endOfRecords);
  const sameAudit = auditSpecies(all.results, filtered.results, 5954958, audit.generatedAt.slice(0, 10));
  strictEqual(sameAudit.exactAcceptedSpecies, 43);
  const cohort = sameAudit.eligible;
  strictEqual(cohort.length, 29); deepStrictEqual(cohort.map(r => r.key).sort(), previous.map((r: Occurrence) => r.gbifID).sort());
  const cases = cohort.map((r, i) => ({ case: i + 1, record: r, date: exactDay(r)!,
    main: selectControls(exactDay(r)!), sensitivity: selectControls(exactDay(r)!, 28) }));
  const plan = { cutoff: STUDY_CUTOFF, occurrenceN: cases.length, requestedControls: cases.length * 4,
    primaryControls: cases.reduce((n, c) => n + c.main.length, 0), sensitivityControls: cases.reduce((n, c) => n + c.sensitivity.length, 0),
    mainControlsPerOccurrence: countBy(cases.map(c => c.main.length)), sensitivityControlsPerOccurrence: countBy(cases.map(c => c.sensitivity.length)),
    cases: cases.map(({ record: _record, ...c }) => c) };
  mkdirSync(output, { recursive: true }); writeFileSync(resolve(output, 'matching-plan.json'), JSON.stringify(plan, null, 2));
  console.log(`MATCHING ${JSON.stringify({ ...plan, cases: undefined })}`);
  if (flags.includes('--plan')) return;
  const evaluations = new Map<string, Evaluation>();
  const key = (r: Occurrence, d: string) => `${Number(r.decimalLatitude).toFixed(2)}:${Number(r.decimalLongitude).toFixed(2)}:${d}`;
  // Verify the original 29 cached production scores; no newly retrieved case inputs can replace them.
  for (const c of cases) {
    const saved = previous.find((r: Occurrence) => r.gbifID === c.record.key), url = weatherRequest(c.record);
    strictEqual(saved.weatherKey, hash(url));
    const replay = strictAssessment(await weather.get(url), c.record, 'boletusEdulis');
    deepStrictEqual(replay.score, saved.score); strictEqual(replay.dataQuality, saved.dataQuality);
    evaluations.set(key(c.record, c.date), evaluate(saved.summary, c.date, qualityTier(c.record.coordinateUncertaintyInMeters), saved.dataQuality));
  }
  const initialHits = weather.hits;
  // Group only one rounded public representative + calendar year per interval request. Never combine different locations.
  const groups = new Map<string, { record: Occurrence; dates: Set<string> }>();
  for (const c of cases) {
    const k = key(c.record, c.date).slice(0, -10) + c.date.slice(0, 4);
    const group = groups.get(k) ?? { record: c.record, dates: new Set<string>() };
    [...c.main, ...c.sensitivity].forEach(d => group.dates.add(d)); groups.set(k, group);
  }
  // Index previously cached intervals without printing URLs/coordinates; prefer immutable original data wherever sufficient.
  const available = readdirSync(cacheDirectory).filter(f => f.endsWith('.json')).map(f => {
    const envelope = JSON.parse(readFileSync(resolve(cacheDirectory, f), 'utf8'));
    const u = new URL(envelope.url); return { url: envelope.url, params: u.searchParams };
  });
  const failures: { group: number; kind: 'acquisition-or-replay' | 'insufficient-weather'; date?: string; reason: string; dates: number }[] = [];
  const failedTargets = new Set<string>(), cachedResponses = new Map<string, Occurrence>();
  const cachedGet = async (url: string) => {
    if (!cachedResponses.has(url)) cachedResponses.set(url, await weather.get(url));
    return cachedResponses.get(url)!;
  };
  const scoreTarget = (response: Occurrence, record: Occurrence, date: string, group: number) => {
    if (failedTargets.has(key(record, date))) return;
    const assessment = strictAssessment(sliceTarget(response, date), controlTarget(record, date), 'boletusEdulis');
    if (assessment.dataQuality === 'insufficient' || assessment.score.score == null) {
      failedTargets.add(key(record, date));
      failures.push({ group, kind: 'insufficient-weather', date, reason: 'Missing required production rain/temperature inputs; no imputation or resampling.', dates: 1 });
      return;
    }
    evaluations.set(key(record, date), evaluate(assessment.summary, date, 'matched', assessment.dataQuality));
  };
  let reusedControlEvaluations = 0, index = 0, mergedReplayChecks = 0;
  for (const group of groups.values()) {
    index++;
    const dates = [...group.dates].sort(), reference = new URL(weatherRequest(group.record));
    for (const date of dates) {
      if (evaluations.has(key(group.record, date))) continue;
      const candidate = available.find(a => [...reference.searchParams].every(([p, v]) => ['start_date', 'end_date'].includes(p) || a.params.get(p) === v)
        && a.params.get('start_date')! <= shiftLocalDate(date, -60) && a.params.get('end_date')! >= date);
      if (candidate) {
        scoreTarget(await cachedGet(candidate.url), group.record, date, index); reusedControlEvaluations++;
      }
    }
    const missing = dates.filter(d => !evaluations.has(key(group.record, d)) && !failedTargets.has(key(group.record, d)));
    if (missing.length) {
      reference.searchParams.set('start_date', shiftLocalDate(missing[0], -60));
      reference.searchParams.set('end_date', missing[missing.length - 1]);
      try {
        const response = await cachedGet(reference.toString());
        for (const date of missing) {
          if (!response.daily?.time?.includes(date)) throw new Error('Target day absent from archive.');
          scoreTarget(response, group.record, date, index);
        }
      } catch (error) {
        // No replacement control selection after seeing weather/failures; all planned dates remain in the failure audit.
        failures.push({ group: index, kind: 'acquisition-or-replay', reason: error instanceof Error ? error.message : 'Acquisition failed', dates: missing.length });
        console.log(`CONTROL WEATHER group=${index} failed (no coordinates logged).`);
      }
    }
    console.log(`CONTROL WEATHER ${index}/${groups.size}: evaluations=${evaluations.size}, HTTP=${weather.requests}, cacheHits=${weather.hits}`);
  }
  // Check interval transport even on a fully offline rerun. Case scores themselves always come from frozen V2 cache.
  for (const c of cases) {
    const reference = new URL(weatherRequest(c.record));
    const interval = [...cachedResponses.entries()].find(([url]) => {
      const p = new URL(url).searchParams;
      return [...reference.searchParams].every(([name, value]) => ['start_date', 'end_date'].includes(name) || p.get(name) === value)
        && p.get('start_date')! <= shiftLocalDate(c.date, -60) && p.get('end_date')! >= c.date;
    });
    if (interval) {
      const replay = strictAssessment(sliceTarget(interval[1], c.date), c.record, 'boletusEdulis');
      deepStrictEqual(replay.score, previous.find((r: Occurrence) => r.gbifID === c.record.key).score, 'merged transport must replay original case components');
      mergedReplayChecks++;
    }
  }
  const sets = (mode: 'main' | 'sensitivity'): MatchedSet[] => cases.map(c => ({ case: c.case,
    occurrence: evaluations.get(key(c.record, c.date))!, controls: c[mode].flatMap(d => {
      const result = evaluations.get(key(c.record, d)); return result ? [result] : [];
    }) }));
  const primarySets = sets('main'), sensitivitySets = sets('sensitivity');
  // An offline replay records transport separately from the initial acquisition, not as fabricated cold-cache requests.
  const resultPath = resolve(output, 'boletus_control_date_results.json');
  const prior = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : undefined;
  const acquisitionRuns = prior?.acquisitionRuns ?? (prior ? [{ generatedAt: prior.generatedAt, transport: prior.transport }] : []);
  const results = { schemaVersion: 3, generatedAt: new Date().toISOString(), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
    source: { dataset: DATASET, doi: '10.15468/ab3s5x', license: 'CC BY-NC 4.0', originalSnapshot: '2026-10-04', tierA: 27, tierB: 2 },
    cohortHash: hash(JSON.stringify(cohort.map(r => r.key).sort())),
    matching: plan, method: { controls: 'Pseudo-controls, not confirmed absences. April-November broad study boundary; same year/location; symmetric ±60 days; inclusive exclusions; weather-blind interior terciles per side.',
      weather: 'Identical V2 ERA5-seamless; D-60 <= history < D; soil D00 Europe/Ljubljana; no realised future rain or historical forecast claim.',
      rain14TargetMm: MUSHROOM_SCORE_V1_CONFIG.rain.targetsMm.days14, high: .8, low: .4,
      rank: 'Competition rank (one plus number strictly above); unique/tied rank 1 exclusive categories; rank 2 may itself tie.',
      quantiles: 'Linear (N-1)*p; production rounded integer scores; paired signed statistics unrounded.',
      partialFailure: 'Do not resample dates; unavailable required weather excludes that planned control from scored-only summaries. Transport/replay errors fail the run; genuine missing weather is reported, not imputed.' },
    transport: { gbifHTTP: gbif.requests, weatherHTTP: weather.requests, caseCacheHits: initialHits, totalWeatherCacheHits: weather.hits,
      reusedControlEvaluations, inflightJoins: weather.joins, uniqueEvaluations: evaluations.size, intervalGroups: groups.size,
      uniquePlannedEvaluations: new Set(cases.flatMap(c => [c.date, ...c.main, ...c.sensitivity].map(d => key(c.record, d)))).size,
      missingUniqueTargets: failedTargets.size,
      mergedReplayChecks, minimumStartSpacingMs: 2000, concurrency: 1, failures },
    acquisitionRuns, primary: analyze(primarySets), sensitivity28: analyze(sensitivitySets), primarySets, sensitivitySets,
    syntheticGrid: syntheticGrid(), phoneRainOnly: [80, 100, 110, 120].map(d26 => syntheticRain(2.9, d26)) };
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  writeFileSync(resolve(output, 'private-weather-manifest.json'), JSON.stringify([...weather.manifest.values()], null, 2));
  console.log(JSON.stringify({ transport: results.transport, primary: { occurrenceN: results.primary.occurrenceN, controlN: results.primary.controlN },
    sensitivity28: { occurrenceN: results.sensitivity28.occurrenceN, controlN: results.sensitivity28.controlN } }, null, 2));
  if (failures.some(f => f.kind === 'acquisition-or-replay')) throw new Error('Study incomplete: acquisition/replay failures recorded.');
}
if (process.argv[2] && resolve(process.argv[2]) === __filename) void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Study failed'); process.exitCode = 1;
});
