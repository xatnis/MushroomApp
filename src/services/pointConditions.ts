import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../domain/types';
import { calculateMushroomWeatherScore } from '../domain/mushroomWeather';
import { CANONICAL_POINT_POLICY, evaluateSevenDayConditions, type SevenDaySnapshot, type SevenDayResult } from '../domain/sevenDayConditions';
import { weatherLocalDate, WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { cachedFetch } from './weather';
import { sevenDayHourlyRequestPlan, withCivilHourlyWeather, type HourlyFetchResult } from './sevenDayHourlyWeather';
import type { UtcHourlyWeather } from '../domain/weatherIntervals';
import { markPointTiming } from './pointTiming';

export interface PointLocation { latitude: number; longitude: number }
const stores = new WeakMap<SQLiteDatabase, { snapshots: Map<string, SevenDaySnapshot>; pending: Map<string, Promise<SevenDaySnapshot>>; listeners: Set<() => void> }>();
const summaries = new WeakMap<MushroomWeatherSummary, SevenDaySnapshot>();
const results = new WeakMap<SevenDaySnapshot, Map<MushroomWeatherProfileId, SevenDayResult[]>>();
const expiredViews = new WeakMap<SevenDaySnapshot, SevenDaySnapshot>();
/** Expiry changes presentation, not source timestamps, weather values, TTL or scorer inputs. */
export function pointSnapshotForDisplay(snapshot: SevenDaySnapshot | undefined): SevenDaySnapshot | undefined {
  if (!snapshot || snapshot.stale || snapshot.expiresAt <= 0 || snapshot.expiresAt > Date.now()) return snapshot;
  let stale = expiredViews.get(snapshot);
  if (!stale) {
    stale = Object.freeze({ ...snapshot, stale: true, today: Object.freeze({ ...snapshot.today, stale: true }) });
    expiredViews.set(snapshot, stale); summaries.set(stale.today, stale);
  }
  return stale;
}
export const pointLocationKey = (point: PointLocation, date: string) => `${point.latitude}:${point.longitude}:${date}:${CANONICAL_POINT_POLICY}`;
const valid = (p: PointLocation) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
function store(db: SQLiteDatabase) {
  let entry = stores.get(db);
  if (!entry) { entry = { snapshots: new Map(), pending: new Map(), listeners: new Set() }; stores.set(db, entry); }
  return entry;
}
export function cachedPointSnapshot(db: SQLiteDatabase, point: PointLocation, date = weatherLocalDate()) { return pointSnapshotForDisplay(store(db).snapshots.get(pointLocationKey(point, date))); }
export function subscribePointConditions(db: SQLiteDatabase, listener: () => void) { const entry = store(db); entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; }
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function emptySnapshot(point: PointLocation, date: string): SevenDaySnapshot {
  return { ...point, baseLocalDate: date, timezone: WEATHER_TIMEZONE, today: { ...point, errors: {}, stale: false, updatedAt: '', source: 'open-meteo' },
    daily: [], dailyPeriods: {}, soilByDate: {}, forecastIssuedAt: null, forecastRetrievedAt: null, archiveRetrievedAt: null,
    snapshotId: pointLocationKey(point, date), expiresAt: Number.MAX_SAFE_INTEGER, stale: false, blockers: [], assembledAt: new Date().toISOString() };
}

/** Shared exact-coordinate point acquisition. Up to 16 missing points share two API batch requests. */
export async function loadPointSnapshots(db: SQLiteDatabase, locations: PointLocation[], date = weatherLocalDate(), timeoutMs?: number): Promise<SevenDaySnapshot[]> {
  const entry = store(db), points = [...new Map(locations.filter(valid).map(p => [pointLocationKey(p, date), p])).values()];
  const tasks = new Map<string, Promise<SevenDaySnapshot>>();
  const missing: Array<{ point: PointLocation; key: string; resolve: (value: SevenDaySnapshot) => void; reject: (reason: unknown) => void }> = [];
  for (const point of points) {
    const key = pointLocationKey(point, date), cached = entry.snapshots.get(key);
    markPointTiming(point, date, 'T2 memory cache', cached && cached.expiresAt > Date.now() && !cached.stale && !cached.blockers.length ? 'hit' : entry.pending.has(key) ? 'pending' : 'miss');
    if (cached && cached.expiresAt > Date.now() && !cached.stale && !cached.blockers.length) tasks.set(key, Promise.resolve(cached));
    else if (entry.pending.has(key)) tasks.set(key, entry.pending.get(key)!);
    else {
      const task = new Promise<SevenDaySnapshot>((resolve, reject) => missing.push({ point, key, resolve, reject }));
      // Reserve point identities BEFORE an overlapping surface can request a single point from this batch.
      entry.pending.set(key, task); tasks.set(key, task);
    }
  }
  const groups = Array.from({ length: Math.ceil(missing.length / 16) }, (_, index) => missing.slice(index * 16, index * 16 + 16));
  let nextGroup = 0;
  // At most two groups / four endpoint requests concurrently; no per-date/profile waterfall.
  const worker = async () => {
    while (nextGroup < groups.length) {
      const group = groups[nextGroup++];
      try {
        const sources = await fetchGroup(db, group.map(item => item.point), date, timeoutMs);
        await Promise.all(group.map(async (item, index) => {
          const assembled = await withCivilHourlyWeather(db, emptySnapshot(item.point, date), timeoutMs, sources[index]);
          markPointTiming(item.point, date, 'T5 adapted');
          delete assembled.legacyDaily; delete assembled.legacyToday;
          assembled.pointPolicyVersion = CANONICAL_POINT_POLICY;
          assembled.today.inputPolicyVersion = CANONICAL_POINT_POLICY;
          assembled.today.evaluationLocalDate = date;
          const snapshot = freeze(JSON.parse(JSON.stringify(assembled))) as SevenDaySnapshot;
          summaries.set(snapshot.today, snapshot); entry.snapshots.set(item.key, snapshot);
          if (entry.snapshots.size > 128) entry.snapshots.delete(entry.snapshots.keys().next().value!);
          item.resolve(snapshot);
        }));
        entry.listeners.forEach(listener => listener());
      } catch (error) { group.forEach(item => item.reject(error)); }
      finally { group.forEach(item => entry.pending.delete(item.key)); }
    }
  };
  void worker(); void worker();
  return Promise.all(points.map(p => tasks.get(pointLocationKey(p, date))!));
}

async function fetchGroup(db: SQLiteDatabase, points: PointLocation[], date: string, timeoutMs?: number): Promise<HourlyFetchResult[][]> {
  const plans = points.map(p => sevenDayHourlyRequestPlan(p.latitude, p.longitude, date));
  const sources: HourlyFetchResult[][] = points.map(() => []);
  await Promise.all([0, 1].map(async endpoint => {
    const cacheRows = await Promise.all(plans.map(plan => db.getFirstAsync<{ payload: string; fetchedAt: string; expiresAt: string }>(
      'SELECT payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey=?', plan[endpoint].key)));
    const needed: number[] = [];
    cacheRows.forEach((row, index) => {
      if (row && Date.parse(row.expiresAt) > Date.now()) {
        try { sources[index][endpoint] = { status: 'fulfilled', value: { data: JSON.parse(row.payload), fetchedAt: row.fetchedAt, stale: false } }; }
        catch { needed.push(index); }
      } else needed.push(index);
    });
    points.forEach((point, index) => markPointTiming(point, date, 'T2 source cache', needed.includes(index) ? 'miss' : 'hit'));
    if (!needed.length) return;
    const first = plans[needed[0]][endpoint], [address, query] = first.url.split('?'), params = new URLSearchParams(query);
    params.set('latitude', needed.map(i => points[i].latitude).join(',')); params.set('longitude', needed.map(i => points[i].longitude).join(','));
    const key = needed.length === 1 ? first.key : `canonical-point-batch-v1:${needed.map(i => plans[i][endpoint].key).join('|')}`;
    try {
      const response = await cachedFetch<UtcHourlyWeather | UtcHourlyWeather[]>(db, key, `${address}?${params}`, true, timeoutMs,
        stage => needed.forEach(index => markPointTiming(points[index], date, stage === 'start' ? 'T3 acquisition start' : stage === 'response' ? 'T4 response' : 'T5 decoded', first.endpoint)));
      needed.forEach(index => markPointTiming(points[index], date, 'T4 sources received', first.endpoint));
      const list = Array.isArray(response.data) ? response.data : [response.data];
      // Open-Meteo's first location can omit the default ID 0 while later rows carry IDs 1..N-1.
      const unnumbered = list.filter(item => item?.location_id == null);
      const numbered = list.flatMap(item => item?.location_id == null ? [] : [item.location_id]);
      const defaultZero = list.length === needed.length && unnumbered.length === 1 && new Set(numbered).size === numbered.length
        && numbered.every(id => Number.isInteger(id) && id >= 1 && id < needed.length);
      await Promise.all(needed.map(async (index, position) => {
        const identified = list.filter(item => item?.location_id === position);
        const data = identified.length === 1 ? identified[0] : identified.length === 0 && position === 0 && defaultZero ? unnumbered[0]
          : list.length === needed.length && list.every(item => item?.location_id == null) ? list[position] : undefined;
        if (!data) { sources[index][endpoint] = { status: 'rejected', reason: new Error('Neenolična identiteta point vira v batch odgovoru.') }; return; }
        sources[index][endpoint] = { status: 'fulfilled', value: { data, fetchedAt: response.fetchedAt, stale: response.stale } };
        if (!response.stale) await db.runAsync('INSERT INTO weather_cache(cacheKey,payload,fetchedAt,expiresAt) VALUES(?,?,?,?) ON CONFLICT(cacheKey) DO UPDATE SET payload=excluded.payload,fetchedAt=excluded.fetchedAt,expiresAt=excluded.expiresAt',
          plans[index][endpoint].key, JSON.stringify(data), response.fetchedAt, new Date(Date.parse(response.fetchedAt) + 30 * 60000).toISOString());
      }));
    } catch (reason) {
      needed.forEach(index => {
        const row = cacheRows[index];
        try { sources[index][endpoint] = row ? { status: 'fulfilled', value: { data: JSON.parse(row.payload), fetchedAt: row.fetchedAt, stale: true } } : { status: 'rejected', reason }; }
        catch { sources[index][endpoint] = { status: 'rejected', reason }; }
      });
    }
  }));
  return sources;
}
export async function loadCanonicalPointSnapshot(db: SQLiteDatabase, location: PointLocation, date = weatherLocalDate(), options: { requestTimeoutMs?: number; seedUpdatedAt?: string } = {}) {
  if (!valid(location)) throw new Error('Neveljavna point lokacija.');
  return (await loadPointSnapshots(db, [location], date, options.requestTimeoutMs))[0];
}
export function pointResults(snapshot: SevenDaySnapshot, profile: MushroomWeatherProfileId) {
  let entry = results.get(snapshot); if (!entry) { entry = new Map(); results.set(snapshot, entry); }
  if (!entry.has(profile)) {
    entry.set(profile, evaluateSevenDayConditions(snapshot, profile, () => markPointTiming(snapshot, snapshot.baseLocalDate, 'T6 inputs built')));
    markPointTiming(snapshot, snapshot.baseLocalDate, 'T7 evaluated');
  }
  return entry.get(profile)!;
}
export async function getCanonicalPointWeatherSummary(db: SQLiteDatabase, latitude: number, longitude: number, date = weatherLocalDate()) {
  return (await loadCanonicalPointSnapshot(db, { latitude, longitude }, date)).today;
}
export function scoreForPointSummary(summary: MushroomWeatherSummary | undefined, profile: MushroomWeatherProfileId) {
  const snapshot = summary && summaries.get(summary);
  if (!snapshot) return summary?.inputPolicyVersion ? { ...calculateMushroomWeatherScore(undefined, profile), reasons: ['Kanonični point snapshot ni na voljo.'] }
    : calculateMushroomWeatherScore(summary, profile);
  const result = pointResults(snapshot, profile)[0];
  return result.score != null ? result.canonical : { ...result.canonical, score: undefined, label: 'Premalo podatkov', trend: 'Ni dovolj podatkov' as const, reasons: result.missing };
}
