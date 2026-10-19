/** Read-only audit: deliberately retains the failing legacy test, never rewrites its baseline. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { digest } from './koroskaRegionalPrototype';
import { saveReport, SHADOW_ROOT } from './koroskaShadowStore';

const file = 'src/services/weather.ts', base = '6127609fb52602eb746e11c4afd68545e20dc14c';
const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), before = execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
function bodies(text: string) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), found: Record<string, string> = {};
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) found[node.name.text] = node.body.getText(ast);
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) found[d.name.text] = d.initializer.getText(ast);
  }
  return found;
}
const a = bodies(before), b = bodies(current), names = ['getHeatmapWeatherBatch', 'soilPointAt', 'responseAt', 'responseList',
  'mapDailyWeather', 'buildHistoricalWeatherSummaryForTarget', 'valuesInLastDays', 'completeSum', 'completeAverage', 'shiftLocalDate', 'buildForecastWeatherSummary', 'CACHE_MS'];
const checks = names.map(name => ({ name, baselinePresent: a[name] != null, currentPresent: b[name] != null,
  bodyEqual: a[name] != null && a[name] === b[name], beforeHash: digest(a[name]), currentHash: digest(b[name]) }));
const old = spawnSync(process.execPath, ['scripts/runSmoke.cjs', 'scripts/regionalRegression.ts'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const report = { schema: 'koroska-regional-source-guard-audit-v1', productionChanged: false, assertion: 'regionalRegression.ts:31 strictEqual(full weather.ts normalized LF, git show 6127609:weather.ts)',
  fullFileEqual: current === before, checks, unchangedRegionalBodies: checks.every(c => c.bodyEqual),
  history: execFileSync('git', ['log', '--format=%H %ad %s', '--date=iso-strict', `${base}..HEAD`, '--', file], { encoding: 'utf8' }).trim().split('\n'),
  oldSuite: { status: old.status, signal: old.signal, spawnError: old.error?.message ?? null, failedAssertion: old.stderr.match(/AssertionError[^\r\n]*/)?.[0] ?? null,
    weatherAssertionObserved: old.stderr.includes('src/services/weather.ts') && old.stderr.includes('regionalRegression.ts:31') },
  intentionalChanges: ['dcd8cdf: optional chart calendar anchor and export of existing daily mapper', 'f84a188: export cachedFetch for validated hourly transport reuse',
    'b63e18a: optional timing callbacks; regional call sites do not supply them'],
  proposedReplacement: 'Separate transport/default-contract behavioral test from scorer/geometry regression: authentic replay plus mock URL/range/variables, Today/Tomorrow windows and soil sample, TTL/dedupe/stale/partial/failure assertions. Retain all scorer/geometry pins and numeric baselines. Do not merely update weather.ts hash.',
  existingProtection: ['hotspotConditionsSmoke: pinned active production assessments 84248/15688 plus guarded intentional helper differences',
    'koroskaContractValidationSmoke: authentic production daily-adapter replay', 'weatherGraphsSmoke/weatherIntervalsSmoke: timeout/cache/dedupe/calendar/coverage',
    'soilSamplingSmoke: 2400 identical samples; sevenDayConditionsSmoke: strict canonical input gates'],
  resolution: 'Obsolete full-file guard conclusively identified; retained unchanged and reported FAIL independently. Focused behavioral replacement is a separate test-maintenance change.' };
console.log(JSON.stringify({ ...report, artifact: saveReport(SHADOW_ROOT, report) }, null, 2));
if (!report.unchangedRegionalBodies || old.status !== 1 || !report.oldSuite.weatherAssertionObserved) process.exitCode = 1;
