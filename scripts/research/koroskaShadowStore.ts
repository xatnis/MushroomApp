/** Append-only research storage. Never reads a user DB or writes production caches. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { digest } from './koroskaRegionalPrototype';
import type { ContractCapture } from './koroskaContractCapture';

export const SHADOW_ROOT = 'docs/research/koroska-shadow-v1';
export const BASELINE_CAPTURE = 'docs/research/koroska-contract-validation-v1.capture.json';
const CODE_FILES = ['src/services/weather.ts', 'src/services/sevenDayHourlyWeather.ts', 'src/domain/weatherIntervals.ts',
  'src/domain/soilSampling.ts', 'src/domain/sevenDayConditions.ts', 'src/domain/mushroomWeather.ts', 'src/domain/heatmap/assessment.ts'];
export const codeDigests = () => Object.fromEntries(CODE_FILES.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
export interface StoredSnapshot {
  schema: 'koroska-shadow-snapshot-v1'; kind: 'operational' | 'historical-dst'; id: string; contentHash: string;
  code: Record<string, string>; capturedAt: string; data?: unknown; reference?: string;
}
export const snapshotId = (kind: StoredSnapshot['kind'], at: string, hash: string) => {
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid capture timestamp');
  return `${kind}-${new Date(at).toISOString().replace(/[^0-9]/g, '')}-${hash.slice(0, 20)}`;
};
function safeFile(root: string, id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Unsafe snapshot ID');
  return join(root, id + '.json.gz');
}
export function storeSnapshot(root: string, kind: StoredSnapshot['kind'], data: unknown, at: string, reference?: string) {
  mkdirSync(root, { recursive: true });
  const contentHash = digest(data), id = snapshotId(kind, at, contentHash);
  const entry: StoredSnapshot = { schema: 'koroska-shadow-snapshot-v1', kind, id, contentHash, capturedAt: at, code: codeDigests(),
    ...(reference ? { reference } : { data }) };
  // One exclusive file creation: identical imports fail rather than silently overwrite old evidence.
  writeFileSync(safeFile(root, id), gzipSync(JSON.stringify(entry) + '\n'), { flag: 'wx' });
  return entry;
}
export function loadSnapshot(root: string, id: string, repository = process.cwd()) {
  const entry = JSON.parse(gunzipSync(readFileSync(safeFile(root, id))).toString()) as StoredSnapshot;
  if (entry.schema !== 'koroska-shadow-snapshot-v1' || entry.id !== id || !['operational', 'historical-dst'].includes(entry.kind)) throw new Error('Unsupported snapshot envelope');
  let data = entry.data;
  if (entry.reference) {
    const file = resolve(repository, entry.reference), within = relative(resolve(repository), file);
    if (within.startsWith('..' + sep) || within === '..' || resolve(file) === resolve(repository)) throw new Error('Unsafe evidence reference');
    data = JSON.parse(readFileSync(file, 'utf8'));
  }
  if (digest(data) !== entry.contentHash || snapshotId(entry.kind, entry.capturedAt, entry.contentHash) !== id) throw new Error('Changed snapshot evidence');
  return { entry, data };
}
export function listSnapshots(root: string) {
  mkdirSync(root, { recursive: true });
  const names = readdirSync(root).filter(n => /^(operational|historical-dst)-[a-z0-9-]+\.json\.gz$/.test(n)).sort();
  if (names.length > 100) throw new Error('Bounded research store limit: 100 snapshots');
  return names.map(n => n.slice(0, -8));
}
export function importBaseline(root: string) {
  const data = JSON.parse(readFileSync(BASELINE_CAPTURE, 'utf8')) as ContractCapture;
  const prior = JSON.parse(readFileSync('docs/research/koroska-contract-validation-v1.report.json', 'utf8'));
  if (digest(prior.productionCodeDigests) !== digest(codeDigests())) throw new Error('Baseline replay code changed; review versions before import');
  return storeSnapshot(root, 'operational', data, data.completedAt, BASELINE_CAPTURE);
}
export function saveReport(root: string, report: unknown) {
  mkdirSync(root, { recursive: true });
  const id = `report-${digest(report).slice(0, 20)}`, file = safeFile(root, id);
  const bytes = gzipSync(JSON.stringify(report) + '\n');
  try { writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || digest(JSON.parse(gunzipSync(readFileSync(file)).toString())) !== digest(report)) throw e;
  }
  return { file, jsonBytes: Buffer.byteLength(JSON.stringify(report) + '\n'), gzipBytes: bytes.length };
}
