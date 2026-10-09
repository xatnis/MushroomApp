import type { DailyWeatherPoint, MushroomWeatherSummary } from './types';
import { shiftLocalDate } from '../services/weather';

export const WEATHER_TIMEZONE = 'Europe/Ljubljana';
export type DailyWeatherSource = 'archive' | 'recentForecastHistory' | 'forecast';
export interface WeatherSeriesInput { day: DailyWeatherPoint; source: DailyWeatherSource; fetchedAt: string | null; stale: boolean }
export interface WeatherSeriesPoint extends Omit<DailyWeatherPoint, 'precipitationMm' | 'temperatureMinC' | 'temperatureMeanC' | 'temperatureMaxC'> {
  precipitationMm: number | null; temperatureMinC: number | null; temperatureMeanC: number | null; temperatureMaxC: number | null;
  source: DailyWeatherSource | null; fetchedAt: string | null; stale: boolean; isCompleteDay: boolean; isProvisional: boolean;
}
export interface WeatherDailySeries {
  latitude: number; longitude: number; timezone: string; today: string; assembledAt: string;
  points: WeatherSeriesPoint[]; availableRange?: { start: string; end: string };
  missing: { precipitation: number; temperatureMean: number; temperatureMin: number; temperatureMax: number };
  partial: boolean; stale: boolean;
}
export function weatherLocalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}
export function validWeatherDate(date: unknown): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function summarySeriesInputs(summary: MushroomWeatherSummary, today: string): WeatherSeriesInput[] {
  return [...(summary.historical?.days ?? []), ...(summary.forecast?.days ?? [])].map(day => ({ day,
    source: day.date >= today ? 'forecast' : day.date >= shiftLocalDate(today, -7) ? 'recentForecastHistory' : 'archive',
    // Summary age is aggregate, not the individual forecast endpoint's retrieval time.
    fetchedAt: null, stale: summary.stale }));
}
/** Calendar slots are explicit: a missing day/value is never synthetic zero or mean. */
export function buildWeatherDailySeries(latitude: number, longitude: number, today: string, inputs: WeatherSeriesInput[]): WeatherDailySeries {
  if (!validWeatherDate(today)) throw new Error('Neveljaven lokalni datum.');
  const byDate = new Map<string, WeatherSeriesInput>();
  for (const entry of inputs) if (validWeatherDate(entry.day?.date)) byDate.set(entry.day.date, entry);
  const points: WeatherSeriesPoint[] = Array.from({ length: 37 }, (_, i) => {
    const date = shiftLocalDate(today, i - 30), entry = byDate.get(date), day = entry?.day;
    const rain = finite(day?.precipitationMm);
    return { date, kind: date < today ? 'historical' : 'forecast',
      precipitationMm: rain != null && rain >= 0 ? rain : null, temperatureMinC: finite(day?.temperatureMinC),
      temperatureMeanC: finite(day?.temperatureMeanC), temperatureMaxC: finite(day?.temperatureMaxC),
      evapotranspirationMm: finite(day?.evapotranspirationMm) ?? undefined,
      source: entry?.source ?? null, fetchedAt: entry?.fetchedAt && Number.isFinite(Date.parse(entry.fetchedAt)) ? entry.fetchedAt : null,
      stale: entry?.stale ?? false,
      isCompleteDay: date < today, isProvisional: date >= today };
  });
  const available = points.filter(p => [p.precipitationMm, p.temperatureMinC, p.temperatureMeanC, p.temperatureMaxC].some(v => v != null));
  const missing = { precipitation: points.filter(p => p.precipitationMm == null).length,
    temperatureMean: points.filter(p => p.temperatureMeanC == null).length, temperatureMin: points.filter(p => p.temperatureMinC == null).length,
    temperatureMax: points.filter(p => p.temperatureMaxC == null).length };
  return { latitude, longitude, timezone: WEATHER_TIMEZONE, today, assembledAt: new Date().toISOString(), points, missing,
    availableRange: available.length ? { start: available[0].date, end: available.at(-1)!.date } : undefined,
    partial: Object.values(missing).some(n => n > 0), stale: points.some(p => p.stale) };
}
export function weatherPlotScale(points: WeatherSeriesPoint[], metric: 'rain' | 'temperature') {
  const values = points.flatMap(p => metric === 'rain' ? [p.precipitationMm] : [p.temperatureMeanC, p.temperatureMinC, p.temperatureMaxC]).filter((v): v is number => v != null);
  if (metric === 'rain') {
    const max = Math.max(1, ...values), magnitude = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 5, 10].map(n => n * magnitude / 2).find(n => n * 4 >= max)!;
    return { min: 0, max: step * 4, ticks: Array.from({ length: 5 }, (_, i) => i * step) };
  }
  const min = Math.floor((Math.min(0, ...values) - 1) / 5) * 5, max = Math.ceil((Math.max(0, ...values) + 1) / 5) * 5;
  return { min, max, ticks: Array.from({ length: 5 }, (_, i) => min + i * (max - min) / 4) };
}
export const weatherDateLabel = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
