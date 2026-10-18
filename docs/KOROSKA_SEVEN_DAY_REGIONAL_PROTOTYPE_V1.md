# Koroška Seven-Day Regional Prototype V1

Research date: **2026-10-18**. Starting branch/commit: `main`, `712ee0686b8a5243785f97e3183a9554dd18f2a0`; starting tree clean. All additions are isolated research/scripts/evidence. No production runtime, generated source asset, weights, cache schema, native project, navigation or golden baseline changed. No APK or native Android test.

## Executive findings and decision

**Overall: PARTIAL. Verdict: CONDITIONAL GO.** The bounded date-aligned pipeline works on actual captured weather: **696 existing cells, 11 existing weather sampling coordinates, seven dates, four profiles, 308/308 complete weather vectors**. The existing habitat mask permits **16,716 numerical map entries**, while **2,646 unknown-habitat and 126 outside-model entries remain nonnumeric**. There are no weather-unavailable vectors in this particular capture; deliberate incomplete/offline fixtures are correctly gated.

This establishes a usable regional research artifact, not production migration approval. The important unfinished part is an independent comparison against **actual provider daily responses used by the legacy regional transport**. To preserve the audit's two-request cap, the comparison here reconstructs a known fixed-offset daily response from the same frozen hourly field and then runs the actual production legacy adapter/scorer. It measures controlled policy differences, not all live legacy-product differences. Equal totals in the live capture are **not evidence of complete production input parity**.

Exactly one next milestone is recommended: **Koroška Regional Weather-Contract Impact Validation V1** (§12), before UI/tiles/national expansion.

The national [feasibility audit](SEVEN_DAY_SLOVENIA_HEATMAP_FEASIBILITY.md), especially §19, remains the governing specification. No material change to its CONDITIONAL GO conclusion was found, so it was not rewritten. Habitat is a mask/eligibility state, not an invented numerical factor; this clarifies the task's phrase “habitat-adjusted score” without changing production semantics.

## 1. Geography and exact selection

Rule: select existing `HEATMAP_HABITAT` features whose **stored representative centre** lies inclusively inside longitude/latitude bbox **[14.65, 46.35, 15.05, 46.59]**. Sort by existing ID using the explicit English locale. Preserve each complete existing clipped polygon, ID, weather mapping, WorldCover values and ZGS enrichment. This is a Koroška-centred study window, **not an official administrative boundary**. Polygons may extend beyond the selection bbox.

Measured: **696** cells; **696 valid/nonempty geometries** in Shapely; projected summed area **680.334747 km²** (EPSG:3035). No zero-source-pixel cells. Tree fraction min **0.1396**, mean **0.812629**, max **1**. Existing boundary clipping, including northern-border shapes, is retained; no foreign habitat or replacement square is invented. The original pinned national boundary is generalized/2009, not a newly verified authoritative border. [Geometry validation evidence](research/koroska-regional-week-v1.geometry-check.json).

The 11 weather definitions are taken from existing regional metadata, not derived from arbitrary cell centres:

| Existing weather ID | Latitude | Longitude |
| --- | ---: | ---: |
| weather-1-1 | 46.386397 | 14.712294 |
| weather-1-2 | 46.380611 | 14.841936 |
| weather-1-3 | 46.374668 | 14.971553 |
| weather-1-4 | 46.368569 | 15.101143 |
| weather-2-1 | 46.476247 | 14.720231 |
| weather-2-2 | 46.470450 | 14.850090 |
| weather-2-3 | 46.464496 | 14.979923 |
| weather-2-4 | 46.458385 | 15.109730 |
| weather-3-2 | 46.560283 | 14.858279 |
| weather-3-3 | 46.554318 | 14.988330 |
| weather-3-4 | 46.548194 | 15.118354 |

Sampling centres need not themselves be inside the selected-centre bbox. Original 10 km spacing does not imply independent 1 km weather information. Provider returned grid coordinates differ from requested coordinates and between archive/forecast; requested sampling identity remains exact. Returned elevation metadata spans **377–1,325 m**; this is not an elevation model of every habitat cell.

## 2. Production contracts inspected and experimental choice

