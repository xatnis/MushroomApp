/** Explicit opt-in, whole-batch adapter. No production point/region policy or raw-cache replacement. */
import type { SQLiteDatabase } from 'expo-sqlite';
import { CANONICAL_POINT_POLICY, type SevenDayResult } from '../domain/sevenDayConditions';
import { HOURLY_INTERVAL_CONTRACT, type UtcHourlyWeather } from '../domain/weatherIntervals';
import { weatherLocalDate } from '../domain/weatherSeries';
import { cachedFetch, shiftLocalDate } from '../services/weather';
import { sevenDayHourlyRequestPlan } from '../services/sevenDayHourlyWeather';
import { loadPointSnapshots, pointResults } from '../services/pointConditions';
import { MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG } from '../domain/mushroomWeather';
import { KOROSKA_SHADOW_ENABLED, categoryForLabel, validateShadowArtifact, type ShadowArtifact, type ShadowVector } from './koroskaShadowData';

export const LIVE_REGIONAL_VERSION = 'koroska-live-regional-v1';
const TTL = 30 * 60000; // Existing raw transport TTL, never renewed by replay or a UI interaction.
const MAX_COHORT_SKEW = 20000; // Acquisition guard, NOT a provider model-cycle assertion.
type ProviderWeather = UtcHourlyWeather & { latitude?: number; longitude?: number; elevation?: number };
export interface LiveRegionalVector extends ShadowVector {
  profileId: ShadowArtifact['profiles'][number]; weatherId: string;
  targetLocalDate: string; componentsVerified: boolean; factors: SevenDayResult['canonical']['components'];
  soilSampling: SevenDayResult['soilSampling']; inputs: Omit<NonNullable<SevenDayResult['inputs']['historical']>, 'days'> | null;
}
export interface LiveRegionalSnapshot {
  schema: typeof LIVE_REGIONAL_VERSION; contract: 'regional-civil-week-v1'; inputContract: typeof HOURLY_INTERVAL_CONTRACT;
  pointPolicy: typeof CANONICAL_POINT_POLICY; snapshotId: string; baseLocalDate: string; dates: string[];
  geometryFingerprint: string; modelFingerprint: string; retrievedAt: string; assembledAt: string; expiresAt: number; modelIssuedAt: null;
  scorerConfigurationId: string; profiles: ShadowArtifact['profiles']; weather: ShadowArtifact['weather'];
  staleAtAcquisition: boolean; publicationAllowed: boolean; missing: string[]; vectors: LiveRegionalVector[];
  sources: Array<{ endpoint: string; url: string; retrievedAt: string; sha256: string; stale: boolean;
    units: Record<string, string>; returned: Array<{ weatherId: string; requested: [number, number]; latitude: number; longitude: number;
    elevation: number | null; locationId: number; firstEpoch: number | null; lastEpoch: number | null; hours: number;
    units: Record<string, string>; currentEpoch: number | null; timezone: string | null; utcOffsetSeconds: number | null; variables: string[] }> }>;
  metrics: { adapterMs: number; evaluationMs: number; evaluations: number; decodedJsonBytes: number[]; preparationMs: number;
    totalMs: number; sourcePairMs: number; requestsStarted: number; network: Array<{ endpoint: string; responseMs: number | null; decodeMs: number | null }> };
}
interface Receipt { schema: 'koroska-live-cohort-v1'; identity: string; baseLocalDate: string; createdAt: string; expiresAt: number }
const stores = new WeakMap<SQLiteDatabase, { value?: LiveRegionalSnapshot; pending?: { key: string; task: Promise<{ snapshot: LiveRegionalSnapshot; cached: boolean }> } }>();
const hash = async (value: unknown) => {
  // Already-installed native dependency, evaluated only during deliberate acquisition, not ordinary map startup.
  const { CryptoDigestAlgorithm, digestStringAsync } = require('expo-crypto') as typeof import('expo-crypto');
  return String(await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value)));
};
// Metrics only; avoid requiring a platform TextEncoder/polyfill or allocating a second payload-sized byte array.
export const utf8Bytes = (s: string) => { let n = 0; for (const c of s) { const v = c.codePointAt(0)!; n += v <= 0x7f ? 1 : v <= 0x7ff ? 2 : v <= 0xffff ? 3 : 4; } return n; };
const freeze = <T,>(v: T): T => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const getStore = (db: SQLiteDatabase) => { let s = stores.get(db); if (!s) { s = {}; stores.set(db, s); } return s; };
export function liveIsStale(s: LiveRegionalSnapshot, now = Date.now()) {
  return s.staleAtAcquisition || s.expiresAt <= now || s.baseLocalDate !== weatherLocalDate(new Date(now));
}
export function peekLiveRegional(db: SQLiteDatabase) { return getStore(db).value; }
/** Exact original public grid only. No user-provided/private points can enter this acquisition. */
function assertPilot(d: ShadowArtifact) {
  validateShadowArtifact(d);
  const pinned = require('../data/koroskaShadow/snapshot.json') as ShadowArtifact;
  if (d.geometryFingerprint !== pinned.geometryFingerprint || d.modelFingerprint !== pinned.modelFingerprint
    || JSON.stringify(d.weather) !== JSON.stringify(pinned.weather) || JSON.stringify(d.cells) !== JSON.stringify(pinned.cells)
    || new Set(d.weather.map(w => `${w.latitude}:${w.longitude}`)).size !== 11) throw new Error('Neujemanje prvotnih 696 celic / 11 javnih vremenskih lokacij.');
}
/** No positional fallback for ambiguous multi-location responses. IDs may arrive in any order. */
function identify(data: ProviderWeather | ProviderWeather[], count: number): ProviderWeather[] {
  if (!Array.isArray(data) || data.length !== count) throw new Error('Nepopoln paket 11 vremenskih lokacij.');
  const rows = data.map(row => {
    if (!row || typeof row !== 'object' || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)
      || Math.abs(row.latitude!) > 90 || Math.abs(row.longitude!) > 180) throw new Error('Manjka prostorska provenienca ponudnika.');
    return row;
  });
  const unnumbered = rows.filter(row => row.location_id == null);
  const numbered = rows.flatMap(row => row.location_id == null ? [] : [row.location_id]);
  const defaultZero = unnumbered.length === 1 && numbered.length === count - 1 && new Set(numbered).size === count - 1
    && numbered.every(id => Number.isInteger(id) && id >= 1 && id < count);
  const result = Array.from({ length: count }, (_, i) => rows.filter(row => row.location_id === i));
  if (defaultZero && result[0].length === 0) result[0] = unnumbered;
  if (result.some(matches => matches.length !== 1)) throw new Error('Neenolični ali manjkajoči location_id; vrstni red odgovora ni dokaz identitete.');
  return result.map(matches => matches[0]);
}

