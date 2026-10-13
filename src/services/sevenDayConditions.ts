import type { SQLiteDatabase } from 'expo-sqlite';
import type { HeatmapSoilPoint } from '../domain/heatmap/types';
import type { SevenDaySnapshot } from '../domain/sevenDayConditions';
import type { MushroomWeatherSummary } from '../domain/types';
import type { WeatherSeriesInput } from '../domain/weatherSeries';
import { WEATHER_TIMEZONE, validWeatherDate } from '../domain/weatherSeries';
import { getMushroomWeatherSummary, mapDailyWeather, shiftLocalDate } from './weather';

interface CacheRow { payload: string; fetchedAt: string; expiresAt: string }
interface Location { latitude: number; longitude: number }
interface RawWeather {
  timezone?: string; utc_offset_seconds?: number; current?: { time?: string }; hourly_units?: Record<string, string>; daily_units?: Record<string, string>;
  hourly?: { time?: string[]; soil_moisture_0_to_7cm?: Array<number | null>; soil_moisture_7_to_28cm?: Array<number | null> };
  daily?: { time?: string[]; precipitation_sum?: Array<number | null>; temperature_2m_mean?: Array<number | null>; et0_fao_evapotranspiration?: Array<number | null> };
}
const cache = new WeakMap<SQLiteDatabase, Map<string, SevenDaySnapshot>>();
const pending = new WeakMap<SQLiteDatabase, Map<string, Promise<SevenDaySnapshot>>>();
const raw = (row: CacheRow | null): RawWeather | undefined => {
  try { const data = row && JSON.parse(row.payload); return data && !Array.isArray(data) && typeof data === 'object' ? data : undefined; } catch { return undefined; }
};
const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Verify the complete source arrays, not just the latest timestamp (another reader could refresh one endpoint). */
export function matchesCanonicalVintage(summary: MushroomWeatherSummary, archive: RawWeather | undefined, forecast: RawWeather | undefined, today: string): boolean {
  const history = new Map();
  for (const data of [summary.errors.historical ? undefined : archive, summary.errors.forecast ? undefined : forecast]) {
    for (const day of data ? mapDailyWeather(data, 'historical') : [])
      if (day.date >= shiftLocalDate(today, -60) && day.date < today) history.set(day.date, day);
  }
  const future = !summary.errors.forecast && forecast ? mapDailyWeather(forecast, 'forecast').filter(day => day.date >= today).slice(0, 7) : [];
  const soil = summary.errors.forecast ? undefined : forecastSoilAt(forecast, today, forecast?.current?.time ?? `${today}T00:00`, false);
  return JSON.stringify([...history.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-60)) === JSON.stringify(summary.historical?.days ?? [])
    && JSON.stringify(future) === JSON.stringify(summary.forecast?.days ?? [])
    && (summary.errors.forecast ? undefined : forecast?.current?.time) === summary.current?.time
    && soil?.soilMoisture0To7Cm === summary.current?.soilMoisture0To7Cm
    && soil?.soilMoisture7To28Cm === summary.current?.soilMoisture7To28Cm;
}
const timezoneChecks = new Map<string, boolean>();
/** `timezone=auto` can return an equivalent IANA zone name. Verify the entire used hourly span, not just today's offset. */
export function compatibleWeatherTimezone(zone: string | undefined, baseDate: string): boolean {
  if (!zone) return false;
  if (zone === WEATHER_TIMEZONE) return true;
  const key = `${zone}:${baseDate}`;
  if (timezoneChecks.has(key)) return timezoneChecks.get(key)!;
  let compatible = false;
  try {
    const format = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    const provider = format(zone), local = format(WEATHER_TIMEZONE);
    const start = Date.parse(shiftLocalDate(baseDate, -60) + 'T00:00:00Z'), end = Date.parse(shiftLocalDate(baseDate, 7) + 'T00:00:00Z');
    compatible = true;
    for (let hour = start; hour <= end; hour += 3600000) if (provider.format(hour) !== local.format(hour)) { compatible = false; break; }
  } catch { compatible = false; }
  timezoneChecks.set(key, compatible);
  if (timezoneChecks.size > 32) timezoneChecks.delete(timezoneChecks.keys().next().value!);
  return compatible;
}
const freeze = <T,>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function weatherUtcOffsetAtDate(date: string): number {
  // Noon is unambiguous even on DST days; Ljubljana's 09:00 has the same offset as noon.
  const utc = Date.parse(date + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(utc);
  return (Number(parts.find(p => p.type === 'hour')!.value) - 12) * 3600 + Number(parts.find(p => p.type === 'minute')!.value) * 60;
}
/** Native named layers only. Never remap 0–1/1–3/3–9/9–27 cm, carry today's value, or synthesize soil from rain. */
export function forecastSoilAt(data: RawWeather | undefined, date: string, preferred: string, nearest = true): HeatmapSoilPoint | undefined {
  if (!data?.hourly?.time || !Array.isArray(data.hourly.time)) return undefined;
  const candidates = data.hourly.time.map((time, index) => ({ time, index })).filter(p => typeof p.time === 'string' && p.time.startsWith(date + 'T') && Number.isFinite(Date.parse(p.time)));
  const preferredMs = Date.parse(preferred);
  const selected = nearest ? candidates.reduce<typeof candidates[number] | undefined>((best, next) =>
    !best || Math.abs(Date.parse(next.time) - preferredMs) < Math.abs(Date.parse(best.time) - preferredMs) ? next : best, undefined)
    : candidates.filter(p => p.time <= preferred).at(-1);
  if (!selected || !Number.isFinite(Date.parse(selected.time))) return undefined;
  const layer = (key: 'soil_moisture_0_to_7cm' | 'soil_moisture_7_to_28cm') => {
    const n = data.hourly?.[key]?.[selected.index];
    return (!data.hourly_units?.[key] || data.hourly_units[key] === 'm³/m³') && validNumber(n) && n >= 0 && n <= 1 ? n : undefined;
  };
  return { time: selected.time, soilMoisture0To7Cm: layer('soil_moisture_0_to_7cm'), soilMoisture7To28Cm: layer('soil_moisture_7_to_28cm') };
}

export function loadSevenDaySnapshot(db: SQLiteDatabase, location: Location, today: string, options: { requestTimeoutMs?: number; seedUpdatedAt?: string } = {}): Promise<SevenDaySnapshot> {
  if (!validWeatherDate(today) || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
    || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return Promise.reject(new Error('Neveljavna lokacija ali datum.'));
  const key = `${location.latitude}:${location.longitude}:${today}:native-soil-09-v1`;
  let entries = cache.get(db); if (!entries) { entries = new Map(); cache.set(db, entries); }
  const existing = entries.get(key);
  if (existing && existing.expiresAt > Date.now() && !existing.stale
    && (!options.seedUpdatedAt || options.seedUpdatedAt === existing.today.updatedAt)) return Promise.resolve(existing);
  let requests = pending.get(db); if (!requests) { requests = new Map(); pending.set(db, requests); }
  const active = requests.get(key); if (active) return active;
  const task = (async () => {
    // Exact existing point pipeline: D60 hybrid history, 7-day daily forecast, native soil, TTL, timeout, dedupe.
    const canonicalToday = await getMushroomWeatherSummary(db, location.latitude, location.longitude, { baseLocalDate: today, requestTimeoutMs: options.requestTimeoutMs });
    const coordinate = `${location.latitude.toFixed(2)}:${location.longitude.toFixed(2)}`;
    const [archiveRow, forecastRow] = await Promise.all([
      db.getFirstAsync<CacheRow>('SELECT payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey=?', `mushroom-archive-v2:${coordinate}:${shiftLocalDate(today, -60)}:${shiftLocalDate(today, -8)}`),
      db.getFirstAsync<CacheRow>('SELECT payload,fetchedAt,expiresAt FROM weather_cache WHERE cacheKey=?', `mushroom-forecast-v1:${coordinate}:${today}`),
    ]);
    const archive = raw(archiveRow), forecast = raw(forecastRow);
    const blockers: string[] = [];
    if (forecastRow && !Number.isFinite(Date.parse(forecastRow.fetchedAt))) blockers.push('Čas pridobitve napovedi ni veljaven.');
    if (!forecast) blockers.push('Napovedni snapshot ni na voljo.');
    if (!compatibleWeatherTimezone(forecast?.timezone, today)) blockers.push('Časovno območje napovedi ni potrjeno kot združljivo z Europe/Ljubljana.');
    if (archive && !compatibleWeatherTimezone(archive.timezone, today)) blockers.push('Časovno območje zgodovine ni potrjeno kot združljivo z Europe/Ljubljana.');
    const rowTimes = [archiveRow?.fetchedAt, forecastRow?.fetchedAt].filter((v): v is string => !!v).sort();
    if (rowTimes.at(-1) !== canonicalToday.updatedAt) blockers.push('Snapshot se je med branjem spremenil; osveži prikaz.');
    if (!matchesCanonicalVintage(canonicalToday, archive, forecast, today)) blockers.push('Vremenski podatki ne pripadajo istemu snapshotu kot današnja ocena; osveži prikaz.');
    const daily: WeatherSeriesInput[] = [];
    for (const [data, row, endpoint] of [[archive, archiveRow, 'archive'], [forecast, forecastRow, 'forecast']] as const) {
      if (!data || !Array.isArray(data.daily?.time)) continue;
      const badRainUnits = data.daily_units?.precipitation_sum && data.daily_units.precipitation_sum !== 'mm';
      const badTempUnits = data.daily_units?.temperature_2m_mean && data.daily_units.temperature_2m_mean !== '°C';
      const badEt0Units = data.daily_units?.et0_fao_evapotranspiration && data.daily_units.et0_fao_evapotranspiration !== 'mm';
      for (const point of mapDailyWeather(data, endpoint === 'archive' ? 'historical' : 'forecast')) {
        if (!validWeatherDate(point.date) || point.date < shiftLocalDate(today, -60) || point.date > shiftLocalDate(today, 6)) continue;
        daily.push({ day: { ...point, kind: point.date < today ? 'historical' : 'forecast',
          precipitationMm: badRainUnits ? undefined : point.precipitationMm,
          temperatureMeanC: badTempUnits ? undefined : point.temperatureMeanC,
          evapotranspirationMm: badEt0Units ? undefined : point.evapotranspirationMm },
          source: endpoint === 'archive' ? 'archive' : point.date < today ? 'recentForecastHistory' : 'forecast',
          fetchedAt: row?.fetchedAt ?? null, stale: !row || Date.parse(row.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(row.expiresAt)) });
      }
    }
    const soilByDate: SevenDaySnapshot['soilByDate'] = {};
    const dateBlockers: NonNullable<SevenDaySnapshot['dateBlockers']> = {};
    // Today uses the canonical current/floor-hour observation; each future date uses its OWN modelled 09:00 point.
    const actualCurrentSoil = forecastSoilAt(forecast, today, forecast?.current?.time ?? `${today}T00:00`, false);
    if (canonicalToday.current?.time && actualCurrentSoil?.time) soilByDate[today] = { time: actualCurrentSoil.time,
      soilMoisture0To7Cm: !forecast?.hourly_units?.soil_moisture_0_to_7cm || forecast.hourly_units.soil_moisture_0_to_7cm === 'm³/m³' ? canonicalToday.current.soilMoisture0To7Cm : undefined,
      soilMoisture7To28Cm: !forecast?.hourly_units?.soil_moisture_7_to_28cm || forecast.hourly_units.soil_moisture_7_to_28cm === 'm³/m³' ? canonicalToday.current.soilMoisture7To28Cm : undefined };
    for (let index = 1; index < 7; index++) {
      const date = shiftLocalDate(today, index);
      if (forecast?.utc_offset_seconds !== weatherUtcOffsetAtDate(date)) {
        dateBlockers[date] = ['Jutranji čas talne vlage ni potrjen v lokalnem času (UTC/DST odmik); primerljive številčne ocene ne prikazujemo.'];
        continue;
      }
      const soil = forecastSoilAt(forecast, date, `${date}T09:00`);
      if (soil?.time === `${date}T09:00`) soilByDate[date] = soil;
      else dateBlockers[date] = ['Manjka napovedni vzorec talne vlage ob 09:00 za ta datum.'];
    }
    // A source failure must not be covered by an unrelated old cache payload.
    if (canonicalToday.errors.historical) for (let i = daily.length - 1; i >= 0; i--) if (daily[i].source === 'archive') daily.splice(i, 1);
    if (canonicalToday.errors.forecast) {
      for (let i = daily.length - 1; i >= 0; i--) if (daily[i].source !== 'archive') daily.splice(i, 1);
      for (const date of Object.keys(soilByDate)) delete soilByDate[date];
      blockers.push('Nedavna zgodovina in napoved trenutno nista na voljo.');
    }
    const snapshot: SevenDaySnapshot = freeze(JSON.parse(JSON.stringify({ baseLocalDate: today, latitude: location.latitude, longitude: location.longitude, timezone: WEATHER_TIMEZONE,
      today: canonicalToday, daily, soilByDate,
      legacyCurrentSoil: forecastSoilAt(forecast, today, forecast?.current?.time ?? `${today}T00:00`),
      forecastRetrievedAt: forecastRow && Number.isFinite(Date.parse(forecastRow.fetchedAt)) ? forecastRow.fetchedAt : null,
      archiveRetrievedAt: archiveRow && Number.isFinite(Date.parse(archiveRow.fetchedAt)) ? archiveRow.fetchedAt : null, forecastIssuedAt: null,
      snapshotId: `${key}:${forecastRow?.fetchedAt ?? 'missing'}:${archiveRow?.fetchedAt ?? 'missing'}`,
      expiresAt: Math.min(...[archiveRow, forecastRow].map(r => r && Number.isFinite(Date.parse(r.expiresAt)) ? Date.parse(r.expiresAt) : 0)),
      stale: canonicalToday.stale || daily.some(e => e.stale), blockers, dateBlockers, assembledAt: new Date().toISOString() })));
    entries!.set(key, snapshot);
    if (entries!.size > 8) entries!.delete(entries!.keys().next().value!);
    return snapshot;
  })().finally(() => requests!.delete(key));
  requests.set(key, task); return task;
}
