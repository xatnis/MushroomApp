import type { SQLiteDatabase } from 'expo-sqlite';
import type { SevenDaySnapshot } from '../domain/sevenDayConditions';
import { aggregateCivilDay, indexHourlySource, HOURLY_INTERVAL_CONTRACT, type UtcHourlyWeather } from '../domain/weatherIntervals';
import { civilDailyPeriod, sampleNativeSoil, ljubljanaClock } from '../domain/soilSampling';
import { cachedFetch, shiftLocalDate, buildHistoricalWeatherSummaryForTarget, buildForecastWeatherSummary } from './weather';

const variables = 'temperature_2m,precipitation,et0_fao_evapotranspiration';
const soilVariables = 'soil_moisture_0_to_7cm,soil_moisture_7_to_28cm';
const utcDate = (instant: string) => instant.slice(0, 10);
/** Request whole UTC dates covering civil boundaries, including the final accumulation endpoint. */
export function sevenDayHourlyRequestPlan(latitude: number, longitude: number, baseDate: string) {
  const first = civilDailyPeriod(shiftLocalDate(baseDate, -60)).startUtc!;
  const seam = civilDailyPeriod(shiftLocalDate(baseDate, -7)).startUtc!;
  const end = civilDailyPeriod(shiftLocalDate(baseDate, 6)).endUtc!;
  if (!first || !seam || !end || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error('Neveljavne meje urnega vremenskega okna.');
  const coordinate = `${latitude}:${longitude}`; // Exact location, no collision with old rounded-coordinate daily caches.
  return ([['archive', first, seam], ['forecast', seam, end]] as const).map(([endpoint, start, finish]) => {
    const fields = endpoint === 'archive' ? variables : `${variables},${soilVariables}`;
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), start_date: utcDate(start),
      end_date: utcDate(finish), hourly: fields, timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', precipitation_unit: 'mm' });
    if (endpoint === 'forecast') { params.set('current', 'temperature_2m'); params.set('temporal_resolution', 'hourly'); }
    return { endpoint, key: `seven-day-hourly-v1:${coordinate}:${baseDate}:${start}:${finish}:${fields}:GMT:unix:hourly`,
      url: `${endpoint === 'archive' ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast'}?${params}` };
  });
}

