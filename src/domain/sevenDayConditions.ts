import type { DailyWeatherPoint, MushroomConditionsScore, MushroomWeatherProfileId, MushroomWeatherSummary } from './types';
import type { HeatmapSoilPoint, HeatmapWeatherCellSource } from './heatmap/types';
import { assessHeatmapWeather, buildHeatmapWeatherSummary } from './heatmap/assessment';
import { calculateMushroomWeatherScore, MUSHROOM_SCORE_V1_CONFIG, BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG } from './mushroomWeather';
import { buildHistoricalWeatherSummaryForTarget, shiftLocalDate } from '../services/weather';
import { validWeatherDate, WEATHER_TIMEZONE, type WeatherSeriesInput } from './weatherSeries';
import type { DailyPeriod, SoilSampleMetadata } from './soilSampling';
import { HOURLY_INTERVAL_CONTRACT, type IntervalCoverage, type HourlyVariable } from './weatherIntervals';
import { civilDailyPeriod, resolveLjubljanaClock, ljubljanaClock } from './soilSampling';

export const CANONICAL_POINT_POLICY = 'point-civil-hourly-asof-local09-v1';

const configs = { generic: MUSHROOM_SCORE_V1_CONFIG, boletusEdulis: BOLETUS_EDULIS_SCORE_V1_CONFIG,
  cantharellusCibarius: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, lactariusDeliciosus: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG };
