import { calculateMushroomWeatherScore } from '../mushroomWeather';
import type { MushroomScoreComponent, MushroomWeatherProfileId, MushroomWeatherSummary } from '../types';
import { buildForecastWeatherSummary, buildHistoricalWeatherSummaryForTarget, shiftLocalDate } from '../../services/weather';
import type { HeatmapDataQuality, HeatmapTargetDay, HeatmapWeatherAssessment, HeatmapWeatherCellSource } from './types';

const EXPECTED_COMPONENTS: Record<MushroomWeatherProfileId, MushroomScoreComponent['key'][]> = {
  generic: ['rain', 'temperature', 'soilMoisture', 'drying'],
  boletusEdulis: ['rain26', 'temperature', 'soilMoisture', 'drying'],
  cantharellusCibarius: ['rain30', 'rain7', 'temperature', 'soilMoisture', 'drying'],
  lactariusDeliciosus: ['rain60', 'rain14', 'soilMoisture', 'temperature', 'drying'],
};

const CORE_COMPONENTS: Record<MushroomWeatherProfileId, MushroomScoreComponent['key'][]> = {
  generic: ['rain', 'temperature'],
  boletusEdulis: ['rain26', 'temperature'],
  cantharellusCibarius: ['rain30', 'rain7', 'temperature'],
  lactariusDeliciosus: ['rain60', 'temperature'],
};

export function localDateFor(reference = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Ljubljana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference);
  const read = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function targetLocalDate(baseLocalDate: string, targetDay: HeatmapTargetDay): string {
  return targetDay === 'today' ? baseLocalDate : shiftLocalDate(baseLocalDate, 1);
}

export function buildHeatmapWeatherSummary(
  source: HeatmapWeatherCellSource,
  targetDay: HeatmapTargetDay,
): { summary: MushroomWeatherSummary; modelledHistoryDays: number } {
  const targetDate = targetLocalDate(source.baseLocalDate, targetDay);
  const historyStart = shiftLocalDate(targetDate, -60);
  const historicalDays = source.days
    .filter((day) => day.date >= historyStart && day.date < targetDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const futureDays = source.days
    .filter((day) => day.date >= targetDate && day.kind === 'forecast')
    .sort((a, b) => a.date.localeCompare(b.date));
  const soil = targetDay === 'today' ? source.currentSoil : source.tomorrowMorningSoil;
  const targetDaily = source.days.find((day) => day.date === targetDate);
  const summary: MushroomWeatherSummary = {
    latitude: source.latitude,
    longitude: source.longitude,
    current: {
      time: soil?.time,
      temperatureC: targetDaily?.temperatureMeanC,
      soilMoisture0To7Cm: soil?.soilMoisture0To7Cm,
      soilMoisture7To28Cm: soil?.soilMoisture7To28Cm,
    },
    historical: historicalDays.length
      ? buildHistoricalWeatherSummaryForTarget(historicalDays, targetDate)
      : undefined,
    forecast: futureDays.length ? buildForecastWeatherSummary(futureDays) : undefined,
    errors: source.errors,
    updatedAt: source.fetchedAt,
    stale: source.stale,
    source: 'open-meteo',
  };
  return {
    summary,
    modelledHistoryDays: historicalDays.filter((day) => day.kind === 'forecast').length,
  };
}

export function heatmapDataQuality(
  profileId: MushroomWeatherProfileId,
  componentKeys: MushroomScoreComponent['key'][],
  score?: number,
): HeatmapDataQuality {
  const available = new Set(componentKeys);
  if (score == null || CORE_COMPONENTS[profileId].some((key) => !available.has(key))) return 'insufficient';
  return EXPECTED_COMPONENTS[profileId].every((key) => available.has(key)) ? 'complete' : 'limited';
}

export function assessHeatmapWeather(
  source: HeatmapWeatherCellSource,
  profileId: MushroomWeatherProfileId,
  targetDay: HeatmapTargetDay,
): HeatmapWeatherAssessment {
  const targetDate = targetLocalDate(source.baseLocalDate, targetDay);
  const { summary, modelledHistoryDays } = buildHeatmapWeatherSummary(source, targetDay);
  const score = calculateMushroomWeatherScore(summary, profileId);
  const dataQuality = heatmapDataQuality(profileId, score.components.map((component) => component.key), score.score);
  const limitations: string[] = [];
  if (source.errors.historical) limitations.push(source.errors.historical);
  if (source.errors.forecast) limitations.push(source.errors.forecast);
  if (targetDay === 'tomorrow' && modelledHistoryDays > 0) {
    limitations.push('Jutrišnje drseče okno vključuje današnje modelirane oziroma napovedane dnevne podatke.');
  }
  if (targetDay === 'tomorrow' && !source.tomorrowMorningSoil) {
    limitations.push('Modelirana vlaga tal za jutri okoli 09:00 ni na voljo; ta komponenta je izločena.');
  }
  if (dataQuality === 'limited') limitations.push('Ocena je omejena, ker manjka vsaj ena opcijska vremenska komponenta.');
  if (dataQuality === 'insufficient') limitations.push('Manjka ključni vremenski vhod, zato normalne ocene ne prikazujemo.');
  return {
    weatherCellId: source.id,
    speciesId: profileId,
    targetDay,
    targetLocalDate: targetDate,
    summary,
    score,
    dataQuality,
    modelledHistoryDays,
    limitations,
  };
}
