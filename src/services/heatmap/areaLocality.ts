import { haversineKm } from '../../domain/format';
import type { ExploreLocation } from '../../domain/types';

// Small, stable locality index for the Črna na Koroškem heatmap area. Coordinates
// were resolved once with the existing Open-Meteo geocoding provider. It avoids
// reverse-geocoding every heatmap cell and keeps the heatmap available without
// device-location permission.
const HEATMAP_AREA_LOCALITIES = [
  { name: 'Črna na Koroškem', afterPri: 'Črni na Koroškem', latitude: 46.47045, longitude: 14.85009, region: 'Koroška' },
  { name: 'Mežica', afterPri: 'Mežici', latitude: 46.52030, longitude: 14.85307, region: 'Koroška' },
  { name: 'Prevalje', afterPri: 'Prevaljah', latitude: 46.54703, longitude: 14.92023, region: 'Koroška' },
  { name: 'Ravne na Koroškem', afterPri: 'Ravnah na Koroškem', latitude: 46.54315, longitude: 14.97053, region: 'Koroška' },
  { name: 'Dravograd', afterPri: 'Dravogradu', latitude: 46.58846, longitude: 15.01874, region: 'Koroška' },
  { name: 'Slovenj Gradec', afterPri: 'Slovenj Gradcu', latitude: 46.51088, longitude: 15.08377, region: 'Koroška' },
  { name: 'Mislinja', afterPri: 'Mislinji', latitude: 46.44141, longitude: 15.20027, region: 'Koroška' },
  { name: 'Muta', afterPri: 'Muti', latitude: 46.61160, longitude: 15.16624, region: 'Koroška' },
  { name: 'Vuzenica', afterPri: 'Vuzenici', latitude: 46.59662, longitude: 15.16346, region: 'Koroška' },
  { name: 'Radlje ob Dravi', afterPri: 'Radljah ob Dravi', latitude: 46.61527, longitude: 15.22472, region: 'Koroška' },
  { name: 'Šoštanj', afterPri: 'Šoštanju', latitude: 46.38000, longitude: 15.04861, region: 'Savinjska' },
  { name: 'Ljubno ob Savinji', afterPri: 'Ljubnem ob Savinji', latitude: 46.34358, longitude: 14.83377, region: 'Savinjska' },
  { name: 'Solčava', afterPri: 'Solčavi', latitude: 46.41955, longitude: 14.69369, region: 'Savinjska' },
] as const;

// A map cell farther away than this from an indexed locality gets a neutral name.
// This is a display-confidence limit, not a geographic or biological threshold.
export const HEATMAP_AREA_LOCALITY_MAX_DISTANCE_KM = 12;

export interface HeatmapAreaLocalityResolution {
  areaId: string;
  location: ExploreLocation;
  cacheHit: boolean;
  distanceKm?: number;
  method: 'nearestLocality' | 'neutralFallback';
}

const areaLocalityCache = new Map<string, HeatmapAreaLocalityResolution>();

export function resolveHeatmapAreaLocality(
  areaId: string,
  latitude: number,
  longitude: number,
): HeatmapAreaLocalityResolution {
  const cached = areaLocalityCache.get(areaId);
  if (cached) return { ...cached, cacheHit: true };

  const matches = HEATMAP_AREA_LOCALITIES
    .map((locality) => ({ locality, distanceKm: haversineKm(latitude, longitude, locality.latitude, locality.longitude) }))
    .sort((left, right) => left.distanceKm - right.distanceKm);
  const nearest = matches[0];
  const result: HeatmapAreaLocalityResolution = nearest && nearest.distanceKm <= HEATMAP_AREA_LOCALITY_MAX_DISTANCE_KM
    ? {
      areaId,
      location: {
        name: `Območje pri ${nearest.locality.afterPri}`,
        latitude,
        longitude,
        admin1: nearest.locality.region,
        country: 'Slovenija',
        source: 'place',
      },
      cacheHit: false,
      distanceKm: nearest.distanceKm,
      method: 'nearestLocality',
    }
    : {
      areaId,
      location: { name: 'Izbrano območje', latitude, longitude, source: 'place' },
      cacheHit: false,
      method: 'neutralFallback',
    };
  areaLocalityCache.set(areaId, result);
  return result;
}

export function clearHeatmapAreaLocalityCacheForTest() {
  areaLocalityCache.clear();
}
