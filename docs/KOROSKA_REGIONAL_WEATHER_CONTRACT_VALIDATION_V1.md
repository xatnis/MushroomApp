# Koroška Regional Weather-Contract Impact Validation V1

Research date: **2026-10-18**. Starting branch/commit: `main`, `877317e3c1a22f3598172bcae63c911639e41d2b`; starting tree clean. This study adds isolated research code, public-provider replay evidence and documentation only. No production weather/scorer/cache, geometry, MapScreen, MapLibre, LOD, navigation, database, visit snapshot or golden baseline was changed. No APK or native Android verification.

## 1. Executive summary and decision

**COMPLETE for the bounded observational impact investigation; CONDITIONAL GO for further validation, not for a production switchover. Recommended strategy: C — dual contract / non-public shadow mode.**

Four authentic, batched API responses cover **11 public weather coordinates × two dates (18–19 October 2026) × four profiles = 88 complete comparisons**. Both paths invoke the unchanged production regional scorers. All 88 return numeric weather scores, but **0/88 have exact full raw-input equality**. Scores are equal in **84/88**, differ in **4/88** (three +1, one −1), with **one weather-level category change**. Equivalent soil values and instants match in all 22 coordinate/date pairs in this capture.

Mapped through the existing habitat masks to **696 existing cells**, there are **4,776 eligible numeric cell/profile/date cases: 4,591 unchanged, 185 changed, 94 category changes, maximum absolute score difference 1**. Another 792 cases remain habitat-unknown/outside-model, not numeric zero. These are dependent copies of shared weather assessments, not thousands of independent weather measurements.

The observed score changes are reproduced by substituting only the actual hourly-derived historical temperature/ET₀ inputs into the actual legacy scorer summary. Changing only soil sampling within the same daily-product response changes none of these scores. This isolates the affected inputs/formula response, **not the provider's undocumented model-run or internal precision algorithm**. Neither response exposes a verified model/run identifier. The comparison is observational, not same-run controlled parity. Live provider DST parity remains unverified.

## 2. Why reconstruction-only parity was insufficient

The earlier [prototype](KOROSKA_SEVEN_DAY_REGIONAL_PROTOTYPE_V1.md) reconstructed legacy daily intervals from its hourly snapshot. Its 88/88 score equality and 44 differing Today sampling instants were useful controls, not a comparison with independently returned daily API products. Its synthetic 16/88 differences and one category change were also explicitly synthetic.

This study keeps those earlier results intact and acquires **actual daily archive and recent/forecast responses through `getHeatmapWeatherBatch`**, alongside actual hourly responses through the existing canonical hourly acquisition path. Primary daily values are never synthesized from hourly values. The new capture is later than the earlier experiment; differing counts between studies are not a regression or a claim of equivalent weather vintages.

## 3. Authentic capture and production-path invocation

`scripts/research/koroskaContractCapture.ts` observes transport around the **actual production** `src/services/weather.ts:getHeatmapWeatherBatch`; its production URLs, variables, caching and daily parsing are not replaced with an approximate adapter. A separate concurrent call uses the existing research capture wrapper over `sevenDayHourlyWeather` and its production request plan/cache helper. Both use an ephemeral in-memory DB, not a user's SQLite database.

The old public hourly evidence was inspected first: it had no paired authentic daily responses and was roughly eight hours older. Reusing it would increase vintage ambiguity, so one fresh four-request capture was used. Hard cap: four distinct products, eleven exact public query coordinates, approved Open-Meteo hosts only, no credentials, no retry. All four returned HTTP 200. Subsequent analyses/tests make **zero external HTTP requests**.

Capture window: **2026-10-18T20:09:17.957Z–20:09:18.364Z** (22:09 Europe/Ljubljana). Retrieval skew is **134 ms**:

| Path/product | Endpoint | Retrieved UTC | Actual coverage per coordinate |
| --- | --- | --- | --- |
| Legacy daily archive | `archive-api.open-meteo.com/v1/archive` | 20:09:18.360 | 53 daily dates, Aug 19–Oct 10 |
| Legacy daily forecast | `api.open-meteo.com/v1/forecast` | 20:09:18.226 | 14 daily dates, Oct 11–24; 336 hourly soil labels |
| Canonical hourly archive | `archive-api.open-meteo.com/v1/archive` | 20:09:18.350 | 1,296 UTC hours, Aug 18–Oct 10 |
| Canonical hourly forecast | `api.open-meteo.com/v1/forecast` | 20:09:18.300 | 360 UTC hours, Oct 10–24 |

Daily variables are the production list: temperature min/max/mean, precipitation sum, ET₀ and weather code; forecast additionally requests current temperature/weather code and native hourly soil layers. Hourly archive requests temperature, precipitation and ET₀; forecast adds both native soil layers and current temperature/weather code. Hourly requests explicitly use `GMT`, Unix timestamps, Celsius/mm and forecast hourly resolution. Full query URLs, response units, axes and metadata are retained in the capture/report, not guessed from these summaries.

Offline daily replay seeds the **original production cache keys, fetchedAt and expiry** with the authentic parsed payloads, then calls the same production batch adapter and `assessHeatmapWeather`. Replay temporarily restores the recorded clock/timezone and restores process globals afterward; it does not renew TTL or present the old artifact as a fresh forecast. The canonical replay calls the unchanged civil-hourly adapter, input builder and scorer through the existing research prototype. Integrity checks reject altered payload hashes, mismatched hourly snapshot timestamps, wrong coordinates or dates. Failed captures remain failures; tests do not substitute synthetic success for live errors.

## 4. Vintage, metadata and spatial comparability

Both daily products return `Europe/Ljubljana`, fixed `utc_offset_seconds=7200`, ISO local labels. Both hourly products return `GMT`, offset 0 and Unix epochs. Provider current timestamps agree at **2026-10-18T20:00:00Z = 22:00 local**, with current interval 900 seconds. That timestamp is a represented current instant, **not model initialization**.

No explicit `models` parameter was supplied, matching the existing default/best-match acquisition policies. Returned model/run identifiers are absent; `verifiedModelRunTime` is null. HTTP `Date`, `generationtime_ms`, retrieval time and current time do not establish a forecast issue time. Close retrieval and matching grids are not evidence of identical underlying model runs. API/source/model-vintage differences remain possible confounders, recorded rather than silently resolved.

