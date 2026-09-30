import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../../domain/types';
import { assessHeatmapWeather, localDateFor } from '../../domain/heatmap/assessment';
import { HEATMAP_PROFILE_IDS, HEATMAP_TARGET_DAYS } from '../../domain/heatmap/pilot';
import metadata from '../../data/heatmapRegional/metadata.json';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import type { HeatmapTargetDay, HeatmapWeatherAssessment, HeatmapWeatherBatch } from '../../domain/heatmap/types';
import { getRegionalWeather } from './regionalWeather';

export interface HeatmapPilotBundle {
  policyVersion: string;
  baseLocalDate: string;
  weather: HeatmapWeatherBatch;
  assessments: Record<HeatmapTargetDay, Record<MushroomWeatherProfileId, Record<string, HeatmapWeatherAssessment>>>;
}


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
  options: { reference?: Date; pointIds: string[]; onProgress?: (bundle: HeatmapPilotBundle) => void },
): Promise<HeatmapPilotBundle> {
  const baseLocalDate = localDateFor(options.reference);
  const ids = new Set(options.pointIds);
  const points = metadata.weatherCells.filter(point => ids.has(point.id));
  return buildBundle(await getRegionalWeather(db, points, baseLocalDate,
    options.onProgress ? weather => options.onProgress?.(buildBundle(weather)) : undefined));
}

/** Keep already useful cells during a pan or retry; date rollover starts a new snapshot. */
export function mergeHeatmapBundles(previous: HeatmapPilotBundle | undefined, next: HeatmapPilotBundle): HeatmapPilotBundle {
  if (!previous || previous.baseLocalDate !== next.baseLocalDate) return next;
  return buildBundle({ ...next.weather, cells: { ...previous.weather.cells, ...next.weather.cells } });
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
