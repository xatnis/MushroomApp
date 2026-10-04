/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPECIES, taxonomyGroup, scoreDistribution, historicalAssessment } from './biGbifValidation';
import { ResearchCache, hash } from './researchCache';
import { shiftLocalDate } from '../../src/services/weather';

export const DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
export const HISTORICAL_MODEL = 'era5_seamless';
export type Occurrence = Record<string, any>;
export function verbatimDay(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]|$)/);
  const english = value.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{4})\b/);
  const parts = iso ? iso.slice(1).map(Number) : english ? [Number(english[3]),
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(english[1]) + 1, Number(english[2])] : undefined;
  if (!parts) return undefined; // Never guess ambiguous locale-formatted dates.
  const date = parts.map((v, i) => String(v).padStart(i === 0 ? 4 : 2, '0')).join('-');
  const check = new Date(date + 'T00:00:00Z');
  return Number.isFinite(check.getTime()) && check.toISOString().slice(0, 10) === date ? date : undefined;
}
export function exactDay(r: Occurrence): string | undefined {
  // No guessed day for year/month precision or an interval. Preserve observation's calendar day, not UTC-converted timestamp.
  const event = typeof r.eventDate === 'string' ? r.eventDate.trim() : '';
  const match = event.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!match || (event.includes('T') && !Number.isFinite(Date.parse(event)))) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const date = match[0].slice(0, 10), check = new Date(date + 'T00:00:00Z');
  if (year < 1 || !Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if ([r.year, r.month, r.day].some((v, i) => v != null && v !== [year, month, day][i])) return undefined;
  const rawDay = verbatimDay(r.verbatimEventDate);
  if (rawDay && rawDay !== date) return undefined;
  return date;
}
export function qualityTier(value: unknown): 'A' | 'B' | 'C' | 'UNKNOWN' | 'INVALID' {
  if (value == null) return 'UNKNOWN';
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'INVALID';
  return value <= 3000 ? 'A' : value <= 10000 ? 'B' : 'C';
}
export function primaryTaxonomy(r: Occurrence, key: number): boolean {
  return taxonomyGroup(r, key) === 'primary-exact-species' && r.speciesKey === key;
}
export function publicSpatial(r: Occurrence, allowedKeys: Set<string>): boolean {
  // Server-side hasGeospatialIssue=false is authoritative. Non-fatal GBIF warnings (e.g. COORDINATE_ROUNDED) are NOT all errors.
  return allowedKeys.has(String(r.key)) && r.datasetKey === DATASET && r.countryCode === 'SI'
    && r.occurrenceStatus !== 'ABSENT' && Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude)
    && Math.abs(r.decimalLatitude) <= 90 && Math.abs(r.decimalLongitude) <= 180
    && !(r.decimalLatitude === 0 && r.decimalLongitude === 0);
}
export function deduplicate(records: Occurrence[]) {
  // Connected identifier groups: a bridge record must not hide a later duplicate with a second identifier.
  const parent = records.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const identifiers = new Map<string, number>();
  records.forEach((r, i) => {
    const ids = [r.occurrenceID && `occ:${r.occurrenceID}`, (r.gbifID ?? r.key) != null && `gbif:${r.gbifID ?? r.key}`].filter(Boolean) as string[];
    for (const id of ids) {
      const previous = identifiers.get(id);
      if (previous != null) parent[root(i)] = root(previous);
      else identifiers.set(id, i);
    }
  });
  const groups = new Map<number, Occurrence[]>();
  records.forEach((r, i) => { const k = root(i), rows = groups.get(k) ?? []; rows.push(r); groups.set(k, rows); });
  const rows = [...groups.values()].map(group => [...group].sort((a, b) => Number(a.key) - Number(b.key))[0]);
  return { rows, duplicates: records.length - rows.length };
}
const countBy = (values: unknown[]) => values.reduce<Record<string, number>>((out, value) => {
  const k = String(value ?? '(missing)'); out[k] = (out[k] ?? 0) + 1; return out;
}, {});
export const seasons = (records: Occurrence[]) => Array.from({ length: 12 }, (_, i) => {
  const dated = records.filter(r => exactDay(r));
  const count = dated.filter(r => Number(exactDay(r)!.slice(5, 7)) === i + 1).length;
  return { month: i + 1, count, percent: dated.length ? count / dated.length * 100 : null };
});
export function eligibleRecord(r: Occurrence, key: number, allowed: Set<string>, cutoff: string): boolean {
  const date = exactDay(r), tier = qualityTier(r.coordinateUncertaintyInMeters);
  return !!date && date <= cutoff && shiftLocalDate(date, -60) >= '1950-01-01'
    && primaryTaxonomy(r, key) && publicSpatial(r, allowed) && (tier === 'A' || tier === 'B');
}
export function weatherRequest(r: Occurrence, model = HISTORICAL_MODEL): string {
  const date = exactDay(r);
  if (!date || !Number.isFinite(r.decimalLatitude) || !Number.isFinite(r.decimalLongitude)) throw new Error('Invalid weather target.');
  const params = new URLSearchParams({ latitude: r.decimalLatitude.toFixed(2), longitude: r.decimalLongitude.toFixed(2),
    start_date: shiftLocalDate(date, -60), end_date: date, timezone: 'Europe/Ljubljana', models: model,
    daily: 'precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration', hourly: 'soil_moisture_0_to_7cm,soil_moisture_7_to_28cm' });
  return `https://archive-api.open-meteo.com/v1/archive?${params}`;
}
export function strictAssessment(response: Occurrence, r: Occurrence, profile: typeof SPECIES[number]['profile']) {
  const date = exactDay(r)!;
  // Defense in depth: even an accidentally overlong cached response cannot leak realised future rain or soil.
  const trim = (section: Occurrence = {}, cutoff: string) => {
    const indices = (section.time ?? []).map((time: string, i: number) => ({ time, i }))
      .filter(({ time }: { time: string }) => time <= cutoff);
    return Object.fromEntries(Object.entries(section).map(([key, value]) => [key,
      Array.isArray(value) ? indices.map(({ i }: { i: number }) => value[i]) : value]));
  };
  return historicalAssessment({ ...response, daily: trim(response.daily, shiftLocalDate(date, -1)), hourly: trim(response.hourly, `${date}T00:00`) },
    date, Number(r.decimalLatitude.toFixed(2)), Number(r.decimalLongitude.toFixed(2)), profile, 0);
}
export function auditSpecies(records: Occurrence[], filtered: Occurrence[], key: number, cutoff: string) {
  const allowed = new Set(filtered.map(r => String(r.key))), unique = deduplicate(records);
  const accepted = unique.rows.filter(r => primaryTaxonomy(r, key)), dated = accepted.filter(r => exactDay(r));
  const eligible = accepted.filter(r => eligibleRecord(r, key, allowed, cutoff));
  const uncertainty = accepted.map(r => r.coordinateUncertaintyInMeters).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const years = dated.map(r => Number(exactDay(r)!.slice(0, 4)));
  const sameDayLocation = countBy(dated.map(r => JSON.stringify([r.speciesKey, exactDay(r), r.decimalLatitude, r.decimalLongitude])));
  return { totalGBIFRecords: records.length, spatiallyFilteredGBIFRecords: filtered.length,
    exactDuplicateCount: unique.duplicates, exactAcceptedSpecies: accepted.length,
    taxonomyGroups: countBy(unique.rows.map(r => taxonomyGroup(r, key))), interpretedNames: countBy(unique.rows.map(r => r.scientificName)),
    acceptedNames: countBy(unique.rows.map(r => r.acceptedScientificName)), exactDay: dated.length,
    verbatimDatesPresent: accepted.filter(r => r.verbatimEventDate).length,
    verbatimCalendarDayConfirmed: accepted.filter(r => verbatimDay(r.verbatimEventDate) === exactDay(r) && exactDay(r)).length,
    verbatimCalendarDayConflicts: accepted.filter(r => verbatimDay(r.verbatimEventDate) && r.eventDate?.slice(0, 10) !== verbatimDay(r.verbatimEventDate)).length,
    withoutValidExactDay: accepted.length - dated.length, coordinateAvailability: records.filter(r => Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude)).length,
    hasCoordinateAndNoGeospatialIssueExclusions: records.length - filtered.length,
    // Separately counted via server queries in acquisition (no conflation of warnings with fatal geospatial flags).
    uncertaintyTiers: countBy(accepted.map(r => qualityTier(r.coordinateUncertaintyInMeters))),
    uncertaintyMeters: uncertainty.length ? { N: uncertainty.length, min: Math.min(...uncertainty), max: Math.max(...uncertainty),
      median: scoreDistribution(uncertainty).median } : { N: 0 },
    basisOfRecord: countBy(records.map(r => r.basisOfRecord)), occurrenceStatus: countBy(records.map(r => r.occurrenceStatus)),
    issues: countBy(records.flatMap(r => r.issues ?? [])), yearRange: years.length ? [Math.min(...years), Math.max(...years)] : null,
    years: countBy(years), sameDayLocationExcessAuditOnly: Object.values(sameDayLocation).reduce((s, n) => s + Math.max(0, n - 1), 0),
    monthlyExactAccepted: seasons(dated), primaryEligible: eligible.length, eligibleTiers: countBy(eligible.map(r => qualityTier(r.coordinateUncertaintyInMeters))),
    // 0.2 degree SI bands are approximately >=15 x 22 km. No occurrence coordinates or IDs in aggregate output.
    coarseSpatialBands: countBy(accepted.filter(r => publicSpatial(r, allowed)).map(r => `${Math.floor(r.decimalLatitude / .2)}:${Math.floor(r.decimalLongitude / .2)}`)),
    eligible };
}

