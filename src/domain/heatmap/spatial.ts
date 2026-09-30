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

// Test the clipped prepared geometry, not just its envelope (important at borders/holes).
export function intersectsBounds(geometry: Geometry, bounds: Bounds): boolean {
  const [west, south, east, north] = bounds;
  const corners: [number, number][] = [[west, south], [east, south], [east, north], [west, north]];
  if (corners.some(point => containsPoint(geometry, point))) return true;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => rings.some(ring => ring.some((a, i) => {
    if (a[0] >= west && a[0] <= east && a[1] >= south && a[1] <= north) return true;
    const b = ring[(i + 1) % ring.length];
    // Liang-Barsky segment/rectangle clipping also detects a narrow polygon crossing the viewport.
    let low = 0, high = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = b[axis] - a[axis], min = bounds[axis], max = bounds[axis + 2];
      if (delta === 0) { if (a[axis] < min || a[axis] > max) return false; }
      else {
        const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        if (low > high) return false;
      }
    }
    return true;
  })));
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
    visible(bounds: Bounds, selectedId?: string, buffer = .2) {
      // 20% viewport overscan for render and weather selection; never changes cell scores.
      const dx = (bounds[2] - bounds[0]) * buffer, dy = (bounds[3] - bounds[1]) * buffer;
      const expanded: Bounds = [bounds[0] - dx, bounds[1] - dy, bounds[2] + dx, bounds[3] + dy];
      return entries.filter(e => e.feature.properties.id === selectedId ||
        (e.bounds[2] >= bounds[0] - dx && e.bounds[0] <= bounds[2] + dx &&
         e.bounds[3] >= bounds[1] - dy && e.bounds[1] <= bounds[3] + dy && intersectsBounds(e.feature.geometry, expanded))).map(e => e.feature);
    },
  };
}

export function viewportWeatherPointIds(features: HeatmapHabitatFeature[]): string[] {
  return [...new Set(features.map(f => f.properties.weatherCellId))].sort();
}

export function heatmapViewportStatus(hasBounds: boolean, covered: boolean, loading: boolean, failed: boolean) {
  if (!hasBounds) return 'loading';
  if (!covered) return 'out-of-coverage';
  if (loading) return 'loading';
  if (failed) return 'error';
  return 'ready';
}
