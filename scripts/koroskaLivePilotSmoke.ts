/** Fully offline: actual cachedFetch/hourly assembly/scorers, synthetic provider boundaries only. */
import { strictEqual, deepStrictEqual, ok, rejects } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as data from '../src/experimental/koroskaShadowData';
import { compileLive } from './koroskaLiveTestSupport';
import { makeFrozenBatch } from './research/koroskaWeatherFixture';
import { selectPilot } from './research/koroskaRegionalPrototype';
import { loadPointSnapshots, pointResults } from '../src/services/pointConditions';
import { ljubljanaClock, resolveLjubljanaClock } from '../src/domain/soilSampling';
import { shiftLocalDate } from '../src/services/weather';
import * as scorer from '../src/domain/mushroomWeather';
import { regionalPreviewResult, liveRegionalPaint, shadowWeatherGroups } from '../src/experimental/koroskaLivePresentation';
import type { LiveRegionalSnapshot } from '../src/experimental/koroskaLive';

const artifact = data.validateShadowArtifact(JSON.parse(readFileSync('src/data/koroskaShadow/snapshot.json', 'utf8')));
const service = (enabled = true) => compileLive('src/experimental/koroskaLive.ts', id => id === './koroskaShadowData' ? { ...data, KOROSKA_SHADOW_ENABLED: enabled } : undefined) as typeof import('../src/experimental/koroskaLive');
const realDate = Date, originalFetch = globalThis.fetch, originalScore = scorer.calculateMushroomWeatherScore;
let base = '2026-10-23', now = resolveLjubljanaClock(base + 'T10:45')[0], http = 0, evaluations = 0;
class Clock extends realDate { constructor(v?: string | number) { super(v === undefined ? now : v); } static now() { return now; } }
globalThis.Date = Clock as DateConstructor;
const db = () => { const rows = new Map<string, any>(); return { rows, getFirstAsync: async (sql: string, key: string) => { ok(sql.includes('weather_cache')); return rows.get(key) ?? null; },
  runAsync: async (sql: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => { ok(sql.includes('weather_cache')); rows.set(key, { payload, fetchedAt, expiresAt }); } } as any; };
let batch = makeFrozenBatch(base);
let change: (rows: any[], endpoint: number) => void = () => {}, fail = -1, hold: Promise<void> | undefined;
const resetWeather = (date: string) => { base = date; now = resolveLjubljanaClock(base + 'T10:45')[0]; batch = makeFrozenBatch(base); change = () => {}; fail = -1; hold = undefined; };
globalThis.fetch = (async (url: any) => {
  http++; const u = new URL(String(url)), endpoint = u.hostname.startsWith('archive') ? 0 : 1;
  ok(['archive-api.open-meteo.com','api.open-meteo.com'].includes(u.hostname));
  strictEqual(u.searchParams.get('timezone'), 'GMT'); strictEqual(u.searchParams.get('timeformat'), 'unixtime');
  const lat = u.searchParams.get('latitude')!.split(',').map(Number), lon = u.searchParams.get('longitude')!.split(',').map(Number);
  strictEqual(lat.length, 11); deepStrictEqual(lat, artifact.weather.map(w => w.latitude)); deepStrictEqual(lon, artifact.weather.map(w => w.longitude));
  if (hold) await hold;
  if (endpoint === fail) throw new Error('synthetic endpoint offline');
  const rows = batch.locations.map((row, i) => {
    const raw: any = structuredClone((row.sources[endpoint] as PromiseFulfilledResult<any>).value.data);
    raw.latitude = row.definition.latitude + .001; raw.longitude = row.definition.longitude + .001; raw.elevation = 500 + i * 10;
    raw.location_id = i; return raw;
  });
  delete rows[0].location_id; change(rows, endpoint);
  return { ok: true, json: async () => rows.reverse() };
}) as any;

async function run() {
  try {
    deepStrictEqual(artifact.weather, selectPilot().weather.map(({ id, latitude, longitude }) => ({ id, latitude, longitude }))); strictEqual(artifact.cells.length, 696);
    const off = service(false), offDb = db(); await rejects(off.refreshLiveRegional(offDb, artifact), /ni omogočen/); strictEqual(http, 0);
    const s = service(), database = db();
    (scorer as any).calculateMushroomWeatherScore = (...args: any[]) => { evaluations++; return (originalScore as any)(...args); };
    const memoryBefore = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
    const first = s.refreshLiveRegional(database, artifact), concurrent = s.refreshLiveRegional(database, artifact);
    strictEqual(first, concurrent, 'simultaneous refresh taps share the actual task');
    const cold = await first, elapsed = performance.now() - started, processCpu = process.cpuUsage(cpu), coldMemory = process.memoryUsage();
    strictEqual(http, 2); strictEqual(evaluations, 308); strictEqual(cold.snapshot.metrics.evaluations, 308);
    strictEqual(cold.cached, false); ok(cold.snapshot.publicationAllowed); strictEqual(cold.snapshot.modelIssuedAt, null);
    strictEqual(cold.snapshot.metrics.requestsStarted, 2); deepStrictEqual(cold.snapshot.weather, artifact.weather); deepStrictEqual(cold.snapshot.profiles, artifact.profiles);
    strictEqual(cold.snapshot.contract, 'regional-civil-week-v1'); strictEqual(cold.snapshot.baseLocalDate, base);
    deepStrictEqual(cold.snapshot.dates, Array.from({ length: 7 }, (_, i) => shiftLocalDate(base, i)));
    strictEqual(cold.snapshot.sources.length, 2); ok(Object.isFrozen(cold.snapshot.vectors));
    const beforeWarm = http, warm = await s.refreshLiveRegional(database, artifact); strictEqual(http, beforeWarm); strictEqual(warm.cached, true); strictEqual(warm.snapshot, cold.snapshot);
    const reopened = await service().refreshLiveRegional(database, artifact); strictEqual(http, beforeWarm); strictEqual(reopened.cached, true);
    strictEqual(reopened.snapshot.metrics.requestsStarted, 0);
    strictEqual(reopened.snapshot.snapshotId, cold.snapshot.snapshotId); strictEqual(reopened.snapshot.expiresAt, cold.snapshot.expiresAt, 'cache/replay cannot renew TTL');
    (scorer as any).calculateMushroomWeatherScore = originalScore;
    const parity = await loadPointSnapshots(database, artifact.weather, base); strictEqual(http, beforeWarm, 'canonical 11-point batch reuses identical raw keys');
    for (let i = 0; i < 11; i++) for (let p = 0; p < 4; p++) for (let d = 0; d < 7; d++) {
      const regional = cold.snapshot.vectors[(i * 4 + p) * 7 + d], point = pointResults(parity[i], artifact.profiles[p])[d];
      strictEqual(regional.score, point.score); strictEqual(regional.label, point.label); deepStrictEqual(regional.factors, point.canonical.components);
      deepStrictEqual(regional.soilSampling, point.soilSampling); const { days: _, ...inputs } = point.inputs.historical!; deepStrictEqual(regional.inputs, inputs);
      ok(regional.inputs?.rain60dMm != null); strictEqual(regional.soilSampling?.units, 'm³/m³');
      const expected = resolveLjubljanaClock(regional.targetLocalDate + (d ? 'T09:00' : 'T10:00'))[0]; strictEqual(Date.parse(regional.soilSampling!.instantUtc), expected);
    }
    const geometry = data.shadowGeometry(artifact), groupStart = performance.now(), groups = shadowWeatherGroups(artifact), groupsMs = performance.now() - groupStart, paint = { 'fill-color': ['get','renderState'] };
    const properties = new Map<string, any>(JSON.parse(geometry).features.map((f: any) => [f.id, f.properties]));
    const expression = (e: any, props: any): any => {
      if (!Array.isArray(e)) return e;
      if (e[0] === 'get') return props[e[1]];
      if (e[0] === '==') return expression(e[1], props) === expression(e[2], props);
      if (e[0] === 'case') { for (let i = 1; i < e.length - 1; i += 2) if (expression(e[i], props)) return expression(e[i + 1], props); return expression(e.at(-1), props); }
      if (e[0] === 'match') { const value = expression(e[1], props); for (let i = 2; i < e.length - 1; i += 2) if (Array.isArray(e[i]) ? e[i].includes(value) : e[i] === value) return expression(e[i + 1], props); return expression(e.at(-1), props); }
      throw Error('Unexpected MapLibre expression ' + e[0]);
    };
    const styleStart = performance.now(); for (let i = 0; i < 1000; i++) liveRegionalPaint(paint, groups, cold.snapshot, i % 4, i % 7); const thousandPaintsMs = performance.now() - styleStart;
    for (let p = 0; p < 4; p++) for (let d = 0; d < 7; d++) {
      const expr: any = liveRegionalPaint(paint, groups, cold.snapshot, p, d); strictEqual(expr['fill-color'][0], 'case');
      for (const c of artifact.cells) { const value = regionalPreviewResult(artifact, 'live', cold.snapshot, c.id, p, d, cold.snapshot.dates, '')!;
        strictEqual(value.habitat, c.habitat[p]); strictEqual(value.score, c.habitat[p] === 'candidate' ? cold.snapshot.vectors[(c.weatherIndex * 4 + p) * 7 + d].score : null);
        strictEqual(value.date, cold.snapshot.dates[d]); }
      for (const c of artifact.cells) strictEqual(expression(expr['fill-color'], properties.get(c.id)), regionalPreviewResult(artifact, 'live', cold.snapshot, c.id, p, d, cold.snapshot.dates, '')!.category);
    }
    strictEqual(http, beforeWarm); strictEqual(data.shadowGeometry(artifact), geometry); deepStrictEqual(paint, { 'fill-color': ['get','renderState'] });
    deepStrictEqual(regionalPreviewResult(artifact, 'frozen', cold.snapshot, artifact.cells[0].id, 0, 0, cold.snapshot.dates, ''), data.shadowCellResult(artifact, artifact.cells[0].id, 0, 0));
    const invalid = structuredClone(artifact); invalid.weather[1] = { ...invalid.weather[0], id: invalid.weather[1].id };
    await rejects(s.refreshLiveRegional(db(), invalid), /prvotnih/); strictEqual(http, beforeWarm);
    for (const mutate of [
      (rows: any[]) => rows.pop(), (rows: any[]) => { rows[1].location_id = rows[2].location_id; },
      (rows: any[]) => rows.forEach(r => delete r.location_id), (rows: any[]) => { delete rows[2].latitude; },
    ]) { change = mutate; const count: number = http; await rejects(service().refreshLiveRegional(db(), artifact)); strictEqual(http - count, 2); }
    change = () => {};
    for (const endpoint of [0,1]) { fail = endpoint; const count: number = http; await rejects(service().refreshLiveRegional(db(), artifact), /ni dosegljiv/); strictEqual(http - count, 2); } fail = -1;
    for (const mutate of [
      (rows: any[], e: number) => { if (e === 1) delete rows[0].hourly.soil_moisture_7_to_28cm; },
      (rows: any[]) => { rows[0].hourly_units.precipitation = 'inch'; },
      (rows: any[]) => { rows[0].hourly.time[24] = rows[0].hourly.time[23]; },
      (rows: any[], e: number) => { if (e === 0) rows[0].hourly.precipitation[24] = null; },
      (rows: any[], e: number) => { if (e === 1) rows[0].current.time = now / 1000 + 3600; },
      (rows: any[], e: number) => { if (e === 1) rows[0].current.time -= 900; },
    ]) {
      change = mutate; const unavailable = (await service().refreshLiveRegional(db(), artifact)).snapshot;
      ok(!unavailable.publicationAllowed); ok(unavailable.missing.length > 0);
      const selected = regionalPreviewResult(artifact, 'live', unavailable, artifact.cells[0].id, 0, 0, unavailable.dates, 'Nepopolni vhodi')!;
      strictEqual(selected.score, null); ok(selected.vector.missing.length); // Never a fake 0 or a partial coloured layer.
    }
    change = () => {};
    change = rows => rows.forEach(raw => {
      raw.hourly.precipitation.fill(0); raw.hourly.temperature_2m.fill(60); raw.hourly.et0_fao_evapotranspiration.fill(2);
      raw.hourly.soil_moisture_0_to_7cm?.fill(0); raw.hourly.soil_moisture_7_to_28cm?.fill(0);
    });
    const trueZero = (await service().refreshLiveRegional(db(), artifact)).snapshot;
    ok(trueZero.publicationAllowed); strictEqual(trueZero.vectors[0].score, 0);
    strictEqual(regionalPreviewResult(artifact, 'live', trueZero, artifact.cells[0].id, 0, 0, trueZero.dates, '')!.score, 0, 'a genuine canonical zero is not missing');
    change = () => {};
    const tampered = db(); await service().refreshLiveRegional(tampered, artifact);
    const tamperCount = http;
    for (const [key, row] of tampered.rows) if (key.startsWith('canonical-point-batch')) {
      // Find the forecast by the actual native soil variables in its unmodified request key.
      if (key.includes('soil_moisture')) { row.payload = row.payload.replace('"°C"', '"kelvin"'); break; }
    }
    await rejects(service().refreshLiveRegional(tampered, artifact), /skupnega zajema/); strictEqual(http, tamperCount, 'changed cached bytes cannot reuse an old cohort receipt');
    const futureTime = db(); await service().refreshLiveRegional(futureTime, artifact); const timeCount = http;
    for (const [key, row] of futureTime.rows) if (key.startsWith('canonical-point-batch') && key.includes('soil_moisture')) row.fetchedAt = new Date(now + 60000).toISOString();
    await rejects(service().refreshLiveRegional(futureTime, artifact), /časi pridobitve/); strictEqual(http, timeCount);
    // Existing cached endpoint without our matching pair receipt cannot masquerade as a coherent refresh.
    const splitDb = db(); await service().refreshLiveRegional(splitDb, artifact);
    for (const [key, row] of splitDb.rows) if (key.includes(':cohort:')) splitDb.rows.delete(key);
    now += 1000; const splitCount = http; await rejects(service().refreshLiveRegional(splitDb, artifact), /skupnega zajema/); strictEqual(http, splitCount);
    // Genuine old complete pair can be displayed only explicitly stale, without renewing its original age.
    now = resolveLjubljanaClock(base + 'T10:45')[0] + 31 * 60000; fail = 0;
    const staleCount = http;
    // Both endpoints fail here, retaining the same coherent old source pair.
    const savedFetch = globalThis.fetch; globalThis.fetch = (async () => { http++; throw Error('offline both'); }) as any;
    const stale = await service().refreshLiveRegional(database, artifact); strictEqual(http - staleCount, 2); ok(s.liveIsStale(stale.snapshot));
    strictEqual(stale.snapshot.snapshotId, cold.snapshot.snapshotId); strictEqual(stale.snapshot.expiresAt, cold.snapshot.expiresAt);
    globalThis.fetch = savedFetch; fail = 0;
    // One refreshed endpoint plus an old fallback is NOT silently published as one new snapshot.
    const mixedCount = http; await rejects(service().refreshLiveRegional(database, artifact), /skupnega zajema/);
    strictEqual(http - mixedCount, 2);
    for (const date of ['2026-03-28','2026-10-24']) {
      resetWeather(date); const result = (await service().refreshLiveRegional(db(), artifact)).snapshot; ok(result.publicationAllowed);
      strictEqual(result.vectors[1].soilSampling!.instantUtc, new realDate(resolveLjubljanaClock(shiftLocalDate(date, 1) + 'T09:00')[0]).toISOString());
      strictEqual(result.dates[1], shiftLocalDate(date, 1));
      const lookup = await loadPointSnapshots(db(), artifact.weather, date); // Actual production adapter parity across DST too.
      for (let i = 0; i < 11; i++) for (let p = 0; p < 4; p++) deepStrictEqual(result.vectors.slice((i * 4 + p) * 7, (i * 4 + p + 1) * 7).map(v => v.score), pointResults(lookup[i], artifact.profiles[p]).map(v => v.score));
    }
    resetWeather('2026-10-23'); const rolloverDb = db(), rolloverService = service(); let release!: () => void;
    const beforeLate = http;
    hold = new Promise<void>(r => release = r); const late = rolloverService.refreshLiveRegional(rolloverDb, artifact);
    // Let request preparation reach the mocked provider before moving the calendar.
    await new Promise(r => setImmediate(r)); strictEqual(http - beforeLate, 2); now = resolveLjubljanaClock('2026-10-24T00:00')[0]; release();
    await rejects(late, /datum/); strictEqual(rolloverService.peekLiveRegional(rolloverDb), undefined);
    resetWeather('2026-10-23'); const commitDb = db(), commitService = service(), originalWrite = commitDb.runAsync;
    let receiptReached!: () => void, releaseReceipt!: () => void;
    const reached = new Promise<void>(r => receiptReached = r), receiptHold = new Promise<void>(r => releaseReceipt = r);
    commitDb.runAsync = async (...args: any[]) => { await originalWrite(...args); if (String(args[1]).includes(':cohort:')) { receiptReached(); await receiptHold; } };
    const lateCommit = commitService.refreshLiveRegional(commitDb, artifact); await reached;
    now = resolveLjubljanaClock('2026-10-24T00:00')[0]; releaseReceipt();
    await rejects(lateCommit, /datum/); strictEqual(commitService.peekLiveRegional(commitDb), undefined, 'midnight during async cache commit cannot publish an old window');
    strictEqual(s.utf8Bytes('m³/m³ °C 🌲'), Buffer.byteLength('m³/m³ °C 🌲'));
    for (const file of ['src/services/weather.ts','src/services/pointConditions.ts','src/services/sevenDayHourlyWeather.ts','src/domain/sevenDayConditions.ts',
      'src/domain/soilSampling.ts','src/domain/weatherIntervals.ts','src/domain/mushroomWeather.ts','src/domain/heatmap/regional.ts','src/domain/heatmap/pilot.ts',
      'src/screens/MapScreen.tsx','src/experimental/koroskaShadowData.ts','src/data/koroskaShadow/snapshot.json'])
      strictEqual(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `af26a61:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), file + ' unchanged');
    console.log(JSON.stringify({ environment: 'Windows/Node OFFLINE synthetic provider; not Android or live API', coldHttp: 2, warmHttp: 0, restartWarmHttp: 0,
      dateProfileHttp: 0, parityVectors: 308, adapterMetrics: cold.snapshot.metrics, elapsedMs: elapsed, processCpu,
      coldHeapDeltaBytes: coldMemory.heapUsed - memoryBefore.heapUsed, coldRssDeltaBytes: coldMemory.rss - memoryBefore.rss,
      retainedSnapshotJsonBytes: Buffer.byteLength(JSON.stringify(cold.snapshot)), groupsMs, thousandPaintsMs, geometryBytesUnchanged: Buffer.byteLength(geometry),
      peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      totalMockedRequestsIncludingNegativeTests: http, realHttp: 0 }));
    console.log('PASS bounded live regional service: exact 696/11, 308 shared canonical vectors/parity, native soil/D60/DST, receipt/vintage/ID/unit/partial/expiry/rollover gates, frozen geometry/masks, 2 cold and 0 warm HTTP, production bytes unchanged.');
  } finally { globalThis.Date = realDate; globalThis.fetch = originalFetch; (scorer as any).calculateMushroomWeatherScore = originalScore; }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
