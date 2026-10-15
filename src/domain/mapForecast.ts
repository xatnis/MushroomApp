import type { MushroomWeatherProfileId } from './types';
import type { SevenDayLocation } from '../components/SevenDayConditionsView';

export interface MapForecastRequest {
  environment: string;
  phase: 'picking' | 'preview' | 'full';
  location?: SevenDayLocation;
  hotspotId?: string;
  profileId: MushroomWeatherProfileId;
  initialDay: number;
}
const valid = (p: { latitude: number; longitude: number } | undefined) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

/** Only explicit current selections. No viewport, GPS, explore location or polygon-centre fallback. */
export function mapForecastLocation(selection: {
  hotspot?: { latitude: number; longitude: number; title?: string | null };
  point?: { latitude: number; longitude: number; areaId: string };
  areaId?: string; conditionsEnabled: boolean; owner: 'mine' | 'friends'; label?: string;
}): SevenDayLocation | undefined {
  if (selection.owner !== 'mine') return;
  if (valid(selection.hotspot)) return { latitude: selection.hotspot!.latitude, longitude: selection.hotspot!.longitude,
    name: selection.hotspot!.title || 'Rastišče brez naslova', source: 'hotspot' };
  if (selection.conditionsEnabled && selection.point?.areaId === selection.areaId && valid(selection.point))
    return { latitude: selection.point!.latitude, longitude: selection.point!.longitude, name: selection.label || 'Izbrana točka', source: 'map-point' };
}

export function forecastPointFromTap(lngLat: readonly number[]): SevenDayLocation | undefined {
  const point = { longitude: lngLat[0], latitude: lngLat[1] };
  return valid(point) ? { ...point, name: 'Izbrana točka', source: 'map-point' } : undefined;
}