/** Manual caller only. ≤2 cachedFetch invocations, no retries; concurrent taps share one task. */
export function refreshLiveRegional(db: SQLiteDatabase, d: ShadowArtifact): Promise<{ snapshot: LiveRegionalSnapshot; cached: boolean }> {
  if (!KOROSKA_SHADOW_ENABLED) return Promise.reject(new Error('Razvojni pilot ni omogočen.'));
  try { assertPilot(d); } catch (error) { return Promise.reject(error); }
  const base = weatherLocalDate(), store = getStore(db), key = `${base}:${d.geometryFingerprint}:${d.modelFingerprint}`;
  if (store.pending?.key === key) return store.pending.task;
  if (store.value && store.value.geometryFingerprint === d.geometryFingerprint && store.value.modelFingerprint === d.modelFingerprint && !liveIsStale(store.value))
    return Promise.resolve({ snapshot: store.value, cached: true });
  const task = acquire(db, d, base).then(result => {
    if (result.snapshot.baseLocalDate !== weatherLocalDate()) throw new Error('Lokalni datum se je spremenil pred objavo; ročno pridobi novo okno.');
    if (store.pending?.task === task && result.snapshot.baseLocalDate === weatherLocalDate()) store.value = result.snapshot;
    return result;
  }).finally(() => { if (store.pending?.task === task) store.pending = undefined; });
  store.pending = { key, task }; return task;
}

