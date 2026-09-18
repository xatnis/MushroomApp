import type { SQLiteDatabase } from 'expo-sqlite';
import type { ConditionsData, DailyWeatherPoint, ForecastWeatherSummary, HistoricalWeatherSummary, MushroomWeatherSummary, WeatherSnapshot } from '../domain/types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_MS = 30 * 60 * 1000;
const inFlight = new Map<string, Promise<unknown>>();

export interface PlaceSearchResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  admin2?: string;
}

interface HourlyResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
  };
  current?: { time?: string; temperature_2m?: number; precipitation?: number };
}

interface MushroomWeatherResponse {
  current?: { time?: string; temperature_2m?: number | null; weather_code?: number | null };
  hourly?: {
    time?: string[];
    soil_moisture_0_to_7cm?: Array<number | null>;
    soil_moisture_7_to_28cm?: Array<number | null>;
  };
  daily?: {
    time?: string[];
    temperature_2m_min?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_mean?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    et0_fao_evapotranspiration?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
}

interface GeocodingResponse {
  results?: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
    admin2?: string;
  }>;
}

const roundCoordinate = (value: number) => value.toFixed(2);
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const localDateOnly = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const dateAtOffset = (days: number) => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return localDateOnly(value);
};

export const weatherCodeLabel = (code?: number) => {
  if (code == null) return undefined;
  if (code === 0) return 'Jasno';
  if (code === 1) return 'Pretežno jasno';
  if (code === 2) return 'Delno oblačno';
  if (code === 3) return 'Oblačno';
  if ([45, 48].includes(code)) return 'Megla';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Rosenje';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Dež';
  if ([71, 73, 75, 77].includes(code)) return 'Sneg';
  if ([80, 81, 82].includes(code)) return 'Plohe';
  if ([85, 86].includes(code)) return 'Snežne plohe';
  if ([95, 96, 99].includes(code)) return 'Nevihta';
  return 'Neznane razmere';
};

export async function searchLocations(query: string, signal?: AbortSignal): Promise<PlaceSearchResult[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  const params = new URLSearchParams({ name, count: '8', language: 'sl', format: 'json' });
  const response = await fetch(`${GEOCODING_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`Iskanje lokacij ni uspelo (${response.status}).`);
  const data = await response.json() as GeocodingResponse;
  return (data.results ?? []).filter((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude));
}

async function cachedFetch<T>(db: SQLiteDatabase, key: string, url: string, allowStale = true): Promise<{ data: T; stale: boolean; fetchedAt: string }> {
  const cached = await db.getFirstAsync<{ payload: string; fetchedAt: string; expiresAt: string }>(`SELECT payload, fetchedAt, expiresAt FROM weather_cache WHERE cacheKey=?`, key);
  if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
    return { data: JSON.parse(cached.payload) as T, stale: false, fetchedAt: cached.fetchedAt };
  }
  const existing = inFlight.get(key) as Promise<{ data: T; stale: boolean; fetchedAt: string }> | undefined;
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
      const data = await response.json() as T;
      const fetchedAt = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO weather_cache(cacheKey,payload,fetchedAt,expiresAt) VALUES(?,?,?,?) ON CONFLICT(cacheKey) DO UPDATE SET payload=excluded.payload,fetchedAt=excluded.fetchedAt,expiresAt=excluded.expiresAt`,
        key, JSON.stringify(data), fetchedAt, new Date(Date.now() + CACHE_MS).toISOString(),
      );
      return { data, stale: false, fetchedAt };
    } catch (error) {
      if (cached && allowStale) return { data: JSON.parse(cached.payload) as T, stale: true, fetchedAt: cached.fetchedAt };
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

export async function getConditions(db: SQLiteDatabase, latitude: number, longitude: number): Promise<ConditionsData> {
  const key = `conditions:${roundCoordinate(latitude)}:${roundCoordinate(longitude)}`;
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    hourly: 'temperature_2m,precipitation', current: 'temperature_2m,precipitation',
    past_days: '7', forecast_days: '3', timezone: 'auto',
  });
  const result = await cachedFetch<HourlyResponse>(db, key, `${FORECAST_URL}?${params}`);
  const times = result.data.hourly?.time ?? [];
  const precipitation = result.data.hourly?.precipitation ?? [];
  const temperatures = result.data.hourly?.temperature_2m ?? [];
  const now = Date.now();
  const sumPeriod = (hours: number): number | undefined => {
    const values = times.flatMap((time, index) => {
      const timestamp = new Date(time).getTime();
      const value = precipitation[index];
      return timestamp <= now && timestamp > now - hours * 3600_000 && value != null ? [value] : [];
    });
    return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
  };
  const latestMeaningfulRain = times.reduce<number | undefined>((latest, time, index) => {
    const timestamp = new Date(time).getTime();
    return timestamp <= now && (precipitation[index] ?? 0) >= 1 && (latest == null || timestamp > latest) ? timestamp : latest;
  }, undefined);
  const upcomingValues = times.flatMap((time, index) => {
    const timestamp = new Date(time).getTime();
    const value = precipitation[index];
    return timestamp > now && timestamp <= now + 48 * 3600_000 && value != null ? [value] : [];
  });
  const nearestPastIndex = times.reduce((best, time, index) => new Date(time).getTime() <= now ? index : best, -1);
  return {
    latitude, longitude,
    temperatureC: result.data.current?.temperature_2m ?? (nearestPastIndex >= 0 ? temperatures[nearestPastIndex] ?? undefined : undefined),
    precipitation24hMm: sumPeriod(24), precipitation3dMm: sumPeriod(72), precipitation7dMm: sumPeriod(168),
    hoursSinceMeaningfulRain: latestMeaningfulRain == null ? undefined : Math.max(0, (now - latestMeaningfulRain) / 3600_000),
    upcomingPrecipitationMm: upcomingValues.length ? upcomingValues.reduce((sum, value) => sum + value, 0) : undefined,
    timeline: times.flatMap((time, index) => {
      const timestamp = new Date(time).getTime();
      return timestamp <= now && timestamp > now - 7 * 86400_000 ? [{ at: time, precipitationMm: precipitation[index] ?? undefined }] : [];
    }),
    updatedAt: result.fetchedAt, stale: result.stale, source: 'open-meteo',
  };
}

