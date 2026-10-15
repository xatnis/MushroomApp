// Public test coordinates only. No saved/private locations or raw payload files.
import { loadLegacySevenDaySnapshotForAudit as loadSevenDaySnapshot } from '../src/services/sevenDayConditions';
import { evaluateSevenDayConditions } from '../src/domain/sevenDayConditions';
import { calculateMushroomWeatherScore, MUSHROOM_WEATHER_PROFILES } from '../src/domain/mushroomWeather';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { weatherLocalDate } from '../src/domain/weatherSeries';
import { sortHotspots } from '../src/domain/hotspotRanking';
import type { MushroomWeatherProfileId } from '../src/domain/types';

async function run() {
  const rows = new Map<string, any>();
  const db: any = { getFirstAsync: async (_: string, key: string) => rows.get(key), runAsync: async (_: string, key: string, payload: string, fetchedAt: string, expiresAt: string) => rows.set(key, { payload, fetchedAt, expiresAt }) };
  const points = [{ id: 'public-A', latitude: 46.5, longitude: 14.5 }, { id: 'public-B', latitude: 46.6, longitude: 14.9 }, { id: 'public-C', latitude: 46.3, longitude: 15.1 }];
  const profiles = Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[];
  const base = weatherLocalDate(); const records: any[] = [];
  for (const point of points) {
    const snapshot = await loadSevenDaySnapshot(db, point, base);
    if (!snapshot.legacyToday || !snapshot.legacyDaily) throw new Error('Run this audit against the pre-migration V1.2 service.');
    for (const profile of profiles) for (const index of [0, 1]) {
      const candidate = evaluateSevenDayConditions(snapshot, profile)[index];
      const legacy = index ? assessHeatmapWeather({ ...point, baseLocalDate: base, days: snapshot.legacyDaily.map(e => e.day).slice(0, 62),
        currentSoil: snapshot.legacyCurrentSoil, tomorrowMorningSoil: snapshot.legacyTomorrowSoil, fetchedAt: snapshot.legacyToday.updatedAt, stale: false, errors: snapshot.legacyToday.errors }, profile, 'tomorrow').score
        : calculateMushroomWeatherScore(snapshot.legacyToday, profile);
      const after = candidate.canonical;
      records.push({ point: point.id, profile, day: index, before: legacy.score, after: after.score, delta: after.score! - legacy.score!, labelChanged: legacy.label !== after.label,
        beforeLabel: legacy.label, afterLabel: after.label, oldSoilTime: index ? snapshot.legacyTomorrowSoil?.time : snapshot.canonicalCurrentSoil?.time, newSoilTime: candidate.soilTime });
    }
  }
  console.log(JSON.stringify({ auditDate: base, cases: records.length, changed: records.filter(r => r.delta !== 0).length,
    maxAbsoluteDelta: Math.max(...records.map(r => Math.abs(r.delta))), labelChanges: records.filter(r => r.labelChanged).length, records,
    ordering: profiles.map(profile => ({ profile, before: sortHotspots(points, Object.fromEntries(records.filter(r => r.profile === profile && r.day === 0).map(r => [r.point, { score: r.before }])), 'conditions').map(p => p.id),
      after: sortHotspots(points, Object.fromEntries(records.filter(r => r.profile === profile && r.day === 0).map(r => [r.point, { score: r.after }])), 'conditions').map(p => p.id) })) }, null, 2));
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
