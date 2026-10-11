import type { WeatherDailySeries, WeatherSeriesPoint } from '../domain/weatherSeries';
import { shiftLocalDate } from '../services/weather';

export type WeatherGraphMetric = 'rain' | 'temperature';
export type WeatherGraphPreset = 'history7' | 'history30' | 'forecast7';
export interface WeatherGraphNavigation { preset: WeatherGraphPreset; generation: number }

/** Presentation navigation only. Keep every date, including nullable dates, in the series. */
export function graphPresetRange(series: WeatherDailySeries, preset: WeatherGraphPreset) {
  const start = preset === 'forecast7' ? series.today : shiftLocalDate(series.today, preset === 'history7' ? -7 : -30);
  const end = shiftLocalDate(series.today, preset === 'forecast7' ? 6 : -1);
  const points = series.points.filter(point => point.date >= start && point.date <= end
    && (preset === 'forecast7' ? point.kind === 'forecast' : point.kind === 'historical' && point.isCompleteDay));
  return { points, startIndex: Math.max(0, series.points.findIndex(point => point.date === points[0]?.date)), selectedDate: points[0]?.date ?? series.today };
}

export function graphScrollOffset(index: number, cellWidth: number, viewportWidth: number, count: number, centered = false) {
  const desired = centered ? (index + .5) * cellWidth - viewportWidth / 2 : index * cellWidth;
  return Math.max(0, Math.min(desired, Math.max(0, count * cellWidth - viewportWidth)));
}
export function graphSelectionVisible(index: number, cellWidth: number, viewportWidth: number, offset: number) {
  const center = (index + .5) * cellWidth;
  return viewportWidth <= 0 || (center >= offset && center <= offset + viewportWidth);
}
export const graphNumber = (value: number | null, unit: string) => value == null ? 'Ni podatka'
  : `${value.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} ${unit}`;
export function graphDate(date: string) {
  const months = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'];
  return `${Number(date.slice(8, 10))}. ${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}
export const graphPhase = (point: WeatherSeriesPoint, today: string) => point.kind === 'historical'
  ? 'Pretekli modelski podatek' : point.date === today ? 'Danes · napoved, nedokončan dan' : 'Napoved';
export function graphPointValues(point: WeatherSeriesPoint, metric: WeatherGraphMetric) {
  return metric === 'rain' ? graphNumber(point.precipitationMm, 'mm')
    : `Povprečje: ${graphNumber(point.temperatureMeanC, '°C')}. Min: ${graphNumber(point.temperatureMinC, '°C')}. Max: ${graphNumber(point.temperatureMaxC, '°C')}.`;
}

/** Display summaries only. No scorer inputs, thresholds or imputation. */
export function graphSummary(series: WeatherDailySeries, metric: WeatherGraphMetric) {
  const windows = [series.points.slice(23, 30), series.points.slice(30, 33)];
  const signals = windows.map((points, index) => {
    const values = points.map(p => metric === 'rain' ? p.precipitationMm : p.temperatureMeanC).filter((v): v is number => v != null && Number.isFinite(v));
    const complete = values.length === points.length && points.length === (index ? 3 : 7);
    const value = complete ? values.reduce((sum, v) => sum + v, 0) / (metric === 'temperature' ? values.length : 1) : null;
    const label = metric === 'rain' ? index ? 'Danes in naslednja 2 dni' : 'Zadnjih 7 zaključenih dni'
      : index ? 'Napoved: 3-dnevno povprečje' : 'Povprečje zadnjih 7 dni';
    return { label, value,
      text: complete ? graphNumber(value, metric === 'rain' ? 'mm' : '°C') : `Ni vseh podatkov (${values.length}/${index ? 3 : 7} dni)` };
  });
  // Compare the displayed 0.1°C averages, not a new ecological/stability threshold.
  const [past, next] = signals.map(s => s.value == null ? null : Number(s.value.toLocaleString('en-US', { maximumFractionDigits: 1, useGrouping: false })));
  const trend = metric === 'temperature' && past != null && next != null
    ? next > past ? 'V napovedi povprečno topleje.' : next < past ? 'V napovedi povprečno hladneje.' : 'Podobno povprečje v napovedi.' : null;
  const description = signals.map(s => `${s.label}: ${s.text}.`).join(' ') + (trend ? ` ${trend}` : '')
    + (series.stale ? ' Vključeni so starejši podatki iz predpomnilnika.' : '');
  return { signals, trend, description };
}

/** Native line dash geometry, bounded by the existing day-cell width. */
export function forecastDashes(length: number) {
  return Array.from({ length: Math.ceil(length / 12) }, (_, index) => ({ left: index * 12, width: Math.min(7, length - index * 12) }));
}
