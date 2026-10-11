import type { WeatherDailySeries, WeatherSeriesPoint } from '../domain/weatherSeries';

export type WeatherGraphMetric = 'rain' | 'temperature';
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
