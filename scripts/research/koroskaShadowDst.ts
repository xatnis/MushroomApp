/** Authentic ARCHIVE controls, not operational forecasts or reconstructed daily responses. */
import { performance } from 'node:perf_hooks';
import { selectPilot, PROFILES, digest } from './koroskaRegionalPrototype';
import { mapDailyWeather, buildHistoricalWeatherSummaryForTarget, shiftLocalDate } from '../../src/services/weather';
import { aggregateCivilDay, indexHourlySource, HOURLY_INTERVAL_CONTRACT, type UtcHourlyWeather } from '../../src/domain/weatherIntervals';
import { civilDailyPeriod, providerDailyPeriod, sampleNativeSoil, type NativeSoilResponse } from '../../src/domain/soilSampling';
import { calculateMushroomWeatherScore } from '../../src/domain/mushroomWeather';
import { SEVEN_DAY_REQUIREMENTS } from '../../src/domain/sevenDayConditions';
import { variablePair } from './koroskaContractValidation';
import type { ProviderRecord } from './koroskaContractCapture';
import type { MushroomWeatherSummary } from '../../src/domain/types';

export const PAST_TRANSITIONS = ['2026-03-29', '2025-10-26'] as const;
export interface DstCapture { schema: 'koroska-shadow-archive-dst-v1'; evidence: 'authentic-archive-products';
  completedAt: string; coordinate: ReturnType<typeof selectPilot>['weather'][number]; records: Array<ProviderRecord & { transition: string }>;
  measurement: { httpRequests: number; wallMs: number }; attribution: string }