export const SEVEN_DAY_REQUIREMENTS = {
  generic: { rain: [7, 14, 30], temperature: 20 }, boletusEdulis: { rain: [26], temperature: 20 },
  cantharellusCibarius: { rain: [7, 30], temperature: 14 }, lactariusDeliciosus: { rain: [14, 60], temperature: 20 },
} as const;
export interface SevenDaySnapshot {
  baseLocalDate: string; latitude: number; longitude: number; timezone: string;
  today: MushroomWeatherSummary; daily: WeatherSeriesInput[]; soilByDate: Record<string, HeatmapSoilPoint>;
  legacyCurrentSoil?: HeatmapSoilPoint; forecastRetrievedAt: string | null; archiveRetrievedAt: string | null;
  forecastIssuedAt: null; snapshotId: string; expiresAt: number; stale: boolean; blockers: string[];
  assembledAt: string;
  dateBlockers?: Record<string, string[]>;
  legacyTomorrowSoil?: HeatmapSoilPoint;
  canonicalCurrentSoil?: HeatmapSoilPoint;
  soilSampling?: Record<string, SoilSampleMetadata>;
  dailyPeriods: Record<string, DailyPeriod>;
  inputContract?: typeof HOURLY_INTERVAL_CONTRACT;
  legacyDaily?: WeatherSeriesInput[];
  legacyToday?: MushroomWeatherSummary;
  intervalCoverage?: Record<string, Record<HourlyVariable, IntervalCoverage>>;
  pointPolicyVersion?: typeof CANONICAL_POINT_POLICY;
}
export interface SevenDayResult {
  targetLocalDate: string; horizonDay: number; profileId: MushroomWeatherProfileId;
  score: number | null; label: string | null; status: 'ready' | 'stale' | 'insufficient_data' | 'error';
  canonical: MushroomConditionsScore; inputs: MushroomWeatherSummary; missing: string[]; warnings: string[];
  componentsVerified: boolean;
  snapshotId: string; forecastRetrievedAt: string | null; forecastIssuedAt: null;
  assembledAt: string;
  latitude: number; longitude: number; modelledHistoryDays: number;
  soilTime?: string; targetSoil?: HeatmapSoilPoint; targetWeather?: DailyWeatherPoint;
  soilSampling?: SoilSampleMetadata;
  provenance: Array<{ date: string; source: WeatherSeriesInput['source']; retrievedAt: string | null }>;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validSoil = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
const cleanSoil = (soil: HeatmapSoilPoint | undefined, target: string): HeatmapSoilPoint | undefined => soil?.time?.startsWith(target + 'T') ? {
  time: soil.time,
  soilMoisture0To7Cm: validSoil(soil.soilMoisture0To7Cm) ? soil.soilMoisture0To7Cm : undefined,
  soilMoisture7To28Cm: validSoil(soil.soilMoisture7To28Cm) ? soil.soilMoisture7To28Cm : undefined,
} : undefined;
const cleanDay = (day: DailyWeatherPoint): DailyWeatherPoint => ({ ...day,
  precipitationMm: finite(day.precipitationMm) && day.precipitationMm >= 0 ? day.precipitationMm : undefined,
  temperatureMeanC: finite(day.temperatureMeanC) ? day.temperatureMeanC : undefined,
  temperatureMinC: finite(day.temperatureMinC) ? day.temperatureMinC : undefined,
  temperatureMaxC: finite(day.temperatureMaxC) ? day.temperatureMaxC : undefined,
  evapotranspirationMm: finite(day.evapotranspirationMm) && day.evapotranspirationMm >= 0 ? day.evapotranspirationMm : undefined,
});

/** Production lookback convention is [target - N, target), never the incomplete target day. */
export function buildWeatherInputsForTargetDate(snapshot: SevenDaySnapshot, target: string, profile: MushroomWeatherProfileId) {
  if (!validWeatherDate(target) || target < snapshot.baseLocalDate || target > shiftLocalDate(snapshot.baseLocalDate, 6)) throw new Error('Datum je zunaj sedemdnevnega horizonta.');
  const byDate = new Map<string, WeatherSeriesInput>();
  for (const entry of snapshot.daily) {
    if (!validWeatherDate(entry.day.date) || entry.day.date < shiftLocalDate(target, -60) || entry.day.date >= target) continue;
    if ((entry.day.date < snapshot.baseLocalDate && entry.source === 'forecast')
      || (entry.day.date >= snapshot.baseLocalDate && entry.source !== 'forecast')) continue;
    byDate.set(entry.day.date, { ...entry, day: cleanDay(entry.day) });
  }
  const history = [...byDate.values()].sort((a, b) => a.day.date.localeCompare(b.day.date));
  const historical = buildHistoricalWeatherSummaryForTarget(history.map(e => e.day), target);
  const soil = snapshot.soilByDate[target];
  const missing = [...snapshot.blockers, ...(snapshot.dateBlockers?.[target] ?? [])];
  if (!soil?.time?.startsWith(target + 'T')) missing.push('Čas talne vlage ne pripada ciljnemu dnevu.');
  const required = SEVEN_DAY_REQUIREMENTS[profile];
  const requiredStart = shiftLocalDate(target, -Math.max(...required.rain, required.temperature, 7));
  if (snapshot.pointPolicyVersion) {
    if (snapshot.pointPolicyVersion !== CANONICAL_POINT_POLICY || snapshot.inputContract !== HOURLY_INTERVAL_CONTRACT)
      missing.push('Nezdružljiva kanonična point pogodba.');
    for (const entry of history.filter(e => e.day.date >= requiredStart)) {
      const date = entry.day.date, period = civilDailyPeriod(date), actual = snapshot.dailyPeriods[date], coverage = snapshot.intervalCoverage?.[date];
      if (actual?.basis !== 'local-calendar' || actual.startUtc !== period.startUtc || actual.endUtc !== period.endUtc)
        missing.push('Dnevna UTC/DST meja ne ustreza kanonični point pogodbi.');
      const daysBefore = Math.round((Date.parse(target + 'T12:00Z') - Date.parse(date + 'T12:00Z')) / 86400000);
      const expectedHours = (Date.parse(period.endUtc ?? '') - Date.parse(period.startUtc ?? '')) / 3600000;
      const verified = (metric: HourlyVariable) => coverage?.[metric]?.complete && coverage[metric].expected === expectedHours
        && coverage[metric].available === expectedHours && Array.isArray(coverage[metric].issues) && !coverage[metric].issues.length
        && coverage[metric].semantics === (metric === 'temperature_2m' ? 'hourly-instant-mean' : 'preceding-hour-sum');
      if (!verified('precipitation') || (daysBefore <= required.temperature && !verified('temperature_2m'))
        || (daysBefore <= 7 && !verified('et0_fao_evapotranspiration'))) missing.push('Manjka potrjena urna pokritost point vhodov.');
      const expectedSource = date >= snapshot.baseLocalDate ? 'forecast' : date >= shiftLocalDate(snapshot.baseLocalDate, -7) ? 'recentForecastHistory' : 'archive';
      if (entry.source !== expectedSource || entry.fetchedAt !== (expectedSource === 'archive' ? snapshot.archiveRetrievedAt : snapshot.forecastRetrievedAt))
        missing.push('Point vhodi ne pripadajo zamrznjenemu source snapshotu.');
    }
    const sample = snapshot.soilSampling?.[target];
    const instant = Date.parse(sample?.instantUtc ?? ''), reference = Date.parse(sample?.requestedInstantUtc ?? '');
    const expectedMorning = resolveLjubljanaClock(target + 'T09:00')[0];
    if (!sample || sample.localTime !== soil?.time || sample.contract !== 'point-asof-or-local09-v1'
      || sample.units !== 'm³/m³' || sample.source !== 'open-meteo-forecast-hourly' || sample.retrievedAt !== snapshot.forecastRetrievedAt
      || sample.depthsCm?.join(',') !== '0–7,7–28' || sample.timezone !== WEATHER_TIMEZONE
      || !finite(instant) || !finite(reference) || sample.providerEpochSeconds !== instant / 1000 || sample.localTime !== ljubljanaClock(instant).slice(0, 16)
      || (target === snapshot.baseLocalDate ? sample.mode !== 'currentModelled' || instant > reference || reference - instant >= 3600000 || reference > Date.parse(snapshot.forecastRetrievedAt ?? '')
        : sample.mode !== 'forecast' || instant !== expectedMorning || reference !== expectedMorning))
      missing.push('Point instant ali provenienca talne vlage nista potrjena.');
  }
  if (history.some(entry => entry.day.date >= requiredStart && !snapshot.dailyPeriods[entry.day.date]?.compatible))
    missing.push('Dnevna UTC/DST okna ponudnika niso potrjena kot popolni lokalni koledarski dnevi; primerljive ocene ne prikazujemo.');
  for (const days of required.rain) if (historical[`rain${days}dMm`] == null) missing.push(`Manjkajo popolne ${days}-dnevne padavine.`);
  if (historical[`avgTemp${required.temperature}dC`] == null) missing.push(`Manjka popolna ${required.temperature}-dnevna povprečna temperatura.`);
  if (historical.rain7dMm == null || historical.evapotranspiration7dMm == null) missing.push('Manjkajo 7-dnevni podatki za bilanco izsuševanja (padavine in ET₀).');
  for (const [label, n] of [['0–7 cm', soil?.soilMoisture0To7Cm], ['7–28 cm', soil?.soilMoisture7To28Cm]] as const)
    if (!finite(n) || n < 0 || n > 1) missing.push(`Manjkajo ${target === snapshot.baseLocalDate ? 'modelirani' : 'napovedni'} podatki o vlagi tal ${label}.`);
  const summary: MushroomWeatherSummary = target === snapshot.baseLocalDate ? snapshot.today : {
    latitude: snapshot.latitude, longitude: snapshot.longitude, historical,
    current: { time: soil?.time, temperatureC: snapshot.daily.find(e => e.day.date === target && e.source === 'forecast')?.day.temperatureMeanC,
      soilMoisture0To7Cm: soil?.soilMoisture0To7Cm, soilMoisture7To28Cm: soil?.soilMoisture7To28Cm },
    // The old Tomorrow path has only its target day in forecast context. Do not add later rain to any score/trend.
    forecast: undefined, errors: snapshot.today.errors, stale: snapshot.stale, updatedAt: snapshot.forecastRetrievedAt ?? snapshot.today.updatedAt, source: 'open-meteo',
  };
  if (snapshot.pointPolicyVersion && target === snapshot.baseLocalDate) {
    const keys = [...required.rain.map(days => `rain${days}dMm`), `avgTemp${required.temperature}dC`, 'rain7dMm', 'evapotranspiration7dMm'] as Array<keyof typeof historical>;
    if (summary.latitude !== snapshot.latitude || summary.longitude !== snapshot.longitude || summary.evaluationLocalDate !== target
      || summary.inputPolicyVersion !== CANONICAL_POINT_POLICY || keys.some(key => summary.historical?.[key] !== historical[key])
      || summary.current?.time !== soil?.time || summary.current?.soilMoisture0To7Cm !== soil?.soilMoisture0To7Cm || summary.current?.soilMoisture7To28Cm !== soil?.soilMoisture7To28Cm)
      missing.push('Point Today summary ne pripada poravnanim vhodom, koordinati ali datumu.');
  }
  return { summary, historical, history, missing };
}

/** Seven independent calls to the unchanged production scorer; incomplete numerical totals are never published. */
export function evaluateSevenDayConditions(snapshot: SevenDaySnapshot, profile: MushroomWeatherProfileId, onInputsBuilt?: () => void): SevenDayResult[] {
  return Array.from({ length: 7 }, (_, horizonDay) => {
    const required = SEVEN_DAY_REQUIREMENTS[profile];
    const target = shiftLocalDate(snapshot.baseLocalDate, horizonDay);
    const built = buildWeatherInputsForTargetDate(snapshot, target, profile);
    onInputsBuilt?.(); // Optional development timing boundary; no input/result mutation.
    const canonical = calculateMushroomWeatherScore(built.summary, profile);
    const missing = [...built.missing];
    const expected = Object.keys(configs[profile].componentWeights);
    for (const key of expected) if (!canonical.components.some(c => c.key === key && finite(c.weightedPoints) && finite(c.weight) && c.weight > 0))
      missing.push(`Prispevek za ${key.startsWith('rain') ? 'padavine' : key === 'temperature' ? 'temperaturo' : key === 'soilMoisture' ? 'vlago tal' : 'izsuševanje'} ni na voljo.`);
    if (!finite(canonical.score)) missing.push('Model nima veljavne ocene.');
    // Do not silently turn a snapshot/date alignment or legacy sampling difference into a second Today/Tomorrow score.
    if (horizonDay <= 1 && !snapshot.pointPolicyVersion) {
      const source: HeatmapWeatherCellSource = { id: snapshot.snapshotId, latitude: snapshot.latitude, longitude: snapshot.longitude,
        baseLocalDate: snapshot.baseLocalDate, days: (snapshot.legacyDaily ?? snapshot.daily).map(e => e.day).filter(day => day.date <= shiftLocalDate(snapshot.baseLocalDate, 1)),
        currentSoil: snapshot.legacyCurrentSoil, tomorrowMorningSoil: snapshot.legacyTomorrowSoil,
        fetchedAt: snapshot.today.updatedAt, stale: snapshot.stale, errors: snapshot.today.errors };
      const legacy = assessHeatmapWeather(source, profile, horizonDay === 0 ? 'today' : 'tomorrow');
      const pointReference = snapshot.legacyToday ?? snapshot.today;
      const legacyInputs = buildHeatmapWeatherSummary(source, horizonDay === 0 ? 'today' : 'tomorrow').summary;
      // Raw unrounded weather input parity, not merely equal final scores or saturated factor points.
      const inputKeys = [...required.rain.map(days => `rain${days}dMm`), `avgTemp${required.temperature}dC`, 'rain7dMm', 'evapotranspiration7dMm'] as Array<keyof NonNullable<MushroomWeatherSummary['historical']>>;
      if (inputKeys.some(key => built.historical[key] !== legacyInputs.historical?.[key]
        || (!horizonDay && built.historical[key] !== pointReference.historical?.[key])))
        missing.push('Today/Tomorrow ne uporablja istih surovih padavinskih, temperaturnih ali ET₀ oken; primerljiva številčna ocena je ustavljena.');
      if (!horizonDay) {
        const pointScore = calculateMushroomWeatherScore(pointReference, profile);
        if (canonical.score !== pointScore.score || JSON.stringify(canonical.components) !== JSON.stringify(pointScore.components)
          || JSON.stringify(canonical.reasons) !== JSON.stringify(pointScore.reasons))
          missing.push('Today/Tomorrow point rezultat ali razlaga se ne ujema s kanonično referenco; številčni prikaz je ustavljen.');
      }
      const legacySoil = horizonDay === 0 ? snapshot.legacyCurrentSoil : snapshot.legacyTomorrowSoil;
      const alignedSoil = snapshot.soilByDate[target];
      const pointSoil = snapshot.canonicalCurrentSoil;
      if (!horizonDay && (pointSoil?.time !== alignedSoil?.time || pointSoil?.soilMoisture0To7Cm !== alignedSoil?.soilMoisture0To7Cm || pointSoil?.soilMoisture7To28Cm !== alignedSoil?.soilMoisture7To28Cm
        || built.summary.current?.soilMoisture0To7Cm !== alignedSoil?.soilMoisture0To7Cm || built.summary.current?.soilMoisture7To28Cm !== alignedSoil?.soilMoisture7To28Cm))
        missing.push('Today/Tomorrow point referenca in poravnani soil vzorec se ne ujemata; številčne ocene ne prikazujemo.');
      if (legacySoil?.time !== alignedSoil?.time || legacySoil?.soilMoisture0To7Cm !== alignedSoil?.soilMoisture0To7Cm || legacySoil?.soilMoisture7To28Cm !== alignedSoil?.soilMoisture7To28Cm)
        missing.push('Today/Tomorrow uporablja drug instant ali vrednosti talne vlage; številčni prikaz čaka na uskladitev produkcijske politike.');
      if (canonical.score !== legacy.score.score || JSON.stringify(canonical.components) !== JSON.stringify(legacy.score.components))
        missing.push('Date-aligned vhodi niso enaki obstoječi Today/Tomorrow oceni; številčni prikaz je ustavljen.');
    }
    // Day 0 must also actually be aligned, not merely reuse an old canonical total.
    if (!horizonDay) {
      for (const days of required.rain) if (built.summary.historical?.[`rain${days}dMm`] !== built.historical[`rain${days}dMm`]) missing.push('Današnji padavinski snapshot ni poravnan z lokalnim datumom.');
      if (built.summary.historical?.[`avgTemp${required.temperature}dC`] !== built.historical[`avgTemp${required.temperature}dC`]) missing.push('Današnji temperaturni snapshot ni poravnan z lokalnim datumom.');
    }
    const available = missing.length === 0;
    const componentsVerified = !snapshot.blockers.length && !missing.some(reason => reason.includes('Today/Tomorrow') || reason.includes('snapshot ni poravnan') || reason.includes('Dnevna UTC/DST')
      || reason.includes('point') || reason.includes('Point') || reason.includes('urna pokritost'));
    return { targetLocalDate: target, horizonDay, profileId: profile, score: available ? canonical.score! : null,
      label: available ? canonical.label : null, status: available ? snapshot.stale ? 'stale' : 'ready'
        : snapshot.today.errors.forecast || snapshot.today.errors.historical ? 'error' : 'insufficient_data',
      canonical, componentsVerified, inputs: built.summary, missing: [...new Set(missing)], snapshotId: snapshot.snapshotId,
      forecastRetrievedAt: snapshot.forecastRetrievedAt, forecastIssuedAt: null, latitude: snapshot.latitude, longitude: snapshot.longitude,
      assembledAt: snapshot.assembledAt,
      soilTime: snapshot.soilByDate[target]?.time,
      soilSampling: snapshot.soilSampling?.[target],
      targetSoil: cleanSoil(snapshot.soilByDate[target], target),
      targetWeather: snapshot.daily.find(e => e.day.date === target && e.source === 'forecast')?.day
        ? cleanDay(snapshot.daily.find(e => e.day.date === target && e.source === 'forecast')!.day) : undefined,
      modelledHistoryDays: built.history.filter(e => e.source === 'forecast').length,
      provenance: built.history.map(e => ({ date: e.day.date, source: e.source, retrievedAt: e.fetchedAt })),
      warnings: ['Okna se končajo pred ciljnim dnevom; prihodnja okna vključujejo napovedane, ne opazovane dnevne podatke.',
        'Ocena ni verjetnost najdbe. Zanesljivost je lahko manjša za bolj oddaljene dni.',
        ...(snapshot.inputContract ? ['Dnevni podatki so agregirani iz urnih modelskih podatkov po lokalnem koledarju; temperatura je povprečje urnih vzorcev, ET₀ pa referenčna evapotranspiracija.'] : []),
        ...(snapshot.stale ? ['Uporabljeni so starejši predpomnjeni podatki.'] : [])] };
  });
}

export { WEATHER_TIMEZONE };
