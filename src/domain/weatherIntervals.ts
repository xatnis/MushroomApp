import type { DailyWeatherPoint } from './types';
import type { WeatherSeriesInput } from './weatherSeries';
import { civilDailyPeriod, type DailyPeriod } from './soilSampling';

export const HOURLY_INTERVAL_CONTRACT = 'open-meteo-utc-hourly-civil-v1';
export type HourlyVariable = 'precipitation' | 'temperature_2m' | 'et0_fao_evapotranspiration';
export interface UtcHourlyWeather {
  timezone?: string; utc_offset_seconds?: number;
  hourly_units?: Record<string, string>;
  current_units?: Record<string, string>;
  current?: { time?: number; temperature_2m?: number | null; weather_code?: number | null };
  location_id?: number;
  hourly?: { time?: number[]; precipitation?: Array<number | null>; temperature_2m?: Array<number | null>;
    et0_fao_evapotranspiration?: Array<number | null>; soil_moisture_0_to_7cm?: Array<number | null>; soil_moisture_7_to_28cm?: Array<number | null> };
}
export interface HourlySource {
  data: UtcHourlyWeather; source: WeatherSeriesInput['source']; fetchedAt: string; stale: boolean;
  contract: typeof HOURLY_INTERVAL_CONTRACT;
}
export interface IntervalCoverage {
  expected: number; available: number; complete: boolean; issues: string[];
  semantics: 'preceding-hour-sum' | 'hourly-instant-mean';
}
export interface CivilDayAggregate {
  entry: WeatherSeriesInput; period: DailyPeriod; coverage: Record<HourlyVariable, IntervalCoverage>;
  contract: typeof HOURLY_INTERVAL_CONTRACT;
}
const HOUR = 3600000;
const variables: HourlyVariable[] = ['precipitation', 'temperature_2m', 'et0_fao_evapotranspiration'];
const units = { precipitation: 'mm', temperature_2m: '°C', et0_fao_evapotranspiration: 'mm' };
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** UTC epochs only. API interpolated hourly model output is accepted, never interpolated again here. */
export function indexHourlySource(source: HourlySource) {
  const validObject = source.data != null && typeof source.data === 'object' && !Array.isArray(source.data);
  const times = validObject && Array.isArray(source.data.hourly?.time) ? source.data.hourly.time : [];
  const issues: string[] = [];
  if (!validObject || source.contract !== HOURLY_INTERVAL_CONTRACT || !['GMT', 'UTC', 'Etc/GMT'].includes(source.data.timezone ?? '')
    || source.data.utc_offset_seconds !== 0 || source.data.hourly_units?.time !== 'unixtime'
    || !['archive', 'recentForecastHistory', 'forecast'].includes(source.source)
    || !Number.isFinite(Date.parse(source.fetchedAt))) issues.push('Nepotrjen UTC urni vir ali čas pridobitve.');
  if (!Array.isArray(times) || !times.length) issues.push('Manjka urna časovna os.');
  const indices = new Map<number, number[]>();
  (times ?? []).forEach((time, index) => {
    if (!Number.isSafeInteger(time) || time % 3600 !== 0 || !Number.isFinite(new Date(time * 1000).getTime())) issues.push('Neveljaven urni UTC instant.');
    else indices.set(time * 1000, [...(indices.get(time * 1000) ?? []), index]);
    if (index && time < times![index - 1]) issues.push('Neurejena urna časovna os.');
  });
  return { source, indices, issues: [...new Set(issues)] };
}
export type IndexedHourlySource = ReturnType<typeof indexHourlySource>;

/** Accumulation at t covers (t-1h,t]; temperature at t belongs to [start,end). */
export function validateIntervalCoverage(indexed: IndexedHourlySource, date: string, variable: HourlyVariable): IntervalCoverage {
  const period = civilDailyPeriod(date), start = Date.parse(period.startUtc ?? ''), end = Date.parse(period.endUtc ?? '');
  const expected = (end - start) / HOUR;
  const issues = [...indexed.issues];
  if (!period.compatible || ![23, 24, 25].includes(expected)) issues.push('Neveljavni lokalni dnevni meji.');
  const array = indexed.source.data?.hourly?.[variable];
  if (!Array.isArray(array) || array.length !== indexed.source.data?.hourly?.time?.length) issues.push(`Neujemajoče dolžine ${variable}.`);
  if (indexed.source.data?.hourly_units?.[variable] !== units[variable]) issues.push(`Neveljavna enota ${variable}.`);
  let available = 0;
  if (period.compatible && [23, 24, 25].includes(expected)) for (let n = 0; n < expected; n++) {
    const instant = start + n * HOUR + (variable === 'temperature_2m' ? 0 : HOUR);
    const matches = indexed.indices.get(instant) ?? [];
    if (matches.length !== 1) { issues.push(matches.length ? 'Podvojen urni interval.' : 'Manjka urni interval.'); continue; }
    const value = array?.[matches[0]];
    if (!finite(value) || (variable !== 'temperature_2m' && value < 0)) { issues.push(`Manjka veljavna vrednost ${variable}.`); continue; }
    available++;
  }
  return { expected: Number.isFinite(expected) ? expected : 0, available, complete: issues.length === 0 && available === expected,
    issues: [...new Set(issues)], semantics: variable === 'temperature_2m' ? 'hourly-instant-mean' : 'preceding-hour-sum' };
}

/** One civil day owns its whole source; no cross-vintage gap filling at the archive/forecast seam. */
export function aggregateCivilDay(indexed: IndexedHourlySource, date: string, baseDate: string): CivilDayAggregate {
  const period = civilDailyPeriod(date);
  const coverage = Object.fromEntries(variables.map(key => [key, validateIntervalCoverage(indexed, date, key)])) as Record<HourlyVariable, IntervalCoverage>;
  const values = (key: HourlyVariable) => coverage[key].complete ? Array.from({ length: coverage[key].expected }, (_, n) => {
    const instant = Date.parse(period.startUtc!) + (n + (key === 'temperature_2m' ? 0 : 1)) * HOUR;
    return indexed.source.data.hourly![key]![indexed.indices.get(instant)![0]]!;
  }) : undefined;
  const rain = values('precipitation'), temperature = values('temperature_2m'), et0 = values('et0_fao_evapotranspiration');
  const sum = (array: number[] | undefined) => array?.reduce((a, b) => a + b, 0);
  const day: DailyWeatherPoint = { date, kind: date < baseDate ? 'historical' : 'forecast', precipitationMm: sum(rain),
    temperatureMeanC: temperature ? sum(temperature)! / temperature.length : undefined,
    temperatureMinC: temperature ? Math.min(...temperature) : undefined, temperatureMaxC: temperature ? Math.max(...temperature) : undefined,
    evapotranspirationMm: sum(et0) };
  // Structure is independently validated. Missing values remain undefined and trigger profile-specific requirements.
  const axisComplete = !indexed.issues.length && period.compatible && Array.from({ length: coverage.precipitation.expected + 1 }, (_, n) =>
    indexed.indices.get(Date.parse(period.startUtc!) + n * HOUR)?.length === 1).every(Boolean);
  return { entry: { day, source: indexed.source.source, fetchedAt: indexed.source.fetchedAt, stale: indexed.source.stale },
    period: { ...period, compatible: axisComplete }, coverage, contract: HOURLY_INTERVAL_CONTRACT };
}
