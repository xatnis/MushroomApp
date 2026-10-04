/// <reference types="node" />
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateMushroomWeatherScore } from '../../src/domain/mushroomWeather';
import { assessHeatmapWeather } from '../../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../../src/services/weather';
import type { HeatmapWeatherCellSource } from '../../src/domain/heatmap/types';
import type { MushroomWeatherProfileId } from '../../src/domain/types';

export const DATASET_KEY = '8959f58a-f762-11e1-a439-00145eb45e9a';
export const SPECIES = [
  { name: 'Boletus edulis', profile: 'boletusEdulis' },
  { name: 'Cantharellus cibarius', profile: 'cantharellusCibarius' },
  { name: 'Lactarius deliciosus', profile: 'lactariusDeliciosus' },
] as const;
type RecordData = Record<string, any>;
export type DateAudit = { precision: 'exact-day' | 'month' | 'year' | 'unknown'; date?: string; year?: number; month?: number; reason?: string };

const validDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day;
};
export function dateQuality(record: RecordData): DateAudit {
  const event = typeof record.eventDate === 'string' ? record.eventDate.trim() : '';
  if (event.includes('/')) return { precision: 'unknown', reason: 'interval-not-a-single-day' };
  const match = event.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T.*)?)?)?$/);
  if (event && !match) return { precision: 'unknown', reason: 'unparseable-event-date' };
  const year = match ? Number(match[1]) : record.year;
  const month = match?.[2] ? Number(match[2]) : record.month;
  const day = match?.[3] ? Number(match[3]) : record.day;
  if (!Number.isInteger(year) || year < 1 || year > 2008) return { precision: 'unknown', reason: 'missing-invalid-or-post-snapshot-year' };
  // Do not turn a contradictory precision claim into a guessed date.
  if (match && [record.year, record.month, record.day].some((value, i) => value != null
    && match[i + 1] != null && value !== Number(match[i + 1]))) return { precision: 'unknown', reason: 'conflicting-date-fields' };
  if (day != null) {
    if (!Number.isInteger(month) || !Number.isInteger(day) || !validDate(year, month, day)) return { precision: 'unknown', reason: 'invalid-calendar-day' };
    const date = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date > '2008-03-31') return { precision: 'unknown', reason: 'post-snapshot-day' };
    return { precision: 'exact-day', date, year, month };
  }
  if (month != null) return Number.isInteger(month) && month >= 1 && month <= 12 && !(year === 2008 && month > 3)
    ? { precision: 'month', year, month } : { precision: 'unknown', reason: 'invalid-month' };
  return { precision: 'year', year };
}

