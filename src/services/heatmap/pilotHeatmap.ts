import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../../domain/types';
import { assessHeatmapWeather, localDateFor } from '../../domain/heatmap/assessment';
import { HEATMAP_PILOT_METADATA, HEATMAP_PROFILE_IDS, HEATMAP_TARGET_DAYS } from '../../domain/heatmap/pilot';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import type { HeatmapTargetDay, HeatmapWeatherAssessment, HeatmapWeatherBatch } from '../../domain/heatmap/types';
import { getHeatmapWeatherBatch } from '../weather';

const MEMORY_TTL_MS = 30 * 60 * 1000;

export interface HeatmapPilotBundle {
  policyVersion: string;
  baseLocalDate: string;
  weather: HeatmapWeatherBatch;
  assessments: Record<HeatmapTargetDay, Record<MushroomWeatherProfileId, Record<string, HeatmapWeatherAssessment>>>;
}

let memoryCache: { key: string; expiresAt: number; value: HeatmapPilotBundle } | undefined;
let inFlight: { key: string; promise: Promise<HeatmapPilotBundle> } | undefined;

const buildBundle = (weather: HeatmapWeatherBatch): HeatmapPilotBundle => {
  const assessments = {} as HeatmapPilotBundle['assessments'];
  HEATMAP_TARGET_DAYS.forEach((targetDay) => {
    assessments[targetDay] = {} as HeatmapPilotBundle['assessments'][HeatmapTargetDay];
    HEATMAP_PROFILE_IDS.forEach((profileId) => {
      assessments[targetDay][profileId] = Object.fromEntries(
        Object.values(weather.cells).map((cell) => [cell.id, assessHeatmapWeather(cell, profileId, targetDay)]),
      );
    });
  });
  return {
    policyVersion: HEATMAP_WEATHER_POLICY_VERSION,
    baseLocalDate: weather.baseLocalDate,
    weather,
    assessments,
  };
};

export async function loadHeatmapPilot(
  db: SQLiteDatabase,
  options: { force?: boolean; reference?: Date } = {},
): Promise<HeatmapPilotBundle> {
  const baseLocalDate = localDateFor(options.reference);
  const key = `${HEATMAP_WEATHER_POLICY_VERSION}:${baseLocalDate}`;
  if (!options.force && memoryCache?.key === key && memoryCache.expiresAt > Date.now()) return memoryCache.value;
  if (!options.force && inFlight?.key === key) return inFlight.promise;
  const promise = getHeatmapWeatherBatch(db, HEATMAP_PILOT_METADATA.weatherCells, baseLocalDate)
    .then(buildBundle)
    .then((value) => {
      memoryCache = { key, expiresAt: Date.now() + MEMORY_TTL_MS, value };
      return value;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = undefined;
    });
  inFlight = { key, promise };
  return promise;
}

export function weatherAssessmentsFor(
  bundle: HeatmapPilotBundle,
  profileId: MushroomWeatherProfileId,
  targetDay: HeatmapTargetDay,
): Record<string, HeatmapWeatherAssessment> {
  return bundle.assessments[targetDay][profileId];
}

export interface HeatmapRequestGate {
  next: () => number;
  isCurrent: (requestId: number) => boolean;
  invalidate: () => void;
}

export function createHeatmapRequestGate(): HeatmapRequestGate {
  let current = 0;
  return {
    next: () => {
      current += 1;
      return current;
    },
    isCurrent: (requestId) => requestId === current,
    invalidate: () => { current += 1; },
  };
}
