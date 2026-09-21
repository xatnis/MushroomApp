import {
  clearHeatmapAreaLocalityCacheForTest,
  resolveHeatmapAreaLocality,
} from '../src/services/heatmap/areaLocality';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

clearHeatmapAreaLocalityCacheForTest();
const crna = resolveHeatmapAreaLocality('crna-area', 46.47045, 14.85009);
assert(crna.location.name === 'Območje pri Črni na Koroškem', 'Črna must resolve to its natural area label.');
assert(crna.location.latitude === 46.47045 && crna.location.longitude === 14.85009, 'Locality resolution must not move representative coordinates.');
assert(crna.location.admin1 === 'Koroška' && crna.location.country === 'Slovenija', 'Črna secondary location metadata is incorrect.');

const mezica = resolveHeatmapAreaLocality('mezica-area', 46.52030, 14.85307);
assert(mezica.location.name === 'Območje pri Mežici', 'A polygon near Mežica must not be labelled as Črna.');

const fallback = resolveHeatmapAreaLocality('outside-area', 0, 0);
assert(fallback.location.name === 'Izbrano območje' && fallback.method === 'neutralFallback', 'A distant point must use the neutral fallback.');

const cached = resolveHeatmapAreaLocality('crna-area', 46.47045, 14.85009);
assert(cached.cacheHit, 'Second resolution for the same area must use the area cache.');

console.info('Heatmap area locality smoke tests passed', {
  crna: crna.location.name,
  mezica: mezica.location.name,
  fallback: fallback.location.name,
  cacheHit: cached.cacheHit,
});
