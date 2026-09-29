import type { HeatmapHabitatFeature, HeatmapPolygonGeometry, HeatmapMultiPolygonGeometry } from './types';

export type Bounds = [number, number, number, number];
type Geometry = HeatmapPolygonGeometry | HeatmapMultiPolygonGeometry;

function inRing(point: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function containsPoint(geometry: Geometry, point: [number, number]): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(r => inRing(point, r)));
}

/** Geometry envelopes are computed once, never on profile/date changes. */
export function createHabitatSpatialIndex(features: HeatmapHabitatFeature[]) {
  const entries = features.map(feature => {
    const points = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of points) {
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    }
    return { feature, bounds };
  });
  return {
    byId: new Map(features.map(f => [f.properties.id, f])),
    visible(bounds: Bounds, selectedId?: string) {
      // Rendering-only 20% overscan. Never used for habitat/weather calculations.
      const dx = (bounds[2] - bounds[0]) * .2, dy = (bounds[3] - bounds[1]) * .2;
      return entries.filter(e => e.feature.properties.id === selectedId ||
        (e.bounds[2] >= bounds[0] - dx && e.bounds[0] <= bounds[2] + dx &&
         e.bounds[3] >= bounds[1] - dy && e.bounds[1] <= bounds[3] + dy)).map(e => e.feature);
    },
  };
}
