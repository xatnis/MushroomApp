/** Observational contract deltas and threshold diagnostics; no replacement scoring rules. */
import { performance } from 'node:perf_hooks';
import { validateContracts } from './koroskaContractValidation';
import { digest, distribution, selectPilot, PROFILES } from './koroskaRegionalPrototype';
import { habitatStateFor } from '../../src/domain/heatmap/pilot';
import { MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG } from '../../src/domain/mushroomWeather';
import type { ContractCapture } from './koroskaContractCapture';
import type { StoredSnapshot } from './koroskaShadowStore';

export const THRESHOLDS = { generic: MUSHROOM_SCORE_V1_CONFIG.thresholds, boletusEdulis: BOLETUS_EDULIS_SCORE_V1_CONFIG.thresholds,
  cantharellusCibarius: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.thresholds, lactariusDeliciosus: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG.thresholds };
type Report = Awaited<ReturnType<typeof validateContracts>>['report'];
type Case = Report['cases'][number];
const matrix = (rows: Array<{ from: string; to: string; count: number }>) => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) { out[r.from] ??= {}; out[r.from][r.to] = (out[r.from][r.to] ?? 0) + r.count; }
  return out;
};
export function thresholdAnalysis(cases: Case[]) {
  const pilot = selectPilot();
  const weights = Object.fromEntries(pilot.weather.map(w => [w.id, Object.fromEntries(PROFILES.map(p => [p,
    pilot.cells.filter(c => c.properties.weatherCellId === w.id && habitatStateFor(c, p) === 'candidate').length]))]));
  const rows = cases.filter(c => c.fullyComparable && c.legacyScore != null && c.hourlyScore != null).map(c => {
    if (c.factors.reduce((sum, f) => sum + (f.legacy?.weight ?? 0), 0) !== 100
      || c.factors.reduce((sum, f) => sum + (f.hourly?.weight ?? 0), 0) !== 100) throw new Error('Raw threshold distance requires complete 100-weight factors');
    const thresholds = Object.values(THRESHOLDS[c.profileId]);
    const crossed = thresholds.filter(t => (c.legacyScore! < t) !== (c.hourlyScore! < t));
    const nearest = (score: number, continuous: boolean) => Math.min(...thresholds.map(t => Math.abs(score - (t - (continuous ? .5 : 0)))));
    return { weatherId: c.weatherId, profileId: c.profileId, targetLocalDate: c.targetLocalDate,
      legacyScore: c.legacyScore!, hourlyScore: c.hourlyScore!, legacyLabel: c.legacyLabel!, hourlyLabel: c.hourlyLabel!,
      crossedThresholds: crossed, categoryChanged: c.categoryChanged, candidateCells: weights[c.weatherId][c.profileId],
      integerDistance: { legacy: nearest(c.legacyScore!, false), hourly: nearest(c.hourlyScore!, false) },
      rawRoundingBoundaryDistance: { legacy: nearest(c.componentPointSums.legacy!, true), hourly: nearest(c.componentPointSums.hourly!, true) } };
  });
  return { thresholds: THRESHOLDS, rows, crossings: rows.filter(r => r.crossedThresholds.length),
    weatherTransitionMatrix: matrix(rows.map(r => ({ from: r.legacyLabel, to: r.hourlyLabel, count: 1 }))),
    candidateTransitionMatrix: matrix(rows.map(r => ({ from: r.legacyLabel, to: r.hourlyLabel, count: r.candidateCells }))),
    integerDistance: distribution(rows.flatMap(r => Object.values(r.integerDistance))),
    rawRoundingBoundaryDistance: distribution(rows.flatMap(r => Object.values(r.rawRoundingBoundaryDistance))),
    changedRawBoundaryDistance: distribution(rows.filter(r => r.categoryChanged).flatMap(r => Object.values(r.rawRoundingBoundaryDistance))),
    note: 'Thresholds imported from production config. Raw boundary t-0.5 applies only to full 100-weight canonical sums. No smoothing, new thresholds or publication override.' };
}
export async function analyseOperational(capture: ContractCapture, entry: StoredSnapshot) {
  const start = performance.now(), cpu = process.cpuUsage(), { report } = await validateContracts(capture);
  const thresholds = thresholdAnalysis(report.cases);
  const gridPairs = report.metadata.flatMap(m => (['Archive', 'Forecast'] as const).map(endpoint => {
    const a = m[`daily${endpoint}`], b = m[`hourly${endpoint}`];
    return { weatherId: m.weatherId, endpoint, daily: a.returnedCoordinates, hourly: b.returnedCoordinates,
      equal: a.returnedCoordinates != null && b.returnedCoordinates != null && digest(a.returnedCoordinates) === digest(b.returnedCoordinates),
      dailyRetrievedAt: a.retrievedAt, hourlyRetrievedAt: b.retrievedAt, dailyRequestedModel: a.requestedModel,
      hourlyRequestedModel: b.requestedModel, dailyReturnedModel: a.returnedModelId, hourlyReturnedModel: b.returnedModelId,
      verifiedModelRunTime: null };
  }));
  const compatible = report.fullQualityCases === 88 && report.cases.every(c => c.identityAndUnitsComparable);
  const stable = { id: entry.id, contentHash: entry.contentHash, capturedAt: entry.capturedAt, baseLocalDate: report.baseLocalDate,
    dates: report.dates, codeFingerprint: digest(entry.code), geometryFingerprint: report.geometryFingerprint, contracts: report.contracts,
    comparability: { category: compatible ? 'authentic-observational' : 'incompatible-or-partial', requestedCoordinatesEqual: true,
      targetDatesEqual: true, unitsEqual: report.cases.every(c => c.identityAndUnitsComparable), fullQualityCases: report.fullQualityCases,
      sourceModelEqualityVerified: false, forecastIssueEqualityVerified: false, providerRunEqualityVerified: false,
      maxRetrievalSkewMs: Math.max(...capture.records.flatMap(r => r.fetchedAt ? [Date.parse(r.fetchedAt)] : []))
        - Math.min(...capture.records.flatMap(r => r.fetchedAt ? [Date.parse(r.fetchedAt)] : [])), gridPairs },
    weather: report.weatherScoreImpact, cells: report.candidateCellImpact, byProfileDate: report.byProfileDate,
    rawInputEquality: report.rawInputEquality, soilInstantEquality: report.soilInstantEquality,
    variables: report.variableSummary, factors: report.factorSummary, cases: report.cases, thresholds,
    habitat: { unknown: 756, outsideModel: 36, totalCombinations: 5568 },
    dailyBoundaryMismatches: report.dailyBoundaryMismatches, sourceFreshness: report.snapshotValidity,
    originalAcquisition: capture.measurement, decodedBodyBytes: capture.records.reduce((sum, r) => sum + (r.bodyBytes ?? 0), 0) };
  return { stable, measurement: { id: entry.id, replayMs: performance.now() - start, cpu: process.cpuUsage(cpu),
    peakProcessRssBytes: process.resourceUsage().maxRSS * 1024, stages: report.performance } };
}
export type OperationalAnalysis = Awaited<ReturnType<typeof analyseOperational>>['stable'];
export function consolidate(snapshots: OperationalAnalysis[], excluded: Array<{ id: string; reason: string }> = []) {
  const compatible = snapshots.filter(s => s.comparability.category === 'authentic-observational').sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  // A time gap is only a retrieval-separation criterion, never evidence of independent model cycles.
  const separated: OperationalAnalysis[] = [];
  for (const s of compatible) if (!separated.length || Date.parse(s.capturedAt) - Date.parse(separated.at(-1)!.capturedAt) >= 6 * 3600000) separated.push(s);
  const groups = new Map<string, OperationalAnalysis[]>();
  for (const s of compatible) {
    const key = digest([s.contracts, s.codeFingerprint, s.geometryFingerprint, s.dates]);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const refreshComparisons = [...groups.values()].flatMap(group => group.slice(1).map((next, i) => {
    const before = group[i];
    return { before: before.id, after: next.id, dates: next.dates, gapHours: (Date.parse(next.capturedAt) - Date.parse(before.capturedAt)) / 3600000,
      providerRunsVerified: false, paths: (['legacy', 'hourly'] as const).map(path => {
        const transitions = before.thresholds.rows.map(a => {
          const b = next.thresholds.rows.find(r => r.weatherId === a.weatherId && r.profileId === a.profileId && r.targetLocalDate === a.targetLocalDate)!;
          return { from: a[`${path}Label`], to: b[`${path}Label`], count: a.candidateCells };
        });
        return { path, candidateCategoryTransitions: matrix(transitions), changedCandidateCategories: transitions.filter(t => t.from !== t.to).reduce((sum, t) => sum + t.count, 0) };
      }) };
  }));
  return { schema: 'koroska-shadow-series-report-v1', researchOnly: true, snapshots, excluded,
    snapshotCount: snapshots.length, compatibleSnapshots: compatible.length, meaningfullySeparatedRetrievals: separated.length,
    multiSnapshotEvidenceComplete: separated.length >= 3 && new Set(separated.map(s => s.baseLocalDate)).size >= 2, verifiedIndependentModelCycles: 0,
    groups: [...groups].map(([key, rows]) => ({ key, dates: rows[0].dates, snapshotIds: rows.map(r => r.id) })), refreshComparisons,
    interpretation: 'No pooled parity percentage across target-date/version groups. Cross-contract category sensitivity is not measured refresh flicker. Retrieval separation >=6h does not verify model independence.',
    evidenceStopRule: 'At most three complete retrieval snapshots >=6h apart spanning >=2 local dates plus the two past-DST controls for this initial gate. If operational gates pass, decide the limited preview without waiting indefinitely for unavailable model-run IDs.',
    recommendedMilestone: compatible.length ? 'Developer-only Koroška seven-day shadow map preview' : 'Specific unresolved provider/data investigation',
    recommendationRequiresHumanReview: true, publicMigrationApproved: false };
}