/** A separate, validated input contract; never silently replaces today's production summary/cache. */
export async function withCivilHourlyWeather(db: SQLiteDatabase, legacy: SevenDaySnapshot, timeoutMs?: number): Promise<SevenDaySnapshot> {
  const plan = sevenDayHourlyRequestPlan(legacy.latitude, legacy.longitude, legacy.baseLocalDate);
  const responses = await Promise.allSettled(plan.map(request => cachedFetch<UtcHourlyWeather>(db, request.key, request.url, true, timeoutMs)));
  const archive = responses[0].status === 'fulfilled' ? responses[0].value : undefined;
  const forecast = responses[1].status === 'fulfilled' ? responses[1].value : undefined;
  const indexedArchive = archive && indexHourlySource({ ...archive, source: 'archive', contract: HOURLY_INTERVAL_CONTRACT });
  const indexedForecast = forecast && indexHourlySource({ ...forecast, source: 'forecast', contract: HOURLY_INTERVAL_CONTRACT });
  const daily: SevenDaySnapshot['daily'] = [], dailyPeriods: SevenDaySnapshot['dailyPeriods'] = {};
  const intervalCoverage: NonNullable<SevenDaySnapshot['intervalCoverage']> = {};
  const seam = shiftLocalDate(legacy.baseLocalDate, -7);
  for (let offset = -60; offset <= 6; offset++) {
    const date = shiftLocalDate(legacy.baseLocalDate, offset);
    const indexed = date < seam ? indexedArchive : indexedForecast;
    if (!indexed) continue;
    const aggregate = aggregateCivilDay(indexed, date, legacy.baseLocalDate);
    daily.push({ ...aggregate.entry, source: date < seam ? 'archive' : date < legacy.baseLocalDate ? 'recentForecastHistory' : 'forecast' });
    dailyPeriods[date] = aggregate.period; intervalCoverage[date] = aggregate.coverage;
  }
  const soilByDate: SevenDaySnapshot['soilByDate'] = {}, soilSampling: NonNullable<SevenDaySnapshot['soilSampling']> = {}, dateBlockers: NonNullable<SevenDaySnapshot['dateBlockers']> = {};
  // Decode only a validated UTC axis. Preserve actual provider epoch, native layer units and response provenance.
  const data = forecast?.data;
  const native = indexedForecast && !indexedForecast.issues.length ? { utc_offset_seconds: 0, hourly_units: data?.hourly_units,
    hourly: { time: data!.hourly!.time!.map(time => new Date(time * 1000).toISOString().slice(0, 19)),
      soil_moisture_0_to_7cm: data?.hourly_units?.soil_moisture_0_to_7cm === 'm³/m³' && data.hourly?.soil_moisture_0_to_7cm?.length === data.hourly?.time?.length ? data.hourly?.soil_moisture_0_to_7cm : undefined,
      soil_moisture_7_to_28cm: data?.hourly_units?.soil_moisture_7_to_28cm === 'm³/m³' && data.hourly?.soil_moisture_7_to_28cm?.length === data.hourly?.time?.length ? data.hourly?.soil_moisture_7_to_28cm : undefined } } : undefined;
  const currentEpoch = data?.current_units?.time === 'unixtime' && Number.isSafeInteger(data.current?.time)
    && Number.isFinite(new Date(data!.current!.time! * 1000).getTime())
    && data!.current!.time! * 1000 <= Date.parse(forecast!.fetchedAt) ? data!.current!.time! : undefined;
  for (let offset = 0; offset < 7; offset++) {
    const date = shiftLocalDate(legacy.baseLocalDate, offset);
    const sample = sampleNativeSoil(native, date, offset ? { kind: 'morning' } : { kind: 'current',
      providerReference: currentEpoch == null ? '' : new Date(currentEpoch * 1000).toISOString().slice(0, 19) }, forecast?.fetchedAt ?? null);
    if (sample.point) soilByDate[date] = sample.point;
    if (sample.metadata) {
      const epoch = Date.parse(sample.metadata.instantUtc) / 1000;
      soilSampling[date] = { ...sample.metadata, providerEpochSeconds: epoch,
        localOffsetSeconds: (Date.parse(ljubljanaClock(epoch * 1000) + 'Z') - epoch * 1000) / 1000,
        depthsCm: ['0–7', '7–28'], units: 'm³/m³', source: 'open-meteo-forecast-hourly' };
    }
    if (sample.missing.length) dateBlockers[date] = sample.missing;
  }
  const blockers = [...legacy.blockers];
  if (!archive) blockers.push('Urna zgodovina za lokalna dnevna okna ni na voljo.');
  if (!forecast) blockers.push('Urna napoved za lokalna dnevna okna ni na voljo.');
  blockers.push(...(indexedArchive?.issues ?? []), ...(indexedForecast?.issues ?? []));
  const expires = [legacy.expiresAt, ...[archive, forecast].map(row => row && !row.stale && Number.isFinite(Date.parse(row.fetchedAt)) ? Date.parse(row.fetchedAt) + 30 * 60000 : 0)];
  const stale = legacy.stale || !!archive?.stale || !!forecast?.stale;
  const today: SevenDaySnapshot['today'] = { latitude: legacy.latitude, longitude: legacy.longitude,
    historical: buildHistoricalWeatherSummaryForTarget(daily.filter(e => e.day.date < legacy.baseLocalDate).map(e => e.day), legacy.baseLocalDate),
    forecast: buildForecastWeatherSummary(daily.filter(e => e.day.date >= legacy.baseLocalDate).map(e => e.day)),
    current: { ...soilByDate[legacy.baseLocalDate], temperatureC: data?.current_units?.temperature_2m === '°C' && typeof data.current?.temperature_2m === 'number' && Number.isFinite(data.current.temperature_2m) ? data.current.temperature_2m : undefined },
    errors: { historical: !archive ? 'Urna zgodovina ni dosegljiva.' : legacy.today.errors.historical,
      forecast: !forecast ? 'Urna napoved ni dosegljiva.' : legacy.today.errors.forecast },
    updatedAt: [archive?.fetchedAt, forecast?.fetchedAt].filter((time): time is string => !!time).sort().at(-1) ?? legacy.today.updatedAt, stale, source: 'open-meteo' };
  return { ...legacy, today, legacyToday: legacy.today, inputContract: HOURLY_INTERVAL_CONTRACT, legacyDaily: legacy.daily, daily, dailyPeriods, intervalCoverage,
    soilByDate, soilSampling, dateBlockers, blockers: [...new Set(blockers)],
    forecastRetrievedAt: forecast?.fetchedAt ?? null, archiveRetrievedAt: archive?.fetchedAt ?? null,
    snapshotId: `${legacy.snapshotId}:${HOURLY_INTERVAL_CONTRACT}:${forecast?.fetchedAt ?? 'missing'}:${archive?.fetchedAt ?? 'missing'}`,
    expiresAt: Math.min(...expires), stale,
    assembledAt: new Date().toISOString() };
}
