/// <reference types="node" />
import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { FindRecord, ProfileSummary } from '../src/domain/types';
import { conditionsForLocation, conditionsProfileForItems, createConditionsSnapshot, initialHotspotProfile,
  mapConditionsLocation, validConditionsLocation } from '../src/domain/locationConditions';
import { visitConditionsText, withoutLocalConditions } from '../src/domain/conditionsSnapshot';
import { HEATMAP_HABITAT, HEATMAP_PILOT_METADATA, buildHeatmapRenderCollection, REGIONAL_INDEX } from '../src/domain/heatmap/regional';
import { HEATMAP_HABITAT as PILOT, areaAssessmentFor, HEATMAP_PROFILE_IDS } from '../src/domain/heatmap/pilot';
import { assessHeatmapWeather, localDateFor } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import { cachedHeatmapBundle, loadHeatmapPilot, subscribeHeatmapConditions } from '../src/services/heatmap/pilotHeatmap';
import { createRegionalWeatherLoader, regionalWeatherKey } from '../src/services/heatmap/regionalWeather';
import type { HeatmapAreaAssessment, HeatmapWeatherCellDefinition, HeatmapWeatherCellSource } from '../src/domain/heatmap/types';
import { patchHeatmapNavigationState, DEFAULT_HEATMAP_NAVIGATION_STATE } from '../src/domain/heatmap/navigationState';

const date = localDateFor(), now = new Date().toISOString();
const occurrenceTime = `${date}T12:00:00+02:00`;
const fixture = (p: HeatmapWeatherCellDefinition): HeatmapWeatherCellSource => ({ ...p, baseLocalDate: date, fetchedAt: now,
  errors: {}, stale: false, days: Array.from({ length: 62 }, (_, i) => ({ date: shiftLocalDate(date, i - 60),
    kind: i < 60 ? 'historical' : 'forecast', precipitationMm: i % 3 === 0 ? 0 : 3,
    temperatureMeanC: 13, evapotranspirationMm: 1 })),
  currentSoil: { time: date + 'T10:00', soilMoisture0To7Cm: .24, soilMoisture7To28Cm: .26 },
  tomorrowMorningSoil: { time: shiftLocalDate(date, 1) + 'T09:00', soilMoisture0To7Cm: .25, soilMoisture7To28Cm: .27 } });
const rows = new Map<string, { payload: string; fetchedAt?: string; expiresAt?: string }>();
const cacheDb = { getFirstAsync: async (_: string, key: string) => rows.get(key) ?? null,
  runAsync: async (_: string, key: string, payload: string, fetchedAt?: string, expiresAt?: string) => rows.set(key, { payload, fetchedAt, expiresAt }),
} as unknown as SQLiteDatabase;

