import { strictEqual, ok } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { hourlyWeatherFixture } from './sevenDayHourlyFixture';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { loadCanonicalPointSnapshot, pointResults } from '../src/services/pointConditions';

// Production adapters, transport and scorer; no native/UI latency claim. Public test coordinates only.
async function run() {
  const live = process.argv.includes('--live'), realFetch = globalThis.fetch;
  const realDate = globalThis.Date; let now = live ? realDate.now() : realDate.parse('2026-10-14T12:00:00Z');
  class TestDate extends realDate { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  globalThis.Date = TestDate as DateConstructor;
  const date = weatherLocalDate(), rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  const cpu: Record<string, { ms: number; calls: number }> = {}, restore: (() => void)[] = [];
  for (const [module, names] of [
    ['../src/domain/soilSampling', ['sampleNativeSoil']],
    ['../src/domain/weatherIntervals', ['indexHourlySource', 'aggregateCivilDay']],
    ['../src/domain/sevenDayConditions', ['buildWeatherInputsForTargetDate', 'evaluateSevenDayConditions']],
  ] as const) {
    const exports = require(module);
    for (const name of names) { const original = exports[name];
      exports[name] = (...args: any[]) => { const start = performance.now(); try { return original(...args); }
        finally { const metric = cpu[name] ??= { ms: 0, calls: 0 }; metric.ms += performance.now() - start; metric.calls++; } };
      restore.push(() => { exports[name] = original; });
    }
  }
  let http = 0; const requests: { endpoint: string; responseMs: number; decodeMs: number }[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    http++; const start = performance.now(), parsed = new URL(String(url));
    const response = live ? await realFetch(url, options) : { ok: true, json: async () => hourlyWeatherFixture(String(url), date) };
    const metric = { endpoint: parsed.hostname.startsWith('archive') ? 'archive' : 'forecast', responseMs: performance.now() - start, decodeMs: 0 };
    requests.push(metric);
    return { ok: response.ok, status: (response as Response).status, json: async () => { const t = performance.now(); try { return await response.json(); } finally { metric.decodeMs = performance.now() - t; } } };
  }) as any;
  const measures: any[] = [];
  async function measure(name: string, point: { latitude: number; longitude: number }) {
    const start = performance.now(), before = http, snapshot = await loadCanonicalPointSnapshot(db, point, date), acquired = performance.now();
    const results = pointResults(snapshot, 'generic'), selected = performance.now();
    // Match the pre-optimization hook's eager all-profile work separately from the active profile.
    for (const profile of ['boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'] as const) pointResults(snapshot, profile);
    const end = performance.now();
    measures.push({ name, http: http - before, acquisitionMs: +(acquired - start).toFixed(2), selectedProfileMs: +(selected - acquired).toFixed(2), selectedReadyMs: +(selected - start).toFixed(2), otherProfilesMs: +(end - selected).toFixed(2), legacyEagerTotalMs: +(end - start).toFixed(2), available: results.filter(r => r.score != null).length });
    return snapshot;
  }
  try {
    const a = { latitude: 46.5, longitude: 14.5 }, b = { latitude: 46.6, longitude: 14.9 };
    const first = await measure('cold A', a); strictEqual(http, 2);
    strictEqual(await measure('warm A', a), first); strictEqual(http, 2);
    await measure('cold B', b); strictEqual(http, 4);
    strictEqual(await measure('return A', a), first); strictEqual(http, 4);
    const start = performance.now(); for (let i = 0; i < 7; i++) ok(pointResults(first, 'generic')[i]);
    console.log(JSON.stringify({ environment: live ? 'LIVE Open-Meteo, Node/Windows; not Android' : 'deterministic production pipeline, Node/Windows; not Android', date, measures, cachedDaySwitchMs: +(performance.now() - start).toFixed(3), requests, cpu }, null, 2));
  } finally { globalThis.fetch = realFetch; globalThis.Date = realDate; restore.forEach(fn => fn()); }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