| Path | Weather/time contract | Scoring and geography |
| --- | --- | --- |
| Existing regional Today/Tomorrow | `getHeatmapWeatherBatch`: provider daily arrays, archive through −8, recent history/forecast; nearest labelled Today soil; Tomorrow labelled 09:00 | `assessHeatmapWeather` + unchanged `calculateMushroomWeatherScore`; optional missing factors can produce limited totals; habitat separately classified |
| Canonical point / seven-day | `withCivilHourlyWeather`, `weatherIntervals`, `soilSampling`, `buildWeatherInputsForTargetDate`; UTC epochs, civil days, as-of Today/exact local09 future | Same production formula; stricter full-score gates; actual requested point, not a regional sample centre |
| This experiment | **`regional-civil-week-v1`** reuses that validated **weather-domain** contract at the **existing public regional sampling coordinates** | Four production scorers run once per weather/date/profile; then join existing cell habitat state. No point scorer is copied onto each polygon |

No production binary `HeatmapTargetDay` is stretched to mean +2…+6. The artifact has absolute dates. No fake shifted base date or UI score override is used. The canonical point-policy marker inside the isolated weather-domain snapshot enables its established provenance/coverage checks; the artifact's regional contract remains a separate explicit version. This does not assert a regional sample equals an actual tapped forest point.

Production component maxima and windows are unchanged:

| Profile | Required rain / temperature windows | Factor maxima |
| --- | --- | --- |
| Splošno | D7/D14/D30; T20 | rain 45, temperature 25, soil 20, drying 10 |
| Jesenski goban | D26; T20 | rain26 50, temperature 30, soil 15, drying 5 |
| Navadna lisička | D7/D30; T14 | rain30 40, rain7 10, temperature 25, soil 20, drying 5 |
| Užitna sirovka | D14/D60; T20 | rain60 35, rain14 10, soil 25, temperature 25, drying 5 |

All full scores additionally require D7/ET₀7 and both native soil depths. Code fingerprints cover the actual scorer/habitat and hourly-domain implementations; model/profile IDs and input versions are retained. No historical visits or model versions are reinterpreted.

## 3. Date alignment, source and soil safety

Completed lookbacks are **[target local date − N calendar days, target local date)** in Europe/Ljubljana. D60 is supplied by the hourly archive, not the 37-day graphs display series. Calendar arithmetic uses existing helpers. Civil midnight boundaries are resolved independently, never by repeatedly adding 24 hours.

Existing UTC interval semantics are retained: precipitation and ET₀ are preceding-hour accumulations with endpoints **(start,end]**; temperature uses hourly instants **[start,end)**. The seam assigns whole dates to archive before base−7, recent forecast history for the seven pre-base dates and forecast for base…+6. No overlapping source intervals are summed and no gaps are replaced by zero. Coverage checks reject duplicates, missing intervals, invalid axes/units and incomplete windows.

Today soil is the native preceding/as-of sample relative to provider current time. Future dates use **09:00 Europe/Ljubljana**. Only original **0–7 and 7–28 cm**, m³/m³ inputs are accepted. No layer substitution, rainfall-to-soil formula or carry-forward. Existing soil normalization and ET₀/drying equations remain untouched.

One locally cloned batch supplies all seven evaluations. Exact definitions, source hashes, UTC axes/units, retrieval times, sampling instants/offsets and date provenance are preserved. Different endpoint retrieval times are expected; different retrieval vintages **within the same endpoint batch** are rejected. Operational `best_match` is not a provider-run pin: **`forecastIssuedAt` remains null**. A common batch hash does not prove all underlying weather models share one initialization.

The artifact retains each snapshot's original assessment-as-of time, minimum source expiry and stale-at-capture flag. Offline replay does **not** renew its TTL. `ready` describes validated inputs at the recorded capture, not permission to present that old artifact as a fresh live forecast later.

No precipitation/temperature/ET₀ after a target cutoff enters its numerical lookback score. Existing canonical Today forecast context can still inform its trend/reasons; this is not claimed as a numerical score input. The no-leak fixture changes later rainfall and verifies the earlier totals and factor contributions stay identical.

## 4. Capture, artifact and reuse

One opt-in public acquisition was executed on **2026-10-18**: **two real HTTP requests**, parallel archive/forecast, using the existing production request plan, `cachedFetch`, TTL and dedupe against an **ephemeral in-memory DB**. No production/private DB was opened. Exactly 11 public coordinates were batched, not 696 cells or seven dates. No retries or additional provider probes were performed. Warm lookup used **zero additional HTTP**.