const mapDailyWeather = (data: MushroomWeatherResponse, kind: DailyWeatherPoint['kind']): DailyWeatherPoint[] => {
  const daily = data.daily;
  return (daily?.time ?? []).map((date, index) => ({
    date,
    kind,
    precipitationMm: daily?.precipitation_sum?.[index] ?? undefined,
    temperatureMinC: daily?.temperature_2m_min?.[index] ?? undefined,
    temperatureMaxC: daily?.temperature_2m_max?.[index] ?? undefined,
    temperatureMeanC: daily?.temperature_2m_mean?.[index] ?? undefined,
    evapotranspirationMm: daily?.et0_fao_evapotranspiration?.[index] ?? undefined,
    weatherCode: daily?.weather_code?.[index] ?? undefined,
  }));
};

const valuesInLastDays = (days: DailyWeatherPoint[], count: number, read: (day: DailyWeatherPoint) => number | undefined) => {
  const start = dateAtOffset(-count);
  const end = dateAtOffset(0);
  return days.filter((day) => day.date >= start && day.date < end).flatMap((day) => {
    const value = read(day);
    return value == null ? [] : [value];
  });
};

const completeSum = (values: number[], requiredDays: number) => values.length === requiredDays
  ? values.reduce((sum, value) => sum + value, 0)
  : undefined;

const completeAverage = (values: number[], requiredDays: number) => values.length === requiredDays
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : undefined;

