# Seven-Day Slovenia Heatmap — Feasibility & Architecture Audit

Audit date: **2026-10-18**, Europe/Ljubljana. Repository: `main` at **b63e18a6c2d1495157e84b631142bb196a7d85ca**. Initial working tree clean. **Audit only:** no production runtime, generated production asset, scorer, cache, SQLite, navigation, MapLibre or golden baseline is changed. No APK or native-device test was performed.

Evidence labels used below: **MEASURED** = this audit's retained results; **CODE** = inspected production behavior; **VERIFIED EXTERNAL** = official source checked on the audit date; **ESTIMATE/PROPOSAL** = not a measured implementation or vendor quotation.

## 1. Executive decision

**CONDITIONAL GO** for a timeboxed regional prototype and a **hybrid precomputed public forecast / on-demand exact-point** architecture (Option D). **NO-GO for shipping national computation on every phone or extending the existing binary day enum and daily weather adapter by simply looping seven times.**

Slovenia is not an unmanageable geometry problem: the existing grid phase, clipped to the repository's pinned national polygon, produces **21,052** detail cells, about twice the current region. Weather sharing reduces this to **252** detail sampling locations, **78** overview locations, or **269 distinct coordinate pairs** across both grids. However, the present national habitat mask is unavailable, the boundary is generalized/2009, the regional weather contract differs from the validated point contract, and native delivery has not been benchmarked on Redmi 13C. These are gates, not reasons to invent data.

Recommended outcome: a small scheduled publisher computes validated weather/date/profile vectors once; clients download overview and visible detail tiles, switch date/profile by attributes, and retain the existing canonical point forecast at the actual tapped/saved coordinates. No private data enter the publisher. Start with one existing Koroška window before buying/building national infrastructure.

The largest scientific risk is **false spatial precision and unvalidated ecological usefulness**, not the multiplication 7×4. The largest engineering risk is **versioned regional input/source consistency plus unproven native tile/switch performance**. Neither software regressions nor a successful public weather probe validate mushroom occurrence.

## 2. Factual architecture inventory

| Area | Actual implementation / evidence | Consequence for national forecasting |
| --- | --- | --- |
| Geographic preparation | `scripts/heatmap/prepare_regional.py`: EPSG:3035; 1,000 m squares anchored at 46.47045/14.85009; 75 km circle intersected with Slovenia; original compatible pilot cells retained | Reuse this phase and clipping, not a new latitude/longitude grid |
| Active regional assets | `src/data/heatmapRegional`: habitat 5,798,294 B; ZGS 11,454,066 B; metadata 16,559 B; coverage 19,427 B; overview 1,051,625 B = **18,339,971 B** | Static modules are eagerly imported; national vector delivery alone will not remove these allocations |
| Habitat | `pilot.ts`, `zgs.ts`: WorldCover vegetation/tree fractions and ZGS host evidence produce candidate / unknown / outside-model | Habitat is a mask/classification, **not a numerical multiplier or bonus** |
| Regional weather | `weather.ts:getHeatmapWeatherBatch`, `regionalWeather.ts`: daily archive + recent/forecast daily arrays, nearest labelled hourly soil; local response-offset semantics | Not the civil-hourly point contract; only days through base+1 survive adapter stitching |
| Regional evaluation | `assessment.ts`: Today/Tomorrow enum; shared `calculateMushroomWeatherScore`; core versus optional-component quality; `pilot.ts:areaAssessmentFor` combines weather and habitat presentation | No arbitrary future-date regional API exists; limited regional totals can be displayed, unlike the stricter weekly gate |
| Geographic LOD | `lod.ts`, `prepare_lod.py`: 4 km unions / 20 km sampling; detail 1 km / 10 km | Preserve separate resolutions and area-weighted candidate/unknown/outside fractions |
| Native display | `MapScreen.tsx`, `useHeatmapVisuals.ts`, `visual.ts`: two stable GeoJSON sources, readiness-confirmed handoff, serialized viewport detail, 20% overscan, 12-entry visual cache | Already avoids remounting, but date/profile changes currently serialize score-bearing source data |
| Point/weekly evaluation | `pointConditions.ts` → `sevenDayHourlyWeather.ts` → `weatherIntervals.ts` / `soilSampling.ts` → `sevenDayConditions.ts` | Reusable validated weather/date domain; do not instantiate the complete point cache/result graph for every 1 km feature |
| Point caching | Exact coordinate/date/policy keys; immutable snapshots; 128 memory entries per DB; profile-result WeakMaps; 30-minute raw TTL; groups ≤16, two concurrent groups; dedupe | Country's 269 weather locations exceed the point store's 128-entry retention; do not repurpose it as a national client database |
| Point refresh | b63e18a: shared-store subscription, warm-first-render, actual TTL deadline, foreground/local-midnight guards; requested profile only | Keep unchanged; tile refresh must not invalidate private point state |
| Weather graphs | `weatherGraphs.ts`, `weatherSeries.ts`: independent 30+7 display series / legacy daily-cache readers | Not a D60 store or source of canonical national scorer inputs; not universally free after an hourly point request |
| App context | `heatmap/navigationState.ts`: `profileId`, binary `targetDay`, selected area, viewport; forecast intent retains a local date | Future absolute-date migration must be explicit across surfaces; do not clamp +5 into Tomorrow |
| Regression references | `hotspotConditionsSmoke.ts` compares actual regional/pilot outputs to 2822a44 | 84,248 / 15,688 are correctness baselines, not field-validation statistics |

The current spatial index scans prepared feature envelopes and tests actual clipped geometry. It is not a national tile index. `pilot.ts` imports pilot data even when its helpers are used by regional code. A future delivery migration should separate pure model/habitat helpers from data modules without changing formulas; otherwise old and national data can coexist unnecessarily in phone memory.

### Existing regional versus canonical point contract

| Contract | Regional polygons, unchanged | Canonical point / weekly, unchanged |
| --- | --- | --- |
| Spatial input | Prepared 10/20 km sampling coordinate + habitat geometry | Actual requested point, not a cell centre |
| Time domain | Provider daily arrays; only Today/Tomorrow retained | UTC hourly instants → true Europe/Ljubljana calendar intervals |
| Today soil | Nearest provider-labelled hour | Unique preceding/as-of hour relative to validated provider current instant, <1 hour old |
| Future soil | Provider-labelled Tomorrow near 09:00 | Exact 09:00 Europe/Ljubljana for each target date |
| Completeness | Core inputs required; optional missing factors can yield a limited total under production semantics | All configured factors/windows, both native soil depths and coverage/provenance gates required for numeric publication |
| Freshness | Existing regional scheduler/cache policy | Frozen point snapshot, source retrieval times, exact-key TTL |
| Result meaning | Regional weather suitability with separate habitat/render state | Point-query model suitability; still not an on-site measurement or mushroom probability |

**An adapter migration will change some regional numbers even with unchanged weights.** V1.3 deliberately migrated individual locations, not regional polygons. A future `regional-civil-week-v1` must coexist with the old mode until input/score/label changes have been measured and approved. Existing regional goldens remain reference evidence, not something to regenerate into apparent parity.

