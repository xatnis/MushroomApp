import type { HeatmapSoilPoint } from './heatmap/types';
import { validWeatherDate, WEATHER_TIMEZONE } from './weatherSeries';
import { shiftLocalDate } from '../services/weather';

export interface NativeSoilResponse {
  utc_offset_seconds?: number;
  hourly_units?: Record<string, string>;
  hourly?: { time?: string[]; soil_moisture_0_to_7cm?: Array<number | null>; soil_moisture_7_to_28cm?: Array<number | null> };
}
export interface SoilSampleMetadata {
  contract: 'point-asof-or-local09-v1'; providerTime: string; instantUtc: string; localTime: string;
  timezone: typeof WEATHER_TIMEZONE; providerOffsetSeconds: number;
  mode: 'currentModelled' | 'forecast'; retrievedAt: string | null;
  providerEpochSeconds?: number; localOffsetSeconds?: number; depthsCm?: ['0–7', '7–28']; units?: 'm³/m³'; source?: 'open-meteo-forecast-hourly';
  requestedInstantUtc?: string;
}
export interface DailyPeriod {
  startUtc: string | null; endUtc: string | null; compatible: boolean;
  basis: 'provider-fixed-offset' | 'local-calendar';
}
const clock = new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function ljubljanaClock(instant: number): string {
  const p = clock.formatToParts(instant), read = (kind: string) => p.find(v => v.type === kind)!.value;
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}:${read('second')}`;
}
const wallEpoch = (time: string): number | undefined => {
  if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(time) || !validWeatherDate(time.slice(0, 10))) return;
  const normalized = time.length === 16 ? time + ':00' : time;
  const value = Date.parse(normalized + 'Z');
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 19) === normalized ? value : undefined;
};
/** Open-Meteo offsetless ISO strings are in the RESPONSE'S fixed offset, not host time or dynamic IANA time. */
export function providerInstant(time: string, offset: number | undefined): number | undefined {
  const wall = wallEpoch(time);
  return wall != null && typeof offset === 'number' && Number.isInteger(offset) && Math.abs(offset) <= 14 * 3600 ? wall - offset * 1000 : undefined;
}
/** Nonexistent clocks have zero instants; ambiguous clocks return BOTH in chronological order. No silent guess. */
export function resolveLjubljanaClock(time: string): number[] {
  const wall = wallEpoch(time); if (wall == null) return [];
  const wanted = time.length === 16 ? time + ':00' : time;
  const offsets = new Set<number>();
  for (const delta of [-12, 0, 12]) {
    const instant = wall + delta * 3600000;
    offsets.add(Date.parse(ljubljanaClock(instant) + 'Z') - instant);
  }
  return [...offsets].map(offset => wall - offset).filter(instant => ljubljanaClock(instant) === wanted).sort((a, b) => a - b);
}
const civilPeriods = new Map<string, DailyPeriod>();
export function civilDailyPeriod(date: string): DailyPeriod {
  const cached = civilPeriods.get(date); if (cached) return cached;
  if (!validWeatherDate(date)) return { startUtc: null, endUtc: null, compatible: false, basis: 'local-calendar' };
  const start = resolveLjubljanaClock(date + 'T00:00'), end = resolveLjubljanaClock(shiftLocalDate(date, 1) + 'T00:00');
  const period: DailyPeriod = Object.freeze({ startUtc: start.length === 1 ? new Date(start[0]).toISOString() : null, endUtc: end.length === 1 ? new Date(end[0]).toISOString() : null,
    compatible: start.length === 1 && end.length === 1, basis: 'local-calendar' });
  civilPeriods.set(date, period); if (civilPeriods.size > 256) civilPeriods.delete(civilPeriods.keys().next().value!);
  return period;
}
export function providerDailyPeriod(date: string, offset: number | undefined): DailyPeriod {
  if (!validWeatherDate(date)) return { startUtc: null, endUtc: null, compatible: false, basis: 'provider-fixed-offset' };
  const start = providerInstant(date + 'T00:00', offset), end = providerInstant(shiftLocalDate(date, 1) + 'T00:00', offset), local = civilDailyPeriod(date);
  const startUtc = start == null ? null : new Date(start).toISOString(), endUtc = end == null ? null : new Date(end).toISOString();
  return { startUtc, endUtc, compatible: startUtc != null && endUtc != null && startUtc === local.startUtc && endUtc === local.endUtc, basis: 'provider-fixed-offset' };
}

/** Same-instant two native depths only. Current: floor/as-of <=1 hour; future: exact civil 09:00, never nearest/carry-forward. */
export function sampleNativeSoil(data: NativeSoilResponse | undefined, date: string, mode: { kind: 'current'; providerReference: string } | { kind: 'morning' }, retrievedAt: string | null = null): { point?: HeatmapSoilPoint; metadata?: SoilSampleMetadata; missing: string[] } {
  if (!validWeatherDate(date) || !Array.isArray(data?.hourly?.time)) return { missing: ['Manjka časovna os talne vlage.'] };
  const targets = mode.kind === 'current' ? [providerInstant(mode.providerReference, data.utc_offset_seconds)].filter((v): v is number => v != null) : resolveLjubljanaClock(date + 'T09:00');
  if (targets.length !== 1) return { missing: ['Instant vzorčenja talne vlage ni enolično določen.'] };
  const target = targets[0];
  const candidates = data.hourly.time.flatMap((time, index) => {
    const instant = providerInstant(time, data.utc_offset_seconds);
    // Reject instants that cannot be selected BEFORE the expensive IANA clock conversion.
    // The exact/as-of eligibility, local-date and duplicate checks below remain identical.
    const eligible = instant != null && (mode.kind === 'morning' ? instant === target : instant <= target && target - instant < 3600000);
    return eligible && ljubljanaClock(instant!).startsWith(date + 'T') ? [{ time, index, instant: instant! }] : [];
  });
  const selected = mode.kind === 'morning' ? candidates.filter(p => p.instant === target)
    : candidates.filter(p => p.instant <= target && target - p.instant < 3600000).sort((a, b) => b.instant - a.instant).slice(0, 1);
  // A duplicated provider timestamp cannot safely select one of two potentially different array values.
  const chosen = selected[0];
  if (!chosen || candidates.filter(p => p.instant === chosen.instant).length !== 1) return { missing: ['Manjka enoličen urni vzorec talne vlage za zahtevani lokalni instant.'] };
  const missing: string[] = [];
  const layer = (key: 'soil_moisture_0_to_7cm' | 'soil_moisture_7_to_28cm', depth: string) => {
    const value = data.hourly?.[key]?.[chosen.index], unit = data.hourly_units?.[key];
    if ((unit != null && unit !== 'm³/m³') || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) { missing.push(`Manjkajo združljivi podatki o vlagi tal ${depth} (m³/m³).`); return undefined; }
    return value;
  };
  const localTime = ljubljanaClock(chosen.instant).slice(0, 16);
  const point: HeatmapSoilPoint = { time: localTime, soilMoisture0To7Cm: layer('soil_moisture_0_to_7cm', '0–7 cm'), soilMoisture7To28Cm: layer('soil_moisture_7_to_28cm', '7–28 cm') };
  return { point, metadata: { contract: 'point-asof-or-local09-v1', providerTime: chosen.time, instantUtc: new Date(chosen.instant).toISOString(), localTime,
    timezone: WEATHER_TIMEZONE, providerOffsetSeconds: data.utc_offset_seconds!, mode: mode.kind === 'current' ? 'currentModelled' : 'forecast', retrievedAt,
    requestedInstantUtc: new Date(target).toISOString() }, missing };
}