const buildHistoricalSummary = (days: DailyWeatherPoint[]): HistoricalWeatherSummary => {
  const rain3 = valuesInLastDays(days, 3, (day) => day.precipitationMm);
  const rain7 = valuesInLastDays(days, 7, (day) => day.precipitationMm);
  const rain14 = valuesInLastDays(days, 14, (day) => day.precipitationMm);
  const rain26 = valuesInLastDays(days, 26, (day) => day.precipitationMm);
  const rain30 = valuesInLastDays(days, 30, (day) => day.precipitationMm);
  const rain60 = valuesInLastDays(days, 60, (day) => day.precipitationMm);
  const temp7 = valuesInLastDays(days, 7, (day) => day.temperatureMeanC);
  const temp14 = valuesInLastDays(days, 14, (day) => day.temperatureMeanC);
  const temp20 = valuesInLastDays(days, 20, (day) => day.temperatureMeanC);
  const evapotranspiration7 = valuesInLastDays(days, 7, (day) => day.evapotranspirationMm);
  return {
    days,
    rain3dMm: completeSum(rain3, 3), rain7dMm: completeSum(rain7, 7), rain14dMm: completeSum(rain14, 14), rain26dMm: completeSum(rain26, 26), rain30dMm: completeSum(rain30, 30), rain60dMm: completeSum(rain60, 60),
    avgTemp7dC: completeAverage(temp7, 7), avgTemp14dC: completeAverage(temp14, 14), avgTemp20dC: completeAverage(temp20, 20),
    evapotranspiration7dMm: completeSum(evapotranspiration7, 7),
    coverage: {
      rain3dDays: rain3.length, rain7dDays: rain7.length, rain14dDays: rain14.length, rain26dDays: rain26.length, rain30dDays: rain30.length, rain60dDays: rain60.length,
      temp7dDays: temp7.length, temp14dDays: temp14.length, temp20dDays: temp20.length,
      evapotranspiration7dDays: evapotranspiration7.length,
    },
  };
};

const buildForecastSummary = (days: DailyWeatherPoint[]): ForecastWeatherSummary => {
  const rain3 = days.slice(0, 3).flatMap((day) => day.precipitationMm == null ? [] : [day.precipitationMm]);
  const rain7 = days.slice(0, 7).flatMap((day) => day.precipitationMm == null ? [] : [day.precipitationMm]);
  return { days, rain3dMm: completeSum(rain3, 3), rain7dMm: completeSum(rain7, 7) };
};

const currentWeatherFrom = (data: MushroomWeatherResponse): MushroomWeatherSummary['current'] => {
  const current = data.current;
  const times = data.hourly?.time ?? [];
  const target = current?.time;
  const exactIndex = target ? times.indexOf(target) : -1;
  const soilIndex = exactIndex >= 0 ? exactIndex : target
    ? times.reduce((best, time, index) => time <= target ? index : best, -1)
    : -1;
  const weatherCode = current?.weather_code ?? undefined;
  const result = {
    time: current?.time,
    temperatureC: current?.temperature_2m ?? undefined,
    weatherCode,
    weatherDescription: weatherCodeLabel(weatherCode),
    soilMoisture0To7Cm: soilIndex >= 0 ? data.hourly?.soil_moisture_0_to_7cm?.[soilIndex] ?? undefined : undefined,
    soilMoisture7To28Cm: soilIndex >= 0 ? data.hourly?.soil_moisture_7_to_28cm?.[soilIndex] ?? undefined : undefined,
  };
  return Object.values(result).some((value) => value != null) ? result : undefined;
};

