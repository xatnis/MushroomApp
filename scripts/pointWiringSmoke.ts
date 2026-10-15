import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { withoutPointMigration } from './pointMigrationSourceGuards';

const screen = readFileSync('src/screens/ConditionsScreen.tsx', 'utf8');
ok(screen.includes('getCanonicalPointWeatherSummary as getMushroomWeatherSummary'));
ok(screen.includes('scoreForPointSummary as calculateMushroomWeatherScore'));
ok(screen.includes('weatherSummary.evaluationLocalDate === weatherDate'));
ok(screen.includes('summary.evaluationLocalDate === weatherDate'));
const map = readFileSync('src/screens/MapScreen.tsx', 'utf8');
ok(map.includes('latitude: graphLocation.latitude, longitude: graphLocation.longitude'));
ok(map.includes('point.assessments[regionalAssessment.areaId] ??'));
ok(map.includes('graphMapPoint.current && graphMapPoint.current.areaId === selectedHeatmapAreaId ? graphMapPoint.current.latitude'));
strictEqual(withoutPointMigration('src/screens/MapScreen.tsx', map), execFileSync('git', ['show', 'f84a188:src/screens/MapScreen.tsx'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), 'everything except point detail/coordinate wiring is byte-identical; no camera/source/mode/LOD change');
for (const path of ['src/services/weather.ts', 'src/domain/mushroomWeather.ts', 'src/domain/heatmap/assessment.ts', 'src/domain/heatmap/regional.ts', 'src/domain/heatmap/pilot.ts',
  'src/services/heatmap/pilotHeatmap.ts', 'src/services/heatmap/regionalWeather.ts', 'src/services/heatmap/useHeatmapVisuals.ts', 'src/domain/hotspotRanking.ts', 'src/domain/hotspotTopThree.ts',
  'src/components/WeatherGraphs.tsx', 'src/services/weatherGraphs.ts', 'src/domain/weatherSeries.ts', 'src/domain/conditionsSnapshot.ts', 'src/storage/database.ts']) {
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `f84a188:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'), path);
}
// Execute the real new calendar hook with mocked native timers/app-state (not a device renderer).
const requireHere = createRequire(__filename), Module = requireHere('node:module').Module;
const realDate = globalThis.Date, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
let now = realDate.parse('2026-03-29T00:30:00Z'), value: string | undefined, deps: any[] | undefined, cleanup: (() => void) | undefined;
let timer: { run: () => void; milliseconds: number } | undefined, listener: ((state: string) => void) | undefined, removed = 0;
class FixtureDate extends realDate { constructor(input?: number | string) { super(input === undefined ? now : input); } static now() { return now; } }
globalThis.Date = FixtureDate as DateConstructor;
globalThis.setTimeout = ((run: () => void, milliseconds: number) => { timer = { run, milliseconds }; return 1; }) as any;
globalThis.clearTimeout = (() => { timer = undefined; }) as any;
try {
  const file = resolve('src/services/usePointLocalDate.ts'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(resolve('src/services'));
  const original = mod.require.bind(mod);
  mod.require = (id: string) => id === 'react' ? { useState: (initial: string) => { value ??= initial; return [value, (next: string) => value = next]; },
    useEffect: (fn: any, next: any[]) => { if (!deps || deps[0] !== next[0]) { cleanup?.(); deps = next; cleanup = fn(); } } }
    : id === 'react-native' ? { AppState: { addEventListener: (_: string, fn: any) => { listener = fn; return { remove: () => { removed++; listener = undefined; } }; } } } : original(id);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  strictEqual(mod.exports.usePointLocalDate(), '2026-03-29'); strictEqual(now + timer!.milliseconds, realDate.parse('2026-03-29T22:00:00Z'));
  now = realDate.parse('2026-03-29T22:00:00Z'); timer!.run(); strictEqual(mod.exports.usePointLocalDate(), '2026-03-30');
  now = realDate.parse('2026-10-25T00:30:00Z'); listener!('active'); strictEqual(mod.exports.usePointLocalDate(), '2026-10-25');
  strictEqual(now + timer!.milliseconds, realDate.parse('2026-10-25T23:00:00Z'));
  cleanup!(); strictEqual(timer, undefined); strictEqual(listener, undefined); ok(removed > 0);
} finally { globalThis.Date = realDate; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
console.log('PASS production point/weekly/Razmere/map coordinate wiring, no regional native source/camera/weights/graphs/cache-body changes, stale date fences, actual spring/autumn midnight/resume hook and cleanup, no GPS fallback; map forecast presentation tested separately.');
