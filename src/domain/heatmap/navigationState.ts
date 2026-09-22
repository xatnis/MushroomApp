import type { MushroomWeatherProfileId } from '../types';
import type { HeatmapTargetDay } from './types';

export interface HeatmapViewport {
  center: [number, number];
  zoom: number;
}

/**
 * Navigation-persistent UI state only. It intentionally contains no weather
 * data: the existing weather cache continues to own that concern.
 */
export interface HeatmapNavigationState {
  enabled: boolean;
  profileId: MushroomWeatherProfileId;
  targetDay: HeatmapTargetDay;
  selectedAreaId?: string;
  viewport?: HeatmapViewport;
}

export const DEFAULT_HEATMAP_NAVIGATION_STATE: HeatmapNavigationState = {
  enabled: false,
  profileId: 'boletusEdulis',
  targetDay: 'today',
};

export function patchHeatmapNavigationState(
  current: HeatmapNavigationState,
  patch: Partial<HeatmapNavigationState>,
): HeatmapNavigationState {
  const next = { ...current, ...patch };
  return next.enabled ? next : { ...next, selectedAreaId: undefined };
}