export async function getMushroomWeatherSummary(db: SQLiteDatabase, latitude: number, longitude: number): Promise<MushroomWeatherSummary> {
  const today = dateAtOffset(0);
  const archiveStart = dateAtOffset(-60);
  const archiveEnd = dateAtOffset(-8);
  const coordinateKey = `${roundCoordinate(latitude)}:${roundCoordinate(longitude)}`;
  const archiveParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: archiveStart, end_date: archiveEnd,
    daily: 'temperature_2m_min,temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration,weather_code',
    timezone: 'auto',
  });
  const forecastParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), past_days: '7', forecast_days: '7',
    current: 'temperature_2m,weather_code',
    hourly: 'soil_moisture_0_to_7cm,soil_moisture_7_to_28cm',
    daily: 'temperature_2m_min,temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration,weather_code',
    timezone: 'auto',
  });

  const [archiveResult, forecastResult] = await Promise.allSettled([
    cachedFetch<MushroomWeatherResponse>(db, `mushroom-archive-v2:${coordinateKey}:${archiveStart}:${archiveEnd}`, `${ARCHIVE_URL}?${archiveParams}`),
    cachedFetch<MushroomWeatherResponse>(db, `mushroom-forecast-v1:${coordinateKey}:${today}`, `${FORECAST_URL}?${forecastParams}`),
  ]);
  const archive = archiveResult.status === 'fulfilled' ? archiveResult.value : undefined;
  const forecast = forecastResult.status === 'fulfilled' ? forecastResult.value : undefined;
  if (archiveResult.status === 'rejected') console.warn('Open-Meteo historical request failed', archiveResult.reason);
  if (forecastResult.status === 'rejected') console.warn('Open-Meteo forecast request failed', forecastResult.reason);

  const historicalByDate = new Map<string, DailyWeatherPoint>();
  for (const day of archive ? mapDailyWeather(archive.data, 'historical') : []) {
    if (day.date >= archiveStart && day.date < today) historicalByDate.set(day.date, day);
  }
  for (const day of forecast ? mapDailyWeather(forecast.data, 'historical') : []) {
    if (day.date >= archiveStart && day.date < today) historicalByDate.set(day.date, day);
  }
  const historicalDays = [...historicalByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  const forecastDays = (forecast ? mapDailyWeather(forecast.data, 'forecast') : [])
    .filter((day) => day.date >= today).slice(0, 7);
  const fetchedTimes = [archive?.fetchedAt, forecast?.fetchedAt].filter((value): value is string => Boolean(value));

  return {
    latitude, longitude,
    current: forecast ? currentWeatherFrom(forecast.data) : undefined,
    historical: historicalDays.length ? buildHistoricalSummary(historicalDays) : undefined,
    forecast: forecastDays.length ? buildForecastSummary(forecastDays) : undefined,
    errors: {
      historical: archiveResult.status === 'rejected' ? 'Starejša vremenska zgodovina trenutno ni na voljo. Prikazani so lahko le nedavni podatki.' : undefined,
      forecast: forecastResult.status === 'rejected' ? 'Trenutno vreme in napoved trenutno nista na voljo.' : undefined,
    },
    updatedAt: fetchedTimes.sort().at(-1) ?? new Date().toISOString(),
    stale: Boolean(archive?.stale || forecast?.stale),
    source: 'open-meteo',
  };
}

export async function getHistoricalWeather(db: SQLiteDatabase, latitude: number, longitude: number, observedAt: string): Promise<WeatherSnapshot> {
  const observed = new Date(observedAt);
  const ageDays = (Date.now() - observed.getTime()) / 86400_000;
  const dataset: WeatherSnapshot['dataset'] = ageDays <= 5 ? 'forecast' : 'archive';
  const baseUrl = dataset === 'forecast' ? FORECAST_URL : ARCHIVE_URL;
  const date = dateOnly(observed);
  const key = `history:${dataset}:${roundCoordinate(latitude)}:${roundCoordinate(longitude)}:${date}`;
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: date, end_date: date,
    hourly: 'temperature_2m,precipitation', timezone: 'auto',
  });
  try {
    const result = await cachedFetch<HourlyResponse>(db, key, `${baseUrl}?${params}`, false);
    const times = result.data.hourly?.time ?? [];
    const target = observed.getTime();
    const index = times.reduce((best, value, current) => {
      if (best < 0) return current;
      return Math.abs(new Date(value).getTime() - target) < Math.abs(new Date(times[best]).getTime() - target) ? current : best;
    }, -1);
    if (index < 0) return { provider: 'open-meteo', dataset, status: 'missing', retrievedAt: result.fetchedAt };
    const temperatureC = result.data.hourly?.temperature_2m?.[index] ?? undefined;
    const precipitationMm = result.data.hourly?.precipitation?.[index] ?? undefined;
    if (temperatureC == null && precipitationMm == null) return { provider: 'open-meteo', dataset, status: 'missing', retrievedAt: result.fetchedAt, weatherTime: times[index] };
    return { provider: 'open-meteo', dataset, status: 'complete', retrievedAt: result.fetchedAt, weatherTime: times[index], temperatureC, precipitationMm };
  } catch (error) {
    return { provider: 'open-meteo', dataset, status: 'error', error: error instanceof Error ? error.message : 'Vreme ni dosegljivo.' };
  }
}
