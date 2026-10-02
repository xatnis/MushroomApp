// Offline pipeline bridge: use the actual detail habitat rules, never a Python copy.
import { HEATMAP_HABITAT } from '../../src/domain/heatmap/regional';
import { habitatStateFor, HEATMAP_PROFILE_IDS } from '../../src/domain/heatmap/pilot';
process.stdout.write(JSON.stringify(Object.fromEntries(HEATMAP_HABITAT.features.map(f => [f.properties.id,
  Object.fromEntries(HEATMAP_PROFILE_IDS.map(id => [id, habitatStateFor(f, id)]))]))));
