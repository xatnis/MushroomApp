import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createRankingOrderCoalescer, sortHotspots, rankingScore, rankingDetailParams } from '../src/domain/hotspotRanking';
import { mapConditionsLocation, conditionsForLocation } from '../src/domain/locationConditions';
import { createRegionalWeatherLoader } from '../src/services/heatmap/regionalWeather';
import { HEATMAP_HABITAT, HEATMAP_PILOT_METADATA, REGIONAL_INDEX, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import { HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import type { HeatmapPilotBundle } from '../src/services/heatmap/pilotHeatmap';

const input = [{ id: 'missing', title: 'C' }, { id: 'b', title: 'B' }, { id: 'a', title: 'A' }, { id: 'zero', title: 'Z' }];
const scores = { missing: undefined, a: { score: 80 }, b: { score: 80 }, zero: { score: 0 } };
strictEqual(sortHotspots(input, scores, 'recent'), input, 'original repository order is default');
deepStrictEqual(sortHotspots(input, scores, 'conditions').map(h => h.id), ['b', 'a', 'zero', 'missing']);
deepStrictEqual(sortHotspots(input, scores, 'name').map(h => h.id), ['a', 'b', 'missing', 'zero']);
deepStrictEqual(input.map(h => h.id), ['missing', 'b', 'a', 'zero'], 'sorting never mutates request input');
deepStrictEqual(sortHotspots([{ id: 'z', title: 'A' }, { id: 'a', title: 'a' }], {}, 'name').map(h => h.id), ['a', 'z']);
for (const value of [undefined, { score: null }, { score: NaN }, { score: Infinity }, { score: -1 }]) strictEqual(rankingScore(value), undefined);
strictEqual(rankingScore({ score: 0 }), 0);
const jobs: Array<{ run: () => void; cancelled: boolean }> = [], publications: any[] = [];
const coalesce = createRankingOrderCoalescer(value => publications.push(value), run => {
  const job = { run, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; };
});
coalesce.update({ key: 'today/generic', ids: ['a', 'b'] }); strictEqual(publications.length, 1);
for (let i = 0; i < 10; i++) coalesce.update({ key: 'today/generic', ids: ['b', 'a'] });
strictEqual(jobs.length, 1, 'micro-updates share one fixed window'); strictEqual(publications.length, 1);
jobs[0].run(); strictEqual(publications.length, 2);
coalesce.update({ key: 'today/generic', ids: ['a', 'b'] });
coalesce.update({ key: 'tomorrow/boletus', ids: ['b', 'a'] }); strictEqual(publications.length, 3);
ok(jobs[1].cancelled); jobs[1].run(); strictEqual(publications.length, 3, 'stale selection cannot overwrite latest');
coalesce.update({ key: 'tomorrow/boletus', ids: ['a', 'b'] }); coalesce.cancel(); jobs[2].run(); strictEqual(publications.length, 3);
deepStrictEqual(rankingDetailParams('a', { targetProfile: 'boletusEdulis', dayMode: 'tomorrow' }),
  { hotspotId: 'a', conditionsContext: { targetProfile: 'boletusEdulis', dayMode: 'tomorrow' } });

async function run() {
  const date = localDateFor(), now = new Date().toISOString();
  const fixture = (point: any) => ({ ...point, baseLocalDate: date, fetchedAt: now, stale: false, errors: {},
    days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60), kind: i < 60 ? 'historical' as const : 'forecast' as const,
      precipitationMm: 2, temperatureMeanC: 13, evapotranspirationMm: 1 })),
    currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .26 },
    tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .26, soilMoisture7To28Cm: .27 } });
  for (const count of [1, 4]) {
    let batches = 0, received = 0;
    // Use interior prepared cells, not border centroids outside clipped Slovenia polygons.
    const byPoint = new Map(HEATMAP_HABITAT.features.filter(f =>
      REGIONAL_INDEX.atPoint([f.properties.centerLongitude, f.properties.centerLatitude])?.properties.id === f.properties.id
      && HEATMAP_PILOT_METADATA.weatherCells.some(p => p.id === f.properties.weatherCellId))
      .map(f => [f.properties.weatherCellId, f]));
    const features = [...byPoint.values()].slice(0, count);
    strictEqual(features.length, count);
    const nine = Array.from({ length: 9 }, (_, i) => {
      const f = features[i % count];
      return mapConditionsLocation({ id: `hotspot-${i}`, latitude: f.properties.centerLatitude, longitude: f.properties.centerLongitude });
    });
    const points = [...new Map(nine.map(m => [m.weatherPoint.id, m.weatherPoint])).values()];
    const rows = new Map<string, { payload: string }>();
    const db = { getFirstAsync: async (_: string, key: string) => rows.get(key) ?? null,
      runAsync: async (_: string, key: string, payload: string) => rows.set(key, { payload }) } as unknown as SQLiteDatabase;
    const loader = createRegionalWeatherLoader(async (_db, group) => {
      batches++; received += group.length;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { policyVersion: 'fixture', baseLocalDate: date, fetchedAt: now, stale: false, coldRequestCount: 2,
        cells: Object.fromEntries(group.map(p => [p.id, fixture(p)])) };
    }, 0);
    const [weather] = await Promise.all([loader(db, points, date), loader(db, points, date)]);
    await loader(db, points, date);
    strictEqual(batches, 1); strictEqual(received, count);
    const bundle: HeatmapPilotBundle = { baseLocalDate: date, policyVersion: 'fixture', weather,
      assessments: Object.fromEntries(['today', 'tomorrow'].map(day => [day, Object.fromEntries(HEATMAP_PROFILE_IDS.map(profile =>
        [profile, Object.fromEntries(points.map(p => [p.id, assessHeatmapWeather(weather.cells[p.id], profile, day as 'today' | 'tomorrow')]))]))])) as HeatmapPilotBundle['assessments'] };
    for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
      const assessments = Object.fromEntries(nine.map(m => [m.id, conditionsForLocation(m, bundle, profile, day)!]));
      for (const m of nine) {
        const detail = buildHeatmapRenderCollection(bundle.assessments[day][profile], [m.feature!], profile, day).assessments[m.feature!.properties.id];
        deepStrictEqual(assessments[m.id], detail, 'ranking receives the same entire assessment as detail heatmap/card');
      }
      strictEqual(sortHotspots(nine.map(m => ({ id: m.id, title: m.id })), assessments, 'conditions').length, 9);
    }
    strictEqual(batches, 1, 'warm/species/day adds no transport');
    console.log('Ranking 9-hotspot MOCK TRANSPORT', { hotspots: 9, uniquePoints: count, batches,
      coldHttp: batches * 2, inFlightDuplicateExtraHttp: 0, warmExtraHttp: 0, speciesDayExtraHttp: 0 });
  }
  const screen = readFileSync('src/screens/MapScreen.tsx', 'utf8');
  const baseline = execFileSync('git', ['show', '4d20a3d:src/screens/MapScreen.tsx'], { encoding: 'utf8' });
  const segment = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b));
  strictEqual(segment(screen, '  const { enabled: heatmapEnabled', '  const heatmapAreaLocality'),
    segment(baseline, '  const { enabled: heatmapEnabled', '  const heatmapAreaLocality'));
  strictEqual(segment(screen, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'),
    segment(baseline, '<GeoJSONSource id="regional-overview-source"', '{locationGranted ?'));
  ok(screen.includes('context={rankingContext} onContext={setRankingContext}'));
  const child = readFileSync('src/components/HotspotRankingList.tsx', 'utf8');
  ok(child.includes('useLocationConditions(hotspots, context.targetProfile, context.dayMode, true, 250)'));
  for (const forbidden of ['loadHeatmapPilot(', 'fetch(', 'updateHeatmapNavigation(', 'GeoJSONSource', 'Supabase', 'updateHotspot(']) ok(!child.includes(forbidden), forbidden);
  const detail = readFileSync('src/screens/HotspotDetailScreen.tsx', 'utf8');
  ok(detail.includes('route.params.conditionsContext?.targetProfile ?? initialHotspotProfile(value.finds)'));
  ok(detail.includes("route.params.conditionsContext?.dayMode ?? 'today'"));
  console.log('PASS ranking: shared parity, unchanged map/weather/LOD, valid zero vs missing, sort/ties/default, fixed window, generation/latest wins, navigation context, privacy isolation.');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
