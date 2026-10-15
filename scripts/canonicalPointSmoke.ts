import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { loadCanonicalPointSnapshot, loadPointSnapshots, getCanonicalPointWeatherSummary, scoreForPointSummary, pointResults, cachedPointSnapshot, pointLocationKey } from '../src/services/pointConditions';
import { loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { CANONICAL_POINT_POLICY, evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { conditionsForLocation, mapConditionsLocation, createConditionsSnapshot } from '../src/domain/locationConditions';
import { calculateMushroomWeatherScore, MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { sortHotspots } from '../src/domain/hotspotRanking';
import { topThreeHotspots } from '../src/domain/hotspotTopThree';
import { hourlyWeatherFixture } from './sevenDayHourlyFixture';
import { resolveLjubljanaClock, ljubljanaClock } from '../src/domain/soilSampling';
import { sevenDayHourlyRequestPlan } from '../src/services/sevenDayHourlyWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';

async function run() {
  const realDate = globalThis.Date, originalFetch = globalThis.fetch; let base = '2026-10-14';
  class FixtureDate extends realDate { constructor(value?: string | number) { super(value === undefined ? base + 'T12:00Z' : value); } static now() { return realDate.parse(base + 'T12:00Z'); } }
  globalThis.Date = FixtureDate as DateConstructor;
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  let http = 0, offline = false;
  globalThis.fetch = (async (url: any) => {
    http++; if (offline) throw new Error('offline'); const address = new URL(String(url));
    const latitudes = address.searchParams.get('latitude')!.split(',');
    const values = latitudes.map((latitude, index) => {
      const single = new URL(address); single.searchParams.set('latitude', latitude);
      const data = hourlyWeatherFixture(single.toString(), base);
      data.location_id = index; data.current!.time = resolveLjubljanaClock(base + 'T10:45')[0] / 1000;
      data.current_units!.temperature_2m = '°C'; data.current!.temperature_2m = 13; data.current!.weather_code = 3;
      data.hourly!.soil_moisture_0_to_7cm = data.hourly!.time!.map(t => .16 + Number(ljubljanaClock(t * 1000).slice(11, 13)) * .004);
      data.hourly!.soil_moisture_7_to_28cm = data.hourly!.time!.map(t => .2 + Number(ljubljanaClock(t * 1000).slice(11, 13)) * .005);
      return data;
    });
    if (values.length > 1) delete values[0].location_id; // Actual API omits the default first-location ID 0.
    return { ok: true, json: async () => values.length === 1 ? values[0] : values.reverse() }; // IDs/default-zero, not response order, identify points.
  }) as any;
  try {
    for (const date of ['2026-10-14', '2026-03-28', '2026-10-24', '2024-02-28', '2026-12-31']) {
      base = date; const point = { id: 'selected', latitude: 46.5, longitude: 14.5 }, before = http;
      const [snapshot, weekly] = await Promise.all([loadCanonicalPointSnapshot(db, point, base), loadSevenDaySnapshot(db, point, base)]);
      strictEqual(snapshot, weekly, 'actual point + weekly production entry returns identical frozen object, not matching manual fixtures');
      strictEqual(http - before, 2); strictEqual(snapshot.pointPolicyVersion, CANONICAL_POINT_POLICY); ok(Object.isFrozen(snapshot));
      strictEqual(snapshot.soilSampling![base].localTime, base + 'T10:00');
      strictEqual(snapshot.soilSampling![base].requestedInstantUtc, new Date(resolveLjubljanaClock(base + 'T10:45')[0]).toISOString());
      strictEqual(snapshot.today.current!.weatherDescription, 'Oblačno');
      const summary = await getCanonicalPointWeatherSummary(db, point.latitude, point.longitude); strictEqual(summary, snapshot.today);
      // A policy tag alone cannot bypass input, snapshot, coverage or sampling parity safeguards.
      const mutations = [
        (copy: typeof snapshot) => { copy.today.current!.soilMoisture0To7Cm! += .01; },
        (copy: typeof snapshot) => { copy.today.historical!.evapotranspiration7dMm! += 1; },
        (copy: typeof snapshot) => { copy.today.latitude += .1; },
        (copy: typeof snapshot) => { copy.today.evaluationLocalDate = '2000-01-01'; },
        (copy: typeof snapshot) => { copy.soilSampling![base].units = 'wrong' as any; },
        (copy: typeof snapshot) => { copy.soilSampling![base].requestedInstantUtc = base + 'T00:00:00Z'; },
        (copy: typeof snapshot) => { copy.intervalCoverage = {}; },
        (copy: typeof snapshot) => { copy.archiveRetrievedAt = '2000-01-01T00:00:00Z'; },
      ];
      for (const mutate of mutations) {
        const copy = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot; mutate(copy);
        strictEqual(evaluateSevenDayConditions(copy, 'generic')[0].score, null, 'unverified canonical input never publishes a numerical score');
      }
      for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
        const results = pointResults(snapshot, profile); ok(results.every(row => row.score != null && row.status === 'ready'), `${base} ${profile}`);
        deepStrictEqual(scoreForPointSummary(summary, profile), results[0].canonical);
        for (const [index, day] of [[0, 'today'], [1, 'tomorrow']] as const) {
          const hotspot = conditionsForLocation(mapConditionsLocation(point), snapshot, profile, day, base)!;
          strictEqual(hotspot.score, results[index].score); deepStrictEqual(hotspot.summary, results[index].inputs);
          strictEqual(hotspot.weatherCellId, pointLocationKey(point, base), 'habitat lookup cannot overwrite the actual point weather identity');
          deepStrictEqual(hotspot.scoreDetails, results[index].canonical); strictEqual(hotspot.inputPolicyVersion, CANONICAL_POINT_POLICY);
          deepStrictEqual(hotspot.scoreDetails, calculateMushroomWeatherScore(hotspot.summary, profile));
          strictEqual(hotspot.targetLocalDate, results[index].targetLocalDate);
          strictEqual(conditionsForLocation(mapConditionsLocation({ ...point, latitude: 47 }), snapshot, profile, day, base), undefined, 'old location snapshot is never current');
        }
      }
      const assessment = conditionsForLocation(mapConditionsLocation(point), snapshot, 'generic', 'today', base)!;
      const visit = createConditionsSnapshot(mapConditionsLocation(point), assessment, base + 'T10:00:00Z')!;
      strictEqual(visit.schemaVersion, 1); strictEqual(visit.inputPolicyVersion, CANONICAL_POINT_POLICY);
      strictEqual(visit.location.samplingLatitude, point.latitude); strictEqual(visit.location.samplingLongitude, point.longitude);
      strictEqual(visit.location.weatherPointId, pointLocationKey(point, base));
      strictEqual(visit.soilSampling!.instantUtc, snapshot.soilSampling![base].instantUtc); strictEqual(visit.weatherSnapshotId, snapshot.snapshotId);
      const saved = JSON.stringify(visit); pointResults(snapshot, 'lactariusDeliciosus'); strictEqual(JSON.stringify(visit), saved);
      strictEqual(http - before, 2, 'profile/day/details/weekly warm open have 0 extra HTTP');
    }
    base = '2026-10-14'; const nine = Array.from({ length: 9 }, (_, i) => ({ id: `saved-${i}`, title: `Saved ${i}`, latitude: 46.6 + i / 1000, longitude: 14.9 + i / 1000 }));
    const before = http;
    const grouped = loadPointSnapshots(db, nine, base), one = loadCanonicalPointSnapshot(db, nine[3], base);
    const snapshots = await grouped; strictEqual(await one, snapshots[3]); strictEqual(http - before, 2, 'nine distinct exact points + overlapping single surface = two batched requests');
    const assessments = Object.fromEntries(nine.map((location, i) => [location.id, conditionsForLocation(mapConditionsLocation(location), snapshots[i], 'generic', 'today', base)!]));
    deepStrictEqual(topThreeHotspots(nine, assessments, true).map(p => p.id), sortHotspots(nine, assessments, 'conditions').slice(0, 3).map(p => p.id));
    const warm = await loadPointSnapshots(db, [...nine, { ...nine[0], id: 'duplicate-location' }], base); strictEqual(warm.length, 9); strictEqual(http - before, 2);
    // A new DB identity must still consume raw per-point disk rows created by the batch (0 requests).
    const disk = await loadPointSnapshots({ ...db } as any, nine, base); strictEqual(disk.length, 9); strictEqual(http - before, 2);
    const point = nine[0], forecastKey = sevenDayHourlyRequestPlan(point.latitude, point.longitude, base)[1].key;
    const good = rows.get(forecastKey).payload, damaged = JSON.parse(good); damaged.hourly.soil_moisture_0_to_7cm.fill(null);
    rows.get(forecastKey).payload = JSON.stringify(damaged);
    const invalid = await loadCanonicalPointSnapshot({ ...db }, point, base);
    ok(pointResults(invalid, 'generic').every(row => row.score === null));
    strictEqual(scoreForPointSummary(invalid.today, 'generic').score, undefined, 'no renormalized partial production point score leaks through Razmere');
    strictEqual(conditionsForLocation(mapConditionsLocation(point), invalid, 'generic', 'today', base)!.score, null);
    rows.get(forecastKey).payload = good; rows.forEach(row => row.expiresAt = '2000-01-01T00:00:00Z'); offline = true;
    const stale = await loadCanonicalPointSnapshot({ ...db }, point, base); ok(stale.stale); ok(pointResults(stale, 'generic').every(row => row.status === 'stale'));
    ok(cachedPointSnapshot(db, point, base));
    console.log('PASS canonical production adapters: exact source/Today10:45 as-of/local09/all 4x7 dates, real shared snapshot identity + full inputs/components/reasons/status parity, DST/leap/year, profile/day 0 HTTP, nine-point batch cold 2/overlap 0/warm memory+disk 0, incomplete strict gates/stale, actual-coordinate snapshots versioned without schema rewrite, ranking/Top3 same ordering.');
  } finally { globalThis.Date = realDate; globalThis.fetch = originalFetch; }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