const dailyFields = 'temperature_2m_min,temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration,weather_code';
const soilFields = 'soil_moisture_0_to_7cm,soil_moisture_7_to_28cm';
export function dstRequestPlan() {
  const coordinate = selectPilot().weather.find(w => w.id === 'weather-2-2')!;
  return PAST_TRANSITIONS.flatMap(transition => (['daily', 'hourly'] as const).map(path => {
    const target = shiftLocalDate(transition, 1), first = shiftLocalDate(transition, -60);
    const params = new URLSearchParams({ latitude: String(coordinate.latitude), longitude: String(coordinate.longitude),
      start_date: path === 'daily' ? first : civilDailyPeriod(first).startUtc!.slice(0, 10),
      end_date: path === 'daily' ? target : civilDailyPeriod(target).endUtc!.slice(0, 10), timezone: path === 'daily' ? 'Europe/Ljubljana' : 'GMT' });
    if (path === 'daily') { params.set('daily', dailyFields); params.set('hourly', soilFields); }
    else { params.set('hourly', `temperature_2m,precipitation,et0_fao_evapotranspiration,${soilFields}`); params.set('timeformat', 'unixtime'); }
    params.set('temperature_unit', 'celsius'); params.set('precipitation_unit', 'mm');
    return { transition, path, endpoint: 'archive' as const, url: `https://archive-api.open-meteo.com/v1/archive?${params}` };
  }));
}
export async function captureDst(): Promise<DstCapture> {
  const start = performance.now(), plans = dstRequestPlan();
  // Exactly four archive requests, no retry/probe, one existing PUBLIC weather coordinate.
  const records = await Promise.all(plans.map(async plan => {
    const record: DstCapture['records'][number] = { ...plan, startedAt: new Date().toISOString() }, begin = performance.now();
    try {
      const response = await fetch(plan.url, { signal: AbortSignal.timeout(18000) });
      record.httpStatus = response.status; record.receivedAt = new Date().toISOString(); record.responseMs = performance.now() - begin;
      record.headers = Object.fromEntries(['date', 'age', 'etag', 'last-modified'].map(k => [k, response.headers.get(k)]));
      const body = performance.now(), text = await response.text(); record.bodyReadMs = performance.now() - body;
      record.bodyBytes = Buffer.byteLength(text);
      const parse = performance.now(); record.payload = JSON.parse(text); record.parseMs = performance.now() - parse;
      record.payloadDigest = digest(record.payload); record.decodedAt = new Date().toISOString(); record.fetchedAt = record.decodedAt;
      if (!response.ok) record.error = `HTTP ${response.status}`;
    } catch (error) { record.error = String(error); }
    return record;
  }));
  return { schema: 'koroska-shadow-archive-dst-v1', evidence: 'authentic-archive-products', completedAt: new Date().toISOString(),
    coordinate: selectPilot().weather.find(w => w.id === 'weather-2-2')!, records, measurement: { httpRequests: records.length, wallMs: performance.now() - start },
    attribution: 'Open-Meteo.com https://open-meteo.com/ CC BY 4.0; modified into retrospective archive controls, NOT issued forecast validation.' };
}
export function analyseDst(capture: DstCapture) {
  if (capture.schema !== 'koroska-shadow-archive-dst-v1' || capture.evidence !== 'authentic-archive-products' || capture.records.length !== 4
    || digest(capture.coordinate) !== digest(selectPilot().weather.find(w => w.id === 'weather-2-2'))) throw new Error('Invalid bounded archival capture');
  const plan = dstRequestPlan();
  for (const r of capture.records) if (!plan.some(p => p.url === r.url && p.path === r.path && p.transition === r.transition)
    || capture.records.filter(x => x.path === r.path && x.transition === r.transition).length !== 1
    || (r.payloadDigest && digest(r.payload) !== r.payloadDigest)) throw new Error('Archive evidence identity/hash mismatch');
  const controls = PAST_TRANSITIONS.map(transition => {
    const a = capture.records.find(r => r.transition === transition && r.path === 'daily')!, b = capture.records.find(r => r.transition === transition && r.path === 'hourly')!;
    if (a.error || b.error || a.httpStatus !== 200 || b.httpStatus !== 200) return { transition, status: 'unavailable' as const, errors: [a.error, b.error] };
    const raw = a.payload as any, hourly = b.payload as UtcHourlyWeather;
    const unitsValid = raw?.daily_units?.precipitation_sum === 'mm' && raw?.daily_units?.temperature_2m_mean === '°C'
      && raw?.daily_units?.et0_fao_evapotranspiration === 'mm';
    const indexed = indexHourlySource({ data: hourly, source: 'archive', fetchedAt: b.fetchedAt!, stale: false, contract: HOURLY_INTERVAL_CONTRACT });
    const target = shiftLocalDate(transition, 1), dates = Array.from({ length: 62 }, (_, i) => shiftLocalDate(transition, i - 60));
    const aggregates = dates.map(d => aggregateCivilDay(indexed, d, shiftLocalDate(target, 1)));
    const dailyDays = mapDailyWeather(raw, 'historical'), civilDays = aggregates.map(r => r.entry.day);
    // Secondary forensic decomposition only. Primary legacy values above remain actual provider daily JSON.
    const dailyDiagnostics = aggregates.map(aggregate => {
      const date = aggregate.entry.day.date, old = dailyDays.find(d => d.date === date), period = providerDailyPeriod(date, raw.utc_offset_seconds);
      const fixed = (variable: 'precipitation' | 'temperature_2m' | 'et0_fao_evapotranspiration') => {
        if (indexed.issues.length || !period.startUtc || !period.endUtc
          || hourly.hourly_units?.[variable] !== (variable === 'temperature_2m' ? '°C' : 'mm')) return null;
        const start = Date.parse(period.startUtc), end = Date.parse(period.endUtc), values: number[] = [];
        for (let t = start + (variable === 'temperature_2m' ? 0 : 3600000); t < end + (variable === 'temperature_2m' ? 0 : 3600000); t += 3600000) {
          const indices = indexed.indices.get(t); if (indices?.length !== 1) return null;
          const value = hourly.hourly?.[variable]?.[indices[0]];
          if (typeof value !== 'number' || !Number.isFinite(value) || (variable !== 'temperature_2m' && value < 0)) return null;
          values.push(value);
        }
        if (values.length !== 24) return null;
        const sum = values.reduce((a, b) => a + b, 0); return variable === 'temperature_2m' ? sum / values.length : sum;
      };
      return { date, fixedPeriod: period, civilPeriod: aggregate.period, coverage: aggregate.coverage,
        variables: Object.fromEntries((['precipitation', 'temperature_2m', 'et0_fao_evapotranspiration'] as const).map(variable => {
          const field = variable === 'precipitation' ? 'precipitationMm' : variable === 'temperature_2m' ? 'temperatureMeanC' : 'evapotranspirationMm';
          const unit = variable === 'temperature_2m' ? '°C' : 'mm', value = fixed(variable);
          return [variable, { primary: variablePair(old?.[field], aggregate.entry.day[field], unit),
            secondaryProductDifference: variablePair(old?.[field], value, unit), secondaryBoundaryEffect: variablePair(value, aggregate.entry.day[field], unit) }];
        })) };
    });
    const validSoil = (data: any) => Array.isArray(data?.hourly?.time) && ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm']
      .every(k => data.hourly_units?.[k] === 'm³/m³' && data.hourly[k]?.length === data.hourly.time.length);
    const utcNative: NativeSoilResponse | undefined = !indexed.issues.length && validSoil(hourly) ? { utc_offset_seconds: 0, hourly_units: hourly.hourly_units,
      hourly: { time: hourly.hourly?.time?.map(t => new Date(t * 1000).toISOString().slice(0, 19)),
        soil_moisture_0_to_7cm: hourly.hourly?.soil_moisture_0_to_7cm, soil_moisture_7_to_28cm: hourly.hourly?.soil_moisture_7_to_28cm } } : undefined;
    const pairs = [transition, target].map(date => {
      const legacyHistory = buildHistoricalWeatherSummaryForTarget(dailyDays, date), canonicalHistory = buildHistoricalWeatherSummaryForTarget(civilDays, date);
      // Historical control samples only: nominal provider label09 versus true IANA09; NOT fabricated Today current metadata.
      const nominal = sampleNativeSoil(validSoil(raw) ? raw : undefined, date, { kind: 'current', providerReference: `${date}T09:00` }, a.fetchedAt!),
        civil = sampleNativeSoil(utcNative, date, { kind: 'morning' }, b.fetchedAt!);
      const archiveSample = (sample: typeof nominal, samplingRule: string) => {
        const metadata = sample.metadata && (({ mode, ...rest }) => rest)(sample.metadata);
        return { point: sample.point, missing: sample.missing, metadata: metadata ? { ...metadata, samplingRule,
          sourceKind: 'historical-archive-not-issued-forecast' } : undefined };
      };
      const summary = (historical: typeof legacyHistory, soil: typeof nominal): MushroomWeatherSummary => ({ ...capture.coordinate,
        historical, current: { time: soil.point?.time, soilMoisture0To7Cm: soil.point?.soilMoisture0To7Cm,
          soilMoisture7To28Cm: soil.point?.soilMoisture7To28Cm }, source: 'open-meteo', updatedAt: capture.completedAt, stale: false, errors: {} });
      return { date, soil: { nominalProvider09: archiveSample(nominal, 'nominal-fixed-provider09'), trueCivil09: archiveSample(civil, 'exact-civil09'), purpose: 'Retrospective archive sampling control; not original historical as-of or forecast issuance.' },
        variables: Object.fromEntries(['rain7dMm', 'rain14dMm', 'rain26dMm', 'rain30dMm', 'rain60dMm', 'avgTemp14dC', 'avgTemp20dC', 'evapotranspiration7dMm']
          .map(key => [key, variablePair((legacyHistory as any)[key], (canonicalHistory as any)[key], key.includes('Temp') ? '°C' : 'mm')])),
        profiles: PROFILES.map(profile => {
          const req = SEVEN_DAY_REQUIREMENTS[profile], keys = [...new Set([...req.rain.map(n => `rain${n}dMm`), `avgTemp${req.temperature}dC`, 'rain7dMm', 'evapotranspiration7dMm'])];
          const complete = (h: typeof legacyHistory, soil: typeof nominal) => unitsValid && !soil.missing.length && keys.every(k => Number.isFinite((h as any)[k]));
          const windows = { precipitation: Math.max(...req.rain, 7), temperature_2m: req.temperature, et0_fao_evapotranspiration: 7 };
          const canonicalCovered = Object.entries(windows).every(([variable, length]) => Array.from({ length }, (_, i) => shiftLocalDate(date, -i - 1))
            .every(d => { const day = aggregates.find(r => r.entry.day.date === d); return day?.period.compatible && day.coverage[variable as keyof typeof windows].complete; }));
          const dailyCovered = Array.from({ length: Math.max(...req.rain, req.temperature, 7) }, (_, i) => shiftLocalDate(date, -i - 1))
            .every(d => dailyDays.filter(day => day.date === d).length === 1);
          const old = calculateMushroomWeatherScore(summary(legacyHistory, nominal), profile), next = calculateMushroomWeatherScore(summary(canonicalHistory, civil), profile);
          const legacyScore = complete(legacyHistory, nominal) && dailyCovered ? old.score ?? null : null,
            hourlyScore = complete(canonicalHistory, civil) && canonicalCovered ? next.score ?? null : null;
          return { profile, legacyScore, hourlyScore, delta: legacyScore != null && hourlyScore != null ? hourlyScore - legacyScore : null,
            legacyLabel: legacyScore != null ? old.label : null, hourlyLabel: hourlyScore != null ? next.label : null,
            legacyFactors: old.components, hourlyFactors: next.components, canonicalCovered,
            missing: hourlyScore == null ? ['Incomplete archive units/window/interval/native-soil coverage; numeric retrospective result gated.'] : [] };
        }) };
    });
    const at = dailyDays.find(d => d.date === transition), day = aggregates.find(r => r.entry.day.date === transition)!;
    return { transition, status: 'authentic-archive-observational' as const,
      sourceKind: 'historical reanalysis/analysis best-match, not archived issued forecasts; run/model IDs unverified',
      unitsValid, requestedCoordinates: capture.coordinate,
      grids: { daily: { latitude: raw.latitude, longitude: raw.longitude, elevation: raw.elevation }, hourly: { latitude: (hourly as any).latitude, longitude: (hourly as any).longitude, elevation: (hourly as any).elevation } },
      metadata: { dailyOffsetSeconds: raw.utc_offset_seconds, hourlyOffsetSeconds: hourly.utc_offset_seconds, dailyRetrievedAt: a.fetchedAt, hourlyRetrievedAt: b.fetchedAt,
        dailyUnits: raw.daily_units, dailySoilUnits: raw.hourly_units, hourlyUnits: hourly.hourly_units, verifiedModelRunTime: null },
      civilPeriod: day.period, fixedProviderPeriod: providerDailyPeriod(transition, raw.utc_offset_seconds), coverage: day.coverage,
      transitionDay: { rain: variablePair(at?.precipitationMm, day.entry.day.precipitationMm, 'mm'),
        temperature: variablePair(at?.temperatureMeanC, day.entry.day.temperatureMeanC, '°C'), et0: variablePair(at?.evapotranspirationMm, day.entry.day.evapotranspirationMm, 'mm') },
      pairs, dailyDiagnostics, decompositionNote: 'Secondary fixed-bin hourly control separates interval membership from residual product differences; actual provider daily values remain primary. Not proof of a common model vintage.' };
  });
  return { schema: 'koroska-shadow-dst-report-v1', evidence: 'authentic-historical-archive-controls', captureDigest: digest(capture),
    controls, operationalForecastParityEstablished: false,
    note: 'Genuine archive daily vs hourly products. Not pooled with operational 88-case snapshots. Upcoming 2026-10-25 is not a historical observation here.' };
}
