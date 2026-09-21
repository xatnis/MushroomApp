import type { SQLiteDatabase } from 'expo-sqlite';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { habitatStateFor, HEATMAP_HABITAT, HEATMAP_PILOT_METADATA, HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import type { HeatmapTargetDay } from '../src/domain/heatmap/types';
import { getHeatmapWeatherBatch } from '../src/services/weather';

const memoryDb = {
  getFirstAsync: async () => null,
  runAsync: async () => ({ changes: 1, lastInsertRowId: 0 }),
} as unknown as SQLiteDatabase;

const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const compact = (value: number | undefined) => value == null ? null : Math.round(value * 1000) / 1000;

async function main() {
  const startedAt = Date.now();
  const batch = await getHeatmapWeatherBatch(
    memoryDb,
    HEATMAP_PILOT_METADATA.weatherCells,
    localDate(),
  );
  const sampleIds = ['weather-0-0', 'weather-2-2', 'weather-4-4'];
  const targetDays: HeatmapTargetDay[] = ['today', 'tomorrow'];
  const samples = sampleIds.map((cellId) => {
    const source = batch.cells[cellId];
    if (!source) throw new Error(`Missing live weather cell ${cellId}.`);
    const habitat = HEATMAP_HABITAT.features
      .filter((feature) => feature.properties.weatherCellId === cellId)
      .sort((left, right) => right.properties.treeCoverFraction - left.properties.treeCoverFraction)[0];
    return {
      cellId,
      latitude: source.latitude,
      longitude: source.longitude,
      days: source.days.length,
      habitatSample: habitat ? {
        areaId: habitat.properties.id,
        treeCoverFraction: habitat.properties.treeCoverFraction,
        grasslandFraction: habitat.properties.grasslandFraction,
        states: Object.fromEntries(HEATMAP_PROFILE_IDS.map((profileId) => [profileId, habitatStateFor(habitat, profileId)])),
      } : null,
      targets: Object.fromEntries(targetDays.map((targetDay) => {
        const assessments = Object.fromEntries(HEATMAP_PROFILE_IDS.map((profileId) => {
          const assessment = assessHeatmapWeather(source, profileId, targetDay);
          const history = assessment.summary.historical;
          return [profileId, {
            score: assessment.score.score ?? null,
            label: assessment.score.label,
            dataQuality: assessment.dataQuality,
            modelledHistoryDays: assessment.modelledHistoryDays,
            inputs: {
              rain7dMm: compact(history?.rain7dMm),
              rain14dMm: compact(history?.rain14dMm),
              rain26dMm: compact(history?.rain26dMm),
              rain30dMm: compact(history?.rain30dMm),
              rain60dMm: compact(history?.rain60dMm),
              avgTemp14dC: compact(history?.avgTemp14dC),
              avgTemp20dC: compact(history?.avgTemp20dC),
              et0Last7dMm: compact(history?.evapotranspiration7dMm),
              soil0To7: compact(assessment.summary.current?.soilMoisture0To7Cm),
              soil7To28: compact(assessment.summary.current?.soilMoisture7To28Cm),
            },
            contributions: Object.fromEntries(assessment.score.components.map((component) => [
              component.key,
              compact(component.weightedPoints),
            ])),
          }];
        }));
        return [targetDay, assessments];
      })),
    };
  });
  console.log(JSON.stringify({
    live: true,
    provider: 'Open-Meteo',
    baseLocalDate: batch.baseLocalDate,
    weatherCellCount: Object.keys(batch.cells).length,
    coldRequestCount: batch.coldRequestCount,
    durationMs: Date.now() - startedAt,
    samples,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