The captured batch is frozen/replayable. Later artifact/benchmark iterations read the saved sources and made **zero HTTP**. `summary.acquisition.originalCaptureMeasurement` preserves the actual first acquisition separately from the final offline replay timings. Reconstructed legacy transport uses **two mocked invocations**, not two more external requests. Focused tests also exercise overlapping actual point-service batch requests with mocked responses: cold 2, duplicate extra 0, warm extra 0; date reads 0.

Artifact layout:

- [Dataset](research/koroska-regional-week-v1.dataset.json): versioned manifest, 696 cell references with four habitat states, 11 weather definitions, 22 source descriptors, **77 distinct stored date-input objects**, **308 weather/date/profile vectors**, factors/reasons/statuses.
- [Original bounded geometry](research/koroska-regional-week-v1.geometry.geojson): cell indexes/IDs and existing polygons, once rather than 28 repeated layers.
- [Frozen public sources](research/koroska-regional-week-v1.sources.json): replay inputs; never private hotspots or a live-published national forecast.
- [Summary](research/koroska-regional-week-v1.summary.json): distributions, timing, memory, bytes and availability.
- [Legacy comparison](research/koroska-regional-week-v1.legacy.json): per-location/profile/date raw aggregate differences, soil samples and factor deltas.
- [Synthetic DST control summary](research/koroska-regional-week-v1.fixture-summary.json): separately labelled, not substituted for actual captured weather.

`cellResult` materializes the full typed cell/date/profile result through references, including profile, date, weather identity, versions, snapshot ID, factors and provenance. **weatherScore** is distinct from **score**: the latter is null for unknown/outside habitat, while the available weather assessment remains inspectable. No biological absence is inferred. This preserves the production mask semantics; it does not invent cell-specific numerical weights.

Sharing: **308 scorer calls versus 19,488 naive per-cell calls**, ~**63.27× fewer**, with 737 civil-day aggregates reused. Current production regional code already shares weather; this is not a claim of a 63× improvement over that existing implementation. The unchanged validated builder still assembles/checks target windows separately per profile: **319 historical-summary calls** (308 profile/date builds + 11 Today summaries). Only **77 rollup objects are stored**, but CPU is **not** falsely claimed deduplicated to 77. Removing that remaining repetition would require a separately parity-tested shared validation interface, not a shortcut around gates.

The separate legacy comparison adds 88 production scorer calls: **396 total experimental-plus-comparison evaluations per complete runner pass**, not 308 for both activities combined.

## 5. Captured availability and score distributions

Dates: **2026-10-18 through 2026-10-24**. All four profiles: **308/308 ready weather vectors**, no source-insufficient/error/stale vectors in this capture. Habitat is static across the seven dates:

| Profile | Candidate cells / day | Unknown | Outside | Seven-day numerical entries |
| --- | ---: | ---: | ---: | ---: |
| Splošno | 696 | 0 | 0 | 4,872 |
| Jesenski goban | 635 | 55 | 6 | 4,445 |
| Navadna lisička | 635 | 55 | 6 | 4,445 |
| Užitna sirovka | 422 | 268 | 6 | 2,954 |
| Total | 2,388 profile/cell combinations | 378 | 18 | **16,716** |

Total requested cell/date/profile combinations: **19,488**; nonnumeric habitat states: **2,772**. All underlying 19,488 weather references are valid in this particular capture, but not all are eligible for colour publication. Missing weather fixtures remain unavailable, never fake 0/100.

Candidate-cell means below are **software outputs for this captured snapshot**, not calibrated harvest forecasts. Full min/max/median and availability by date/profile are in the summary:

| Date | Splošno | Jesenski goban | Navadna lisička | Užitna sirovka |
| --- | ---: | ---: | ---: | ---: |
| Oct 18 | 65.180 | 58.883 | 54.191 | 89.934 |
| Oct 19 | 63.731 | 58.252 | 52.351 | 89.723 |
| Oct 20 | 58.185 | 56.362 | 46.628 | 87.853 |
| Oct 21 | 58.185 | 54.948 | 46.499 | 86.967 |
| Oct 22 | 61.662 | 57.654 | 48.973 | 87.919 |
| Oct 23 | 59.853 | 57.323 | 48.472 | 86.773 |
| Oct 24 | 58.598 | 57.157 | 47.893 | 86.277 |

