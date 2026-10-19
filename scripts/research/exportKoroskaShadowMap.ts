/** Explicit offline conversion; no Node research modules or raw weather shipped to React Native. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { loadSnapshot, SHADOW_ROOT, codeDigests } from './koroskaShadowStore';
import { buildPrototype, digest, selectPilot, cellResult } from './koroskaRegionalPrototype';
import { categoryForLabel, validateShadowArtifact, shadowGeometry, shadowPaint, type ShadowArtifact } from '../../src/experimental/koroskaShadowData';
import type { ContractCapture } from './koroskaContractCapture';

async function main() {
  const args = process.argv.slice(3), id = args[args.indexOf('--snapshot') + 1];
  if (!args.includes('--snapshot') || !id) throw new Error('Use --snapshot <operational-id> [--write]');
  const start = performance.now(), cpu = process.cpuUsage(), { entry, data: raw } = loadSnapshot(SHADOW_ROOT, id);
  if (entry.kind !== 'operational' || digest(entry.code) !== digest(codeDigests())) throw new Error('Use authentic operational sources with matching production code.');
  const capture = raw as ContractCapture;
  if (capture.schema !== 'koroska-authentic-contract-capture-v1' || capture.evidence !== 'authentic-provider-responses') throw new Error('Synthetic/archive controls are not preview input.');
  const { validateContracts } = require('./koroskaContractValidation') as typeof import('./koroskaContractValidation');
  await validateContracts(capture); // Actual source/hash/date/coordinate gates, no reconstructed primary daily response.
  const built = await buildPrototype(capture.hourlyBatch, digest(codeDigests())), pilot = selectPilot(), d = built.data;
  const artifact: ShadowArtifact = { schema: 'koroska-shadow-map-v1', researchOnly: true, contract: d.inputVersion,
    snapshotId: d.batchId, captureId: entry.id, capturedAt: capture.completedAt, expiresAt: Math.min(...d.snapshotValidity.map(s => s.expiresAt)), modelIssuedAt: null,
    modelFingerprint: d.modelFingerprint, geometryFingerprint: d.geometryFingerprint, dates: d.dates, profiles: d.profiles,
    bounds: [14.65, 46.35, 15.05, 46.59], attribution: d.attribution, weather: d.weather.map(({ id, latitude, longitude }) => ({ id, latitude, longitude })),
    provenance: d.sourceManifest.map(s => ({ weatherId: s.weatherId, source: s.endpoint, retrievedAt: s.retrievedAt, sha256: s.sha256 })),
    cells: d.cells.map((c, i) => ({ id: c.id, weatherIndex: c.weatherIndex, habitat: c.habitat, geometry: pilot.cells[i].geometry })),
    vectors: d.vectors.map(v => ({ score: v.componentsVerified ? v.score : null, label: v.componentsVerified && v.score != null ? v.label : null,
      status: v.status, missing: v.missing, category: v.componentsVerified && v.score != null ? categoryForLabel(v.label) : 'insufficient' })) };
  validateShadowArtifact(artifact);
  const encoded = JSON.stringify(artifact) + '\n', parseTimes: number[] = [], geometryTimes: number[] = [];
  let geometry = '';
  for (let i = 0; i < 5; i++) { let t = performance.now(); JSON.parse(encoded); parseTimes.push(performance.now() - t);
    t = performance.now(); geometry = shadowGeometry(artifact); geometryTimes.push(performance.now() - t); }
  const paint = { 'fill-color': ['match', ['get', 'renderState'], 'good', '#7EA46E', '#A6A6A6'] }, switched = performance.now();
  for (let i = 0; i < 1000; i++) shadowPaint(paint, i % 4, i % 7);
  const thousandPaintSwitchesMs = performance.now() - switched, states: Record<string, number> = {};
  for (let c = 0; c < 696; c++) for (let p = 0; p < 4; p++) for (let day = 0; day < 7; day++) {
    const result = cellResult(d, c, p, day); states[result.availability] = (states[result.availability] ?? 0) + 1;
  }
  const metrics = { schema: 'koroska-shadow-map-export-v1', captureId: id, artifactDigest: digest(artifact), dates: d.dates, cells: 696, weather: 11,
    states, artifactBytes: Buffer.byteLength(encoded), artifactGzipBytes: gzipSync(encoded).length,
    nativeSourceJsonBytes: Buffer.byteLength(geometry), nativeSourceGzipBytes: gzipSync(geometry).length,
    medianParseMs: parseTimes.sort((a, b) => a - b)[2], medianGeometryMs: geometryTimes.sort((a, b) => a - b)[2], thousandPaintSwitchesMs,
    build: built.metrics, totalMs: performance.now() - start, processCpu: process.cpuUsage(cpu), peakRssBytes: process.resourceUsage().maxRSS * 1024,
    httpRequests: 0, nativeFrameTiming: 'not measured', note: 'Windows/Node offline export, not Android. Immutable source and per-switch paint only.' };
  if (args.includes('--write')) {
    mkdirSync('src/data/koroskaShadow', { recursive: true }); writeFileSync('src/data/koroskaShadow/snapshot.json', encoded);
    writeFileSync('docs/research/koroska-shadow-map-v1.export.json', JSON.stringify(metrics, null, 2) + '\n');
  }
  console.log(JSON.stringify(metrics, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
