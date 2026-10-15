import { getHeatmapWeatherBatch } from '../src/services/weather';
import { loadPointSnapshots, pointResults } from '../src/services/pointConditions';
import { mapConditionsLocation } from '../src/domain/locationConditions';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { sortHotspots } from '../src/domain/hotspotRanking';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import type { MushroomWeatherProfileId } from '../src/domain/types';

async function run() {
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  const points = [{ id: 'public-A', latitude: 46.5, longitude: 14.5 }, { id: 'public-B', latitude: 46.6, longitude: 14.9 }, { id: 'public-C', latitude: 46.3, longitude: 15.1 }];
  const mapped = points.map(mapConditionsLocation), date = weatherLocalDate();
  const before = await getHeatmapWeatherBatch(db, [...new Map(mapped.map(m => [m.weatherPoint.id, m.weatherPoint])).values()], date);
  const after = await loadPointSnapshots(db, points, date);
  const records = (Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).flatMap(profile => points.flatMap((point, index) => [0, 1].map(day => {
    const old = assessHeatmapWeather(before.cells[mapped[index].weatherPoint.id], profile, day ? 'tomorrow' : 'today');
    const current = pointResults(after[index], profile)[day];
    return { point: point.id, profile, day, before: old.score.score, after: current.score, delta: current.score == null || old.score.score == null ? null : current.score - old.score.score,
      labelChanged: old.score.label !== current.label, oldSampling: [mapped[index].weatherPoint.latitude, mapped[index].weatherPoint.longitude],
      exactPoint: [point.latitude, point.longitude], oldSoilTime: old.summary.current?.time, newSoilTime: current.soilTime,
      oldT20: old.summary.historical?.avgTemp20dC, newT20: current.inputs.historical?.avgTemp20dC, missing: current.missing };
  })));
  console.log(JSON.stringify({ date, audit: 'LIVE public former cell-backed hotspots -> canonical exact point; endpoint retrievals differ slightly, not a frozen model-vintage experiment',
    cases: records.length, changed: records.filter(r => r.delta != null && r.delta !== 0).length, maxAbsoluteDelta: Math.max(...records.map(r => Math.abs(r.delta ?? 0))),
    labelChanges: records.filter(r => r.labelChanged).length, unavailable: records.filter(r => r.after == null).length,
    records, ranking: (Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map(profile => ({ profile,
      before: sortHotspots(points, Object.fromEntries(records.filter(r => r.profile === profile && r.day === 0).map(r => [r.point, { score: r.before ?? null }])), 'conditions').map(p => p.id),
      after: sortHotspots(points, Object.fromEntries(records.filter(r => r.profile === profile && r.day === 0).map(r => [r.point, { score: r.after }])), 'conditions').map(p => p.id) })) }, null, 2));
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
