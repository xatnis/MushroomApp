import habitat from '../src/data/heatmapRegional/habitat.geojson.json';
import { containsPoint, createHabitatSpatialIndex } from '../src/domain/heatmap/spatial';
import type { HeatmapHabitatFeatureCollection } from '../src/domain/heatmap/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const features = (habitat as HeatmapHabitatFeatureCollection).features;
const start = performance.now();
const index = createHabitatSpatialIndex(features);
const indexedMs = performance.now() - start;
const filterStart = performance.now();
const visible = index.visible([14.75, 46.4, 14.95, 46.54]);
const filteredMs = performance.now() - filterStart;
assert(visible.length > 0 && visible.length < features.length, 'Local viewport should reduce native payload');
assert(index.visible([0, 0, 1, 1]).length === 0, 'Outside viewport must not invent data');
assert(index.visible([0, 0, 1, 1], features[0].properties.id).length === 1, 'Keep selected cell accessible');
const withHole = { type: 'Polygon' as const, coordinates: [
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
] };
assert(containsPoint(withHole, [.5, .5]), 'Interior');
assert(!containsPoint(withHole, [1.5, 1.5]), 'Hole');
assert(!containsPoint(withHole, [8, 8]), 'Exterior');
assert(containsPoint({ type: 'MultiPolygon', coordinates: [withHole.coordinates] }, [.5, .5]), 'MultiPolygon');
console.log(JSON.stringify({ indexedMs, filteredMs, allPolygons: features.length, visiblePolygons: visible.length,
  fullBytes: JSON.stringify(features).length, visibleBytes: JSON.stringify(visible).length }));