These means use different profile habitat candidate sets; they are not evidence of one species being more likely to be found than another. Retained outcomes are a time-specific research sample, not a current forecast promise after their original date/TTL.

## 6. Legacy comparison: what is and is not demonstrated

To isolate policy effects with the same geography and underlying weather field, reconstruct **24-hour bins using one explicit base-date UTC offset**, convert the frozen hourly soil labels to that offset, then route them through actual `getHeatmapWeatherBatch` and `assessHeatmapWeather`. No legacy weight/formula/golden is edited. This is an intentional **controlled response fixture**, not an assertion that every live provider's daily aggregate equals that reconstruction. Temperature min/max are computed from the available hourly samples, not invented daily observations; unsupported daily weather codes remain null. These min/max/code fields do not enter the production suitability formulas.

| Controlled comparison | Actual captured-hourly reconstruction | Synthetic 2026-10-26 DST/sampling control |
| --- | ---: | ---: |
| Unique weather/profile/Today+Tomorrow cases | 88 | 88 |
| Equal / different numerical totals | 88 / 0 | 72 / 16 |
| Absolute delta mean / median / max | 0 / 0 / 0 | 0.181818 / 0 / 1 |
| Category changes | 0 | 1 |
| Availability changes | 0 | 0 |
| All-cell weighted equal / different | 5,568 / 0 | 4,512 / 1,056 |
| Candidate-cell weighted equal / different | 4,776 / 0 | 3,846 / 930 |
| Candidate-cell category changes | 0 | 94 |

Synthetic weather-level histogram: **−1:12, 0:72, +1:4**. All-cell histogram: −1:840, 0:4,512, +1:216. Candidate-only histogram: −1:722, 0:3,846, +1:208. These repeated cell cases are not independent weather samples.

In the actual captured-hourly reconstruction, all historical aggregate values and factor contributions matched exactly, but **44 Today cases have a different soil sampling label/instant** (as-of 13:00 versus nearest 14:00). The values happened to yield unchanged factors/totals. This is precisely why equal rounded scores do not prove equivalent sampling. Tomorrow samples matched. The synthetic control intentionally varies hourly soil and includes the autumn 25-hour day in lookbacks, demonstrating small numeric/category changes without fabricated weights.

Discrepancy classification: fixed-offset versus true civil days and nearest versus as-of sampling are **deliberate input-policy migration differences**. No coordinate substitution is made. No production scorer bug is inferred from this controlled comparison. Live provider daily-vs-hourly product/model differences remain unmeasured. Missing-input comparisons are separately tested and classified as availability changes, not zero-score differences. Required inputs, factor weights and factor points are retained in per-case evidence.

## 7. Performance and dataset sizes

Environment: Windows / Node **v24.21.0**, existing TypeScript smoke runner and static production imports. No Android, server SLA, GPU, tile encoding or client-render measurement. Values below are a retained replay pass, not stable medians. Synchronous function wrappers exist **only in the research runner** and are restored before legacy comparison. Nested measurements must not be added twice.

**Actual acquisition (separate first run):** archive **313,617 B** + forecast **137,380 B** = **450,997 decoded JSON bytes**. Cold acquisition including decoding/cache work: **514.192 ms**; warm **1.735 ms / 0 extra HTTP**. Per-endpoint start/response/decoded milestones are recorded. Response-to-decoded includes body transfer/JSON work, not pure CPU. Network variability is not controllable and no guaranteed latency is claimed.

**Final offline replay:**

| Phase | Calls | Wall time |
| --- | ---: | ---: |
| UTC source indexing | 22 | 5.338 ms |
| Civil daily aggregation | 737 | 41.670 ms |
| Native soil sampling | 77 | 94.507 ms |
| Rolling summary assembly | 319 | 16.696 ms |
| Production scorer only | 308 | 5.998 ms |
| Full hourly adapter, including indexing/aggregation/soil | 11 | 154.339 ms |
| Evaluation including input validation/windows/scorer | 308 | 165.863 ms |
| Static cell/habitat reference join | 696 | 13.572 ms |
| Whole build, including source cloning/hashing/checks | 1 | 376.922 ms |
| Materialize all cell summaries for distributions | 19,488 | 15.698 ms |
| Legacy reconstruction/adapter/comparison | 1 batch | 63.543 ms |
| Dataset serialization / gzip | 1 / 1 | 5.358 / 7.043 ms |
| Whole replay runner | 1 | 510.886 ms |

