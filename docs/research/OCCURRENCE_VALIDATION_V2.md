# Occurrence validation pipeline V2 — iNaturalist / Slovenia

Result: **58 eligible occurrences scored, all complete**, without model tuning.
These are **score distributions among documented occurrences**, not accuracy.
Habitat validation is explicitly deferred to phase 2.

Acquired **2026-10-04**; production baseline **d050a0f950ef8488b0a5ead6373cf1b8d667a9d6**.
No app/UI, production scorer, habitat, heatmap, or weather-service changes.

## Source, attribution and snapshot

iNaturalist Research-grade Observations, published through GBIF by iNaturalist;
credit to the iNaturalist observation community. Dataset key
`50c9509d-22c7-4a22-a47d-8c48425ef4a7`, DOI
[10.15468/ab3s5x](https://doi.org/10.15468/ab3s5x).
The [official dataset registry](https://api.gbif.org/v1/dataset/50c9509d-22c7-4a22-a47d-8c48425ef4a7)
was checked live: license [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/),
registry modification 2026-09-29. This is non-commercial research, not a new production data source.
No photographs, observer names, original hidden coordinates, or occurrence-level locations are published here.

Only official JSON endpoints were used, not HTML scraping:

```text
https://api.gbif.org/v1/dataset/{datasetKey}
https://api.gbif.org/v1/species/match?name={species}
https://api.gbif.org/v1/occurrence/search?datasetKey={datasetKey}&country=SI&taxonKey={acceptedKey}&limit=300&offset={offset}
```

Acquisition includes unfiltered country/taxon pages for exclusion accounting, then
`hasCoordinate=true`, then `hasCoordinate=true&hasGeospatialIssue=false`.
`country=SI` is the API parameter; responses carry `countryCode=SI`.
All pages must agree on count, have unique GBIF keys, and match dataset/country.
The study used 13 cached GBIF responses; each species fit in one page per query.
All-species audit finishes and writes `audit-summary.json` **before** any weather request.

GBIF search is mutable, not an immutable minted occurrence-download DOI. Cached response
envelopes contain acquisition timestamps, URLs and SHA-256; a private manifest records them.
The DOI above identifies the dataset, not a newly registered frozen download.
Replaying the acquired cache reproduces these results; a future fresh retrieval may change counts.

## Taxonomy and primary filters

| Species | GBIF accepted key | Production profile |
| --- | ---: | --- |
| Boletus edulis | 5954958 | boletusEdulis |
| Cantharellus cibarius | 5249504 | cantharellusCibarius |
| Lactarius deliciosus | 5248629 | lactariusDeliciosus |

Matches must be EXACT, ACCEPTED, rank SPECIES, with the requested canonical name.
Occurrence `taxonKey`, `acceptedTaxonKey`, and `speciesKey` must agree with that key;
rank must be SPECIES, status ACCEPTED, and no infraspecific epithet may be present.
Synonym/different-concept and infraspecific records are audited separately, not pooled.
All retrieved records passed this exact concept gate; no synonyms/infraspecific records appeared.
In particular, none of BI V1's historical Cantharellus var./subsp. issue appears in this export.
Accepted GBIF mapping is not independent genetic confirmation of identification/species complexes.

Daily precision requires a valid single ISO calendar date (possibly with observation time),
consistent interpreted year/month/day. Month/year-only dates, intervals, conflicts and invalid dates
are not assigned guessed days. Calendar date is preserved rather than shifted through UTC.
All 90 records have interpretable publisher `verbatimEventDate`, agreeing on calendar day with GBIF.
Recognized verbatim formats are ISO/year-first and English weekday/month dates; ambiguous locale
formats are never guessed. No date conflicts or missing/invalid event dates occurred here.

Primary: valid public coordinates, server geospatial filters, status not ABSENT,
exact taxonomy/day, date not in the future, complete 60-day historical interval starting >=1950-01-01,
and uncertainty Tier A or B:

- **A:** reported uncertainty 0–3,000 m.
- **B:** >3,000–10,000 m.
- **C:** >10,000 m; audit only.
- **UNKNOWN:** missing; audit only, never assumed GPS accuracy.
- Negative/non-numeric/non-finite uncertainty is INVALID and excluded.

Use only published coordinates and reported uncertainty, including generalized locations.
Do not recover obscured originals. Weather-request rounding adds uncertainty; it does not reduce a record's tier.
Exact occurrenceID / gbifID connected groups are deduplicated, choosing the lowest GBIF key.
Distinct IDs on the same day/location are retained. Same taxon/day/location signatures are audit flags only.

## Data-quality audit

Counts below are SI records in this dataset, not global iNaturalist totals. All country-query
records also passed the server coordinate/geospatial filters.

| Metric | B. edulis | C. cibarius | L. deliciosus |
| --- | ---: | ---: | ---: |
| Total GBIF / exact accepted / exact-day | 43 / 43 / 43 | 41 / 41 / 41 | 6 / 6 / 6 |
| Usable public coordinates | 43 | 41 | 6 |
| Invalid/missing exact event date | 0 | 0 | 0 |
| Synonym / infraspecific | 0 / 0 | 0 / 0 | 0 / 0 |
| Geospatial-issue exclusions | 0 | 0 | 0 |
| Duplicate IDs / same-day-location excess | 0 / 0 | 0 / 0 | 0 / 0 |
| Tier A | 27 | 24 | 5 |
| Tier B | 2 | 0 | 0 |
| Tier C | 3 | 1 | 0 |
| UNKNOWN uncertainty | 11 | 16 | 1 |
| INVALID uncertainty | 0 | 0 | 0 |
| Known uncertainty min / median / max, m | 1 / 91 / 27,031 | 3 / 15 / 27,095 | 25 / 119 / 1,802 |
| Observation years | 2013–2026 | 2019–2026 | 2017–2021 |
| Eligible A+B | 29 | 24 | 5 |

All are `HUMAN_OBSERVATION`, `PRESENT`. GBIF warnings were
`COORDINATE_ROUNDED` (42/40/5 respectively), `CONTINENT_DERIVED_FROM_COORDINATES`
(43/41/6), and `TAXON_ID_NOT_FOUND` (43/41/6). The latter concerns source taxon identifier
resolution; accepted species mappings above still agree. **Warnings are not equivalent to
`hasGeospatialIssue=true`**; excluding every issue would incorrectly discard this dataset.

The coordinate fields are public `decimalLatitude`, `decimalLongitude`, and
`coordinateUncertaintyInMeters`; they are not reconstructed SRE footprints or hidden iNaturalist GPS.
Aggregate spatial bands are 0.2° (~15 × 22 km in Slovenia), never individual points:
23 occupied bands for goban, 25 for lisička, 4 for sirovka (all accepted coordinate records).
Counts by band are in ignored `audit-summary.json`; no precise coordinates are in this report.

## Historical weather and future-information decision

Endpoint: `https://archive-api.open-meteo.com/v1/archive`.
Model pinned to **era5_seamless**, timezone Europe/Ljubljana.
Open-Meteo's [historical API documentation](https://open-meteo.com/en/docs/historical-weather-api)
distinguishes reanalysis models and their variable availability. Standalone ERA5-Land live responses
had null precipitation/ET0: the exploratory run was stopped, not scored as zeros.
ERA5-Seamless was then verified to supply all requested variables, combining compatible
ERA5 atmospheric and ERA5-Land surface inputs. This is not uniformly 0.1° weather for every variable.

For record day D, the request covers D-60 through D:

```text
models=era5_seamless
daily=precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration
hourly=soil_moisture_0_to_7cm,soil_moisture_7_to_28cm
timezone=Europe/Ljubljana
```

Production `assessHeatmapWeather` / `calculateMushroomWeatherScore` and existing aggregation
helpers calculate their unchanged rolling rain/temperature/ET0 windows using **D-60 <= history < D**.
Soil uses **D00:00 local**, a conservative start-of-day convention, not a claimed observation time.
Today's daily totals/mean temperature and later hourly values are discarded before aggregation;
scoring uses pre-D historical temperature. Soil at 00:00 replaces live-current soil for this research adapter only.
V1's research adapter gained an optional soil hour; its default remains 09:00 and V1 tests still pass.

**A — strict retrospective day-level analysis:** no rain after D, no D-total rain in historical windows,
no forecast days; even an overlong response is trimmed. Future rainfall is missing. Production future
rain affects trend, not the numeric weather score; no made-up future trend is evaluated here.
**B — production-semantics historical forecast replay: NOT performed.** No forecasts issued on D were
acquired. Realised later rain must not masquerade as a forecast available to an observer on D.
Reanalysis itself uses retrospective assimilation; this is not a real-time operational forecast backtest.

Numeric nulls remain missing. Production missing-component renormalization / insufficient handling
is reused. Insufficient outcomes are counted separately, not published as 0/100.
Quantiles use linear interpolation at `(N-1)*p`; buckets use integer production scores.

## Weather coverage and transport

| Species | Eligible | Scored | Weather failures | Insufficient | Partial/missing component | Complete |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| B. edulis | 29 | 29 | 0 | 0 | 0 | 29 |
| C. cibarius | 24 | 24 | 0 | 0 | 0 | 24 |
| L. deliciosus | 5 | 5 | 0 | 0 | 0 | 5 |

54 unique primary-model weather requests scored 58 distinct observations; 4 exact rounded-coordinate/day
requests reused cache. Immutable research cache keys include representative coordinates rounded to
0.01° (at most approximately 0.7 km extra displacement in SI), dates/windows, model, variables and timezone.
This is a cache representative, not a claim of GPS or provider-grid precision. No identical request
is sent twice: memory in-flight join plus disk cache, response hashes, atomic cache writes.
Concurrency is **1**, starts at least **2 s** apart, timeout 30 s, max 3 attempts with backoff;
429 numeric Retry-After is observed up to 60 s per attempt. Multiday HTTP calls consume more than
one provider quota unit; this small run is not permission for bulk API extraction at arbitrary scale.
The 29 cached standalone ERA5-Land exploratory responses are not part of primary distributions.
The separate variable-availability probe used the public pilot center, not an unpublished observation.

An offline disk-cache replay scored all 58 again, **0 HTTP requests**, 58 weather cache hits,
with identical score distributions. There are no production cache or scheduler changes.

## Primary results: score distribution among documented occurrences

| Species | N | Mean | Median | P10 | P25 | P75 | P90 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B. edulis | 29 | 90.24 | 91 | 81.4 | 88 | 98 | 100 |
| C. cibarius | 24 | 84.54 | 85.5 | 66.2 | 78 | 97 | 99 |
| L. deliciosus | 5 | 94.80 | 97 | 89.4 | 90 | 99 | 99 |

| Species | 0–39 | 40–59 | 60–69 | 70–79 | 80–100 | >=60 | >=70 | >=80 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B. edulis | 0 | 1 | 1 | 1 | 26 | 96.55% | 93.10% | 89.66% |
| C. cibarius | 0 | 1 | 3 | 5 | 15 | 95.83% | 83.33% | 62.50% |
| L. deliciosus | 0 | 0 | 0 | 0 | 5 | 100% | 100% | 100% |

### Spatial uncertainty sensitivity

Tier A goban: N=27, mean **89.70**, median **91**, P10=80.8, P25=87, P75=97, P90=100;
buckets **0/1/1/1/24**, shares >=60/70/80 = **96.30% / 92.59% / 88.89%**.
Versus A+B, the mean differs by 0.54 points, median unchanged. Only two Tier B observations exist;
this cannot establish broad robustness to coordinate displacement. Lisička and sirovka A-only equal
A+B exactly because there are no eligible Tier B observations for those species.

### Temporal sensitivity

Goban pre-2017: **N=1**, score=96 (all quantiles 96); inadequate for a temporal comparison.
Goban 2017+: **N=28**, mean=90.04, median=91, P10=81.1, P25=87.5, P75=98.25, P90=100;
buckets 0/1/1/1/25, shares >=60/70/80 = 96.43%/92.86%/89.29%.
All scored lisička (24) and sirovka (5) are 2017+; pre-2017 has N=0 and NA statistics, not zeros.
The same pinned weather model is used in both cohorts. This is not an IFS-vs-ERA5 comparison,
and any observed cohort difference would not by itself imply ecological change.

## Seasonality

Each entry is **count (percentage of that species' subset)**. Raw denotes unique exact accepted
daily observations before uncertainty exclusion (N=43/41/6); primary denotes eligible N=29/24/5.
January–March and May have zero records in all six columns.

| Month | Goban raw | Goban primary | Lisička raw | Lisička primary | Sirovka raw | Sirovka primary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Apr | 1 (2.33%) | 1 (3.45%) | 0 | 0 | 0 | 0 |
| Jun | 0 | 0 | 2 (4.88%) | 1 (4.17%) | 0 | 0 |
| Jul | 1 (2.33%) | 1 (3.45%) | 6 (14.63%) | 4 (16.67%) | 0 | 0 |
| Aug | 6 (13.95%) | 2 (6.90%) | 3 (7.32%) | 2 (8.33%) | 0 | 0 |
| Sep | 23 (53.49%) | 14 (48.28%) | 9 (21.95%) | 5 (20.83%) | 2 (33.33%) | 2 (40%) |
| Oct | 11 (25.58%) | 11 (37.93%) | 14 (34.15%) | 8 (33.33%) | 1 (16.67%) | 1 (20%) |
| Nov | 1 (2.33%) | 0 | 5 (12.20%) | 4 (16.67%) | 3 (50%) | 2 (40%) |
| Dec | 0 | 0 | 2 (4.88%) | 0 | 0 | 0 |

Observation frequency **is not abundance**. Uncertainty filtering changes seasonal composition.

## Habitat: phase 2, not a centroid result

No candidate/unknown/outside-model occurrence classification or Regional AOI sample count is claimed.
Intersect/sample each Tier A uncertainty area against the contemporary 1 km habitat grid first,
report mixed-state ambiguity and outside-AOI fractions. A representative point alone is not sufficient.
Even this would be a contemporary-habitat consistency study, not reconstructed historical ZGS/WorldCover.

## Interpretation, bias, V1 comparison and next steps

The high scores at many documented occurrences are a plausible first consistency signal, **not validation
of discrimination or calibration**. No obvious implementation/input error was found in the published
scores. High upper-tail scores/ceiling effects (especially sirovka N=5) warrant a future matched-background
study; they do not justify tuning these models now. The low-score occurrences are retained, not discarded
as inconvenient. There is no legitimate absence/background sample in this study.

Limitations: presence-only records; no reliable absences; observer-effort, access, geographic and seasonal
bias; community identification/species-complex uncertainty; unknown positional uncertainty excludes
28/90 records; four others exceed 10 km; mountainous reanalysis/grid displacement; retrospective
assimilation; start-of-day soil differs from live-time soil; reporting changes through time; small/non-independent
samples and near-shared weather cells. No accuracy, precision, recall, specificity or ROC-AUC is calculated.
Record-level scores are not independent biological trials, and high scores alone cannot reveal false positives.

BI V1 (`d050a0f`) had no eligible exact-day weather sample. V2 resolves that date blocker but provides a much
smaller modern Slovenia subset, not evidence that one source or species model is superior to the other.
Future V3: preregister matched season/region background design, separate training/validation/holdout
by year and geography, assess saturation and robustness to location/model uncertainty; implement
uncertainty-aware habitat phase 2. Do **not** tune and evaluate on this same presence sample.

## Reproduction and files

From project root (uses existing Node/TypeScript runtime; no new dependencies):

```powershell
# Audit only: no weather requests
node scripts/runSmoke.cjs scripts/research/occurrenceValidationV2.ts --audit
# All-species audit barrier, then historical weather and summaries
node scripts/runSmoke.cjs scripts/research/occurrenceValidationV2.ts --audit --weather
# Exact local response replay; fails a cache miss rather than making a network request
node scripts/runSmoke.cjs scripts/research/occurrenceValidationV2.ts --audit --weather --offline
```

Raw response envelopes: `research/.cache/occurrence-validation-v2/{gbif,weather}/`.
Ignored outputs: `research-output/occurrence-validation-v2/`:

- `audit-summary.json`, `species-summary.json`, `score-distributions.csv`, `seasonality.csv`.
- `private-provenance.json`, `private-scores.json`, `private-acquisition-manifest.json` contain
  occurrence IDs/coordinates or request locations and **must never be committed/published**.

Existing ignore rules cover both directories. The committed report contains only aggregate results.
Cached inputs are immutable for a study run; use a separate clean cache snapshot for a later new retrieval,
not a mixture of old/new GBIF pages. Record hashes/production baseline when comparing studies.

Checks passed: `npm run typecheck`; V2 and BI V1 research smoke tests; generic weather details,
location-ranking scorer consistency, pilot weather, Boletus/Chanterelle/ZGS habitat regressions.
V2 smoke tests freeze relevant production files byte-for-byte (normalized line endings) against
`d050a0f`, test direct production scorer identity, missing/null renormalization, future leakage,
dates/taxonomy/status/geospatial gates, identifier dedupe, in-flight/disk cache, and bounded retries.
No production change, dependency, Android build or new APK is needed for this research-only task.
