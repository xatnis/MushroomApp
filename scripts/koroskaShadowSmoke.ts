import { strictEqual, deepStrictEqual, ok, throws, rejects } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { importBaseline, loadSnapshot, storeSnapshot, saveReport, listSnapshots, SHADOW_ROOT, BASELINE_CAPTURE } from './research/koroskaShadowStore';
import { analyseOperational, consolidate, thresholdAnalysis, THRESHOLDS } from './research/koroskaShadowAnalysis';
import { analyseDst, dstRequestPlan, type DstCapture } from './research/koroskaShadowDst';
import type { ContractCapture } from './research/koroskaContractCapture';
import { digest, PROFILES } from './research/koroskaRegionalPrototype';
import { replayDaily } from './research/koroskaContractCapture';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { civilDailyPeriod } from '../src/domain/soilSampling';

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'mushroom-koroska-shadow-')), original = globalThis.fetch;
  let escapedHttp = 0;
  globalThis.fetch = (async () => { escapedHttp++; throw new Error('Offline tests prohibit HTTP'); }) as typeof fetch;
  try {
    const entry = importBaseline(root), capture = JSON.parse(readFileSync(BASELINE_CAPTURE, 'utf8')) as ContractCapture;
    strictEqual(digest(loadSnapshot(root, entry.id).data), digest(capture));
    throws(() => importBaseline(root), /EEXIST/); strictEqual(listSnapshots(root).length, 1);
    throws(() => loadSnapshot(root, '../outside'), /Unsafe/);
    const at = '2026-10-19T08:24:12.278Z', testOnly = { explicitlySyntheticStorageFixture: true };
    const extra = storeSnapshot(root, 'operational', testOnly, at);
    ok(extra.id !== entry.id); strictEqual(listSnapshots(root).length, 2);
    const altered = { ...extra, data: { tampered: true } };
    writeFileSync(join(root, extra.id + '.json.gz'), gzipSync(JSON.stringify(altered)));
    throws(() => loadSnapshot(root, extra.id), /Changed/);
    const report = { fixture: true, zero: 0, missing: null };
    strictEqual(saveReport(root, report).file, saveReport(root, report).file);
    const analysed = await analyseOperational(capture, entry), a = analysed.stable;
    strictEqual(a.comparability.category, 'authentic-observational'); strictEqual(a.comparability.providerRunEqualityVerified, false);
    strictEqual(a.weather.changed, 4); strictEqual(a.cells.changed, 185); strictEqual(a.cells.categoryChanges, 94);
    strictEqual(a.thresholds.crossings.length, 1); strictEqual(a.thresholds.crossings[0].candidateCells, 94);
    deepStrictEqual(a.thresholds.crossings[0].crossedThresholds, [50]);
    ok(a.thresholds.changedRawBoundaryDistance.max! < .05);
    strictEqual(a.thresholds.candidateTransitionMatrix['Dobre razmere']['Povprečne razmere'], 94);
    const repeat = await analyseOperational(capture, entry); deepStrictEqual(repeat.stable, a);
    const secondId = listSnapshots(SHADOW_ROOT).find(id => id.startsWith('operational-') && id !== entry.id); ok(secondId);
    const second = loadSnapshot(SHADOW_ROOT, secondId), secondAnalysis = await analyseOperational(second.data as ContractCapture, second.entry);
    const realSeries = consolidate([a, secondAnalysis.stable]); strictEqual(realSeries.snapshotCount, 2);
    strictEqual(realSeries.meaningfullySeparatedRetrievals, 2); strictEqual(realSeries.multiSnapshotEvidenceComplete, false);
    strictEqual(secondAnalysis.stable.weather.cases, 88); strictEqual(secondAnalysis.stable.cells.cases, 4776);
    deepStrictEqual(THRESHOLDS.generic, { average: 25, good: 50, veryGood: 70, excellent: 85 });
    for (const p of PROFILES.filter(p => p !== 'generic')) strictEqual(THRESHOLDS[p].average, 30);
    const { batch } = await replayDaily(capture); ok(batch);
    for (const c of a.cases) {
      const actual = assessHeatmapWeather(batch.cells[c.weatherId], c.profileId, c.targetLocalDate === capture.baseLocalDate ? 'today' : 'tomorrow');
      const canonical = calculateMushroomWeatherScore(actual.summary, c.profileId);
      strictEqual(actual.score.score, canonical.score); strictEqual(actual.score.label, canonical.label); strictEqual(c.legacyLabel, canonical.label);
    }
    // Labelled synthetic SERIES metadata, not more real independent captures.
    const near = { ...a, id: 'fixture-near', capturedAt: '2026-10-18T20:10:18.364Z' };
    strictEqual(consolidate([a, near]).meaningfullySeparatedRetrievals, 1);
    const later = { ...a, id: 'fixture-later', capturedAt: '2026-10-19T08:24:12.278Z' };
    strictEqual(consolidate([a, later]).refreshComparisons.length, 1);
    strictEqual(consolidate([a, later]).multiSnapshotEvidenceComplete, false);
    const dateGroup = { ...later, dates: ['2026-10-19', '2026-10-20'], baseLocalDate: '2026-10-19' };
    strictEqual(consolidate([a, dateGroup]).groups.length, 2); strictEqual(consolidate([a, dateGroup]).refreshComparisons.length, 0);
    const version = { ...a, id: 'fixture-version', codeFingerprint: 'different' };
    strictEqual(consolidate([a, version]).groups.length, 2);
    const unavailable = { ...a, comparability: { ...a.comparability, category: 'incompatible-or-partial' } };
    strictEqual(consolidate([unavailable]).compatibleSnapshots, 0);
    const missing = structuredClone(capture), record = missing.records.find(r => r.path === 'daily' && r.endpoint === 'forecast')!, old = record.payloadDigest;
    const rows = record.payload as any[]; delete rows[0].hourly.soil_moisture_7_to_28cm; record.payloadDigest = digest(record.payload);
    missing.legacyCache.filter(c => c.payloadDigest === old).forEach(c => { c.payloadDigest = record.payloadDigest!; });
    const limited = await analyseOperational(missing, { ...entry, id: 'fixture-missing-layer' });
    strictEqual(limited.stable.comparability.category, 'incompatible-or-partial');
    strictEqual(limited.stable.thresholds.rows.length, 80); // Do not pool incomplete factor sets into complete category sensitivity.
    const bad = structuredClone(capture); bad.hourlyBatch.baseLocalDate = '2026-10-20';
    await rejects(() => analyseOperational(bad, entry), /matched-date/);

    const actualDstId = listSnapshots(SHADOW_ROOT).find(id => id.startsWith('historical-dst-')); ok(actualDstId);
    const dst = loadSnapshot(SHADOW_ROOT, actualDstId).data as DstCapture, evidence = analyseDst(dst);
    strictEqual(evidence.operationalForecastParityEstablished, false);
    for (const control of evidence.controls) {
      strictEqual(control.status, 'authentic-archive-observational');
      const expected = control.transition === '2026-03-29' ? 23 : 25;
      for (const coverage of Object.values(control.coverage!)) { strictEqual(coverage.expected, expected); strictEqual(coverage.available, expected); ok(coverage.complete); }
      strictEqual(control.fixedProviderPeriod!.compatible, false);
      ok(control.pairs!.every(p => p.profiles.every(x => x.canonicalCovered && x.hourlyScore != null)));
      for (const day of control.dailyDiagnostics!) for (const pair of Object.values(day.variables)) {
        const { primary, secondaryProductDifference: product, secondaryBoundaryEffect: boundary } = pair;
        if (primary.delta != null && product.delta != null && boundary.delta != null) ok(Math.abs(primary.delta - product.delta - boundary.delta) < 1e-9);
      }
    }
    const partial = structuredClone(dst), h = partial.records.find(r => r.path === 'hourly' && r.transition === '2026-03-29')!;
    const payload = h.payload as any, instant = Date.parse(civilDailyPeriod('2026-03-29').startUtc!) / 1000 + 3600;
    payload.hourly.precipitation[payload.hourly.time.indexOf(instant)] = null; h.payloadDigest = digest(payload);
    const gated = analyseDst(partial).controls.find(c => c.transition === '2026-03-29')!;
    strictEqual(gated.coverage!.precipitation.complete, false);
    ok(gated.pairs!.find(p => p.date === '2026-03-30')!.profiles.every(p => p.hourlyScore === null && p.missing.length));
    const failed = structuredClone(dst); failed.records[0].httpStatus = 503; failed.records[0].error = 'controlled archive failure';
    strictEqual(analyseDst(failed).controls[0].status, 'unavailable');
    ok(dstRequestPlan().every(p => new URL(p.url).hostname === 'archive-api.open-meteo.com'));
    ok(!dstRequestPlan().some(p => p.url.includes('2026-10-25')));
    strictEqual(digest(evidence), digest(analyseDst(dst))); strictEqual(escapedHttp, 0);
    console.log('PASS append-only storage/duplicate/hash/replay; actual 2x88 inputs/factors/cells; thresholds/point labels; grouping/vintage/partial gates; authentic historical 23/25h archive controls and missing intervals; external HTTP=0. Temporary fixtures:', root);
  } finally { globalThis.fetch = original; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