Process CPU: **531 ms user / 31 ms system** in this pass (process CPU can exceed wall time). Peak RSS **266,964,992 B**; start RSS 178,352,128 B; end RSS 265,871,360 B. These include compiler, imported national-region/pilot objects, raw source fixtures, snapshots, comparison and benchmark allocations; they are **not isolated adapter bytes or Android PSS**. The dataset/caches are bounded by 696/11; no background timer, per-frame work or production retained store is added.

| Artifact | Uncompressed JSON | gzip |
| --- | ---: | ---: |
| Result dataset, including inputs/factors/provenance | **949,239 B** | **40,150 B** |
| Geometry once | **184,896 B** | **21,410 B** |
| Combined two delivery candidates | **1,134,135 B** | **61,560 B** |

Sizes exclude final newline and separate debug/raw replay files. Real MVT encoding, edge duplication and native decoding remain unmeasured. This is a compact reference-based research package, not a claim that national GeoJSON is the best delivery format. Repeated weather/provenance explains strong compression.

National count extrapolation remains **269×28 = 7,532 weather evaluations**, not per-habitat-cell scoring. Linear payload scaling from this small sample is about 11 MB decoded source data, only a planning estimate. Do **not** multiply this replay's time and promise a national publication SLA: model latency, batch pacing, GC, habitat preparation, tile encoding, run-vintage skew, storage and retries can be nonlinear. Production publication needs separate budgets and provider access review from the audit.

## 8. Safety gates and scientific limitations

Tested gates: missing native soil/layer units, missing ET₀, missing older D60 rain, duplicate/partial hourly intervals, endpoint failure, total offline response, stale inputs, mixed retrieval vintages, duplicate/moved sampling identity and invalid indices. Generic D30 remains available when only older D60 coverage is missing; Lactarius is correctly unavailable. Genuine zero precipitation remains a valid numerical input. No partial total is normalized for full-colour publication.

DST fixtures exercise **2026-03-29 (23 hours)** and **2026-10-25 (25 hours)**, including future local09 offset changes. Leap-day and year/month-crossing fixtures are included. No later rain changes earlier target totals/factors. Whole-batch copy/hash plus exact coordinate matching prevents caller mutation/source identity mixing. Existing point-service async/cache tests remain unchanged and pass.

The 1 km habitat / 10 km sampling grid cannot resolve a forest microclimate or mountain slope. Provider returned altitude/downscaled weather is not proof of accurate cell-specific soil or temperature. WorldCover/ZGS coverage and stand-level host evidence are historical/heuristic. Unknown habitat is not absence. No arbitrary altitude correction, confidence percentage, mushroom discovery probability or harvest quantity is produced. Passing software tests does not validate actual mushroom occurrence. A single day's live completeness does not demonstrate year-round provider coverage.

