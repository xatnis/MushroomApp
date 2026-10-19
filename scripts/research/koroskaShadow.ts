/** CLI only: explicit network opt-in, immutable captures, offline replay and consolidation. */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { captureContracts, type ContractCapture } from './koroskaContractCapture';
import { captureDst, analyseDst, type DstCapture } from './koroskaShadowDst';
import { analyseOperational, consolidate, type OperationalAnalysis } from './koroskaShadowAnalysis';
import { SHADOW_ROOT, importBaseline, storeSnapshot, loadSnapshot, listSnapshots, saveReport, codeDigests } from './koroskaShadowStore';
import { digest } from './koroskaRegionalPrototype';

async function main() {
  // runSmoke.cjs retains its own argv[1] and the TypeScript entry at argv[2].
  const command = process.argv[3], args = process.argv.slice(4);
  if (command === 'import-baseline') return console.log(importBaseline(SHADOW_ROOT).id);
  if (command === 'capture' || command === 'capture-dst') {
    if (!args.includes('--live')) throw new Error('Network requires --live (operational <=4; historical DST <=4 requests).');
    const data = command === 'capture' ? await captureContracts(JSON.parse(readFileSync('docs/research/koroska-regional-week-v1.sources.json', 'utf8'))) : await captureDst();
    const entry = storeSnapshot(SHADOW_ROOT, command === 'capture' ? 'operational' : 'historical-dst', data, 'completedAt' in data ? data.completedAt : '');
    return console.log(JSON.stringify({ id: entry.id, measurement: data.measurement, storedEvenIfPartial: true }, null, 2));
  }
  if (command !== 'replay' && command !== 'report') throw new Error('Commands: import-baseline | capture --live | capture-dst --live | replay <id> | report');
  if (command === 'replay' && !args[0]) throw new Error('replay requires a stored snapshot ID');
  const ids = command === 'replay' ? [args[0]] : listSnapshots(SHADOW_ROOT), snapshots: OperationalAnalysis[] = [], excluded: Array<{ id: string; reason: string }> = [], dst: unknown[] = [], performance: unknown[] = [];
  const timings: Record<string, { calls: number; ms: number }> = {}, restore: Array<() => void> = [];
  for (const [path, key] of [['../../src/domain/mushroomWeather', 'calculateMushroomWeatherScore'],
    ['../../src/domain/weatherIntervals', 'aggregateCivilDay'], ['../../src/domain/soilSampling', 'sampleNativeSoil']]) {
    const module = require(path), prior = module[key]; timings[key] = { calls: 0, ms: 0 };
    module[key] = (...values: unknown[]) => { const start = globalThis.performance.now(); try { return prior(...values); }
      finally { timings[key].calls++; timings[key].ms += globalThis.performance.now() - start; } };
    restore.push(() => { module[key] = prior; });
  }
  // Never fetch or silently replace incompatible evidence during replay.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('External network disabled during offline replay'); }) as typeof fetch;
  try {
    for (const id of ids) {
      try {
        const { entry, data } = loadSnapshot(SHADOW_ROOT, id);
        if (digest(entry.code) !== digest(codeDigests())) throw new Error('Production replay-code version mismatch; do not mix derived versions');
        if (entry.kind === 'historical-dst') dst.push({ id, ...analyseDst(data as DstCapture) });
        else { const result = await analyseOperational(data as ContractCapture, entry); snapshots.push(result.stable); performance.push(result.measurement); }
      } catch (error) { excluded.push({ id, reason: String(error) }); }
    }
  } finally { globalThis.fetch = original; restore.reverse().forEach(fn => fn()); }
  const report = { ...consolidate(snapshots, excluded), historicalDst: dst };
  const saved = saveReport(SHADOW_ROOT, report), measured = saveReport(SHADOW_ROOT, { schema: 'koroska-shadow-replay-measurements-v1', reportDigest: digest(report), performance, functionTimings: timings,
    note: 'Research-process synchronous wrappers restored afterward; nested timings not additive, CPU user/system in microseconds, not Android.' });
  console.log(JSON.stringify({ ...saved, measurementArtifact: measured, snapshotCount: report.snapshotCount, separatedRetrievals: report.meaningfullySeparatedRetrievals,
    evidenceComplete: report.multiSnapshotEvidenceComplete, excluded, summaries: snapshots.map(s => ({ id: s.id, dates: s.dates, weather: s.weather, cells: s.cells,
      crossings: s.thresholds.crossings, captureHttp: s.originalAcquisition.httpRequests, decodedBodyBytes: s.decodedBodyBytes })),
    dst: dst.map((d: any) => ({ id: d.id, controls: d.controls.map((c: any) => ({ transition: c.transition, status: c.status, coverage: c.coverage, deltas: c.transitionDay,
      scoreDeltas: c.pairs?.map((p: any) => ({ date: p.date, profiles: p.profiles.map((x: any) => ({ profile: x.profile, delta: x.delta })) })) })) })),
    performance, serializedSummaryGzipBytes: gzipSync(JSON.stringify(report)).length }, null, 2));
  if (excluded.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