async function acquire(db: SQLiteDatabase, d: ShadowArtifact, base: string) {
  const start = Date.now(), preparation = performance.now();
  const scorerConfigurationId = await hash([MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG]);
  const plans = d.weather.map(w => sevenDayHourlyRequestPlan(w.latitude, w.longitude, base));
  // Same complete 11-location raw keys as pointConditions.fetchGroup; never alias daily products.
  const requests = [0, 1].map(endpoint => {
    const first = plans[0][endpoint], [address, query] = first.url.split('?'), params = new URLSearchParams(query);
    params.set('latitude', d.weather.map(w => w.latitude).join(',')); params.set('longitude', d.weather.map(w => w.longitude).join(','));
    return { endpoint: first.endpoint, url: `${address}?${params}`, key: `canonical-point-batch-v1:${plans.map(p => p[endpoint].key).join('|')}` };
  });
  const receiptKey = `${LIVE_REGIONAL_VERSION}:cohort:${await hash([requests.map(r => r.key), d.geometryFingerprint, d.modelFingerprint, scorerConfigurationId])}`;
  const old = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM weather_cache WHERE cacheKey=?', receiptKey);
  const before = await Promise.all(requests.map(r => db.getFirstAsync<{ payload: string; fetchedAt: string; expiresAt: string }>(
    'SELECT payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey=?', r.key)));
  let receipt: Receipt | undefined;
  try { receipt = old ? JSON.parse(old.payload) : undefined; } catch { /* A malformed receipt is not evidence of a coherent pair. */ }
  const timing = requests.map(() => ({} as Partial<Record<'start' | 'response' | 'decoded', number>>)), sourceStart = performance.now();
  const pair = await Promise.allSettled(requests.map((r, i) => cachedFetch<ProviderWeather[]>(db, r.key, r.url, true, 18000,
    stage => { timing[i][stage] = performance.now(); })));
  const sourcePairMs = performance.now() - sourceStart;
  if (base !== weatherLocalDate()) throw new Error('Med pridobivanjem se je spremenil lokalni datum. Ročno pridobi novo okno.');
  const failed = pair.flatMap((r, i) => r.status === 'rejected' ? [`${requests[i].endpoint}: vremenski vir ni dosegljiv (${r.reason instanceof Error ? r.reason.message : 'napaka'}).`] : []);
  if (failed.length) throw new Error(failed.join(' '));
  const sources = pair.map(r => (r as PromiseFulfilledResult<{ data: ProviderWeather[]; fetchedAt: string; stale: boolean }>).value);
  const times = sources.map(r => Date.parse(r.fetchedAt));
  if (times.some(t => !Number.isFinite(t) || t > Date.now())) throw new Error('Neveljavni časi pridobitve virov.');
  const ordered = sources.map(r => identify(r.data, 11));
  const hashes = await Promise.all(sources.map(r => hash(r.data)));
  const identity = await hash([LIVE_REGIONAL_VERSION, base, d.geometryFingerprint, d.modelFingerprint, scorerConfigurationId, requests.map(r => r.key), times, hashes]);
  const currentPair = sources.every((r, i) => !r.stale && times[i] >= start && !(before[i] && Date.parse(before[i]!.expiresAt) > start))
    && Math.max(...times) - Math.min(...times) <= MAX_COHORT_SKEW;
  const expiresAt = Math.min(...times) + TTL;
  const verifiedReceipt = receipt?.schema === 'koroska-live-cohort-v1' && receipt.identity === identity && receipt.baseLocalDate === base
    && receipt.expiresAt === expiresAt && Number.isFinite(Date.parse(receipt.createdAt)) && Date.parse(receipt.createdAt) <= Math.min(...times);
  if (!currentPair && !verifiedReceipt) throw new Error(`Vremenska vira nimata potrjenega skupnega zajema. Mešanega predpomnilnika ne objavimo; počakaj na iztek obeh virov (po ${new Date(Math.max(...times) + TTL).toISOString()}) in ročno poskusi znova.`);
  const cohortIssues: string[] = [];
  const reference = ordered[1][0].current?.time;
  if (!Number.isSafeInteger(reference) || ordered[1].some(r => r.current?.time !== reference)
    || times[1] - reference! * 1000 < 0 || times[1] - reference! * 1000 >= 3600000)
    cohortIssues.push('Regionalni current referenčni časi niso skupni in aktualni ob pridobitvi.');
  if (ordered.some(list => list.some(raw => JSON.stringify(raw.hourly?.time) !== JSON.stringify(list[0].hourly?.time))))
    cohortIssues.push('Urne UTC osi znotraj istega regionalnega vira se razlikujejo.');
  const manifest: LiveRegionalSnapshot['sources'] = sources.map((r, endpoint) => ({ endpoint: requests[endpoint].endpoint,
    url: requests[endpoint].url, retrievedAt: r.fetchedAt, sha256: hashes[endpoint], stale: r.stale,
    units: { ...ordered[endpoint][0].hourly_units }, returned: ordered[endpoint].map((raw, i) => ({ weatherId: d.weather[i].id,
      requested: [d.weather[i].latitude, d.weather[i].longitude], latitude: raw.latitude!, longitude: raw.longitude!,
      elevation: typeof raw.elevation === 'number' && Number.isFinite(raw.elevation) ? raw.elevation : null,
      locationId: i, firstEpoch: Number.isSafeInteger(raw.hourly?.time?.[0]) ? raw.hourly!.time![0] : null,
      lastEpoch: Number.isSafeInteger(raw.hourly?.time?.at(-1)) ? raw.hourly!.time!.at(-1)! : null, hours: raw.hourly?.time?.length ?? 0,
      units: { ...raw.hourly_units }, currentEpoch: raw.current?.time ?? null, timezone: raw.timezone ?? null,
      utcOffsetSeconds: raw.utc_offset_seconds ?? null, variables: Object.keys(raw.hourly ?? {}).filter(key => key !== 'time') })) }));
  // Reuse the ACTUAL point batch pipeline over an immutable, read-only view of this verified cohort.
  // It cannot choose old per-point memory entries, mix independent raw rows, or fetch on a cache miss.
  // This is not another persisted weather cache: the only persistent rows are cachedFetch's existing
  // complete-batch keys plus our small cohort receipt. The facade dies after this bounded assembly.
  const rows = new Map<string, { payload: string; fetchedAt: string; expiresAt: string }>();
  for (let i = 0; i < 11; i++) sources.forEach((r, endpoint) => rows.set(plans[i][endpoint].key,
    { payload: JSON.stringify(ordered[endpoint][i]), fetchedAt: r.fetchedAt,
      expiresAt: new Date(r.stale ? 0 : Date.parse(r.fetchedAt) + TTL).toISOString() }));
  const cohortDb = { getFirstAsync: async (_sql: string, key: string) => {
    const row = rows.get(key); if (!row) throw new Error('Regionalni HTTP proračun: dodatna pridobitev ni dovoljena.'); return row;
  }, runAsync: async () => { throw new Error('Paketni vir je samo za branje.'); } } as unknown as SQLiteDatabase;
  const adapterStart = performance.now(), assembled = await loadPointSnapshots(cohortDb, d.weather, base, 18000);
  const adapterMs = performance.now() - adapterStart;
  if (assembled.length !== 11 || assembled.some((s, i) => s.latitude !== d.weather[i].latitude || s.longitude !== d.weather[i].longitude
    || s.baseLocalDate !== base || s.forecastRetrievedAt !== sources[1].fetchedAt || s.archiveRetrievedAt !== sources[0].fetchedAt
    || s.pointPolicyVersion !== CANONICAL_POINT_POLICY || s.inputContract !== HOURLY_INTERVAL_CONTRACT)) throw new Error('Kanonični paket ne ustreza potrjenemu regionalnemu zajemu.');
  const vectors: LiveRegionalVector[] = []; let evaluationMs = 0;
  const stale = sources.some(r => r.stale) || expiresAt <= Date.now();
  for (let i = 0; i < 11; i++) {
    const scoreStart = performance.now();
    for (const profile of d.profiles) for (const result of pointResults(assembled[i], profile)) {
      const { days: _days, ...inputs } = result.inputs.historical ?? {};
      vectors.push({ profileId: result.profileId, weatherId: d.weather[i].id, score: result.score, label: result.label, category: categoryForLabel(result.label), status: result.status,
        missing: result.missing, targetLocalDate: result.targetLocalDate, factors: result.componentsVerified ? result.canonical.components : [],
        componentsVerified: result.componentsVerified, soilSampling: result.soilSampling, inputs: result.inputs.historical ? inputs as LiveRegionalVector['inputs'] : null });
    }
    evaluationMs += performance.now() - scoreStart;
  }
  if (base !== weatherLocalDate()) throw new Error('Lokalni datum se je spremenil med izračunom; rezultat ni objavljen.');
  const missing = [...new Set([...cohortIssues, ...vectors.flatMap(v => v.missing)])], publicationAllowed = !cohortIssues.length && vectors.length === 308 && vectors.every(v => v.score !== null);
  if (currentPair) await db.runAsync('INSERT INTO weather_cache(cacheKey,payload,fetchedAt,expiresAt) VALUES(?,?,?,?) ON CONFLICT(cacheKey) DO UPDATE SET payload=excluded.payload,fetchedAt=excluded.fetchedAt,expiresAt=excluded.expiresAt',
    receiptKey, JSON.stringify({ schema: 'koroska-live-cohort-v1', identity, baseLocalDate: base, createdAt: new Date(start).toISOString(), expiresAt } satisfies Receipt), new Date(start).toISOString(), new Date(expiresAt).toISOString());
  // Freeze only derived results/metadata, not raw provider objects retained in the shared cache.
  const snapshot = freeze<LiveRegionalSnapshot>({ schema: LIVE_REGIONAL_VERSION, contract: 'regional-civil-week-v1', inputContract: HOURLY_INTERVAL_CONTRACT,
    pointPolicy: CANONICAL_POINT_POLICY, snapshotId: identity, baseLocalDate: base, dates: Array.from({ length: 7 }, (_, i) => shiftLocalDate(base, i)),
    geometryFingerprint: d.geometryFingerprint, modelFingerprint: d.modelFingerprint, scorerConfigurationId, profiles: [...d.profiles],
    weather: d.weather.map(w => ({ ...w })), retrievedAt: new Date(Math.max(...times)).toISOString(),
    assembledAt: new Date().toISOString(), expiresAt, modelIssuedAt: null, staleAtAcquisition: stale, publicationAllowed, missing, sources: manifest, vectors,
    metrics: { adapterMs, evaluationMs, evaluations: vectors.length, decodedJsonBytes: sources.map(r => utf8Bytes(JSON.stringify(r.data))),
      sourcePairMs, totalMs: performance.now() - preparation, preparationMs: performance.now() - preparation - sourcePairMs,
      requestsStarted: timing.filter(t => t.start != null).length, network: timing.map((t, i) => ({ endpoint: requests[i].endpoint,
        responseMs: t.start != null && t.response != null ? t.response - t.start : null,
        decodeMs: t.response != null && t.decoded != null ? t.decoded - t.response : null })) } });
  if (base !== weatherLocalDate()) throw new Error('Lokalni datum se je spremenil pred objavo; rezultat ni objavljen.');
  return { snapshot, cached: !currentPair };
}
