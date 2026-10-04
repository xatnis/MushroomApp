import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId } from '../../domain/types';
import { assessHeatmapWeather, localDateFor } from '../../domain/heatmap/assessment';
import { HEATMAP_PROFILE_IDS, HEATMAP_TARGET_DAYS } from '../../domain/heatmap/pilot';
import metadata from '../../data/heatmapRegional/metadata.json';
import { HEATMAP_WEATHER_POLICY_VERSION } from '../../domain/heatmap/config';
import type { HeatmapTargetDay, HeatmapWeatherAssessment, HeatmapWeatherBatch, HeatmapWeatherCellSource, HeatmapWeatherCellDefinition } from '../../domain/heatmap/types';
import { getRegionalWeather } from './regionalWeather';

export interface HeatmapPilotBundle {
  policyVersion: string;
  baseLocalDate: string;
  weather: HeatmapWeatherBatch;
  assessments: Record<HeatmapTargetDay, Record<MushroomWeatherProfileId, Record<string, HeatmapWeatherAssessment>>>;
}


// Immutable snapshots: score each point/profile/day once, not again on every progress event.
const scored = new WeakMap<HeatmapWeatherCellSource, Map<string, HeatmapWeatherAssessment>>();
const buildBundle = (weather: HeatmapWeatherBatch): HeatmapPilotBundle => {
  const assessments = {} as HeatmapPilotBundle['assessments'];
  HEATMAP_TARGET_DAYS.forEach((targetDay) => {
    assessments[targetDay] = {} as HeatmapPilotBundle['assessments'][HeatmapTargetDay];
    HEATMAP_PROFILE_IDS.forEach((profileId) => {
      assessments[targetDay][profileId] = Object.fromEntries(
        Object.values(weather.cells).map((cell) => {
          let cache = scored.get(cell);
          if (!cache) { cache = new Map(); scored.set(cell, cache); }
          const key = `${profileId}:${targetDay}`;
          if (!cache.has(key)) cache.set(key, assessHeatmapWeather(cell, profileId, targetDay));
          return [cell.id, cache.get(key)!];
        }),
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
  options: { reference?: Date; pointIds: string[]; pointDefinitions?: HeatmapWeatherCellDefinition[]; signal?: AbortSignal; prefetch?: boolean; onProgress?: (bundle: HeatmapPilotBundle) => void },
): Promise<HeatmapPilotBundle> {
  const baseLocalDate = localDateFor(options.reference);
  const byId = new Map((options.pointDefinitions ?? metadata.weatherCells).map(point => [point.id, point]));
  const points = [...new Set(options.pointIds)].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return buildBundle(await getRegionalWeather(db, points, baseLocalDate,
    options.onProgress ? weather => {
      // Skipped/failed speculative work is not a foreground error or replacement
      // for existing useful data. Completed requests still populate shared cache.
      const progress = options.prefetch ? { ...weather, cells: Object.fromEntries(Object.entries(weather.cells)
        .filter(([, c]) => !c.errors.historical && !c.errors.forecast && !c.stale && c.days.length > 0)) } : weather;
      if (!options.prefetch || Object.keys(progress.cells).length) options.onProgress?.(buildBundle(progress));
    } : undefined, options.signal, { prefetch: options.prefetch }));
}

/** Keep already useful cells during a pan or retry; date rollover starts a new snapshot. */
export function mergeHeatmapBundles(previous: HeatmapPilotBundle | undefined, next: HeatmapPilotBundle): HeatmapPilotBundle {
  if (!previous || previous.baseLocalDate !== next.baseLocalDate) return next;
  if (Object.entries(next.weather.cells).every(([id, cell]) => previous.weather.cells[id] === cell)) return previous;
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

export function scheduleSettledHeatmapLoad(callback: () => void, delayMs = 250): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
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