All eleven query coordinates and ordering match exactly between paths. Returned grid coordinates and elevations match **daily versus hourly for all eleven archive pairs and all eleven forecast pairs**. Archive and forecast grids themselves differ. Example `weather-1-1`: requested 46.386397, 14.712294; archive grid 46.291737, 14.664536; forecast grid 46.388206, 14.710788; returned elevation 734 m for both. These are weather-grid estimates, not forest-site observations. Default grid/elevation selection can differ from the query coordinate; this is documented provider behavior, not a reason to replace the existing sampling coordinates. [Open-Meteo forecast documentation](https://open-meteo.com/en/docs).

The bounded geometry selection is unchanged: existing representative centres inside inclusive `[14.65, 46.35, 15.05, 46.59]`, retaining whole existing clipped polygons. It is a reproducible Koroška-oriented research window, not an asserted administrative or national boundary. Weather definitions are inherited unchanged:

| ID | Query latitude | Query longitude |
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

## 5. Daily versus hourly scorer inputs

The production regional input policy is **`pilot-weather-v1`**. The isolated candidate is **`regional-civil-week-v1`**. Both use completed lookbacks **[target date − N calendar days, target date)**; Today is excluded from Today's rolling history, included as forecast weather in Tomorrow's history. No data after the target cutoff enters numeric lookbacks. Archive owns older dates; recent forecast history owns the last seven dates, without duplicate seam hours. D60 remains D60, not the graph's D30 horizon.

| Profile | Rain windows used | Temperature | Existing factor maxima |
| --- | --- | --- | --- |
| Splošno | D7/D14/D30 | T20 | rain 45, temperature 25, soil 20, drying 10 |
| Jesenski goban | D26 | T20 | rain 50, temperature 30, soil 15, drying 5 |
| Navadna lisička | D30/D7 | T14 | rain 40/10, temperature 25, soil 20, drying 5 |
| Užitna sirovka | D60/D14 | T20 | rain 35/10, soil 25, temperature 25, drying 5 |

Drying also uses existing D7 and ET₀7 inputs for every profile. Production soil transformations and factor formulas/weights are unchanged. Full canonical publication additionally requires both compatible native soil depths, complete required windows and validated intervals.

There are **22 unique coordinate/date input pairs**, not 88 independent weather records. Delta means hourly minus legacy. The 1e−9 diagnostic distinguishes floating-point summation noise from larger differences; it **never changes a score, relaxes a gate or overrides raw equality**.

| Input | Comparable pairs | Maximum absolute delta | Finding |
| --- | ---: | ---: | --- |
| D7 | 22 | 8.88e−16 mm | summation noise only |
| D14 | 22 | 3.55e−15 mm | summation noise only |
| D26 | 22 | 3.55e−15 mm | summation noise only |
| D30 | 22 | 7.11e−15 mm | summation noise only |
| D60 | 22 | 2.84e−14 mm | summation noise only |
| T14 | 22 | 0.027381 °C | mean absolute delta 0.012432 °C |
| T20 | 22 | 0.025208 °C | mean absolute delta 0.011439 °C |
| ET₀7 | 22 | 0.120000 mm | mean absolute delta 0.041818 mm; mean signed −0.040909 mm |
| max(ET₀7 − D7, 0) | 22 | 0.120000 mm | existing drying deficit, not a new formula |
| Soil 0–7 cm | 22 | 0 m³/m³ | values and instants match |
| Soil 7–28 cm | 22 | 0 m³/m³ | values and instants match |

All 88 full input sets differ in at least one raw required value. Identical integer scores therefore do not imply input parity.

Daily diagnostics cover **671 coordinate/dates = 11 × 61** (Aug 19–Oct 18, the union of Today/Tomorrow lookbacks). Rain differs only by arithmetic noise; temperature differs beyond that tolerance on 636 dates, ET₀ on 471. Maximum daily differences are 0.083333 °C and 0.05 mm ET₀. Rounding the hourly temperature mean to 0.1 °C reproduces 587/671 daily-product means, **not the other 84**. Returned temperatures lie on a 0.1 °C lattice and ET₀ on a 0.01 mm lattice in both products. This is consistent with separately quantized/aggregated products, but does not prove a single common model, a unique precision mechanism or that final-mean rounding explains every difference. Alternative start-stamped sums are retained only as secondary diagnostics; they are not used to manufacture primary legacy inputs.

## 6. Local-day and DST evidence

Hourly precipitation and ET₀ describe preceding-hour accumulations; the candidate sums endpoint instants **(civil midnight, next civil midnight]**. Temperature uses sampled instants **[civil midnight, next civil midnight)** and a mean, not a sum. Calendar boundaries are independently resolved with the IANA timezone, never `start + 86,400 s`. [Open-Meteo variable semantics](https://open-meteo.com/en/docs).

Provider fixed-offset bins are not assumed to be true IANA civil days across DST. The historical API documents fixed timezone behavior; this is why hourly UTC membership and explicit coverage validation matter. [Historical API documentation](https://open-meteo.com/en/docs/historical-weather-api). Provider documentation was checked on 2026-10-18.

All **671/671** actual compared daily boundaries agree with civil boundaries: this Aug–Oct 18 capture contains no DST transition. **The observed live score differences cannot be attributed to DST.** No extra historical DST request was made beyond the four-response budget. Live daily-versus-hourly DST parity is **unverified**.

Separately labelled deterministic controls exercise March 29, 2026 (23 hours) and October 25, 2026 (25 hours), UTC/local boundaries, nonexistent 02:30 in spring and two possible 02:30 instants in autumn. The synthetic autumn forecast starts Oct 24; it is not presented as a historical observation of Oct 25. Existing weather/soil tests cover missing/duplicate intervals, accumulation endpoints, seams and no-zero gap handling. All protections remain unchanged.

## 7. Soil sampling policies and actual selected instants

Legacy regional Today uses `soilPointAt`: nearest available labelled hour to provider current time, restricted to the target date. Tomorrow uses nearest hour to local 09:00. The experimental path uses an explicit as-of hour for current conditions and exact **09:00 Europe/Ljubljana** for future dates. Only original **0–7 and 7–28 cm**, m³/m³, are accepted; there is no depth substitution, interpolation, rain-to-soil formula or carry-forward.

The legacy nearest-hour implementation parses timezone-less ISO labels with the host's `Date` timezone. This capture/replay records and uses host **Europe/Ljubljana**, matching the tested Slovenian deployment; it does not establish host-timezone-independent legacy behavior. The candidate resolves provider offsets/UTC instants explicitly. This additional legacy assumption is documented, not corrected in production by the research harness.

In this capture Today is exactly 22:00 local in both provider current records, so nearest and as-of both select **20:00Z**. Tomorrow selects **07:00Z = 09:00 local**. Both depth values and instants agree on all **22/22** pairs; the report preserves provider array indices, raw labels/offsets, resolved UTC instants, canonical sample metadata and same-daily-response canonical sampling controls.

This does **not** erase the known policy difference. A 10:45 nearest-versus-as-of scenario remains a controlled fixture, not a changed production observation. Previous 44 Today instant differences came from a different capture/control. No production policy was migrated to obtain equality here.

## 8. Canonical factor impact and attribution controls

Both sides call the existing production `calculateMushroomWeatherScore` via their appropriate adapter/assessment paths; no second formula or UI score is implemented. Each case retains actual components, maximum weights, weighted points, availability, total and label.

| Factor | Materially different cases | Largest absolute weighted-point change |
| --- | ---: | ---: |
| Temperature | 66/88 | 0.069163 |
| Drying | 76/88 | 0.060000 |
| Soil | 0/88 | 0 |
| Profile-specific rain factors | 0 | ≤7.11e−15 arithmetic noise |

Two additional calls of the **same** scorer per comparable case isolate the numerical effects: (1) replace legacy historical inputs with actual hourly-derived inputs, retaining legacy soil; (2) sample the same authentic daily-response soil using canonical policy, retaining legacy history. The history-only control reproduces all four changed candidate scores, and the soil-policy-only control retains all four legacy scores. Remaining soil-product factor deltas are zero. This establishes which input families change these scores; it does not reveal whether separate provider precision, internal aggregation or unreported model vintage causes each raw input difference.

## 9. Weather-level score impact and outliers

**84 equal; 4 different; MAE 0.045455 points; median absolute difference 0; max 1; histogram −1:1, 0:84, +1:3.** One category change. All differing weather/profile/date cases are listed, not hidden by averages:

| Weather ID | Profile | Date | Legacy → hourly | Eligible cell cases affected | Category |
| --- | --- | --- | --- | ---: | --- |
| weather-1-1 | Navadna lisička | Oct 19 | 58 → 59 | 80 | unchanged |
| weather-1-2 | Užitna sirovka | Oct 18 | 92 → 93 | 10 | unchanged |
| weather-2-2 | Navadna lisička | Oct 19 | 50 → 49 | 94 | **Dobre razmere → Povprečne razmere** |
| weather-3-4 | Jesenski goban | Oct 19 | 55 → 56 | 1 | unchanged |

For `weather-2-2` the sum of actual canonical weighted contributions shifts from approximately 49.54643 to 49.47727, crossing the existing integer-rounding/category boundary. These diagnostic component sums are not an alternative score or a display override. The unchanged production scorer decides the final result.

## 10. Cell-level impact, habitat and geographic concentration

The existing cell-to-weather mapping and actual `habitatStateFor` are reused. Habitat is an eligibility mask, not an invented score multiplier. Candidate counts per date: Splošno 696; goban 635; lisička 635; sirovka 422.

| Profile/date | Eligible numeric cases | Scores changed | Categories changed |
| --- | ---: | ---: | ---: |
| Splošno Oct 18 / Oct 19 | 696 / 696 | 0 / 0 | 0 / 0 |
| Jesenski goban Oct 18 / Oct 19 | 635 / 635 | 0 / 1 | 0 / 0 |
| Navadna lisička Oct 18 / Oct 19 | 635 / 635 | 0 / 174 | 0 / 94 |
| Užitna sirovka Oct 18 / Oct 19 | 422 / 422 | 10 / 0 | 0 / 0 |

Total **4,776**, unchanged **4,591**, changed **185** (+1:91; −1:94), category changes **94**, MAE **0.038735**, median 0, max 1. Changes concentrate in the four weather definitions in section 9; all category changes are the 94 eligible lisička cells attached to `weather-2-2`, not 94 independently observed sites.

Across all 5,568 cell/profile/date combinations, **756 habitat-unknown and 36 outside-model cases remain nonnumeric**. A separate weather-only diagnostic, ignoring habitat eligibility, finds 277 score changes and 98 category changes. These are **not** 277 visible cell-colour changes; ineligible habitat must remain neutral. Public-only GeoJSON diagnostics retain the original 696 polygons with weather IDs, habitat states and impact counts, not private locations or a new production forecast layer.

## 11. Missing data, incompatibility and availability

The authentic primary capture has 88/88 full weather results in each path and no availability change. This is observed coverage, not a guarantee for every future acquisition.

Controlled response mutations are explicitly marked `controlled-response-mutation` and never saved as live measurements. Missing one native soil layer exposes an important existing difference: Generic reports limited quality, while the three species can retain a soil component from one available layer under their existing formula. Missing both makes all legacy profiles limited. The canonical full-input gate rejects either missing depth. The report checks actual required-input coverage independently of a legacy `complete` label, preserving rather than hiding that possible publication difference. It does not alter production limited-data scoring.

Missing canonical soil for one location yields eight unavailable primary outcomes, not 0/100. A recorded daily-forecast failure remains a source failure and yields no legacy numeric results; it is not converted to fabricated data. Tests also cover unit mismatch, malformed batch identity, changed coordinates/dates, mismatched snapshot timestamps and hash corruption. Existing interval/depth/window/stale/provenance gates stay enabled. Zero rain is valid; null is missing.

## 12. Actual network, CPU, memory and artifact cost

One acquisition: **daily cold 2 HTTP + hourly cold 2 HTTP = 4 real requests**, eleven coordinates batched per request. Warm daily and warm hourly each add **0 HTTP**. No per-cell, per-profile or per-day network acquisition. Capture and validation are CLI-only; no app request behavior changes.

| Product | Original decoded UTF-8 body bytes | Minimized semantic JSON bytes | Pure JSON.parse median, ms |
| --- | ---: | ---: | ---: |
| Daily archive | 29,625 | 28,048 | 0.221 |
| Daily forecast | 130,967 | 129,600 | 0.511 |
| Hourly archive | 372,952 | 313,620 | 1.186 |
| Hourly forecast | 156,310 | 137,596 | 0.539 |
| Total | **689,854** | **608,864** | separate measurements |

Daily body total **160,592 B**; hourly **529,262 B**. These are decompressed response text bytes, not compressed network-wire bytes or billable provider units. The observer's captured `parseMs` includes JSON.parse **and integrity hashing**; the table separately measures pure JSON.parse over five offline trials per response.

Instrumented Windows/Node v24.21.0 capture: **407.249 ms wall**, daily cold adapter **404.610 ms**, hourly acquisition **392.896 ms**, running concurrently. Response-header waits were 203–397 ms; body-read 1–91 ms per product. The observer reads response text before returning its JSON result, so transport callback timings include observer work and must not be treated as uninstrumented app latency. Warm daily **1.658 ms**, hourly **1.663 ms**. No guaranteed mobile/network latency is claimed.

Retained offline analysis run: actual daily-adapter replay **25.103 ms**; candidate hourly adapter **218.058 ms**; window/scorer evaluation **230.054 ms**; cell join **13.341 ms**; prototype build **511.737 ms**; full comparison **761.920 ms**. Function instrumentation: 737 daily aggregates **57.577 ms**; 99 soil samples **170.854 ms**; 429 historical-summary calls **32.951 ms**; 572 scorer calls **10.324 ms**. Nested timings are **not additive**. Total scorer calls comprise 308 weekly weather vectors + 88 legacy primary cases + 176 attribution controls, not 19,488 per-cell evaluations. CPU validation still occurs per profile where the existing builder requires it; no unmeasured deduplication is claimed.

Process peak RSS **288,731,136 B (~275.4 MiB)** includes TypeScript transpilation, imports/static geometry, capture and reports; it is not isolated algorithm heap usage or Android RAM consumption. Measurements vary between runs and are not used as dataset identity.

Committed evidence sizes, including serialized newline/pretty-report overhead:

| Artifact | Bytes | gzip bytes |
| --- | ---: | ---: |
| `koroska-contract-validation-v1.capture.json` | 1,072,606 | 179,978 |
| `koroska-contract-validation-v1.report.json` | 1,295,227 | 49,980 |
| `koroska-contract-validation-v1.daily.json` | 780,634 | 38,780 |
| `koroska-contract-validation-v1.diagnostics.geojson` | 259,447 | 19,180 |

Capture intentionally retains both authentic response envelopes and the adapter-ready hourly batch for cross-checking. This is a bounded replay archive, not a proposed production delivery format. Full requests, units, provider coordinates/elevations, response headers, canonical payload hashes and original decoded-body hashes are retained. Original whitespace is not retained; parsed authentic values are. No secret, hotspot name/ID, note, visit or private trace is included. Attribution: **Open-Meteo.com, CC BY 4.0; modified into research comparisons**.

## 13. Effect on existing production results

**Actual production changes in this task: zero.** All differences above are counterfactual shadow comparisons of the captured input products under unchanged formulas/masks. No production cache entry, runtime adapter or persisted result was migrated. No existing visit snapshot is recomputed or reinterpreted. The sampled one-point changes must not be generalized as a national maximum or as permanent expected changes at these coordinates.

The older `scripts/regionalRegression.ts` was also attempted and fails at its source-byte guard comparing the already-committed `weather.ts` with commit `6127609…`, before reaching numeric comparisons. The differing chart/calendar/timing helper additions predate this task (`weather.ts` last changed at `b63e18a`). `git diff HEAD -- src ...` is empty. This obsolete guard was **not edited or bypassed**, and that script is **not reported as passing**. The active production assessment regression in `hotspotConditionsSmoke.ts` passed **84,248 regional and 15,688 pilot comparisons** against its pinned baseline. Soil sampling passed **2,400 identical comparisons**.

## 14. Evidence for and against migration

For: actual provider hourly coverage supports D60 and all required current/future variables in this bounded capture; input construction is explicit and civil-time aware; existing regional formulas and habitat semantics remain reusable; batching/replay costs are modest on this desktop; every primary comparison is auditable.

Against immediate migration: daily and hourly inputs are not identical, even without DST; rounding boundaries can change publicly visible categories for many cells sharing one sample; live soil-policy divergence was not exercised at a fractional current hour here; model/run compatibility cannot be established; live historical DST product differences and repeat-run stability remain unmeasured. Small observed deltas and passing software tests do not validate ecological accuracy.

## 15. Recommended contract strategy

**Choose C: preserve legacy public regional scores while evaluating the candidate in a non-public, versioned shadow workflow.** Do not choose B on the basis of 84 equal rounded scores. A production change may ultimately be justified, but it requires explicit acceptance of expected input/score/category changes and their publication semantics. C retains a path to evidence without misrepresenting current production as migrated. No shadow runtime service, backend deployment or public map layer is implemented in this task.

## 16. Model, cache and snapshot versioning requirements

Keep `pilot-weather-v1` results distinct from `regional-civil-week-v1`. A future approved derived-result identity must include input contract, scorer/configuration fingerprint, geometry/habitat version, exact weather-sampling coordinate, absolute local target date, profile, source payload hashes, snapshot/as-of identity and original freshness/expiry. Provider run time remains null unless independently verified. An input-contract change is not a species-weight change.

Reuse raw weather only when endpoint, variables, coordinates, range, resolution, units and timestamp semantics match; do not alias daily products to hourly cache keys or extend old forecasts into a new horizon. Experimental artifacts must not populate old derived caches. Keep old immutable visit snapshots and old golden comparisons interpretable under their original recorded versions. Exact-point estimates and regional habitat-masked estimates remain explicitly different products.

## 17. Scientific limitations

Public regional model grids cannot resolve every mountainous slope, altitude, forest microclimate, canopy moisture or habitat boundary. Archive/forecast grids are coarser and different from many existing cells; matching daily/hourly query grids does not make them on-site measurements. Existing habitat uncertainty remains visible and border polygons are not extrapolated. Forecast/reanalysis soil is modelled, not locally observed. ET₀ is reference evapotranspiration, not direct forest-soil evaporation. No mushroom-occurrence accuracy, find probability, harvest quantity or numerical confidence is established. This validates software/data contracts only.

## 18. Reproduction, tests and public-rendering gates

Offline commands (no external HTTP):

```powershell
npx tsc --noEmit
node scripts/runSmoke.cjs scripts/research/validateKoroskaContracts.ts
node scripts/runSmoke.cjs scripts/koroskaContractValidationSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaRegionalPrototypeSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotConditionsSmoke.ts
node scripts/runSmoke.cjs scripts/soilSamplingSmoke.ts
Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' | Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
```

`validateKoroskaContracts.ts --save` regenerates the report/daily diagnostics/GeoJSON from the frozen capture; score/input diagnostics reproduce exactly, timing/RSS fields naturally vary. The new smoke test performs two replays and checks semantic equality excluding timing, capture immutability, gzip round-trip and zero external requests. It verifies real daily invocation/values, hourly source integrity, 11×2×4 identities, input/factor/category/cell accounting, unit/soil/missing/failure/vintage controls and labelled DST fixtures.

Executed: **TypeScript PASS; all 50 deterministic root `*Smoke.ts` suites PASS**, including the new validation, existing Koroška prototype, weather intervals/cache, all four scorers, point/weekly/ConditionsScreen/map/navigation/hotspot/ranking/Top 3/snapshot coverage. **84,248 + 15,688 + 2,400 unchanged comparisons** passed. Expected offline/timeout errors are exercised by negative tests, not failed live requests. Initial research-only type/test expectation errors were corrected against source semantics, without altering production or baseline files. The separate old byte-pinned regression failure is disclosed in section 13. Live smoke suites were not run; the sole external acquisition was the four-request capture. No native Android test or APK build was required or claimed.

Any new live capture must be a deliberately authorized, bounded new experiment, not an automatic replay fallback:

```powershell
# Overwrites only this research capture; <=4 public API requests, no retries.
node scripts/runSmoke.cjs scripts/research/captureKoroskaContracts.ts --live
```

Before approving public regional rendering: review repeat acquisitions and partial/failure behavior; obtain authentic supported past-DST daily/hourly controls under a separately agreed budget; explicitly accept quantified category/availability changes; document model-vintage uncertainty or a verified pin; approve the versioned artifact/freshness contract and spatial disclaimers. Never weaken missing/coverage/soil/vintage gates just to fill layers. Production regional MapScreen integration is **not yet justified by this single observational capture**.

## 19. Exactly one next implementation milestone

**Bounded Koroška dual-contract CLI shadow validation series.** Retain the same eleven public sampling coordinates and 696 cells, keep public production on `pilot-weather-v1`, record repeated dated authentic paired products plus separately budgeted genuinely past DST controls, and produce reviewed versioned score/input/availability/category deltas before any public rendering decision. Its acceptance gate is an explicit migration review with explained contract effects and unresolved provider-vintage uncertainty stated, not seven coloured layers. It adds no map UI, production weather migration, national rollout or user-data processing.
