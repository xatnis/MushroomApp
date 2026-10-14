import { sevenDayFixture } from './sevenDayFixture';
import { ljubljanaClock, resolveLjubljanaClock } from '../src/domain/soilSampling';
import { shiftLocalDate } from '../src/services/weather';
import type { UtcHourlyWeather } from '../src/domain/weatherIntervals';

/** Precipitation/ET0 are interval END stamped; no fixture date ownership from UTC date strings. */
export function hourlyWeatherFixture(url: string, baseDate: string): UtcHourlyWeather {
  const params = new URL(url).searchParams, fixture = sevenDayFixture(baseDate);
  const start = Date.parse(params.get('start_date') + 'T00:00:00Z'), end = Date.parse(shiftLocalDate(params.get('end_date')!, 1) + 'T00:00:00Z');
  const time = Array.from({ length: (end - start) / 3600000 }, (_, i) => (start + i * 3600000) / 1000);
  const point = (instant: number) => fixture.daily.find(e => e.day.date === ljubljanaClock(instant).slice(0, 10))?.day;
  const accumulation = (epoch: number, field: 'precipitationMm' | 'evapotranspirationMm') =>
    ljubljanaClock((epoch - 3600) * 1000).slice(11, 16) === '00:00' ? point((epoch - 3600) * 1000)?.[field] ?? 0 : 0;
  const soil = (epoch: number) => fixture.soilByDate[ljubljanaClock(epoch * 1000).slice(0, 10)] ?? fixture.soilByDate[baseDate];
  return { timezone: 'GMT', utc_offset_seconds: 0, current_units: { time: 'unixtime' }, current: { time: resolveLjubljanaClock(baseDate + 'T10:00')[0] / 1000 },
    hourly_units: { time: 'unixtime', precipitation: 'mm', temperature_2m: '°C', et0_fao_evapotranspiration: 'mm', soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³' },
    hourly: { time, precipitation: time.map(t => accumulation(t, 'precipitationMm')), et0_fao_evapotranspiration: time.map(t => accumulation(t, 'evapotranspirationMm')),
      temperature_2m: time.map(t => point(t * 1000)?.temperatureMeanC ?? 12),
      soil_moisture_0_to_7cm: time.map(t => soil(t).soilMoisture0To7Cm ?? null), soil_moisture_7_to_28cm: time.map(t => soil(t).soilMoisture7To28Cm ?? null) } };
}