async function run() {
  strictEqual(conditionsProfileForItems([{ speciesId: 'boletus-edulis' }]), 'boletusEdulis');
  strictEqual(conditionsProfileForItems([{ speciesId: 'cantharellus-cibarius' }]), 'cantharellusCibarius');
  strictEqual(conditionsProfileForItems([{ speciesId: 'lactarius-deliciosus' }]), 'lactariusDeliciosus');
  for (const item of [{ speciesId: 'macrolepiota-procera' }, { speciesId: 'boletus-group' },
    { speciesId: 'other', customName: 'Marela' }, {}, { speciesId: 'boletus-edulis', customName: 'Marela' }]) {
    strictEqual(conditionsProfileForItems([item]), 'generic', 'unsupported/custom/group is not a species scorer');
  }
  const syntheticFinds = [{ observedAt: '2025-09-01', items: [{ speciesId: 'boletus-edulis' }] },
    { observedAt: '2025-09-02', items: [{ speciesId: 'lactarius-deliciosus' }] }] as FindRecord[];
  strictEqual(initialHotspotProfile(syntheticFinds), 'lactariusDeliciosus');
  const savedCoordinate = { id: 'private-hotspot', latitude: 46.47045, longitude: 14.85009 };
  const mapped = mapConditionsLocation(savedCoordinate);
  strictEqual(mapped.latitude, savedCoordinate.latitude); strictEqual(mapped.longitude, savedCoordinate.longitude);
  ok(mapped.feature); strictEqual(REGIONAL_INDEX.atPoint([savedCoordinate.longitude, savedCoordinate.latitude]), mapped.feature);
  strictEqual(mapped.weatherPoint.id, mapped.feature.properties.weatherCellId);
  const outside = mapConditionsLocation({ id: 'outside', latitude: 45.5, longitude: 13.1 });
  strictEqual(outside.feature, undefined); strictEqual(outside.weatherPoint.latitude, 45.5);
  strictEqual(outside.weatherPoint.longitude, 13.1, 'outside coverage uses actual coordinate, not a regional centre');
  ok(!validConditionsLocation({ id: 'invalid', latitude: NaN, longitude: 14 }));
  throws(() => mapConditionsLocation({ id: 'invalid', latitude: 999, longitude: 14 }));
  strictEqual(conditionsForLocation(mapped, undefined, 'generic', 'today'), undefined, 'no fabricated zero');

  for (const p of [mapped.weatherPoint, outside.weatherPoint]) rows.set(regionalWeatherKey([p], date), { payload: JSON.stringify(fixture(p)) });
  const oldFetch = globalThis.fetch;
  let requests = 0, notifications = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
  const unsubscribe = subscribeHeatmapConditions(cacheDb, () => { notifications++; });
  try {
    const bundle = await loadHeatmapPilot(cacheDb, { pointIds: [mapped.weatherPoint.id, outside.weatherPoint.id],
      pointDefinitions: [mapped.weatherPoint, outside.weatherPoint] });
    ok(cachedHeatmapBundle(cacheDb)); ok(notifications > 0, 'map progress shared with cards');
    for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
      const actual = conditionsForLocation(mapped, bundle, profile, day)!;
      const expected: HeatmapAreaAssessment = buildHeatmapRenderCollection(bundle.assessments[day][profile], [mapped.feature!], profile, day).assessments[mapped.feature!.properties.id];
      deepStrictEqual(actual, expected, 'entire location assessment identical to heatmap/detail');
      strictEqual(conditionsForLocation(outside, bundle, profile, day)!.habitatState, 'unknown');
    }
    await loadHeatmapPilot(cacheDb, { pointIds: [mapped.weatherPoint.id] });
    const oldDate = shiftLocalDate(date, -1);
    rows.set(regionalWeatherKey([mapped.weatherPoint], oldDate), { payload: JSON.stringify({ ...fixture(mapped.weatherPoint), baseLocalDate: oldDate }) });
    await loadHeatmapPilot(cacheDb, { pointIds: [mapped.weatherPoint.id], reference: new Date(oldDate + 'T12:00:00Z') });
    strictEqual(cachedHeatmapBundle(cacheDb)!.baseLocalDate, date, 'late old-day request cannot roll shared conditions back');
    strictEqual(requests, 0, 'memory/disk reuse and all species/date switches have zero HTTP requests');
    const a = structuredClone(conditionsForLocation(mapped, bundle, 'boletusEdulis', 'today')!);
    const snapshot = createConditionsSnapshot(mapped, a, occurrenceTime, now)!;
    strictEqual(snapshot.schemaVersion, 1); strictEqual(snapshot.score, a.score);
    strictEqual(snapshot.targetProfile, 'boletusEdulis'); deepStrictEqual(snapshot.normalizedComponents, a.scoreDetails.components);
    ok(snapshot.scorerConfig); ok(!('days' in snapshot.weather)); ok(!('forecast' in snapshot.weather));
    strictEqual(snapshot.location.latitude, savedCoordinate.latitude);
    strictEqual(snapshot.location.weatherPointId, mapped.weatherPoint.id);
    strictEqual(createConditionsSnapshot(mapped, a, shiftLocalDate(date, -7) + 'T12:00:00+02:00'), undefined, 'no today backfill for old visit');
    strictEqual(createConditionsSnapshot(mapped, { ...a, score: null }, occurrenceTime), undefined);
    strictEqual(createConditionsSnapshot(mapped, undefined, occurrenceTime), undefined);
    const frozen = JSON.stringify(snapshot); a.scoreDetails.components[0].weightedPoints = -99;
    strictEqual(JSON.stringify(snapshot), frozen, 'snapshot never mutates with live data or later model changes');
    strictEqual(visitConditionsText(undefined), undefined);
    ok(visitConditionsText(snapshot)?.includes(`${snapshot.score} / 100`));
    deepStrictEqual(withoutLocalConditions({ id: 'visit', conditionsSnapshot: snapshot, conditionsSnapshotJson: frozen }), { id: 'visit' });
    await repositoryTests(snapshot);
  } finally { unsubscribe(); globalThis.fetch = oldFetch; }

  // Nine nearby hotspots need ONE deduped point and one pair of provider requests.
  rows.clear(); let batches = 0, received = 0;
  const loader = createRegionalWeatherLoader(async (_db, group) => {
    batches++; received += group.length;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { policyVersion: 'fixture', baseLocalDate: date, fetchedAt: now, stale: false, coldRequestCount: 2,
      cells: Object.fromEntries(group.map(p => [p.id, fixture(p)])) };
  }, 0);
  const nine = Array.from({ length: 9 }, (_, i) => mapConditionsLocation({ ...savedCoordinate, id: `hotspot-${i}` }));
  const points = [...new Map(nine.map(m => [m.weatherPoint.id, m.weatherPoint])).values()];
  await Promise.all([loader(cacheDb, points, date), loader(cacheDb, points, date)]);
  await loader(cacheDb, points, date);
  strictEqual(batches, 1); strictEqual(received, 1);
  console.info('Hotspot fixture request counts', { hotspots: 9, uniqueWeatherPoints: points.length,
    coldHttp: batches * 2, concurrentDuplicateHttp: 0, warmHttp: 0, speciesDayHttp: requests });

  const navigation = patchHeatmapNavigationState(DEFAULT_HEATMAP_NAVIGATION_STATE,
    { enabled: true, profileId: 'lactariusDeliciosus', targetDay: 'tomorrow', selectedAreaId: undefined });
  strictEqual(navigation.enabled, true); strictEqual(navigation.profileId, 'lactariusDeliciosus'); strictEqual(navigation.targetDay, 'tomorrow');
  const map = readFileSync('src/screens/MapScreen.tsx', 'utf8');
  ok(map.indexOf('<HotspotConditionsMarkers') > map.indexOf('id="mushroom-heatmap-selected"'), 'markers after all fill/line sources');
  ok(map.includes('...pendingHotspotFocus.conditions')); ok(map.includes('zoom: 15'));
  ok(map.includes('hotspotId: selected.id')); ok(map.includes('focusHotspot(hotspot)'));
  const marker = readFileSync('src/components/HotspotConditionsMarkers.tsx', 'utf8');
  ok(marker.includes('profile, day, enabled && showMarkers, 250')); ok(marker.includes('score != null'));
  ok(!/GeoJSON|useHeatmapVisuals|heatmapLod/.test(marker.replace(/\/\*\*.*?\*\//gs, '')), 'badge cannot rebuild or remount a heatmap source');
  const hook = readFileSync('src/services/heatmap/useLocationConditions.ts', 'utf8');
  ok(hook.includes('[db, key, baseDate, active, attempt, foreground, debounceMs]'), 'transport effect excludes profile/day');
  ok(hook.includes('controller.abort()')); ok(hook.includes('listener.remove()'));
  const detail = readFileSync('src/screens/HotspotDetailScreen.tsx', 'utf8');
  ok(detail.includes('requestHotspotFocus(hotspot, { profileId: conditionsProfile, targetDay: conditionsDay })'));
  ok(detail.indexOf('<HotspotConditionsCard') < detail.indexOf('title="Dodaj obisk"'));
  regressionTests();
  console.info('PASS hotspot coordinate/profile/day/parity, unavailable, snapshots/privacy, SQL compatibility, grouped cache/dedupe, marker and navigation integration');
}

function regressionTests() {
  const requireHere = createRequire(__filename);
  // Compare with the pre-task committed implementation, not a copy of its formulas.
  const baselineSource = execFileSync('git', ['show', '2822a44:src/domain/heatmap/regional.ts'], { encoding: 'utf8' });
  const Module = requireHere('node:module').Module;
  const filename = resolve('src/domain/heatmap/regional.ts');
  const baseline = new Module(filename); baseline.filename = filename; baseline.paths = Module._nodeModulePaths(resolve('src/domain/heatmap'));
  baseline._compile(ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  const old = baseline.exports as typeof import('../src/domain/heatmap/regional');
  for (const file of ['src/domain/mushroomWeather.ts', 'src/domain/heatmap/assessment.ts', 'src/domain/heatmap/pilot.ts',
    'src/services/weather.ts', 'src/services/heatmap/regionalWeather.ts', 'src/domain/heatmap/lod.ts', 'src/domain/heatmap/visual.ts']) {
    const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const productionDefault = file !== 'src/services/weather.ts' ? current : current
      .replace('  /** Optional calendar anchor for read-only daily charts; scorer callers retain their existing default. */\n  baseLocalDate?: string;\n', '')
      .replace('export const mapDailyWeather', 'const mapDailyWeather')
      .replace('const today = options.baseLocalDate ?? dateAtOffset(0);', 'const today = dateAtOffset(0);')
      .replace('const archiveStart = options.baseLocalDate ? shiftLocalDate(today, -60) : dateAtOffset(-60);', 'const archiveStart = dateAtOffset(-60);')
      .replace('const archiveEnd = options.baseLocalDate ? shiftLocalDate(today, -8) : dateAtOffset(-8);', 'const archiveEnd = dateAtOffset(-8);');
    strictEqual(productionDefault,
      execFileSync('git', ['show', `2822a44:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), `production rules/scheduler/LOD unchanged: ${file}`);
  }
  let regionalCases = 0, pilotCases = 0;
  for (const profile of HEATMAP_PROFILE_IDS) for (const day of ['today', 'tomorrow'] as const) {
    const weather = Object.fromEntries(HEATMAP_PILOT_METADATA.weatherCells.map(p => [p.id, assessHeatmapWeather(fixture(p), profile, day)]));
    const before = old.buildHeatmapRenderCollection(weather, old.HEATMAP_HABITAT.features, profile, day);
    const after = buildHeatmapRenderCollection(weather, HEATMAP_HABITAT.features, profile, day);
    for (const f of HEATMAP_HABITAT.features) {
      deepStrictEqual(after.assessments[f.properties.id], before.assessments[f.properties.id]); regionalCases++;
    }
    for (const f of PILOT.features) {
      const p = HEATMAP_PILOT_METADATA.weatherCells.find(p => p.id === f.properties.weatherCellId);
      const source = fixture(p ?? { id: f.properties.weatherCellId, latitude: f.properties.centerLatitude,
        longitude: f.properties.centerLongitude, projectedX: 0, projectedY: 0 });
      deepStrictEqual(areaAssessmentFor(f, assessHeatmapWeather(source, profile, day)),
        areaAssessmentFor(f, assessHeatmapWeather(structuredClone(source), profile, day))); pilotCases++;
    }
  }
  strictEqual(regionalCases, 84248); strictEqual(pilotCases, 15688);
  console.info('Production assessment regressions', { regionalCases, pilotCases,
    baseline: '2822a44', scorerHabitatLodSourcesByteIdentical: true, weatherDefaultBehaviorPreserved: true });
}

async function repositoryTests(snapshot: NonNullable<FindRecord['conditionsSnapshot']>) {
  const requireHere = createRequire(__filename);
  const cryptoPath = requireHere.resolve('expo-crypto');
  requireHere.cache[cryptoPath] = { exports: { randomUUID } } as NodeJS.Module;
  const { migrateDatabase, DiaryRepository } = requireHere('../src/storage/database') as typeof import('../src/storage/database');
  const sqlite = new DatabaseSync(':memory:');
  const parameters = (args: unknown[]) => (Array.isArray(args[0]) ? args[0] : args) as Array<string | number | null>;
  const db = {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getFirstAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).get(...parameters(args)) ?? null,
    getAllAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(...parameters(args)),
    runAsync: async (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...parameters(args)),
    withExclusiveTransactionAsync: async (callback: (tx: SQLiteDatabase) => Promise<void>) => {
      sqlite.exec('BEGIN'); try { await callback(db as unknown as SQLiteDatabase); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as SQLiteDatabase;
  try {
    await migrateDatabase(db);
    const repository = new DiaryRepository(db);
    const profile: ProfileSummary = { id: 'local:device', mode: 'local', createdAt: now };
    const makeVisit = () => ({ profile, newHotspot: { latitude: 46.47045, longitude: 14.85009,
      locationSource: 'manual' as const, locationSharing: 'private' as const },
      find: { hotspotId: '', observedAt: occurrenceTime, observationLatitude: 46.47045, observationLongitude: 14.85009,
        outcome: 'found' as const, visibility: 'private' as const, shareExactCommunityLocation: false,
        weather: { provider: 'open-meteo' as const, status: 'pending' as const }, items: [], photos: [] } });
    const legacy = await repository.saveVisit(makeVisit());
    // Real v2 database upgrade, preserving old rows without fabricating snapshots.
    sqlite.exec('ALTER TABLE finds DROP COLUMN conditionsSnapshotJson; PRAGMA user_version = 2;');
    await migrateDatabase(db); await migrateDatabase(db);
    strictEqual((await repository.getFind(profile.id, legacy.findId))!.conditionsSnapshot, undefined);
    const input = makeVisit();
    const saved = await repository.saveVisit({ ...input, find: { ...input.find, conditionsSnapshot: snapshot } });
    const read = (await repository.getFind(profile.id, saved.findId))!;
    deepStrictEqual(read.conditionsSnapshot, snapshot);
    strictEqual((await repository.listHotspots(profile.id))[0].locationSharing, 'private');
    await repository.updateFind(profile, { ...read, notes: 'edited', conditionsSnapshot: { ...snapshot, score: 0 } });
    deepStrictEqual((await repository.getFind(profile.id, saved.findId))!.conditionsSnapshot, snapshot, 'UPDATE cannot replace immutable snapshot');
    await repository.updateWeather(profile, saved.findId, { provider: 'open-meteo', status: 'complete', temperatureC: 20 });
    deepStrictEqual((await repository.getFind(profile.id, saved.findId))!.conditionsSnapshot, snapshot, 'historical weather enrichment cannot overwrite conditions');
    strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM outbox').get()!.n, 0, 'local visits never enter cloud outbox');
    const cloud: ProfileSummary = { id: 'cloud:test', mode: 'cloud', accountId: 'test', createdAt: now };
    sqlite.prepare("INSERT INTO local_profiles(id,mode,accountId,createdAt,active) VALUES(?,'cloud',?,?,0)").run(cloud.id, cloud.accountId!, now);
    await repository.saveVisit({ ...input, profile: cloud, find: { ...input.find, conditionsSnapshot: snapshot } });
    const payloads = sqlite.prepare("SELECT payload FROM outbox WHERE entity='find'").all();
    ok(payloads.length > 0);
    for (const row of payloads) {
      ok(!String(row.payload).includes('conditionsSnapshot'));
      ok(!String(row.payload).includes('normalizedComponents'), 'new local metadata is never uploaded');
    }
  } finally { sqlite.close(); }
}

void run().catch(error => { console.error(error); process.exitCode = 1; });