export function taxonomyGroup(record: RecordData, key: number): string {
  if (record.taxonRank !== 'SPECIES' || record.infraspecificEpithet) return 'infraspecific-or-other-rank';
  if (record.taxonomicStatus !== 'ACCEPTED' || record.taxonKey !== key || record.acceptedTaxonKey !== key) return 'synonym-or-different-concept';
  return 'primary-exact-species';
}
export function usableSpatial(record: RecordData): boolean {
  return Number.isFinite(record.decimalLatitude) && Number.isFinite(record.decimalLongitude)
    && Math.abs(record.decimalLatitude) <= 90 && Math.abs(record.decimalLongitude) <= 180
    && record.countryCode === 'SI' && record.occurrenceStatus === 'PRESENT'
    && !(record.issues ?? []).some((issue: string) => ['COORDINATE_INVALID', 'ZERO_COORDINATE', 'COUNTRY_COORDINATE_MISMATCH'].includes(issue));
}
const countBy = (values: Array<string | number | null | undefined>) => values.reduce<Record<string, number>>((counts, v) => {
  const key = String(v ?? '(missing)'); counts[key] = (counts[key] ?? 0) + 1; return counts;
}, {});
const hasValue = (v: unknown) => v != null && v !== '';
const rawTerm = (raw: RecordData, term: string) => raw[`http://rs.tdwg.org/dwc/terms/${term}`] ?? raw[term];
export function verbatimDateQuality(raw: RecordData): DateAudit {
  const number = (term: string) => /^\d+$/.test(String(rawTerm(raw, term) ?? '')) ? Number(rawTerm(raw, term)) : undefined;
  return dateQuality({ eventDate: rawTerm(raw, 'eventDate'), year: number('year'), month: number('month'), day: number('day') });
}
export function duplicateAudit(records: RecordData[]) {
  const ids = records.map(r => r.occurrenceID ?? r.catalogNumber).filter(hasValue);
  const groups = new Map<string, number>();
  for (const r of records) {
    if (!usableSpatial(r) || dateQuality(r).precision === 'unknown') continue;
    // Private key: never write this signature/coordinates into the aggregate summary.
    const key = JSON.stringify([r.scientificName, r.eventDate, r.year, r.month, r.day, r.decimalLatitude, r.decimalLongitude]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { recordsWithIdentifier: ids.length, repeatedIdentifierExcess: ids.length - new Set(ids).size,
    sameTaxonDateGridGroups: [...groups.values()].filter(n => n > 1).length,
    sameTaxonDateGridExcess: [...groups.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0),
    policy: 'Flags only: same coarse grid/year is not proof of duplicate observation; retain records.' };
}
export function scoreDistribution(scores: number[]) {
  const sorted = scores.filter(Number.isFinite).sort((a, b) => a - b), n = sorted.length;
  const q = (fraction: number) => {
    if (!n) return null;
    const position = (n - 1) * fraction, low = Math.floor(position);
    return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
  };
  return { N: n, mean: n ? sorted.reduce((sum, s) => sum + s, 0) / n : null, median: q(.5),
    P10: q(.1), P25: q(.25), P75: q(.75), P90: q(.9),
    bins: Object.fromEntries([[0, 39], [40, 59], [60, 69], [70, 79], [80, 100]].map(([lo, hi]) =>
      [`${lo}-${hi}`, { count: sorted.filter(s => s >= lo && s <= hi).length, fraction: n ? sorted.filter(s => s >= lo && s <= hi).length / n : null }])),
    atLeast: Object.fromEntries([60, 70, 80].map(t => [t, n ? sorted.filter(s => s >= t).length / n : null])),
  };
}

/** Historical reanalysis adapter only; windows and scores remain production imports.
 * V1 defaults to 09:00 local; V2 requests start-of-day (00:00) to avoid using later observation-day soil. */
export function historicalAssessment(response: RecordData, date: string, latitude: number, longitude: number, profile: MushroomWeatherProfileId, soilHour = 9) {
  if (!Number.isInteger(soilHour) || soilHour < 0 || soilHour > 23) throw new Error('Invalid research soil hour.');
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const daily = response.daily ?? {}, hourly = response.hourly ?? {};
  const index = (hourly.time ?? []).indexOf(`${date}T${String(soilHour).padStart(2, '0')}:00`);
  const source: HeatmapWeatherCellSource = { id: 'historical-research', latitude, longitude, baseLocalDate: date,
    days: (daily.time ?? []).map((time: string, i: number) => ({ date: time, kind: 'historical' as const,
      precipitationMm: number(daily.precipitation_sum?.[i]), temperatureMeanC: number(daily.temperature_2m_mean?.[i]),
      evapotranspirationMm: number(daily.et0_fao_evapotranspiration?.[i]) })),
    currentSoil: index >= 0 ? { time: hourly.time[index], soilMoisture0To7Cm: number(hourly.soil_moisture_0_to_7cm?.[index]),
      soilMoisture7To28Cm: number(hourly.soil_moisture_7_to_28cm?.[index]) } : undefined,
    errors: {}, fetchedAt: new Date().toISOString(), stale: false };
  const assessment = assessHeatmapWeather(source, profile, 'today');
  // Explicit identity check protects against a research-only alternate formula.
  const direct = calculateMushroomWeatherScore(assessment.summary, profile);
  if (JSON.stringify(direct) !== JSON.stringify(assessment.score)) throw new Error('Production scorer mismatch.');
  return assessment;
}

export function auditRecords(records: RecordData[], key: number, verbatim: RecordData[]) {
  const primary = records.filter(r => taxonomyGroup(r, key) === 'primary-exact-species');
  const dates = (rows: RecordData[]) => countBy(rows.map(r => dateQuality(r).precision));
  const months = (rows: RecordData[]) => Array.from({ length: 12 }, (_, i) => rows.filter(r => dateQuality(r).month === i + 1).length);
  const spatialFields = ['decimalLatitude', 'decimalLongitude', 'coordinateUncertaintyInMeters', 'coordinatePrecision', 'geodeticDatum',
    'verbatimCoordinates', 'verbatimLatitude', 'verbatimLongitude', 'locationID', 'locality', 'verbatimLocality', 'footprintWKT', 'georeferenceRemarks'];
  const rawFields = [...new Set(verbatim.flatMap(v => Object.keys(v).filter(field => /locality|location|coordinate|grid|sre|date|year|month|day/i.test(field))))];
  const exactSpatial = primary.filter(r => dateQuality(r).precision === 'exact-day' && usableSpatial(r));
  return { totalRetrieved: records.length, primaryExactSpecies: primary.length, taxonomyGroups: countBy(records.map(r => taxonomyGroup(r, key))),
    interpretedNames: countBy(records.map(r => r.scientificName)), acceptedNames: countBy(records.map(r => r.acceptedScientificName)),
    ranks: countBy(records.map(r => r.taxonRank)), taxonomicStatuses: countBy(records.map(r => r.taxonomicStatus)),
    datesAllRetrieved: dates(records), datesPrimary: dates(primary), usableEventDatePrimary: primary.filter(r => dateQuality(r).precision !== 'unknown').length,
    usableSpatialAllRetrieved: records.filter(usableSpatial).length, usableSpatialPrimary: primary.filter(usableSpatial).length,
    exactDayWithUsableSpatial: exactSpatial.length, spatialFieldsPresent: Object.fromEntries(spatialFields.map(f => [f, records.filter(r => hasValue(r[f])).length])),
    uncertaintyMeters: countBy(records.map(r => r.coordinateUncertaintyInMeters)), datums: countBy(records.map(r => r.geodeticDatum)),
    countries: countBy(records.map(r => r.countryCode)), basisOfRecord: countBy(records.map(r => r.basisOfRecord)),
    occurrenceStatus: countBy(records.map(r => r.occurrenceStatus)), issues: countBy(records.flatMap(r => r.issues ?? [])),
    duplicateLooking: duplicateAudit(records), uniqueCoarseLocations: new Set(records.filter(usableSpatial).map(r => `${r.decimalLatitude}/${r.decimalLongitude}`)).size,
    years: countBy(records.map(r => dateQuality(r).year)),
    seasonal: { months1To12AllRetrieved: months(records), months1To12Primary: months(primary),
      months1To12ExactDayUsableSpatial: months(exactSpatial), available: records.some(r => dateQuality(r).month != null) },
    verbatimAudit: { inspected: verbatim.length, sampling: 'Deterministic strata of interpreted name, date precision and presence/absence of coordinates; max 12 per species plus all exact-day records.',
      datePrecision: countBy(verbatim.map(verbatimDateQuality).map(d => d.precision)), fieldNames: rawFields,
      rawNames: countBy(verbatim.map(v => rawTerm(v, 'scientificName'))), rawBasis: countBy(verbatim.map(v => rawTerm(v, 'basisOfRecord'))),
      rawMonthPresent: verbatim.filter(v => hasValue(rawTerm(v, 'month'))).length, rawDayPresent: verbatim.filter(v => hasValue(rawTerm(v, 'day'))).length,
      rawGridMetadataPresent: verbatim.filter(v => hasValue(v['http://unknown.org/griddedDataset'])).length,
      // This is GBIF's dataset-level nearest-neighbour flag, NOT an SRE polygon or code.
      gridDiagnosticValues: [...new Set(verbatim.map(v => v['http://unknown.org/griddedDataset']).filter(hasValue))],
      sourceCodeValues: [...new Set(verbatim.map(v => v['http://unknown.org/code']).filter(hasValue))],
      conceptualSchemaValues: [...new Set(verbatim.map(v => v['http://unknown.org/conceptualSchema']).filter(hasValue))] },
  };
}

const ROOT = resolve(__dirname, '../..');
const CACHE = resolve(ROOT, 'research/.cache/bi-gbif-v1');
const OUTPUT = resolve(ROOT, 'research-output');
const API = 'https://api.gbif.org/v1';
async function main() {
  const flags = process.argv.slice(3);
  if (flags.some(flag => !['--offline', '--refresh', '--weather'].includes(flag))) throw new Error('Flags: --offline, --refresh, --weather.');
  if (flags.includes('--offline') && flags.includes('--refresh')) throw new Error('offline + refresh is invalid.');
  mkdirSync(CACHE, { recursive: true }); mkdirSync(OUTPUT, { recursive: true });
  let requests = 0;
  const acquisitions = new Map<string, { url: string; downloadedAt: string; sha256: string }>();
  async function fetchCached(url: string): Promise<RecordData> {
    const filename = resolve(CACHE, createHash('sha256').update(url).digest('hex') + '.json');
    if (existsSync(filename) && !flags.includes('--refresh')) {
      const cached = JSON.parse(readFileSync(filename, 'utf8'));
      if (cached.url !== url || createHash('sha256').update(JSON.stringify(cached.data)).digest('hex') !== cached.sha256) throw new Error('Corrupt research cache.');
      acquisitions.set(url, { url, downloadedAt: cached.downloadedAt, sha256: cached.sha256 }); return cached.data;
    }
    if (flags.includes('--offline')) throw new Error('Required cache entry missing; run online acquisition first.');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        requests++;
        const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'MushroomApp-BI-validation/1 (non-commercial research)' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as RecordData;
        const sha256 = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const envelope = { url, downloadedAt: new Date().toISOString(), sha256, data };
        writeFileSync(filename, JSON.stringify(envelope));
        acquisitions.set(url, { url, downloadedAt: envelope.downloadedAt, sha256 }); return data;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
    throw new Error('Unreachable');
  }
  const metadata = await fetchCached(`${API}/dataset/${DATASET_KEY}`);
  if (metadata.doi !== '10.15468/2inmxv' || !String(metadata.license).includes('/by-nc/4.0/')) throw new Error('Unexpected dataset DOI/license; review before proceeding.');
  const endpoints = await fetchCached(`${API}/dataset/${DATASET_KEY}/endpoint`);
  const results: RecordData[] = [];
  for (const species of SPECIES) {
    const match = await fetchCached(`${API}/species/match?name=${encodeURIComponent(species.name)}`);
    if (match.matchType !== 'EXACT' || match.rank !== 'SPECIES' || match.status !== 'ACCEPTED' || match.canonicalName !== species.name) throw new Error('Taxonomy match requires manual review.');
    const records: RecordData[] = [];
    let expected: number | undefined;
    for (let offset = 0; ; offset += 300) {
      const page = await fetchCached(`${API}/occurrence/search?datasetKey=${DATASET_KEY}&taxonKey=${match.usageKey}&limit=300&offset=${offset}`);
      if (expected != null && page.count !== expected) throw new Error('GBIF count changed mid-acquisition; refresh all pages.');
      expected = page.count;
      records.push(...page.results);
      if (page.endOfRecords) break;
      if (!page.results.length || offset >= 99000) throw new Error('Incomplete API paging; use official download rather than truncating.');
    }
    if (records.length !== expected || new Set(records.map(r => r.key)).size !== expected || records.some(r => r.datasetKey !== DATASET_KEY)) throw new Error('Missing/duplicate/out-of-dataset GBIF pages.');
    console.log(`${species.name}: ${records.length} records acquired; auditing date/taxonomy/spatial precision.`);
    const sample = new Map<number, RecordData>();
    const strata = new Map<string, RecordData[]>();
    for (const r of records) {
      const key = `${r.scientificName}/${dateQuality(r).precision}/${usableSpatial(r)}`;
      const rows = strata.get(key) ?? []; rows.push(r); strata.set(key, rows);
    }
    for (const rows of strata.values()) for (const r of [rows[0], rows.at(-1)!]) if (sample.size < 12) sample.set(r.key, r);
    for (const r of records) if (dateQuality(r).precision === 'exact-day') sample.set(r.key, r);
    const verbatim: RecordData[] = [];
    for (const r of sample.values()) verbatim.push(await fetchCached(`${API}/occurrence/${r.key}/verbatim`));
    const audit = auditRecords(records, match.usageKey, verbatim);
    const eligible = records.filter(r => taxonomyGroup(r, match.usageKey) === 'primary-exact-species'
      && dateQuality(r).precision === 'exact-day' && usableSpatial(r));
    const scores: number[] = [], qualities: string[] = [];
    let weatherFailed = 0, weatherAttempted = 0, weatherUnsupportedDate = 0;
    if (flags.includes('--weather')) for (const r of eligible) {
      // Mandatory verbatim confirmation prevents GBIF's inferred/default date precision from becoming a daily target.
      const raw = verbatim.find(v => v.key === r.key)!;
      const date = dateQuality(r).date!;
      if (verbatimDateQuality(raw).date !== date) { weatherFailed++; continue; }
      if (shiftLocalDate(date, -60) < '1940-01-01') { weatherUnsupportedDate++; continue; }
      const params = new URLSearchParams({ latitude: String(r.decimalLatitude), longitude: String(r.decimalLongitude),
        start_date: shiftLocalDate(date, -60), end_date: date, timezone: 'Europe/Ljubljana', models: 'era5',
        daily: 'precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration', hourly: 'soil_moisture_0_to_7cm,soil_moisture_7_to_28cm' });
      weatherAttempted++;
      try {
        const response = await fetchCached(`https://archive-api.open-meteo.com/v1/archive?${params}`);
        const assessment = historicalAssessment(response, date, r.decimalLatitude, r.decimalLongitude, species.profile);
        qualities.push(assessment.dataQuality);
        if (assessment.dataQuality !== 'insufficient' && assessment.score.score != null) scores.push(assessment.score.score);
      } catch { weatherFailed++; }
      // Bounded sequential research transport, no concurrency/API storm. Full 61-day hourly calls are not counted as one quota unit.
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    results.push({ species: species.name, profile: species.profile, taxonMatch: match, ...audit,
      weather: { enabled: flags.includes('--weather'), eligible: eligible.length, attempted: weatherAttempted, unsupportedHistoricalDate: weatherUnsupportedDate, failedOrVerbatimRejected: weatherFailed,
        dataQuality: countBy(qualities), distribution: scoreDistribution(scores),
        status: eligible.length === 0 ? 'not-estimable-no-exact-day-spatial-primary-records' : flags.includes('--weather') ? 'executed' : 'requires---weather' },
      habitat: { status: 'phase-2', reason: 'SRE footprint not recovered; do not validate a 1 km habitat via an uncertain centroid. Current 2021 WorldCover/ZGS is not historical occurrence-era habitat.' } });
  }
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
    dataset: { key: DATASET_KEY, title: metadata.title, doi: metadata.doi, license: metadata.license, sourceSnapshot: '2008-03-31',
      registryModified: metadata.modified, publisherKey: metadata.publishingOrganizationKey,
      endpoints: (endpoints as unknown as RecordData[]).map(endpoint => ({ type: endpoint.type, url: endpoint.url })) },
    productionSourceSha256: Object.fromEntries(['src/domain/mushroomWeather.ts', 'src/domain/heatmap/assessment.ts', 'src/services/weather.ts']
      .map(file => [file, createHash('sha256').update(readFileSync(resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
    methodology: { acquisition: 'Official occurrence/search, paginated taxonKey incl. descendants; exact-species primary subset filtered separately.',
      rawCache: 'research/.cache/bi-gbif-v1 (ignored)', sourceFingerprintManifest: 'research-output/bi-acquisition-manifest.json (ignored)',
      date: 'Actual exact calendar date + verbatim confirmation required. No invented Jan 1, month midpoints or collection time.',
      weather: 'Production assessHeatmapWeather + calculateMushroomWeatherScore; ERA5 reanalysis, D-60 <= history < D, D09:00 soil convention; not a historical forecast backtest.',
      metric: 'score distribution among documented occurrences; NOT accuracy/precision/recall/AUC.',
      noAbsenceOrControls: true, noFormulaChanges: true }, httpRequestsThisRun: requests, species: results };
  writeFileSync(resolve(OUTPUT, 'bi-validation-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(resolve(OUTPUT, 'bi-acquisition-manifest.json'), JSON.stringify([...acquisitions.values()], null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({ species: r.species, retrieved: r.totalRetrieved, primary: r.primaryExactSpecies,
    dates: r.datesPrimary, spatial: r.usableSpatialPrimary, weatherN: r.weather.distribution.N, verbatim: r.verbatimAudit.inspected })), null, 2));
  console.log('Aggregate summary saved to ignored research-output/bi-validation-summary.json. Raw cache never committed.');
}
if (process.argv[2] && resolve(process.argv[2]) === __filename) void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Research run failed; no completed summary claimed.'); process.exitCode = 1;
});