const ROOT = resolve(__dirname, '../..'), OUTPUT = resolve(ROOT, 'research-output/occurrence-validation-v2');
const API = 'https://api.gbif.org/v1';
async function main() {
  const flags = process.argv.slice(3);
  if (flags.some(f => !['--audit', '--weather', '--offline'].includes(f)) || (!flags.includes('--audit') && !flags.includes('--weather'))) {
    throw new Error('Usage: node scripts/runSmoke.cjs scripts/research/occurrenceValidationV2.ts --audit [--weather] [--offline]');
  }
  mkdirSync(OUTPUT, { recursive: true });
  const gbif = new ResearchCache(resolve(ROOT, 'research/.cache/occurrence-validation-v2/gbif'), flags.includes('--offline'), 300);
  const weather = new ResearchCache(resolve(ROOT, 'research/.cache/occurrence-validation-v2/weather'), flags.includes('--offline'), 2000);
  const metadata = await gbif.get(`${API}/dataset/${DATASET}`);
  if (metadata.doi !== '10.15468/ab3s5x' || !String(metadata.license).includes('/by-nc/4.0/')) throw new Error('Dataset DOI/license changed; review required.');
  const cutoff = new Date().toISOString().slice(0, 10);
  const speciesRows: Occurrence[] = [];
  for (const species of SPECIES) {
    const match = await gbif.get(`${API}/species/match?name=${encodeURIComponent(species.name)}`);
    if (match.matchType !== 'EXACT' || match.rank !== 'SPECIES' || match.status !== 'ACCEPTED' || match.canonicalName !== species.name) throw new Error('Taxonomy needs manual review.');
    async function acquire(extra: string) {
      const records: Occurrence[] = []; let expected: number | undefined;
      for (let offset = 0; ; offset += 300) {
        const page = await gbif.get(`${API}/occurrence/search?datasetKey=${DATASET}&country=SI&taxonKey=${match.usageKey}${extra}&limit=300&offset=${offset}`);
        if (expected != null && page.count !== expected) throw new Error('GBIF count drift; use a fresh cache directory.');
        expected = page.count; records.push(...page.results);
        if (page.endOfRecords) break;
        if (!page.results.length || offset >= 99000) throw new Error('Paging incomplete; official download required.');
      }
      if (records.length !== expected || new Set(records.map(r => r.key)).size !== expected || records.some(r => r.datasetKey !== DATASET || r.countryCode !== 'SI')) throw new Error('GBIF pagination/provenance mismatch.');
      return records;
    }
    const records = await acquire(''), coordinates = await acquire('&hasCoordinate=true');
    const filtered = await acquire('&hasCoordinate=true&hasGeospatialIssue=false');
    const allKeys = new Set(records.map(r => r.key)), coordinateKeys = new Set(coordinates.map(r => r.key));
    if (coordinates.some(r => !allKeys.has(r.key)) || filtered.some(r => !coordinateKeys.has(r.key))) throw new Error('Inconsistent GBIF filter snapshots; acquire a new clean snapshot.');
    const audit = auditSpecies(records, filtered, match.usageKey, cutoff);
    speciesRows.push({ species: species.name, profile: species.profile, acceptedTaxonKey: match.usageKey, ...audit,
      geospatialIssueExclusionsAmongCoordinateRecords: coordinates.length - filtered.length });
    console.log(`AUDIT ${species.name}: total=${records.length}, exact=${audit.exactAcceptedSpecies}, daily=${audit.exactDay}, eligible=${audit.primaryEligible}, tiers=${JSON.stringify(audit.uncertaintyTiers)}`);
  }
  // Mandatory all-species audit barrier. No weather GET can happen before this completed artifact is written.
  const productionFiles = ['src/domain/mushroomWeather.ts', 'src/domain/heatmap/assessment.ts', 'src/services/weather.ts', 'src/domain/heatmap/pilot.ts', 'src/domain/heatmap/zgs.ts'];
  const provenance = { schemaVersion: 2, generatedAt: new Date().toISOString(), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
    dataset: { key: DATASET, title: metadata.title, doi: metadata.doi, license: metadata.license, registryModified: metadata.modified },
    productionSourceSha256: Object.fromEntries(productionFiles.map(f => [f, hash(readFileSync(resolve(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))])) };
  writeFileSync(resolve(OUTPUT, 'audit-summary.json'), JSON.stringify({ ...provenance, species: speciesRows.map(({ eligible, ...audit }) => audit) }, null, 2));
  writeFileSync(resolve(OUTPUT, 'private-provenance.json'), JSON.stringify(speciesRows.flatMap(s => s.eligible.map((r: Occurrence) => ({ sourceDatasetKey: DATASET,
    sourceOccurrenceId: r.occurrenceID, gbifID: r.key, species: s.species, acceptedTaxonKey: s.acceptedTaxonKey,
    eventDate: exactDay(r), coordinateUncertainty: r.coordinateUncertaintyInMeters, qualityTier: qualityTier(r.coordinateUncertaintyInMeters),
    publicLatitude: r.decimalLatitude, publicLongitude: r.decimalLongitude }))), null, 2));
  console.log('ALL-SPECIES AUDIT COMPLETE. Weather acquisition can now start if --weather enabled.');
  if (!flags.includes('--weather')) return;
  const output: Occurrence[] = [];
  const privateScores: Occurrence[] = [];
  for (const s of speciesRows) {
    const scored: Occurrence[] = []; let failures = 0, insufficient = 0;
    for (const [i, r] of s.eligible.entries()) {
      try {
        const response = await weather.get(weatherRequest(r));
        if (!response.daily?.time || !response.daily.time.includes(exactDay(r))) throw new Error('Target day absent in archive.');
        const assessment = strictAssessment(response, r, s.profile);
        privateScores.push({ gbifID: r.key, profile: s.profile, score: assessment.score, dataQuality: assessment.dataQuality,
          summary: assessment.summary, weatherKey: hash(weatherRequest(r)) });
        if (assessment.dataQuality === 'insufficient' || assessment.score.score == null) insufficient++;
        else scored.push({ score: assessment.score.score, quality: assessment.dataQuality, tier: qualityTier(r.coordinateUncertaintyInMeters), year: Number(exactDay(r)!.slice(0, 4)) });
      } catch (error) { failures++; console.log(`Weather failure ${s.species} record ${i + 1}: ${error instanceof Error ? error.message : 'request failed'}`); }
      console.log(`WEATHER ${s.species}: ${i + 1}/${s.eligible.length}, scored=${scored.length}, failed=${failures}`);
    }
    output.push({ species: s.species, Neligible: s.eligible.length, Nscored: scored.length, NweatherFailures: failures, Ninsufficient: insufficient,
      NmissingSignalPartial: scored.filter(r => r.quality === 'limited').length, dataQuality: countBy(scored.map(r => r.quality)),
      primaryAandB: scoreDistribution(scored.map(r => r.score)), tierAOnly: scoreDistribution(scored.filter(r => r.tier === 'A').map(r => r.score)),
      pre2017: scoreDistribution(scored.filter(r => r.year < 2017).map(r => r.score)), since2017: scoreDistribution(scored.filter(r => r.year >= 2017).map(r => r.score)),
      seasonalEligible: seasons(s.eligible), habitat: { status: 'phase-2', reason: 'Uncertainty-area intersections not implemented; no blind centroid 1 km classification. Contemporary habitat cannot establish historical habitat.' } });
  }
  const summary = { ...provenance, method: { metric: 'score distribution among documented occurrences', model: HISTORICAL_MODEL, timezone: 'Europe/Ljubljana',
    dateWindow: 'D-60 <= history < D; soil at D00:00 local (start-of-day convention, not known observation time)',
    futureRain: 'Missing; no realised weather after D and no historical forecast replay claimed',
    coordinateRounding: '0.01 degree request representative (~<=0.7 km extra shift in SI), NOT original or provider grid precision',
    primary: 'exact accepted species, exact day, present-or-unspecified status, server geospatial filters, uncertainty A+B <=10km',
    replayStatus: 'not-performed-no-issued-historical-forecasts-acquired', noFormulaChanges: true },
    transport: { gbifHTTP: gbif.requests, weatherHTTP: weather.requests, weatherCacheHits: weather.hits, inflightJoins: weather.joins,
      concurrency: 1, minimumWeatherStartSpacingMs: 2000, uniqueWeatherDatasets: weather.manifest.size }, species: output };
  writeFileSync(resolve(OUTPUT, 'species-summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(OUTPUT, 'private-scores.json'), JSON.stringify(privateScores, null, 2));
  writeFileSync(resolve(OUTPUT, 'private-acquisition-manifest.json'), JSON.stringify([...gbif.manifest.values(), ...weather.manifest.values()], null, 2));
  const csv = ['species,subset,N,mean,median,P10,P25,P75,P90,0-39,40-59,60-69,70-79,80-100,ge60,ge70,ge80'];
  for (const s of output) for (const subset of ['primaryAandB', 'tierAOnly', 'pre2017', 'since2017']) {
    const d = s[subset]; csv.push([s.species, subset, d.N, d.mean, d.median, d.P10, d.P25, d.P75, d.P90,
      ...Object.values(d.bins).map((v: any) => v.count), ...Object.values(d.atLeast)].join(','));
  }
  writeFileSync(resolve(OUTPUT, 'score-distributions.csv'), csv.join('\n') + '\n');
  writeFileSync(resolve(OUTPUT, 'seasonality.csv'), ['species,subset,month,count,percent', ...speciesRows.flatMap(s => [
    ...s.monthlyExactAccepted.map((m: Occurrence) => [s.species, 'exactAccepted', m.month, m.count, m.percent].join(',')),
    ...seasons(s.eligible).map(m => [s.species, 'primaryEligible', m.month, m.count, m.percent].join(','))])].join('\n') + '\n');
  console.log(JSON.stringify({ transport: summary.transport, species: output.map(s => ({ species: s.species,
    eligible: s.Neligible, scored: s.Nscored, failures: s.NweatherFailures, insufficient: s.Ninsufficient,
    mean: s.primaryAandB.mean, median: s.primaryAandB.median })) }, null, 2));
}
if (process.argv[2] && resolve(process.argv[2]) === __filename) void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Research pipeline failed.'); process.exitCode = 1;
});
