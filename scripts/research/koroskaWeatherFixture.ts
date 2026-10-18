/** Deterministic synthetic hourly field, NOT observations and NOT an issued forecast. */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { UtcHourlyWeather } from '../../src/domain/weatherIntervals';
import { ljubljanaClock, resolveLjubljanaClock } from '../../src/domain/soilSampling';
import { getHeatmapWeatherBatch, shiftLocalDate } from '../../src/services/weather';
import { sevenDayHourlyRequestPlan } from '../../src/services/sevenDayHourlyWeather';
import { selectPilot, type FrozenBatch } from './koroskaRegionalPrototype';

export const FIXTURE_VERSION = 'synthetic-koroska-hourly-v1';
export function memoryDb() {
  const rows = new Map<string, { payload: string; fetchedAt: string; expiresAt: string }>();
  return { getFirstAsync: async (_sql: string, key: string) => rows.get(key) ?? null,
    runAsync: async (_sql: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => {
      rows.set(key, { payload, fetchedAt, expiresAt }); return { changes: 1, lastInsertRowId: 0 };
    } } as unknown as SQLiteDatabase;
}
export function makeFrozenBatch(baseLocalDate = '2026-10-26'): FrozenBatch {
  const retrieved = new Date(resolveLjubljanaClock(baseLocalDate + 'T10:45')[0]).toISOString();
  return { baseLocalDate, evidence: 'synthetic-fixture', sourceContract: FIXTURE_VERSION,
    locations: selectPilot().weather.map((definition, index) => ({ definition,
      sources: sevenDayHourlyRequestPlan(definition.latitude, definition.longitude, baseLocalDate).map(plan => {
        const params = new URL(plan.url).searchParams;
        const start = Date.parse(params.get('start_date') + 'T00:00Z'), end = Date.parse(shiftLocalDate(params.get('end_date')!, 1) + 'T00:00Z');
        const time = Array.from({ length: (end - start) / 3600000 }, (_, i) => start / 1000 + i * 3600);
        const dayOffset = (epoch: number) => Math.round((Date.parse(ljubljanaClock(epoch * 1000).slice(0,10) + 'T12:00Z') - Date.parse(baseLocalDate + 'T12:00Z')) / 86400000);
        const top = (t: number) => .18 + index * .004 + dayOffset(t) * .0003 + Number(ljubljanaClock(t*1000).slice(11,13)) * .003;
        const data: UtcHourlyWeather = { timezone: 'GMT', utc_offset_seconds: 0, location_id: index,
          current_units: { time: 'unixtime', temperature_2m: '°C' },
          current: { time: resolveLjubljanaClock(baseLocalDate + 'T10:45')[0] / 1000, temperature_2m: 13, weather_code: 2 },
          hourly_units: { time: 'unixtime', precipitation: 'mm', temperature_2m: '°C', et0_fao_evapotranspiration: 'mm', soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³' },
          hourly: { time, precipitation: time.map(t => (t/3600 + index*7) % 19 === 0 ? 1.5 + index * .2 : 0),
            temperature_2m: time.map(t => 8 + index * .4 + ((dayOffset(t) % 5 + 5) % 5) + Math.sin(Number(ljubljanaClock(t*1000).slice(11,13)) * Math.PI/12) * 4),
            et0_fao_evapotranspiration: time.map(() => .03 + index*.002),
            soil_moisture_0_to_7cm: time.map(top), soil_moisture_7_to_28cm: time.map(t => top(t) + .03) } };
        if (plan.endpoint === 'archive') {
          delete data.current; delete data.current_units;
          delete data.hourly!.soil_moisture_0_to_7cm; delete data.hourly!.soil_moisture_7_to_28cm;
          delete data.hourly_units!.soil_moisture_0_to_7cm; delete data.hourly_units!.soil_moisture_7_to_28cm;
        }
        return { status: 'fulfilled' as const, value: { data, stale: false, fetchedAt: retrieved } };
      }) })) };
}

/** Reconstruct known fixed-offset provider DAILY bins from the SAME synthetic physical field.
 * This isolates policy effects; it is not evidence of the live provider's exact daily model products. */
export function legacyResponse(batch: FrozenBatch, endpoint: number) {
  const baseInstant = resolveLjubljanaClock(batch.baseLocalDate + 'T00:00')[0];
  const offset = Date.parse(batch.baseLocalDate + 'T00:00Z') - baseInstant;
  return batch.locations.map((row, index) => {
    const response = row.sources[endpoint];
    if (response.status !== 'fulfilled') throw new Error('Fixture legacy reconstruction needs both sources');
    const raw = response.value.data, hourly = raw.hourly!, lookup = new Map(hourly.time!.map((t,i) => [t*1000,i]));
    const dates = Array.from({ length: endpoint ? 14 : 53 }, (_, n) => shiftLocalDate(batch.baseLocalDate, (endpoint ? -7 : -60) + n));
    const values = (date: string, field: 'precipitation' | 'temperature_2m' | 'et0_fao_evapotranspiration') => {
      const start = Date.parse(date + 'T00:00Z') - offset;
      return Array.from({length:24}, (_, h) => hourly[field]?.[lookup.get(start + (h + (field === 'temperature_2m' ? 0 : 1)) * 3600000) ?? -1]);
    };
    const sum = (xs: Array<number | null | undefined>) => xs.every(x => typeof x === 'number' && Number.isFinite(x)) ? xs.reduce<number>((a,b)=>a+b!,0) : null;
    const mean = (date: string) => {const xs=values(date,'temperature_2m'), s=sum(xs); return s == null ? null : s/24;};
    const extreme=(date:string,mode:'min'|'max')=>{const xs=values(date,'temperature_2m');return sum(xs)==null?null:
      (mode==='min'?Math.min(...xs as number[]):Math.max(...xs as number[]));};
    // All wall labels use the same fixture offset, matching this explicitly tested legacy scenario.
    const clock = (t: number) => new Date(t*1000 + offset).toISOString().slice(0,16);
    return { location_id: index, utc_offset_seconds: offset/1000,
      current: raw.current ? { time: clock(raw.current.time!), temperature_2m: raw.current.temperature_2m??null, weather_code: raw.current.weather_code??null } : undefined,
      hourly: { time: hourly.time!.map(clock), soil_moisture_0_to_7cm: hourly.soil_moisture_0_to_7cm,
        soil_moisture_7_to_28cm: hourly.soil_moisture_7_to_28cm },
      daily: { time: dates, precipitation_sum: dates.map(d => sum(values(d,'precipitation'))),
        temperature_2m_mean: dates.map(mean), temperature_2m_min: dates.map(d=>extreme(d,'min')), temperature_2m_max: dates.map(d=>extreme(d,'max')),
        et0_fao_evapotranspiration: dates.map(d=>sum(values(d,'et0_fao_evapotranspiration'))), weather_code: dates.map(()=>null) } };
  });
}
export async function legacyFromFrozen(batch: FrozenBatch) {
  const original = globalThis.fetch; let mockRequests=0;
  const payloads = [0,1].map(endpoint=>{try{return legacyResponse(batch,endpoint);}catch{return undefined;}});
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (++mockRequests > 2) throw new Error('Unexpected legacy fixture request');
    const parsed = new URL(String(url));
    if (!['archive-api.open-meteo.com', 'api.open-meteo.com'].includes(parsed.hostname)) throw new Error('Unexpected fixture endpoint');
    const payload=payloads[parsed.hostname.startsWith('archive')?0:1];
    return { ok:!!payload, status:payload?200:503, json:async()=>payload } as Response;
  }) as typeof fetch;
  try {
    const result = await getHeatmapWeatherBatch(memoryDb(), selectPilot().weather, batch.baseLocalDate);
    // Freeze retrieval metadata of synthetic inputs; production adapter's real clock is not a model issue time.
    for (const cell of Object.values(result.cells)) cell.fetchedAt = batch.locations[0].sources[0].status === 'fulfilled' ? batch.locations[0].sources[0].value.fetchedAt : '';
    return { result, mockRequests, realHttpRequests: 0, error:null,decodedFixtureBytes: payloads.map(p => p?Buffer.byteLength(JSON.stringify(p)):0) };
  } catch(error) {
    return {result:undefined,mockRequests,realHttpRequests:0,error:String(error),decodedFixtureBytes:payloads.map(p=>p?Buffer.byteLength(JSON.stringify(p)):0)};
  } finally { globalThis.fetch = original; }
}
