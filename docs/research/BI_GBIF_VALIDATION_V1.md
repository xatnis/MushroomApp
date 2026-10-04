# Boletus informaticus / GBIF validation study V1

**Result: data audit completed; daily weather validation is not estimable with this export.
Habitat validation is deferred to phase 2. Models were not tuned.**

Audit/acquisition date: **2026-10-04**. Pre-study production baseline:
`1d7b102b3dfe72f0ec2fb5fb25fe151a93261f83` (also recorded in the local summary).

## Dataset and acquisition

- Slovenian Fungal Database – Boletus informaticus; key `8959f58a-f762-11e1-a439-00145eb45e9a`.
- DOI [10.15468/2inmxv](https://doi.org/10.15468/2inmxv).
- Attribution: Slovenian Fungal Database – Boletus informaticus, published through GBIF;
  Slovenian Forestry Institute (see publisher organization in dataset registry).
- The [official registry API](https://api.gbif.org/v1/dataset/8959f58a-f762-11e1-a439-00145eb45e9a)
  describes the source snapshot as **31 March 2008**. Its current registry modification is
  **2025-11-18**. Historical observation dates, source snapshot date, current GBIF interpretation
  and the 2026 acquisition date are different things; this is not an immutable 2008 GBIF index.
- License verified in registry: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
  This is a non-commercial research workflow; no occurrence data is bundled into the app.
  Commercial reuse must not be inferred from public API access. Retain attribution and review
  reuse conditions before any later data redistribution/commercial integration.

Only official JSON APIs were used, not HTML scraping:

```text
GET https://api.gbif.org/v1/dataset/{datasetKey}
GET https://api.gbif.org/v1/dataset/{datasetKey}/endpoint
GET https://api.gbif.org/v1/species/match?name={species}
GET https://api.gbif.org/v1/occurrence/search?datasetKey={datasetKey}&taxonKey={key}&limit=300&offset={offset}
GET https://api.gbif.org/v1/occurrence/{key}/verbatim
```

Search includes descendant taxa/synonyms for the audit; the strict primary species subset is separate.
All 10 pages were fetched: 3 goban, 5 lisička, 2 sirovka. Returned counts and unique GBIF keys matched
743/1,418/532; no truncated paging or duplicate API keys. Initial acquisition made **40 HTTP calls**
(10 search pages, 25 verbatim samples, dataset/endpoint metadata and 3 taxon matches). Offline rerun: 0.
Raw envelopes contain endpoint, acquisition timestamp and SHA-256, allowing cache integrity checks.

The endpoint registry also exposes an official `BIOCASE_XML_ARCHIVE`:
`https://orphans.gbif.org/SI/8959f58a-f762-11e1-a439-00145eb45e9a.zip`.
It was **not downloaded or audited** in V1. We do not assert that the original database/archive cannot
contain additional precision; we report the inspected Occurrence API export and verbatim samples.

## Data-quality audit

"Usable event date" below means a valid date at its **reported precision**, not daily eligibility.
"Usable spatial" means a valid Slovenian representative coordinate with no invalid/zero/country-mismatch
flag; it does **not** mean GPS accuracy or eligibility for a 1 km habitat test.

| Inclusive retrieved taxon group | Total | Usable event date | Exact day | Month+year only | Year only | Unknown date | Usable coarse spatial |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Boletus edulis + accepted-name matches/descendants | 743 | 743 | 0 | 0 | 743 | 0 | 310 |
| Cantharellus cibarius descendants | 1,418 | 1,417 | 0 | 0 | 1,417 | 1 | 801 |
| Lactarius deliciosus | 532 | 532 | 0 | 0 | 532 | 0 | 235 |
| Total | 2,693 | 2,692 | 0 | 0 | 2,692 | 1 | 1,346 |

All records are interpreted as Slovenian `PRESENT` occurrences. Valid reported years span **1923–2007**.
Basis: goban 741 `OBSERVATION` + 2 `PRESERVED_SPECIMEN`; lisička 1,412 observations + 6 specimens;
sirovka 532 observations. This is a mixture of historical reporting/collection sources, not a designed
sampling survey. A specimen label is not independent verification of its historical species concept.

### Taxonomy and primary inclusion

Live exact/accepted GBIF matches:

| Requested concept | Accepted scientific name | GBIF key | Strict primary N | Primary year-only | Primary coarse spatial | Primary exact-day + spatial |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Boletus edulis | Boletus edulis Bull. | 5954958 | 725 | 725 | 303 | 0 |
| Cantharellus cibarius | Cantharellus cibarius Fr. | 5249504 | 0 | 0 | 0 | 0 |
| Lactarius deliciosus | Lactarius deliciosus (L.) Gray | 5248629 | 532 | 532 | 235 | 0 |

Operational strict primary filter: `SPECIES` rank, accepted status, direct `taxonKey` and
`acceptedTaxonKey` equal to the requested accepted species, no infraspecific epithet. This is deliberately
stricter than pooling every record assigned to that accepted name.

- Goban exclusions: 11 **B. betulicola**, 4 **B. persoonii**, 1 **B. venturii**, 1 **B. clavipes**,
  1 **B. edulis var. clavipes**. GBIF currently accepts all 18 under B. edulis, but V1 does not silently
  merge historical synonyms. Primary includes the 725 direct accepted B. edulis records.
- Lisička: **1,410 C. cibarius var. cibarius** (accepted `VARIETY`) and **8 C. cibarius subsp. nanus**
  (`SUBSPECIES`, synonym under C. cibarius). There are **no direct species-rank records** in this search.
  Excluding the nominotypical variety is an explicit operational choice, **not** a claim that it is a
  biologically separate species. A future reported sensitivity analysis may include the 1,410 autonym
  records after concept review; that still does not recover any exact dates here.
- Sirovka: all 532 are direct accepted L. deliciosus; older identifications may still reflect broader
  historical concepts. Current backbone matching cannot retrospectively verify specimens.

### Verbatim vs interpreted dates

All **2,693 interpreted records** were audited. Deterministic verbatim strata (name, date precision,
coordinate availability; first/last record per stratum, cap 12/species) inspected **12/9/4** records.
Goban and sirovka verbatim samples all give year-only `eventDate`/`year`; lisička samples give 8 year-only
and 1 unknown. No sampled source `month` or `day` fields exist. Their literal taxon names also confirm
the infraspecific/synonym distinction. This is a **25-record verbatim audit, not a full verbatim census**.
Any future exact-day interpreted record must additionally pass a verbatim exact-date match before scoring.

We do not assign 1 January, a month midpoint or snapshot/publication date as the finding date.
Intervals, impossible calendar dates, conflicting fields and post-snapshot dates are excluded.

### Actual spatial representation

Georeferenced records contain `decimalLatitude`, `decimalLongitude`, interpreted `geodeticDatum=WGS84`
and **`coordinateUncertaintyInMeters=3000` for every georeferenced record**. GBIF flags
`GEODETIC_DATUM_ASSUMED_WGS84` on all 1,346; `COORDINATE_ROUNDED` on 298/784/224 records respectively.
No `coordinatePrecision`, `locationID`, `locality`, `verbatimLocality`, `footprintWKT` or
`georeferenceRemarks` is provided in the retrieved interpreted records. Distinct coarse coordinate
pairs: 99 goban, 148 lisička, 84 sirovka (groups overlap; not a pooled count).

Inspected verbatim records include the dataset-level `http://unknown.org/griddedDataset` nearest-neighbour
diagnostic (`distanceNN=0.05`, `countNN=453`, `percentNN=0.9438`). This is **not an occurrence footprint**.
`http://unknown.org/code=BI` is a source code, **not an SRE cell identifier**. The conceptual schema is
the historical DigiR Darwin 2003 schema. No explicit SRE identifier/polygon was recovered from these
inspected fields. The dataset is treated as **coarse/grid-referenced**, never as precise GPS findings.
The 3,000 m uncertainty is not used to invent an SRE grid definition or a verified circular footprint.

### Duplicate-looking records

| Inclusive group | Repeated catalog/occurrence-ID excess | Same taxon + date/year + coordinate groups | Excess records in those groups |
| --- | ---: | ---: | ---: |
| Goban | 0 | 52 | 93 |
| Lisička | 0 | 156 | 369 |
| Sirovka | 0 | 35 | 56 |

These are flags, **not proven duplicates**: different visits/collectors within a coarse grid and the
same year can legitimately collide. No collector identities, exact coordinate pairs or occurrence
identifiers are exported in the research report/aggregate summary. No automatic deduplication was applied.

## Weather methodology and results

Production imports: `calculateMushroomWeatherScore`, `assessHeatmapWeather`,
`buildHistoricalWeatherSummaryForTarget` (through the production assessment builder), `shiftLocalDate`.
No formulas, weights, targets, classifications or habitat rules changed.

The research adapter is tested with fixtures, **not actual historical occurrence weather** in this run.
For future eligible records it requests the same official Open-Meteo
[archive endpoint](https://open-meteo.com/en/docs/historical-weather-api), explicit ERA5, Europe/Ljubljana,
daily precipitation/mean temperature/ET0 and hourly 0–7/7–28 cm soil moisture. Same rolling windows:
**D−60 <= history < D**, including rain7/14/26/30/60, temp14/20 and ET0 7d. The finding day's future/rain
does not improve its score. Soil at **D09:00 local** is an explicit research convention because
collection time is unknown; it is not a reconstruction of the production app's live current-time soil.
This is a reanalysis hindcast, **not** a test of forecast skill; historic best-match/live model mix differs.
Missing values remain missing and production optional-signal renormalization/data-quality gates apply.
Unsupported history before 1940 is skipped, not filled; soil availability must be checked per response.

**Exact-day + primary taxonomy + usable coordinates: N=0 for all three profiles. Therefore zero weather
HTTP requests were made. Historical weather/component coverage cannot be estimated from this run.**

"Score distribution among documented occurrences" (publishable exact-day subset):

| Species | N scored | Mean | Median | P10 | P25 | P75 | P90 | >=60 | >=70 | >=80 |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B. edulis | 0 | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| C. cibarius | 0 | NA | NA | NA | NA | NA | NA | NA | NA | NA |
| L. deliciosus | 0 | NA | NA | NA | NA | NA | NA | NA | NA | NA |

For each species, bins **0–39 / 40–59 / 60–69 / 70–79 / 80–100** each contain zero observations
in the empty eligible subset. Their proportions are **NA**, not 0%; no denominator exists. JSON uses
`null` for mean/percentiles/proportions. No synthetic dates, guessed weather or synthetic scores appear
in this table. Complete/limited/insufficient distributions are empty because no real assessment ran.

## Seasonal and habitat results

No month-resolved records exist in the retrieved 2,693 records. January–December known-month counts
are `[0,0,0,0,0,0,0,0,0,0,0,0]` for **all retrieved**, **strict primary**, and **exact-day validation**
subsets. These zeros denote **missing temporal coverage, not months without fungi**. A seasonal
distribution is not estimable; annual/year counts in the local summary must not be read as abundance.

Habitat counts (`candidate` / `unknown` / `outside-model`) are **not computed**. We did not assign an
occurrence to its representative point's 1 km cell. Phase 2 needs a verified SRE footprint/grid mapping,
area-based state fractions over intersecting Regional V2 cells, and an explicit partial-coverage policy.
It must also acknowledge historical mismatch: WorldCover 2021 and contemporary ZGS do not reconstruct
habitat during the 1923–2007 findings. At most that would be modern habitat-context concordance, not
validation of historical habitat. No false absence conclusions follow from missing ZGS/coverage.

## Biases, conclusions and next hypotheses

Presence-only archive; no true absences or standardized effort. Unequal collector/reporting effort,
geographic clustering, repeated visits, seasonal reporting, historical identification/species-complex
changes and SRE/coarse uncertainty all limit inference. Primary taxonomy filtering adds a selection
bias of its own. Raw counts are neither abundance nor prevalence. Historical reanalysis differs from
live forecast weather and current land cover differs from historical habitat.

**No accuracy, precision, recall, specificity or ROC-AUC is calculated. No model can be called obviously
miscalibrated, plausible or validated from this N=0 study.** The result is a useful feasibility/audit
finding: this GBIF export cannot supply the daily targets required by the existing weather scorers.
There is no evidence-based tuning recommendation and no production change.

Next: ask the BI data custodian whether exact collection dates and an explicit SRE grid definition can
be supplied under the same/reviewed conditions; separately examine the official original archive.
If usable dates emerge, preregister the strict-primary vs reported autonym/synonym sensitivity subsets,
spatial uncertainty analysis and independent hold-out geography/years **before** assessing any tuning.
Future hypotheses (not conclusions): alternative rainfall windows may differ by species; coarse soil
reanalysis may be less representative in mountains; historical taxonomy may alter lisička results.
Evaluate with independent dated data and legitimate effort-matched controls; do not tune on this export.

## Reproduce / outputs / tests

From the project root (existing compiler, no new dependencies):

```powershell
node scripts/runSmoke.cjs scripts/research/biGbifValidation.ts --weather
# Reproduce the pinned cached responses, no network:
node scripts/runSmoke.cjs scripts/research/biGbifValidation.ts --offline --weather
# Intentionally reacquire the current GBIF index (may produce different interpretations/counts):
node scripts/runSmoke.cjs scripts/research/biGbifValidation.ts --refresh --weather
node scripts/runSmoke.cjs scripts/research/biGbifValidationSmoke.ts
npm run typecheck
```

Raw occurrences/verbatim/weather: ignored `research/.cache/bi-gbif-v1/`. Aggregated machine-readable
summary: ignored `research-output/bi-validation-summary.json`; exact source hashes/acquisition dates:
ignored `research-output/bi-acquisition-manifest.json`. The summary contains no collector/location names,
coordinate pairs or occurrence IDs. Production-source hashes are recorded there. Only code, this report
and ignore rules are committed; no raw, bulk weather, sensitive occurrence or credentials.

Focused research tests cover exact calendar/date precision, taxonomy exclusion, coordinate validity,
duplicate flags, missing-signal renormalization, production score identity, target-day exclusion and
empty-distribution NA handling. Tests assert production weather/assessment/habitat files remain identical
to the pre-study baseline. Fixture scores are software checks, **not validation observations**.

Validation run: TypeScript PASS; research smoke PASS; existing `heatmapPilotSmoke`,
`genericWeatherDetailsSmoke`, `locationRankingSmoke`, `boletusHabitatSmoke`, `chanterelleHabitatSmoke`,
`zgsEnrichmentSmoke` PASS. No APK/runtime change is required for this scripts/docs-only study.