No private hotspot ID/name, visit, annotation or GPS trace is read or exported. Public weather coordinates and public regional source geometry are the only locations used. Existing attribution is retained: Open-Meteo ([data licence](https://open-meteo.com/en/licence)), ESA WorldCover 2021 v200/modified Copernicus and ZGS; detailed licensing/procurement findings remain in the national audit. Captured operational model values are not on-site observations.

## 9. Tests and reproducibility

Executed: full TypeScript; **all 49 deterministic root smoke/regression suites** (48 existing + this prototype), plus subsequent focused prototype/TypeScript/replay verification after research-only review. Existing expected offline/timeout test diagnostics are deliberate fixtures, not failures. Actual unchanged regression counts: **84,248 regional**, **15,688 pilot**, **2,400 soil-sampling**. No golden regenerated.

The research iteration first exposed a self-referential callback type; it was corrected. Review also removed reference-identity comparisons of whole daily arrays, made missing-soil hashing safe, and added complete-offline handling. These fixes are isolated to new research code; no production bug or weight change is concealed.

```powershell
# Offline synthetic DST control, without replacing captured public-weather artifacts:
node scripts/runSmoke.cjs scripts/research/runKoroskaPrototype.ts --summary-only --save
# Rebuild captured public results with ZERO HTTP:
node --expose-gc scripts/runSmoke.cjs scripts/research/runKoroskaPrototype.ts --replay docs/research/koroska-regional-week-v1.sources.json --save
# Verify identical logical dataset, without writing files or requesting weather:
node scripts/runSmoke.cjs scripts/research/runKoroskaPrototype.ts --replay docs/research/koroska-regional-week-v1.sources.json --verify
node scripts/runSmoke.cjs scripts/koroskaRegionalPrototypeSmoke.ts
npx tsc --noEmit
# Opt-in only: new two-request public capture; overwrites research evidence, NOT production:
# node scripts/runSmoke.cjs scripts/research/runKoroskaPrototype.ts --live --save

Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' | Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
```

Exact source JSON and algorithm/geometry fingerprints make score artifacts reproducible from the frozen inputs. Timings/RSS vary and are intentionally outside dataset identity. Regenerating a new live snapshot is a different experiment, not a reproducibility failure. No paid infrastructure, large-scale import or national API experiment was run.

## 10. Success-criteria assessment

| Criterion | Result | Evidence / limit |
| --- | --- | --- |
| 1. Bounded geometry valid | PASS | 696 valid existing polygons, 11 definitions; no new grid |
| 2. Seven aligned input sets | PASS | Seven dates per public sample; D60/UTC/DST tests |
| 3. Four profiles when complete | PASS | Actual 308/308 ready vectors |
| 4. Incomplete/incompatible gated | PASS | Missing/depth/units/coverage/offline fixtures, no fake zero |
| 5. Efficient reuse | PASS | 308 versus 19,488 scorer calls; no per-day/cell HTTP; remaining per-profile validation explicitly measured |
| 6. Regional factor semantics | PASS | Actual formulas/weights and existing masks; no invented habitat multiplier |
| 7. Legacy differences fully quantified | **PARTIAL** | Controlled reconstructed-daily comparisons quantified; actual independent provider daily-product comparison still required |
| 8. Practical serialization | PASS for research | 61,560 B combined gzip; native tile/render performance unmeasured |
| 9. Time and memory measured | PASS, desktop only | Actual function stages/process peak; no Android claim |
| 10. Reproducible | PASS | Frozen capture replay and dataset equality; separate deterministic DST control |
| 11. Production map unchanged | PASS | No runtime/generated production file diff; existing regression suites |

## 11. Isolation and files

New isolated scripts: `scripts/research/koroskaRegionalPrototype.ts`, `koroskaWeatherFixture.ts`, `koroskaWeatherCapture.ts`, `runKoroskaPrototype.ts`; focused test `scripts/koroskaRegionalPrototypeSmoke.ts`. This document plus seven `docs/research/koroska-regional-week-v1.*` evidence files are added. No installed dependency, app import, MapScreen/MapLibre source/LOD action, weather policy, scorer formula, SQLite schema or private data change. No APK is appropriate for this research-only commit.

## 12. Exactly one next milestone

**Koroška Regional Weather-Contract Impact Validation V1.** Use the same bounded public sample and collect the actual legacy daily archive/recent-forecast responses alongside canonical hourly inputs in one tightly bounded acquisition window. This would require **separate explicit allowance for up to four HTTP requests** (two legacy + two hourly), not quietly exceeding this task's two-request acquisition cap. Preserve raw requests/responses/model metadata and exact coordinates, then quantify daily product, timezone/bin, sampling and availability differences separately for all four profiles/Today/Tomorrow. Include the existing synthetic DST controls and unchanged regional goldens; do not force parity or deploy the regional adapter.

Acceptance: a defensible production impact report distinguishing provider-product differences from clock/sampling policy and model formulas, with an explicit approve/reject decision for `regional-civil-week-v1`. Only after that review should a production-safe rendering/integration milestone be selected. This is **not** a proposal to implement a new scorer or silently “correct” legacy results. Current evidence supports continuing research, not switching the production map or declaring national readiness.

### Follow-up: authentic contract impact validation

The [Koroška Regional Weather-Contract Impact Validation V1](KOROSKA_REGIONAL_WEATHER_CONTRACT_VALIDATION_V1.md) now compares authentic provider daily products with a new contemporaneous hourly capture, rather than reconstructing daily inputs. Its 88 primary comparisons contain four one-point score differences; after habitat masking, 185 of 4,776 eligible Today/Tomorrow cell/profile cases change score and 94 change category. This later observational snapshot does not replace the reconstruction controls above or prove common model vintages. It recommends **C — non-public dual-contract shadow validation**, not a production migration; live DST product parity remains unverified.