## 3. National boundary and geographic scope

**MEASURED:** read the existing cached geoBoundaries geometry, verified SHA256 `9df0ad9979ff342ea79d11b046e0ed0d0b08763b6e618d54f7b37152768c92fe`, projected to EPSG:3035, intersected actual squares and unions. No national raster or stand import was performed.

The [current geoBoundaries metadata](https://www.geoboundaries.org/api/current/gbOpen/SVN/ADM0/) still identifies a **2009** Slovenia boundary, Public Domain underlying source, with geoBoundaries/Wikipedia attribution. The pinned geometry is suitable for a reproducible planning estimate, **not an exact current authoritative border**. Measured polygon area is **20,399.754 km²**; bbox `[13.377363726,45.419427129,16.597878433,46.883449076]`. This is not a replacement for the government's land-area definition ([GOV.SI](https://www.gov.si/podrocja/drzava-in-druzba/o-sloveniji/)).

For release prefer a dated **GURS Evidenca državne meje** export, validate polygon topology/land-water definition, pin checksum and re-run counts. [GURS](https://www.e-prostor.gov.si/podrocja/drzavna-meja/evidenca-drzavne-meje/) provides the graphical layer through JGP. Although the [OPSI catalogue](https://podatki.gov.si/dataset/evidenca-drzavne-meje) says its licence field is undefined, its linked [GURS general terms](https://www.e-prostor.gov.si/dostopi/javni-dostop/?acitem=1821-1822) explicitly permit commercial/noncommercial reuse under CC BY 4.0 with agency, data type and reference-date attribution. Resolve that provenance in the downloaded release manifest; do not infer licensing from free access alone. All pages checked **2026-10-18**.

Clip **rendered habitat geometry**, not meteorological support locations, at the national boundary. Of the requested sampling centres, **46/252 detail** and **28/78 overview** are outside the pinned polygon; global weather can support these clipped border cells. Do not draw foreign habitat, claim foreign ZGS coverage, treat sea as forest or silently move centres onto Slovenian land. Very small slivers may have no valid 10 m pixel centre; retain missing/omit according to the existing preparation rule, never assign zero vegetation.

WorldCover 2021 v200 land-cover map COGs at `N45E012` and `N45E015` cover this bbox. The existing bounded-row reader can be reused nationally; its source is land-cover classes, not RGB WMS. National ZGS acquisition requires complete paging, CRS checks, overlap/invalid-share validation and a pinned acquisition snapshot. One read-only WFS `resultType=hits` request on 2026-10-18 reported **350,457 records / 0 returned geometries** for the whole published `pregledovalnik:sestoji` layer. This is **not** a count of in-country valid stands, forest cells or suitable mushroom habitat; no raw stands were downloaded.

## 4. Grid, LOD and habitat counts

| Quantity | Current prepared region | Full pinned-country geometry |
| --- | ---: | ---: |
| Surface (projected polygon) | 10,224.214 km² | 20,399.754 km² |
| Detail cells, 1 km phase | 10,531 | **21,052** |
| Partial border detail cells | Not recounted separately | **1,294** |
| Overview units, existing 4 km grouping | 704 | **1,422** |
| Detail weather query coordinates | 126 | **252** |
| Overview weather query coordinates | 40 | **78** |
| Distinct coordinates across both weather grids | Not needed by current loader | **269** (61 overlaps) |
| Detail cell × date × profile entries | 84,248 for current 2×4 | **589,456** for 7×4 |
| Overview cell × date × profile entries | 5,632 for current 2×4 | **39,816** for 7×4 |
| Weather-only weekly profile evaluations | Current two-date path differs | 7,056 detail; 2,184 overview; **7,532 after exact-coordinate sharing** |

The grid algorithm reproduces the current **10,531** intersections as an assertion before reporting national values. Counts are from geometry, not land area divided by 1 km². The national estimate reuses the phase but represents full country-clipped cells, not the old AOI-clipped border IDs. A future geometry version needs stable row/column IDs plus dataset version; don't silently replace legacy shapes under old persisted IDs.

### Actual habitat filtering, not national extrapolation

| Profile | Current detail candidate / unknown / outside | Weather locations used by candidate cells | Current overview candidate / unknown / outside |
| --- | ---: | ---: | ---: |
| Splošno | 10,422 / 0 / 109 | 122 | 701 / 3 / 0 |
| Jesenski goban | 8,129 / 1,233 / 1,169 | 121 | 551 / 137 / 16 |
| Navadna lisička | 8,129 / 1,233 / 1,169 | 121 | 551 / 137 / 16 |
| Užitna sirovka | 3,869 / 5,493 / 1,169 | 111 | 184 / 504 / 16 |

There are **9,362** current cells meeting the existing ≥0.30 tree-cover rule. Candidate weather sets overlap the unknown/outside sets; their counts are not additive. The low candidate count for Lactarius is not a reason to discard unknown cells as biological absences.

**National post-habitat-filter counts are UNKNOWN**, explicitly `null` in the retained audit. National WorldCover fractions and ZGS host aggregates do not exist in the repository. Scaling the unusually wooded current region's percentages nationally would manufacture a result. Use all 21,052 cells / 269 weather locations as a conservative engineering envelope until actual import; candidate masking may save little weather because many candidate and unknown cells share the same weather coordinate.

Requested weather locations are not a count of independent native provider grid cells. Provider grid selection, model, variable and elevation downscaling can differ. Do not deduplicate exact-point requests solely because their returned grid centres coincide.

## 5. Seven-day regional scoring feasibility

**CODE:** all four profiles use the same production functions. Required complete windows are `[targetDate−N calendar days,targetDate)`, excluding the provisional target day:

| Profile | Rain / temperature | Canonical factor maxima |
| --- | --- | --- |
| Splošno | D7, D14, D30 / T20 | Rain 45, temperature 25, soil 20, drying 10 |
| Jesenski goban | D26 / T20 | Rain26 50, temperature 30, soil 15, drying 5 |
| Navadna lisička | D30, D7 / T14 | Rain30 40, rain7 10, temperature 25, soil 20, drying 5 |
| Užitna sirovka | D60, D14 / T20 | Rain60 35, rain14 10, soil 25, temperature 25, drying 5 |

Every complete weekly total also requires D7 and ET₀7 for drying and native 0–7 / 7–28 cm soil. Existing normalization is 0.12 baseline, 0.16 range, 40/60% depth weights; drying uses `max(ET₀7−D7,0)` and the existing 20 mm reference. These are audited dependencies, **not proposed tuning**. Partial production factor totals must not escape the stricter weekly publication gate as fully comparable scores.

The old regional scorer cannot safely be extended by passing a fake shifted base date: its `HeatmapTargetDay` is binary, its source drops days after +1, soil has only two stored roles, and provider daily bins are not proven civil-day equivalents. Reuse the validated point **weather-domain assembly** at each public weather coordinate, compute 7×4 weather vectors, then apply existing static habitat classifications/LOD fractions to many features. Create an explicit future regional result/date adapter; never present a sampling-centre result as the tapped exact point.

Reusable once per geography: clipping, land-cover fractions, ZGS aggregates, habitat states, LOD unions, IDs and tile geometry. Once per weather coordinate/snapshot/date: hourly coverage, complete rolling rain/temperature/ET₀ aggregates and soil lookup. Per profile/date: unchanged formula, requirements, factors and label. Per feature: cheap lookup/mask/presentation, **not another D60/hourly download**.

This replaces 589,456 detail feature evaluations with **7,056 weather evaluations + lookups**, an ~83.5× reduction relative to a deliberately naive per-feature evaluator. Existing code already shares weather across features; don't claim this entire reduction as a new improvement over current Regional V2. The real country-versus-current-region weather workload grows about 2× spatially and 3.5× temporally (7 versus 2 dates).

## 6. Weather source coverage, semantics and compatibility

The validated code already requests hourly **temperature_2m, precipitation, et0_fao_evapotranspiration**, plus future native **soil_moisture_0_to_7cm / soil_moisture_7_to_28cm** and current metadata. Older history is archive; the last seven pre-base days and future horizon use one forecast response. Whole UTC request margins preserve the final accumulation endpoint. Archive and recent/forecast own whole civil dates; no duplicated seam hours or cross-vintage gap filling.

**VERIFIED EXTERNAL:** [Forecast definitions](https://open-meteo.com/en/docs) distinguish instantaneous temperature from preceding-hour precipitation/ET₀ accumulations. [Historical documentation](https://open-meteo.com/en/docs/historical-weather-api) documents fixed-offset daily/ISO behavior and recommends Unix timestamps for DST-aware conversion. [ECMWF documentation](https://open-meteo.com/en/docs/ecmwf-api) lists the required original soil depths and native 9 km IFS; the generic model's 0–1 / 1–3 / 3–9 / 9–27 cm layers are not equivalent. Checked **2026-10-18**.

**CODE contract retained:** local midnight to next local midnight is resolved independently. Rain and ET₀ sum interval ends `(start,end]`; temperature averages valid hourly instants `[start,end)`. Spring 2026-03-29 has 23 hours, autumn 2026-10-25 has 25. Missing/repeated wall clocks are handled by actual UTC epochs. D60 is not reduced to graph history, missing/null is not zero, temperature mean is not synthesized from min/max, and future soil is neither interpolated across incompatible layers nor carried forward from Today. Provider-interpolated hourly model output is not labelled as independent hourly station measurement.

The [historical product matrix](https://open-meteo.com/en/docs/historical-weather-api) distinguishes ~9 km IFS, ~25 km ERA5 and ~11 km ERA5-Land, with different latency/variable coverage. The archive must not be assumed to contain yesterday. Keep the existing hybrid seam and validate each date's availability. The [forecast API](https://open-meteo.com/en/docs) documents terrain-aware grid selection/elevation downscaling; this is not evidence that a single 10 km sample resolves every valley and ridge inside it.

### Frozen publication versus actual model issuance

Current snapshots expose source **retrieval** and assembly timestamps; `forecastIssuedAt` is null. `best_match` may combine models, resolutions and successive updates. A common internal run ID does not prove a single provider initialization, nor does a country-wide sequence of requests automatically share one weather vintage.

Public generation should capture every source object/hash, retrieval interval, requested/returned coordinates, variable/unit/model policy, geometry/habitat/scorer/input versions and target dates before evaluating. Publish atomically; never mix old and new score columns across a map. Bound acquisition skew and retain a manifest stating whether provenance is operational best-match/as-of or genuinely provider-run-pinned. Don't invent `issuedAt`.

For stronger reproducibility, [Single Runs API](https://open-meteo.com/en/docs/single-runs-api) supports a UTC `run=` initialization and preserves a full individual run; IFS HRES documentation lists a 10-day horizon and four daily runs. Availability is later than initialization. [Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api) is instead a stitched timeseries; it is not interchangeable with a stored issued forecast. These products are viable **adapter candidates**, not verified drop-in replacements: original soil depths, current/as-of metadata, recent history and billing must be tested before changing any contract. This audit did not query a Single Run or claim run-level national parity.

Alternative sources: direct ECMWF/DWD ingestion/self-hosted Open-Meteo could improve control but adds GRIB ingestion, model-variable reconciliation, operations and licensing maintenance. A national ARSO integration would require documented variable/depth/horizon/redistribution/API contracts not established here. Neither is the lowest-risk MVP; no new source is recommended merely to avoid an API subscription.

## 7. Official terms, licensing and pricing checks

Verified **2026-10-18**, subject to provider changes; this is technical procurement guidance, not a legal guarantee:

| Source | Verified fact / release action |
| --- | --- |
| [Open-Meteo Terms](https://open-meteo.com/en/terms) | Free API is noncommercial only: <10,000 calls/day, 5,000/hour, 600/minute. Ads/subscriptions/commercial products require paid access. Provider troubleshooting logs can include query coordinates and are retained up to 90 days; don't promise zero provider logging. |
| [Open-Meteo Pricing](https://open-meteo.com/en/pricing) | Standard 1M / Professional 5M / Enterprise >50M monthly budgets; archive/historical and Single Runs require **Professional or higher**, not merely Standard. Multiple locations, periods >2 weeks, >10 variables and models affect call accounting. Batch HTTP count is not billable call count. |
| Open-Meteo price amount | Pricing cards are embedded via Stripe; this audit did **not** verify a currency amount. Obtain a current Professional/Enterprise quote, endpoint access and workload calculation; use `Q_prof` / `Q_enterprise` below, not an invented €29/€99 price. Do not base capacity on temporarily unenforced monthly cutoffs. |
| [Open-Meteo licence](https://open-meteo.com/en/licence) | API data CC BY 4.0 allow derived redistribution with attribution/link and indication of modification. API access terms still apply. Keep provider/model attribution. Self-hosting/forking server code has separate AGPL obligations; consuming its API does not itself require copying server code into the app. |
| [ESA WorldCover](https://esa-worldcover.org/en/data-access) | CC BY 4.0 with the specified year/modified-Copernicus attribution. 2021 v200 land cover is not current forest condition, ownership or permission to forage. |
| [ZGS public-information catalogue](https://www.zgs.si/informacije/informacije-javnega-znacaja/) | Mandatory source attribution; attribution-only reuse is exempt from the written reuse decision described there. No named CC licence asserted. Retain the particular WFS dataset/provenance and reconfirm national/commercial derivative redistribution and service-use conditions; public WFS is not an SLA. |
| Boundary | geoBoundaries planning source and GURS release-source terms are explained in §3; use one dated/checksummed policy per artifact, not a silent boundary swap. |
| [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) | Standard: $0.015/GB-month, $4.50/million Class A, $0.36/million Class B; 10 GB / 1M A / 10M B monthly included, no direct egress charge. Other services, Workers, domain, compute and taxes are separate. |

Caching/redistribution of attributed API-derived data is supported by the data licence; this audit found no basis to label forecasts as confidential provider property. However, termination/service-access conditions are not a promise of perpetual archived access. Preserve permitted frozen input evidence yourself for validation; review the paid contract and model-specific terms. Never ship a paid secret API key in the APK. Commercial exact-point acquisition needs a properly scoped proxy/credentials strategy, not only a new public tile host.

## 8. Bounded experiments actually executed

Retained machine-readable evidence:

- [Geometry and viewport counts](research/slovenia-heatmap-geometry-audit.json).
- [Offline CPU, JSON/gzip and heap measurements](research/slovenia-heatmap-performance-audit.json).
- [Six-public-location availability probe](research/slovenia-heatmap-live-six-audit.json).
- [Paired exact-point / 10 km sampling-centre probe](research/slovenia-heatmap-live-pairs-audit.json).

Scripts: `scripts/research/sloveniaHeatmapAudit.py` and `.ts`. Existing Python GIS venv (Python 3.14.7, Shapely 2.1.2, pyproj 3.7.2) and Node v24.21.0 / project TypeScript were used. No added mobile dependency, installation or production cache/database write. Temporary country geometry is audit-only and is not committed.

### Live acquisition and spatial impact

On **2026-10-18**, six public coordinates spanning Koroška, alpine Gorenjska, Pohorje, central Slovenia, Primorska and Kočevje/Dolenjska produced **168/168 ready** profile/date outcomes. Two batched HTTP requests delivered **246,851 decoded JSON bytes**; acquisition **382.993 ms**, scoring all profiles **102.498 ms**, warm reopen **0.253 ms / 0 extra HTTP**. These are Node/in-memory-SQLite service timings, not app selection-to-paint times or a latency promise. The previous task's multi-second API waits remain valid evidence of variability.

The paired probe used **11 unique public locations**: six points plus their 10 km centres, with Koroška's anchor also its centre. A single paired batch shares actual archive/forecast retrieval timestamps and canonical input policy. All **308 unique** profile/date outcomes were ready; logical pairs give 168 comparisons:

| Region | Changed scores / 28 pairs | Changed labels | Maximum absolute score difference | Maximum absolute T20 difference |
| --- | ---: | ---: | ---: | ---: |
| Koroška, identical anchor/centre | 0 | 0 | 0 | 0 °C |
| Alpine Gorenjska | 28 | 12 | **11** | 2.090 °C |
| Pohorje | 27 | 8 | **10** | **3.769 °C** |
| Central Slovenia | 20 | 0 | 3 | 0.828 °C |
| Primorska | 20 | 1 | 3 | 0.402 °C |
| Kočevje/Dolenjska | 24 | 0 | 3 | 0.724 °C |

Total **119/168** scores and **21/168** labels differed. Returned elevation metadata for the Pohorje pair were **1,221 versus 460 m**; Gorenjska **1,800 versus 2,170 m**. This demonstrates sampling sensitivity, not that elevation alone caused every difference. It is **not ground-truth error**, not a representative accuracy distribution and not a comparison with the old daily-bin regional model. It argues against calling 10 km weather a precise 1 km forecast or coarsening exact-point coordinates.

Paired acquisition **600.200 ms**, scoring **155.292 ms**, warm **1.333 ms / 0 extra HTTP**; decoded payload **453,086 B**. Both native soil layers had m³/m³ units. The provider's returned model-grid coordinates differ from requested point coordinates; canonical request identity still retains the latter.

**Total weather API traffic in this audit: six HTTP requests**: the six-point probe, one initial paired research run, and the corrected paired run (2 each; 6+11+11 location acquisitions). The initial paired script incorrectly assumed one returned snapshot per duplicate input; production intentionally deduplicates the anchor. It failed after acquisition, was fixed by exact-coordinate lookup, and was rerun. An earlier offline research assertion also caught omission of the lower D60 cutoff in the research comparison helper; it was corrected, not production code. No thousands-of-points probe or paid resource was used. One additional ZGS count-only request fetched no geometries.

### Serialization, memory and CPU

**MEASURED desktop**, medians over repeated passes, GC where available. Attributes below are explicitly synthetic compression stress values, not national forecasts or habitat evidence:

| Representation, 21,052 features | Raw JSON | gzip (Node default) | Parse median | Stringify median | Approximate new JS parse heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Geometry + IDs / query-reference props | 8.668 MB | 1.268 MB | 44.633 ms | 39.586 ms | 16.08 MB |
| Geometry + one synthetic selected score/status | 7.189 MB | 1.030 MB | 37.266 ms | 41.663 ms | 15.07 MB |
| Geometry + all 28 synthetic scores/statuses | 18.347 MB | 1.545 MB | 87.917 ms | 85.841 ms | 25.54 MB |

The one-selection example omits extra reference properties, hence being smaller than the first row. These exclude detailed ecological aggregates, native copies, tile buffers and GPU allocations. Gzip results are data-pattern/codec-sensitive; Python's separate compression measurement is not the same codec setting. The complete Node process heap (~222 MB during the audit) includes compiler, imported regional/pilot data, fixtures and benchmark objects; it is **not** measured phone RAM.

Two uint8 values per detail cell/date/profile require **1,178,912 B** uncompressed. The synthetic weather-shared pattern compressed to 11,440 B, which is **not a credible upper bound for real data**. At weather-vector level, 269×28×2 is only **15,064 B**, before IDs, dates, metadata and reasons. A date-to-visible-property join over all national features measured **6.455 ms** in Node, not native bridge/render latency.

Prebuilt synthetic hourly-source fixtures, production adapters/scorers: one location's adaptation median **15.451 ms**; four profiles × seven dates **13.513 ms**. Linear scaling to 269 locations suggests **7.791 CPU seconds** for those two phases on this host, excluding IO, tile encoding and publication. It is not a server SLA or Android projection. One serialized canonical snapshot was **63,476 B**, its full 28 result objects **484,349 B**: ~147 MB of snapshot+result JSON across 269 locations, before JS/native object expansion. A client should receive compact public vectors/tiles, not that full graph for every sample.

The same existing historical aggregation function repeated 4× per target took **33.218 ms** for 32 synthetic locations; computing it once per target and sharing the result took **7.645 ms** (896 → 224 assemblies; outputs checked equal). This is a non-production sharing experiment, **not** permission to bypass profile-specific completeness checks or change floating-point summation order. 4,000 cached profile-result lookups took **0.263 ms**.

No MVT encoder/PMTiles archive was generated, so MVT byte sizes, native paint-update latency, date-switch FPS and GPU memory are **unmeasured**.

## 9. Spatial batching, cache and update design

**PROPOSAL:** preserve 1 km habitat / 10 km weather and 4 km overview / 20 km weather initially, but version both identities. The 269 coordinate union shares identical queries across LODs; don't merge different coordinates just because they are near each other. Compare altitude-stratified residuals before considering 20/25 km detail weather or adding elevation bands. Additional bands increase weather demand; do not assign arbitrary lapse-rate/soil adjustments in display code.

Current point transport groups ≤16: 252 detail locations imply **32 cold HTTP**; 78 overview **10**; shared union 269 **34**, rather than summing 42. This is an engineering batch size, not an official maximum. Provider work/call units still scale by locations/time/models. National server batches should be bounded, retryable, concurrency-limited and quota-aware, not launched as 269 independent requests.

Current regional loader is different: detail batch 25, overview batch 40 only when the **entire requested set is ≤40**, one batch in flight, 2 s start spacing and 75 locations/minute budget. A national 78-point overview would fail that current overview predicate and use 25-point batching; don't extrapolate the current 40-point success as a guaranteed national four-request load. In either case its rate scheduler is a development safeguard, not a licensed server ingestion plan.

Public pipeline cache tiers:

1. **Static geography/habitat**, checksum/version-addressed; prepare once per source update, never on gestures.
2. **Hourly source store**, exact weather query policy, variable/unit set, resolution, interval range, retrieval/run provenance. Keep D60 + margins and correction history; don't mix old daily/fixed-offset derived rows.
3. **Derived weather/date vectors**, one frozen source set → 7 dates × 4 profiles; share intermediate rollups, retain per-profile gates and canonical factors.
4. **Published immutable run**, geometry/model/input-policy versions + absolute local dates + source manifest + scores/statuses/coverage; checksums and atomic latest pointer.
5. **Client tile/vector cache**, bounded bytes/LRU; latest pointer short revalidation, immutable run resources long-cache; support stale-but-explicit prior run and absolute-date checks at midnight.

Start at **four publications/day** as a planning cadence, aligned after provider updates, not every pan or every app launch. A 6-hour public publication is not as fresh as a 30-minute point cache; label both timestamps and never assert equal snapshots. Keep previous valid publication if a new run fails validation; mark aged/unsupported dates, never silently fill them with zero. Incremental historical ingestion is an optimization only after stable-source/correction policies are tested; the existing app refetches the full keyed archive window and must not be described as already incremental.

## 10. Candidate architectures and decision matrix

Ratings are engineering judgments about a correctly implemented design, not measured outcomes. H = favourable/high capability; M = tradeoff; L = poor. Effort/maintenance are stated separately to avoid reversing the scale.

| Criterion | A: all on device | B: viewport weather/compute | C: independent precomputed date/profile layers | D: hybrid shared precomputed layers + exact point |
| --- | --- | --- | --- | --- |
| Correctness/provenance control | M, many user vintages | M, neighbouring viewport vintages | H if atomic generation | H if versioned and point/region clearly separate |
| API economics | L, per user | M, per user/view | H, central run | H, central run + bounded private point misses |
| First usable map latency | L cold | M, can stall on pan | H cached/CDN | H cached/CDN |
| Redmi CPU/RAM/battery | L | M | H with tiles; L if full GeoJSON | H with bounded native tiles |
| Offline | H after large acquisition, costly | M, visited views only | H for explicitly downloaded packs | H for downloaded public packs + local point cache |
| Scale with users | L | M | H | H |
| Operational maintenance | Low backend / high client complexity | Medium | Medium | Medium-high initially |
| Privacy | Coordinates already sent to weather provider | More browsing-related weather queries | Public grid only | Public grid separate from explicit point requests |
| Extensibility | M | M | M, repeated layer sets | H, shared geography/time delivery with separate models |
| Development effort | Medium but poor product fit | Low-medium reuse, later ceiling | Medium | Medium-high; phase delivery, don't build every option |

**A — fully on-device:** ~269 sources, ~11 MB decoded initial weather (sample-based scale), ~147 MB serialized full forecast objects before object expansion, plus geography. Current 128-entry point retention does not fit all locations. Battery, JS contention, refreshes and per-user API accounting dominate. Offline only becomes useful after a large successful acquisition. Reject as the national product default; a bounded personal prototype remains possible.

**B — viewport on demand:** current code already approximates this approach. Typical detail view needs ~6–42 weather locations in the tested zoom scenarios, not one per feature. Cold acquisition can fit one to three point-service groups but follows panning and shares only within each phone/session/cache. Native responsiveness remains network-sensitive; geography/habitat quality is not solved. Useful low-infrastructure pilot, not preferred for repeated national exploration by thousands of users.

**C — 28 independent precomputed layers:** centralized source acquisition, clear dataset versions and easy CDN delivery. Static GeoJSON is simple for a small overview, but duplicating detail geometry into 28 selections costs ~201 MB raw / ~28.8 MB gzip per run using the synthetic one-layer example, excluding overview and tile duplication. Separate vector tilesets reduce delivered visible data but each date/profile can cause new tile traffic. Operationally viable; unnecessary repeated geometry and cold selection traffic make it less attractive than D.

**D — recommended hybrid:** central, versioned national weather + habitat publication; one per-run tiled geometry carrying all 28 compact scores/statuses (or shared geometry with a small weather-vector sidecar if native tests favour it). Fetch only overview and visible detail. Date/profile paint expressions select existing attributes; don't mount 28 sources/layers or replace all country GeoJSON. Exact-point forecasts remain the existing canonical on-demand workflow, with their own freshness and safety gates. No multi-location private ranking or public hotspot store is introduced.

**Best low-cost fallback:** precomputed overview-only public snapshots, existing bounded region and exact-point forecast. If the commercial provider budget is unavailable, stay a genuinely noncommercial prototype or retain current scope; hiding national calculations inside viewport requests does not remove access-term obligations.

## 11. Recommended data flow and implementation contract

```text
Pinned country/grid + WorldCover + validated ZGS aggregates
                    -> versioned static habitat and LOD geometry

Public sampling coordinates -> licensed weather ingestion -> frozen source manifest
                           -> civil hourly validation -> shared date rollups
                           -> unchanged 4 profile scorers x 7 dates
                           -> numeric-or-unavailable vectors + factors/provenance

Static geometry + public vectors -> immutable per-run tiles / small overview pack
                                -> object storage/CDN -> native visible map tiles

Explicit actual tap/private hotspot -> existing canonical point weather/scoring
                                   -> compact/full 7-day detail, local private state
                                   (NOT an input to public tiles or regional training)
```

Proposed manifest fields: schema/run ID (artifact generation, not fabricated model issuance); geometry/habitat versions and checksums; scoring profile/config identifiers; input-policy version; timezone; base/target absolute local dates; archive/forecast source hashes and retrieval range; verified provider run IDs if actually available; completeness/status schema; generated/published times; attribution; content checksums/URLs and expiration/stale policy. The cell table uses public grid IDs; a separate weather-vector table avoids repeating canonical explanation objects per habitat polygon.

Retain validated missing-data reasons/coverage in the downloadable manifest or a compact indexed detail resource. Score `null`/explicit availability state is distinct from genuine 0, outside habitat and unknown habitat. Any integer encoding must preserve the actual canonical displayed precision or carry a lossless companion; don't round component data just to match a colour.

Public data can be decoded/rendered independently of login. A future paid exact-point proxy should accept coordinates + required source parameters only, authenticate/rate-limit, redact query logs and avoid persistent user-linked location histories. Private IDs/names/notes never belong in weather URLs or public manifests.

## 12. MapLibre and Android delivery feasibility

**CODE:** installed MapLibre React Native **11.3.10** supports `VectorSource` `url`/`tiles`, `minzoom`/`maxzoom` and native `Layer` paint expressions. The [v11 migration guide](https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/) confirms these names; old `tileUrlTemplates` examples are not the current API. Current GeoJSONSource stringifies object data, which the app already avoids with its serialized visual cache.

Standard HTTPS **XYZ MVT + TileJSON** is the lowest-risk new delivery contract. PMTiles is useful as a build/storage archive, but the [PMTiles MapLibre integration](https://docs.protomaps.com/pmtiles/maplibre) describes **GL JS** `addProtocol`, not proof of direct support in this installed native wrapper. No PMTiles adapter was found in installed RN source. Use a tested HTTP tile gateway/export or prove native integration first; do not promise `npm install pmtiles` solves Android. [Range/CORS hosting requirements](https://docs.protomaps.com/pmtiles/cloud-storage) also need validation if archive range delivery is chosen.

| Delivery | Advantage | Main cost/risk |
| --- | --- | --- |
| Full national GeoJSON per selection | Smallest backend implementation | Full parse/source replacement, repeated geometry and client cache memory |
| Static geometry shards + compact vectors | Low-cost bridge from current code, geometry downloaded once | JS join/serialization on date changes unless already resident attributes; shard edges/cache bounds need tests |
| All-28-attribute vector tiles | Native visible-region decoding, geometry reused for date/profile paint changes | Encoder/tile buffers, source-layer/schema, attribute size and native cache behavior not yet measured |
| Separate selection tilesets | Simple per-layer resources | New date/profile causes more tile requests/cache churn |
| PMTiles archive | Few storage objects, versioned immutable artifact | Native protocol/gateway proof and range-cache behavior required |

### Visible-feature envelope, not claimed phone measurements

Geometry intersections for six public contexts, **assumed 360×480 dp map**, 512-pixel tile convention and Mercator latitude scale:

| Zoom / requested LOD | Visible detail cells | Detail with existing 20% overscan | Visible overview cells |
| --- | ---: | ---: | ---: |
| z6 / overview | 18,858–21,052, but must NOT load as detail | Full country if incorrectly selected | **1,271–1,422** |
| z9.2 / entering detail | **1,136–1,530** | **1,989–2,961** | 90–120 |
| z10.5 / detail | 266–285 | 457–540 | 23–30 |
| z12 / detail | 35–42 | 63–80 | 4–9 |

A separate fixed 15×22 km test yielded 357–368 visible and 617–704 buffered cells, 12–20 weather queries. These are geometry/camera simulations, not recorded Redmi bounds. The ~3,000-cell threshold case matters more than testing only a close-up 400-cell view. Preserve hysteresis/readiness and test tile-boundary buffers, not just feature count.

**ESTIMATED initial targets:** ≤0.5 MB compressed overview; ≤1 MB incremental visible detail per ordinary view; 2–8 MB compressed bounded public forecast pack/session, not a measured MVT size. A planning 8 MB artifact ×4/day×30 days is 0.96 GB before replica/retention overhead. The measured all-country JSON shows an engineering upper-bound alternative, not a final tile-archive size. Don't multiply compressed wire size by an arbitrary constant and call it measured RAM.

With all date/profile attributes already loaded, a switch should require **0 weather HTTP / 0 new geometry**, only native style selection. Source URLs change only on a coherent new run/geometry version, not a local date tap. Panning may fetch missing **tiles**, not run weather/scoring. Offline coverage must be explicit: previously cached tiles are not a promise of a complete country pack. Test native offline APIs/disk limits in the selected tile contract.

**Redmi verdict:** plausibly supports bounded tiled delivery, **not demonstrated**. Gate A2 on release/profileable build measurements: warm selection p95 <150 ms; no map remount/camera reset; bounded memory/no monotonic growth after 100 switches and a pan tour; PSS increment target ≤100 MB over the current map baseline; frame/jank/thermal checks at the device's actual refresh rate. These are proposed acceptance goals, not achieved results. Follow [Android performance measurement guidance](https://developer.android.com/topic/performance/measuring-performance) (also inspected through `android-cli`), using Perfetto/system traces, native frame metrics and heap/PSS, not desktop JS timing as FPS evidence.

## 13. Capacity and cost scenarios

All financial scenarios are **estimates**, excluding tax, labour, app stores, basemap service costs and production security/monitoring. MB/GB are decimal. Let `Q_prof` be a verified Professional subscription quote, `Q_enterprise` a higher-volume quote. Neither amount was verified here.

A cold source pair requests about **54 UTC archive dates + 15 UTC recent/forecast dates**, <10 variables per endpoint, one requested model policy. Applying the documented fractional-call example gives a provisional **K = 54/14 + 15/14 ≈4.93 billed units/location**, not 2. Confirm actual best-match/current-variable/model accounting with the provider. Thus a 269-location cold national refresh is **34 HTTP but ~1,326 provisional call units**, independent of 7×4 local evaluations.

| Scenario and explicit assumptions | Central weather | Extra exact-point demand | Provider volume estimate / month | Delivery and infrastructure planning allowance |
| --- | --- | --- | ---: | --- |
| Personal: 10 testers, 4 sessions/user/month, 2 cold points/session, 1 national refresh/day | ~39.8k units/month; 1,020 HTTP | 80 cold points ≈394 units; 160 HTTP | **~0.040M units** | 40 sessions ×2–8 MB = 0.08–0.32 GB; €0–20/month excluding provider, genuinely noncommercial only |
| Beta: 500 users, 10 sessions/month, 2 cold points/session, 4 national refreshes/day | ~159.1k units; 4,080 HTTP | 10,000 cold points ≈49.3k units; 20,000 HTTP | **~0.208M units** | 5,000 sessions ×2–8 MB = 10–40 GB; **Q_prof + €10–40/month** allowance |
| Broader: 10,000 active users, 12 sessions/month, 3 cold points/session, same public cadence | Same ~159.1k units; public cost does not multiply by users | 360,000 cold points ≈1.774M units; 720,000 HTTP | **~1.933M units** | 120,000 sessions ×2–8 MB = 240–960 GB; **Q_prof + €20–100/month** allowance, depending on chosen compute/proxy/CDN |

The allowances are **not vendor quotations** or evidence that an arbitrary hosting stack is free. R2's verified included storage/operation tiers could cover modest public tile traffic; e.g. 120k sessions×50 reads =6M object reads before cache hits. Workers/proxy/cron/domains and abuse/retries still cost separately. Model 50–95% CDN hit ratios as scenarios, not measurements: 6M logical reads then become 3M–0.3M origin reads. Caching removes repeated bytes/provider work but not all client requests.

If 10,000 clients independently downloaded all 269 weather locations once monthly (A), weather consumption alone would be ~**13.26M units**, versus ~0.159M for four centralized daily refreshes. At 120k whole-country sessions it would be ~159M units. B with 20 cold viewport locations in each of 120k sessions is ~11.83M units before pan reuse. These are deliberately stated cache-miss assumptions, not forecasts of actual users. Exact-point demand still grows with users under D and can exceed the Professional budget; rate limits and a product budget are necessary.

An incremental-history design could append one archive day/location/day and fetch the 15-date forecast source four times/day: roughly **42.7k units/month** for the public grid after bootstrap versus 159.1k full cold-window units. This assumes one minimum billable archive unit/location for the small append and stable correction semantics; neither optimization nor billing is implemented. Don't sacrifice as-of history/revision reproducibility to meet that figure.

At the measured per-location payload scale, a full refresh is ~**11.0 MB decoded**; four full-window publications/day over 30 days are therefore ~**1.3 GB/month decoded input**, excluding retries/retention. The forecast-only portion of an incremental-history design would be ~0.4 GB/month plus history appends; that optimization is not implemented. A linear synthetic CPU estimate is ~8 s/run; propose a **≤2-minute compute/encode budget excluding network**, and ≤5-minute end-to-end publication under the chosen paid provider contract. Tile encoding and cold country acquisition latency are unmeasured. Free-tier pacing alone makes a ~1,326-unit burst inappropriate in one minute; current app location budgets are not exact provider-unit budgets.

## 14. Scientific validity and validation plan

| Dimension | Established here | Not established |
| --- | --- | --- |
| Software correctness | Existing numeric regressions, coverage/parity gates, exact/date identities | No new regional adapter has been implemented |
| Data completeness | Six contexts / 11 unique public samples currently support the required variables | Country-wide all-hour/all-season completeness or model-run uniformity |
| Spatial resolution | Actual 1/4 km habitat grid and 10/20 km query sharing; measured point/centre sensitivity | Independent information in each coloured 1 km cell |
| Ecological validity | Transparent code dependencies and positive host evidence | Calibrated national mushroom-occurrence relationship |
| Predictive usefulness | Weather-driven scores vary across regions/dates/profiles | Ability to improve foraging outcomes or predict harvest |

The numerical model uses rain, rolling temperature, soil and drying. Habitat controls whether a score is presented as candidate/unknown/outside; it does not quantitatively change the score. Explicit elevation, slope, aspect, substrate, access rights and phenological stage are not factors in the current formulas. Provider orography influences weather, but that is not a calibrated mountain ecological model. Season notes in profile metadata are not an independently implemented seasonal growth model. Neighbouring candidate cells sharing weather can have identical scores; do not add visual noise to disguise this.

WorldCover 2021, incomplete/invalid stand composition, stand-wide growing-stock shares rather than tree micro-location, broad host groups and common weather vectors all limit apparent precision. Candidate is positive evidence, unknown is not biological absence, and outside this heuristic model is not proof that mushrooms cannot exist. No finding-probability percentages, confidence percentages or harvest quantities should be inferred from 0–100.

Proposed field validation: opt-in, time-frozen predictions; standardized effort/species/date/habitat reporting including unsuccessful visits; independent identification checks where possible; geographically blocked and season/year-held-out evaluation. Compare relative suitability ordering, forecast stability and usefulness separately from precipitation/temperature/soil forecast error. Private visit logs are biased toward chosen/favourable locations and do not currently establish standardized absence/effort; don't train a presence predictor by treating missing visits as zeros.

Exact private coordinates remain on-device by default. Any validation export must be separately consented, minimize location precision, suppress sparse/cohort-identifiable aggregates and specify retention/deletion. No upload is authorized or implemented by this audit. Preserve the forecast actually available at decision time; later reanalysis or a newer forecast is not evidence that the original model knew those values. At least a representative fruiting season, preferably independent seasons, is needed before stronger product claims.

## 15. Future national date-selection UX/state proposal

One compact map date selector controls **Today…+6** as absolute Ljubljana dates, alongside the active profile. National overview → zoom detail → actual tap → canonical point details → optional private save. Show selected date and publication age, unknown/stale hatch/neutral states, and “regional approximation” separately from point-query precision. Do not add another global day selector in the point panel or a permanent technical paragraph over the map.

Proposed state identities: `category/profile`, `regionalTargetLocalDate`, `selectedPoint{coordinates,origin,optionalPrivateId}`, `pointDetailDate` (local exploration), `mapMode`, and `publication{runId,geometryVersion,inputPolicy,sourceAge}`. The point date initially follows the map's absolute selected date; full-screen point exploration can remain local with an explicit date label and no hidden global mutation. On return the map retains its date/camera; don't silently recolour the country because a local point day changed.

Existing Today/Tomorrow hotspot ranking and Top 3 are **not seven-day ranking**. Future shared state migration must explicitly reject/hide unsupported future badge/ranking dates or retain a clearly labelled Today/Tomorrow ranking context; never clamp Sunday to Tomorrow or display a Today's marker score as Sunday's. Private marker identity and saving remain available. At midnight re-resolve absolute dates against the new manifest; if a previously selected date is still valid, retain it, otherwise visibly choose a valid date. Preserve map camera, search/list context, Top 3 origin and generation guards.

## 16. Extending to other foraging categories

Share geography, source ingestion, UTC/civil-day validation, versioned snapshot envelopes, generic tile delivery, cache mechanics and explicit location/date UX. Keep profile-specific requirements, habitat rules, formula/config versions, seasonal/phenological logic, calibration, explanations and availability separate.

A minimal registry can declare `{categoryId,profileId,modelVersion,inputRequirements,habitatPolicy,evaluateCanonical,explain}`. Do not refactor the whole app into a speculative framework first. Mushroom V1 can produce the first manifest with an explicit model-family field. Chestnuts/blueberries later need their own evidence, fruiting/ripening inputs and validation; renaming mushroom scores or reusing its four factor weights would not be a valid model. No placeholder scores were created.

## 17. Privacy and public-data boundary

Public national datasets contain only fixed public grid/habitat/weather aggregates and version metadata. Publisher jobs must not read a user's hotspot/visit database, names, notes or exact saved coordinates. No cloud-sharing/schema change is needed.

Explicit point requests still disclose the coordinates necessary to the existing weather provider. A commercial proxy must not turn that into persistent user-location analytics; redact or minimize logs, don't send private labels/IDs, and describe actual provider retention rather than claiming absolute anonymity. Public tile/cache keys contain no private identities; users browsing the same public cell receive the same public artifact. Visits remain immutable/private under their recorded policy/version.

## 18. Phased migration and go/no-go gates

Effort estimates assume one developer familiar with this repo, exclude procurement/fieldwork and are not commitments.

| Stage | Deliverables / dependencies | Main risks and tests | Performance / decision gate | Rough effort |
| --- | --- | --- | --- | --- |
| A1: Koroška date-aware data prototype | Existing ≤700 detail cells / ≤13 weather coordinates, 7×4 vectors, versioned regional adapter/manifest; static habitat unchanged | Compare raw inputs/factors with canonical weather-coordinate results; measure old regional Today/Tomorrow deltas; DST/missing/native-soil/vintage tests | All valid equal-input vectors agree; unavailable remains null; ≤2 cold batched HTTP for 13 locations, 0 date/profile requests; no production mode switch | 3–5 engineering days |
| A2: bounded native delivery proof | Research/dev-only comparison of sharded GeoJSON versus all-28-attribute MVT; real Redmi profileable build | Tile seams/selection, 100 switches, native Back/camera/large fonts/offline; no PMTiles assumption | Meet §12 goals; choose the simpler format that actually passes; if neither passes, reduce LOD/coverage, not data gates | 3–5 days; timebox A to ~2 weeks |
| B: six-context pilot | Alpine/continental/coastal/forest samples; actual masks and versioned sources, provider access/quote | Point/centre sensitivity, altitude strata, grid seams, 23/25-hour windows, partial runs, regional policy-impact approval | Coherent provenance and honest map labels; paid access budget/keys settled; tile/session byte targets met | 1–3 weeks |
| C: country rollout | Authoritative boundary export/checksum, complete national WorldCover/ZGS, final counts, scheduled licensed publisher/CDN, atomic manifests and bounded packs | Full coverage/no foreign geometry, current-vs-new policy report, cache invalidation/midnight/retries/rollback; phone endurance | Actual national counts/availability published; no unresolved numeric gates bypassed; cost budget and native acceptance pass; limited beta labelled experimental | 2–4 weeks |
| D: usefulness validation | Consent-based standardized observations, frozen issued/as-of artifacts, held-out region/season design | Selection bias, species ID, absence/effort, weather versus ecological skill | No stronger claims until field evidence; revise profiles only in a separate versioned model task | At least a relevant season; ongoing |
| E: other categories | Explicitly specified chestnut/berry models using established ingestion/delivery | Phenology and habitat cannot be borrowed blindly | Independent model/readiness review; no fake scores | Separate research scope, not estimated as trivial reuse |

**Postpone national release** if source availability/soil compatibility fails, regional Today/Tomorrow policy changes cannot be explained, no suitable provider plan/redistribution basis is secured, national habitat is not actually prepared, run identities are misleading, or Redmi native budgets fail. The next fallback is a truthful overview-only/point product, not seven filled colour layers.

## 19. Exact next implementation task / next Codex prompt

Recommended **FIRST milestone: Regional Seven-Day Data Prototype V1 — Koroška**, not national deployment.

> Implement a research-only date-aware regional forecast adapter for one existing Koroška viewport (maximum 700 existing detail features and 13 existing public weather coordinates). Reuse `withCivilHourlyWeather`, the validated input builder and unchanged production scorers; evaluate each weather coordinate once for all seven dates/four profiles, then join the existing habitat states. Produce a versioned `regional-civil-week-v1` manifest, compact score/status vectors and an isolated fixture. Preserve every missing-data/depth/coverage/vintage gate. Compare Today/Tomorrow inputs, factor contributions, labels and totals with the legacy regional path and report differences without changing its golden baseline. Add DST, D60, seam, no-future-leakage, duplicate/partial and cache/batching tests. Source acquisition must be bounded/deduplicated, at most one archive+forecast pair for ≤13 cold locations, no requests for date/profile changes. Do not alter the shipped map UI, global day controls, canonical point contract, WeatherGraphs, private snapshots, production assets or backend deployment. Prepare the small geometry/attribute fixture and acceptance measurements needed for a separate Redmi MVT-versus-GeoJSON proof. Run TypeScript, relevant suites and existing 84,248/15,688 comparisons; document the new regional policy and explicit publication gates. Stop at a usable bounded artifact and a GO/NO-GO review, not a nationwide feature flag.

A1's API pair is a HTTP count, not a commercial free-use claim. Accept this milestone only if it produces reproducible canonical inputs and a measured regional impact report; do not add national date controls before that gate. A2 then tests real rendering, instead of assuming desktop serialization proves Android readiness.

## 20. Verification, reproducibility and unchanged runtime

Executed successfully on 2026-10-18: TypeScript and **all 48 root deterministic smoke/regression suites**, including regional/LOD/point/seven-day/cache/navigation/hotspot/Top 3 tests. Actual unchanged regressions: **84,248 regional**, **15,688 pilot**; existing **2,400 soil-sampler comparisons** also passed. No production baseline was regenerated. The research-only failure/corrections and actual API budget are disclosed in §8. A subsequent TypeScript review caught three implicit callback types introduced in the research live-pair addition; the point array now has an explicit coordinate type, with final verification rerun before commit.

Reproduce from repository root; use the existing GIS environment/dependencies. The ignored cached pinned boundary is required. If absent, the existing `prepare_regional.py` **without `--build`** obtains the checksum-pinned boundary and writes only its ignored dry-run cache; do not run national WorldCover/ZGS preparation as part of this audit.

```powershell
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/research/sloveniaHeatmapAudit.py --output docs/research/slovenia-heatmap-geometry-audit.json --fixture docs/research/slovenia-geometry-audit.tmp.json
node --expose-gc scripts/runSmoke.cjs scripts/research/sloveniaHeatmapAudit.ts --save
# Explicit optional network probes, each hard-capped at two batched weather HTTP requests:
node scripts/runSmoke.cjs scripts/research/sloveniaHeatmapAudit.ts --live-six --save
node scripts/runSmoke.cjs scripts/research/sloveniaHeatmapAudit.ts --live-pairs --save
npx tsc --noEmit
# All existing root deterministic suites, excluding opt-in live tests:
Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' |
  Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
```

The complete suite loop was actually executed. Geometry outputs are count/measurement reports; temporary full-country geometry is removed after benchmarking and excluded from the commit. No new production data file or native layer exists. Future runs change live scores/timings; measurement JSON records the audit evidence, not a golden forecast.

Android inspection used the available `android-cli` guidance/documentation only. No attached-phone journey, GPU/PSS/FPS/TalkBack measurement or national tile decoding was performed. APK intentionally **not built** for this audit-only change.

## 21. Added files and final readiness checklist

Added only this document, two isolated research scripts, and four small JSON evidence reports under `docs/research/`. All measurements, synthetic/real distinctions, API/licence URLs and verification dates are recorded above. Existing `src/`, native project, weather queries/cache, model weights, stored visits, navigation, generated production assets and regression references remain byte-unchanged.

Final recommendation: **CONDITIONAL GO — Option D**, **GO for A1 now**, **NO-GO for an immediate national release**. Remaining explicit gates are authoritative boundary/import counts, versioned regional weather-policy migration, national source/run provenance, provider quote/key/usage design, native tile-format/performance proof and ecological validation/product-claim discipline. The country is small enough for a modest precomputed platform; that is not evidence that a phone should acquire/evaluate it repeatedly or that existing scores already predict mushrooms.
