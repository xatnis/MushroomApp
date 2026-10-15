# Seven-Day Conditions V1

## Readiness gate and scope

Implementation status: **PARTIAL / availability-gated**. One selected Razmere location has seven individually date-aligned evaluations for all four production profiles. Numeric estimates are available only with complete, compatible inputs and successful Today/Tomorrow parity. A live public-location check on 2026-10-13 produced all 28 numeric results. Missing signals, unverified DST sampling and the existing Today soil-sampling discrepancy are explicit blockers, not substitute scores. This is not seven-day heatmap/ranking/Top 3, nor a forecast of actual mushrooms.

## Architecture and immutable snapshot

`ConditionsScreen` passes its actual selected coordinates and controlled profile to `SevenDayConditionsModal`. The acquisition hook uses the existing `getMushroomWeatherSummary` point service and reads its existing raw disk cache. No endpoints, query variables, transport, TTLs, daily graph model or persistent schemas change. `src/domain/sevenDayConditions.ts` assembles canonical `MushroomWeatherSummary` inputs, calls `calculateMushroomWeatherScore`, and attaches availability/coverage/provenance without modifying that scorer.

One deeply frozen snapshot contains D60 history, the single seven-day forecast response, native soil samples, archive/forecast retrieval times, local base date and source blockers. All four profiles are derived/memoized from it; date/profile selection never acquires data. Source arrays and soil values are checked against the canonical Today summary after disk reads, in addition to timestamp checks. A concurrent endpoint replacement therefore blocks mixed-vintage display. Archive reanalysis and recent forecast history naturally have separate retrieval times: this is explicit provenance, not a claim that both were issued together. The API does not expose a verified forecast model-run issuance timestamp; `forecastIssuedAt` is null. `retrievedAt` and view `assembledAt` are not labelled as issuance.

## Audited production requirements

These are mappings to existing production configs, not replacement formula definitions.

| Profile | Precipitation | Rolling mean temperature | Canonical component maxima |
| --- | --- | --- | --- |
| Splošno (Generic V2) | D7, D14, D30; rain composite uses 20/35/45% horizon shares | T20 | rain 45, temperature 25, soil 20, drying 10 |
| Jesenski goban | D26 | T20 | D26 50, temperature 30, soil 15, drying 5 |
| Navadna lisička | D30, D7 | T14 | D30 40, D7 10, temperature 25, soil 20, drying 5 |
| Užitna sirovka | D60, D14 | T20 | D60 35, D14 10, soil 25, temperature 25, drying 5 |

All profiles use soil **0–7 cm and 7–28 cm**, m³/m³, normalized by the unchanged production baseline 0.12/range 0.16 and 40/60% depth weights. All drying factors require complete D7 precipitation and ET₀7; the production deficit is `max(ET₀7 − D7, 0)` with the existing 20 mm reference. Temperature responses, rainfall normalizations and exponential Lactarius signals remain in the production scorer, never reimplemented here.

Production missing-input policies differ: Generic needs its rainfall composite and T20 and requires both layers for its soil factor; Boletus/Cantharellus can return renormalized partial totals (and use one available soil layer); Lactarius requires D60 and T20 but other components may be optional. Heatmap assessment has its own core-input quality checks. **The new weekly publication gate is intentionally stricter:** every configured component, every required complete window, both soil depths and D7/ET₀7 must be available. Otherwise public `score`/`label` are null. Canonical available components remain inspectable; an internally renormalized partial result is never shown as a fully comparable weekly score. No weights are renormalized by the new layer.

## Date windows and history/forecast boundary

The audited production interval is **[target local date − N, target local date)**, excluding the target day's incomplete daily total. This exact rule is reused through `buildHistoricalWeatherSummaryForTarget`.

For Day +5, D26 uses 21 completed pre-base days plus five modelled forecast days from base through Day +4. No target-day or later precipitation, temperature or ET₀ enters the rolling score. The selected target day's own weather forecast is shown separately, explicitly not part of that window. Soil is a target-date point signal, not a rolling rain surrogate.

Input dates are validated, deduplicated and sorted. Null/invalid/negative precipitation and ET₀ are missing, never zero. Temperature mean must exist; min/max are not averaged to manufacture it. Coverage must contain all N valid calendar days, not just N array entries. D60 uses the existing archive base−60 through base−8 plus Forecast API past_days=7. Graphs keep their independent 30+7 presentation horizon.

Local dates use Europe/Ljubljana and existing calendar-shift helpers. Midnight and resume update the base-date request key; actual local-midnight deadlines handle 23/25-hour DST days. New-date loading hides the previous keyed results immediately. Equivalent timezone=auto aliases (the live point returns Europe/Vienna) are accepted only after verifying calendar/hour equivalence over the complete used history/forecast span. Incompatible or unknown timezone metadata blocks numeric output.

## Soil feasibility, ET₀ and unresolved sampling limits

The existing Forecast API request already includes native named `soil_moisture_0_to_7cm` and `soil_moisture_7_to_28cm`. The public test response supplied both in m³/m³ for all 336 past/future hourly timestamps. The API's [ECMWF documentation](https://open-meteo.com/en/docs/ecmwf-api) describes these native depth layers and modelled ET₀; other models' 0–1/1–3/3–9/9–27 cm products are **not** substituted. No soil-depth transformation, rain-to-soil formula or Today carry-forward is implemented. Invalid units/ranges and missing layers block full totals; the UI only presents validated native soil values.

Today retains the canonical point service's current/floor-hour sampling. Tomorrow and later dates require their **own exact 09:00** soil point, following the existing Tomorrow morning convention. ET₀ is already requested as daily `et0_fao_evapotranspiration`, mm, blended into rolling ET₀7 with the same exclusive cutoff as rain.

Two honest limitations remain:

1. The point Today service chooses the preceding hourly sample; the heatmap helper chooses nearest-hour current soil. After a half-hour boundary, these can differ. The weekly Day 0 gate compares the canonical point scorer and existing assessment on the identical snapshot; a mismatch suppresses the affected numeric result. Neither production path is changed. A future shared sampling-policy decision, with Today regressions, is required to remove this blocker safely.
2. The provider documents a fixed UTC offset for a response crossing DST. If that published offset differs from Europe/Ljubljana's target-day 09:00 offset, the future morning point is not accepted as equivalent. Affected dates are unavailable with a UTC/DST explanation. Resolving this requires a canonical timestamp/offset contract and Tomorrow parity tests, not silently selecting 08:00/10:00 in this feature.

Likewise, if the existing Today historical builder's host-calendar anchor and Ljubljana target disagree, the Day 0 alignment gate suppresses display instead of modifying Today behavior. These are why this V1 is reported as availability-gated/partial rather than seven guaranteed numeric cards on every device/date/source.

## Scorer reuse and parity

Day 0 uses the untouched canonical Today summary and separately verifies its rolling windows are aligned. Day +1 uses the existing target-relative windows and Tomorrow morning soil. For both, numeric totals and complete component arrays are compared with `assessHeatmapWeather` using the same legacy date scope. A mismatch blocks the affected public number; production is never changed to force parity. Day +2..6 independently call the same scorer.

All factor labels, contribution points/maxima and progress ratios come from the existing canonical result via `advancedFactors`/`advancedExplanation`. No alternate UI score is computed. Available components from incomplete but verified inputs remain visible; unverified snapshot/parity/alignment results retain canonical diagnostics internally but do not present numeric bars as confirmed. Later-date future rain is not appended to trend context; the existing Tomorrow assessment also lacks a full seven-day future trend. Existing Today trend behavior remains in its canonical result, separate from numeric scoring.

## UI, loading, errors and navigation

The compact **Napoved pogojev · 7 dni** action sits inside Gobarski signal. It opens a full-screen modal with the selected location, controlled production profile chips and seven horizontally scrollable date cards. Day selection is local; selecting Day +5 never alters global Map/Ranking Danes/Jutri. Switching profile changes the same Razmere profile source of truth. The origin screen and MapLibre remain mounted; close/Android Back only dismiss this modal. Graphs and weekly detail do not open together.

Selected details show public score/label or **Ocena ni na voljo**, exact missing/parity/source reasons, available canonical factors, required rolling rain/temperature context, actual native soil sample time, ET₀7 and separately labelled target-day weather. Forecast retrieval time, stale state and uncertainty remain visible. No probability/confidence percentage or expected mushroom quantity is invented.

Acquisition/loading, request error, insufficient inputs, ready and stale usable results are distinct. A source failure prevents incomplete totals and offers retry; both endpoint failures use the hook's error state. Expired same-horizon fallback remains visibly stale. Old horizons cannot pass the new date cache key as fresh. Partial values are not deleted or replaced by zero. Location keys, effect cleanup and current-key guards prevent late old-location responses; all profile evaluations belong to the same current frozen snapshot. The snapshot callback can update the main Today summary only for matching current coordinates and unblocked source assembly.

The modal owns real top/bottom/left/right safe-area edges; its vertical content has normal design spacing, not another system inset. Header/profile/day/retry actions have at least 48pt touch targets. Cards have no fixed height or numberOfLines clipping, so larger text grows vertically; the week scrolls horizontally. Selected states, header focus and factor text alternatives support TalkBack. Device rendering, native Back, status/navigation bars and font scaling still require physical Redmi QA.

## Cache, requests, privacy and isolation

Existing raw keys are reused unchanged: `mushroom-archive-v2:<rounded coordinate>:<start>:<end>` and `mushroom-forecast-v1:<rounded coordinate>:<base date>`, 30-minute TTL and shared in-flight dedupe. The bounded derived cache is scoped to database identity and exact location/base date/native-soil policy. It expires at the earlier source expiry and is never used as fresh if marked stale. No new SQLite table, dependency or raw cache artifact is added.

Measured mock transport: cold 2 existing endpoint calls; duplicate concurrent weekly load 0 extra; warm memory/disk reopen 0 extra; all four profiles, seven selections and explanations 0 extra. A live public-point concurrent main/weekly load also used **2**, warm reopen **0**. If Razmere already loaded these point responses, weekly opening adds 0 HTTP; otherwise only missing/expired sources are fetched (at most the two existing endpoints per acquisition). Offline expired-cache tests attempted 2 refreshes, then labelled fallback stale. An earlier live run returned forecast HTTP 503; the UI exposed missing predictions, and reopening the incomplete cache attempted the one missing endpoint rather than manufacturing a warm hit.

No regional cell evaluation, GeoJSON rebuild, heatmap source remount, camera call or LOD dependency exists in this path. Hotspot evaluation/ranking/Top 3, visits/snapshots, private persistence and sharing stay unchanged. Existing weather provider queries remain subject to existing privacy behavior; no community coordinates or cloud schema are introduced.

## Executed verification and native limitations

On 2026-10-13, `npm run typecheck` passed and 25 scripts passed via `node scripts/runSmoke.cjs scripts/<suite>.ts`:

- sevenDayConditionsSmoke, sevenDayUiSmoke
- conditionsLoadingSmoke, conditionsAdvancedSmoke, weatherGraphsDiscoverabilitySmoke, weatherGraphsNavigationSmoke, weatherGraphsSmoke, genericWeatherDetailsSmoke, conditionsCardSmoke, screenSafeAreaSmoke, locationAccuracySmoke
- hotspotConditionsSmoke, hotspotConditionsUiSmoke, hotspotRankingSmoke, hotspotRankingUiSmoke, rankingControlsSmoke, hotspotTopThreeSmoke, hotspotHeatmapIntegrationSmoke, hotspotOverlaySmoke, focusedHotspotMapSmoke, locationConditionsHookSmoke
- bottomMapTabNavigationSmoke, heatmapNavigationSmoke, heatmapTransitionSmoke, heatmapLodSmoke

New tests cover all four profiles × seven dates across month/year/leap/DST boundaries; manual D7/14/26/30/60 and T14/20 expectations; no post-target rain/temp/ET₀ leakage; Today/Tomorrow equality and explicit mismatch gates; native soil/units/DST-offset blocking; missing mean/ET₀/D60/layers; duplicate dates; immutable snapshot/vintage race; cold/warm/concurrent/stale requests; actual modal/hook latest-location/profile behavior; local selection; Back/close; controlled profile; midnight/resume cleanup; and production source guards.

Actual production regression execution (`hotspotConditionsSmoke`): **84,248 regional and 15,688 pilot identical comparisons**, baseline 2822a44. Scorer/habitat/LOD source identity checks passed. Warning logs from simulated offline/timeouts are expected assertions, not suite failures.

`sevenDayLiveSmoke` is an explicit opt-in public coordinate check, not automatic phone verification and not a source of example UI scores. The final live run returned seven ready results for each profile; no raw API files or private coordinates were persisted. No Android device was attached. APK attempt with `npm run apk -- --name MushroomApp-preview-seven-day-conditions-v1.apk` failed with **Unable to establish loopback connection**; no old APK was copied. Run that command locally for a fresh preview, then verify Redmi 13C navigation/TalkBack/large text and changing local dates.

## Future readiness

The typed snapshot/input builder can support later selected-hotspot forecasts. Multi-location/week ranking, future heatmaps, marker dates, push notifications and other foraging profiles are deliberately deferred. Before broader publication, resolve the canonical soil sampling/offset contract, confirm forecast issuance metadata where available, validate source/model continuity and uncertainty, and compare forecasts with later field outcomes without reclassifying later observations as information known at forecast issuance.

## Seven-Day Conditions V1.1 — Soil Sampling and DST Consistency

### Acceptance: PARTIAL, not unconditional map-integration readiness

The following findings and implementation supersede the V1 soil-offset gate above. Soil instants are now explicitly resolved, including across DST. **Numeric publication is still gated** where the unchanged production sampling policy or API daily periods are incompatible. No production scorer, weight, heatmap assessment, point/hotspot integration, weather transport, query/cache key, UI or navigation has been altered to force parity. This task does not implement map integration.

### Actual source audit / comparison matrix

| Existing surface | Source / spatial context | Today soil choice | Tomorrow soil choice | V1.1 behavior |
| --- | --- | --- | --- | --- |
| Razmere individual Today | `getMushroomWeatherSummary`, point cache, timezone=auto | `currentWeatherFrom`: exact hourly time or last timestamp <= returned current.time | No independent Tomorrow implementation in this service | Untouched; weekly verifies this floor/as-of reference |
| Hotspot detail, ranking, marker/popup and Top 3 | `useLocationConditions` → `conditionsForLocation` → cached pilot bundle; existing weather-cell mapping, actual point outside coverage | Batch `soilPointAt`: nearest hourly timestamp to current.time | Nearest timestamp to provider-labelled target date 09:00 | Untouched; independent legacy sampling retained as parity reference |
| Regional / pilot heatmap | Same batch service, regional weather points; habitat / LOD layers | Same nearest-hour rule | Same nearest provider-09:00 rule | Entire regional model/scheduler/extraction left unchanged |
| Weekly V1 | Direct selected-location point response + same cached raw forecast | Floor-hour values, but compared to nearest-hour batch output | Required raw 09:00; rejected a differing provider/DST offset | Superseded by explicit instant sampler and retained independent parity gates |
| Weekly V1.1 | Same direct-location sources, deeply frozen weekly snapshot | Latest unique native sample no later than current.time's actual instant, less than one hour old | Exact **09:00 Europe/Ljubljana**, converted to UTC and matched in the provider array | Correct time/depth metadata; no nearest-hour substitute, interpolation or carry-forward |
| Historical soil | Archive request contains daily rain/temp/ET₀, **no historical soil series** | Not a soil input source | Not applicable | No invented archive-to-forecast layer transformation |

The Today difference is a real sampling-policy difference, not a weight/formula error. At 10:45 a nearest-hour policy can choose 11:00 whereas the point as-of policy chooses 10:00. A scientifically valid approximate nearest estimate is not the same instant as an as-of estimate; numeric equality alone does not prove consistency. Resolving all legacy point surfaces would require an explicit input-policy decision while maintaining their heatmap/detail equality. Such a production change is deliberately not hidden in this patch.

`soilSamplingSmoke` reports a **synthetic diagnostic**, not new production scores: floor vs nearest total is Generic 72/74, Boletus 72/74, Cantharellus 67/69, Lactarius 79/82 for its fixed 10:45 fixture. All real production paths remain byte-identical to 4222eb0. The new gate also catches different raw values/instants when saturation or rounding makes their totals identical.

### Reusable sampling contract and metadata

`src/domain/soilSampling.ts` defines `point-asof-or-local09-v1`. The inputs are an explicit target local date, returned current reference or future morning role, response offset and native hourly arrays. Today is sampled relative to **the provider's returned current instant**, not the device clock or a guessed historical hour. Future morning is a unique civil instant. Both native depths come from the same array index; unknown/invalid time metadata, duplicate instants, a missing requested hour, unsupported units, invalid values and incompatible/missing depth layers remain unavailable. A missing unit attribute may only rely on the already documented default of these named native variables; explicit conflicting units are rejected.

The frozen snapshot now retains provider timestamp, UTC instant, real Ljubljana local timestamp, provider offset, timezone, retrieval time and current-modelled/forecast role per sample. `soilTime` denotes the real sample, while the original canonical current weather timestamp remains untouched. These are instantaneous model fields, not daily means or local station observations. Exact soil model-run identity is **not exposed by the existing best_match payload**; the app cannot claim a verified IFS run merely from the variable name. The [ECMWF native-variable documentation](https://open-meteo.com/en/docs/ecmwf-api) supports the named depths; actual responses and unit checks decide availability. There is no 0–1 → 0–7 cm or 9–27 → 7–28 cm substitution.

### DST root cause and deterministic handling

The provider's documented ISO timestamps use one fixed `utc_offset_seconds` throughout a response. Parsing an offsetless API timestamp with host `Date.parse` is not a reliable interpretation of that instant. The new helper interprets it as wall time minus the **published response offset**, then formats its instant through Europe/Ljubljana. It independently resolves desired civil clocks using IANA offsets and verifies the resulting wall time; calendar dates advance through the existing calendar helper, not by adding 24 hours.

- 29 March 2026 has 23 elapsed hours. Local 02:30 does not exist: the resolver returns no instant, never shifts it to 03:30. Local 09:00 is UTC 07:00; a CET-offset response names that sample 08:00.
- 25 October 2026 has 25 elapsed hours. Local 02:30 has UTC 00:30 and UTC 01:30: the resolver exposes both rather than guessing. Current sampling uses the response's explicit offset to disambiguate. Local 09:00 is UTC 08:00; a CEST-offset response names that sample 10:00.
- The future contract deliberately uses unambiguous 09:00. It requires that exact instant; nearby hours are not substituted. Tests change the host timezone between UTC, Ljubljana and New York and obtain the same result.

The old blanket *soil offset differs, therefore no sample* gate is replaced only for soil extraction: correctly converted native soil can now be inspected on those dates. **This does not automatically authorize a numeric score.** Legacy Tomorrow may still use another instant, so `legacyTomorrowSoil` is extracted independently from the raw provider-09:00 rule, not copied from the new sampler. Equality of total/components, both raw layers and actual chosen time is required. This fixes the V1 self-referential Tomorrow comparison risk.

### Additional daily-period blocker found during source inspection

Provider [getTimerange2 source](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/ForecastapiQuery.swift) constructs daily reads with 86,400-second steps and a constant offset. A provider-labelled day across DST therefore cannot be assumed to equal a complete 23-/25-hour Ljubljana civil day. Its boundary can also shift on other historical dates with a different seasonal offset. Neither a daily sum nor a temperature mean can be corrected accurately by merely renaming its date or scaling it.

The new `dailyPeriods` metadata compares **both actual interval endpoints** against civil midnight-to-midnight. Numeric publication requires compatible periods for all dates in the profile's required lookback, including D7/ET₀7. Unknown period metadata also blocks publication. This prevents a spring transition daily bin from silently including an hour beyond the target's local-midnight cutoff. Diagnostic canonical inputs remain retained; unverified-period contribution bars are not presented as confirmed.

All four profiles / Day 0–6 remain supported when native soil, complete daily windows, timezone/period compatibility and legacy parity are valid. Maximum relevant lookbacks are Generic 30, Boletus 26, Cantharellus 30 and Lactarius 60 days. A required window spanning incompatible seasonal daily bins remains unavailable; this can persist after the transition, not just on the clock-change date. Old Today's host-calendar alignment gate also remains in place. No false zero or renormalized partial full-score replaces these blockers.

### Parity, explanations, safety and performance

Full-compatible fixtures verify all four profiles' Today/Day 0 and Tomorrow/Day +1 totals, component arrays/maxima, raw soil values, rolling windows, ET₀ and explanation/coverage metadata. Day 0 retains the canonical **point** explanation/trend context; a regional capped forecast can have a different trend explanation without changing numeric factors. Tests do not force these intentionally different trend contexts to be equal.

Retained/strengthened gates: complete required components, both native soil layers, no missing ET₀/temperature mean/D60, source-vintage consistency, valid timezone and local horizon, daily interval compatibility, Today/Tomorrow **input and instant** parity, and unknown sampling metadata. No scorer is modified and no UI override or rounding trick suppresses a mismatch. The forecast/back/loading/error/stale interface, profile/location generations, privacy, visits and all MapLibre/LOD behavior stay unchanged.

Raw weather request/cache keys, variable sets, 30-minute TTL, dedupe and coherent forecast snapshot are unchanged. Only the bounded **derived** snapshot policy key changes to `native-soil-instant-v1-1` so a V1 derived object cannot bypass new checks. No new HTTP variable or per-day request is introduced. On 2026-10-14 the public live check produced **28 ready results**, cold main+weekly **2 existing requests**, warm reopen **0 extra**. Date/profile/detail/scroll actions remain local with 0 HTTP.

### Verification, remaining work and map-readiness decision

On 2026-10-14 TypeScript and **26 suites** passed: the 25 V1 suites listed above plus `soilSamplingSmoke`. New coverage includes 23-/25-hour arrays, missing/repeated clocks, response offset vs IANA time, future exact-hour lookup, current floor at minutes 00/15/30/45/59, no cross-day carry-forward, native units/depths, duplicate/missing samples, daily interval endpoints, unknown period metadata, all-profile parity and masked/saturated soil mismatches. The existing transport fixture now explicitly freezes its audited 2026-10-13 clock; it no longer accidentally depends on the developer's current date. Production golden snapshots were not changed.

Actual regression execution: **84,248 regional + 15,688 pilot identical comparisons**, baseline 2822a44, including production source-identity guards. A native device was not attached, so no new Android/TalkBack journey is claimed. `npm run apk -- --name MushroomApp-preview-seven-day-v1-1.apk` failed with **Unable to establish loopback connection**; no stale APK was copied.

Readiness verdict: **safe reusable sampler and gated weekly evaluation, NOT ready for unconditional Map/Hotspot seven-day publication**. The two remaining decisions must precede a COMPLETE verdict:

1. Explicitly approve/version one production individual-point soil policy across Razmere and cell-backed hotspot/detail paths, with isolated before/after input and score cases. Keep regional semantics separate if intentionally coarse; never disguise a golden change as unchanged behavior.
2. Obtain validated date-aligned daily inputs for DST-crossing windows. A concrete route is cached/batched hourly precipitation, mean-temperature samples and ET₀ spanning required history + forecast, aggregated over true civil day boundaries. These variables are not requested by this patch, and their cache/version/network cost needs separate review. Then compare the corrected inputs with legacy Today/Tomorrow explicitly rather than changing old values silently.

Until then, exact soil instants are available where supported, but unresolved equivalence produces an honest unavailable result. No map button or new feature is shipped as part of this consistency work.

## V1.2 — Canonical Weather Consistency

Status: **PARTIAL**. Civil-day hourly assembly is implemented and validated. Production point-policy migration is deliberately **not** performed. Today/Tomorrow publication still requires strict independent legacy input/result parity. This section supersedes V1.1's two-request/current-snapshot availability findings; older sections describe the earlier implementation.

### Audited production contracts and impact

| Surface | Today soil | Tomorrow soil | Weather/date contract |
| --- | --- | --- | --- |
| Razmere | Latest response hour not later than provider `current.time` | No separate Razmere Tomorrow evaluator | Existing hybrid daily arrays; default historical builder uses host calendar |
| Hotspot detail/ranking/Top 3/badges/popups | Nearest provider hour (ties retain earlier array entry) | Nearest provider-labelled 09:00 | Shared cell-backed regional weather assessment; prepared habitat can intentionally resolve to a weather-cell centre rather than exact saved coordinates |
| Selected map-point/regional/pilot | Same existing nearest-hour batch helper | Same provider-labelled 09:00 | Existing regional daily inputs and habitat/LOD semantics, unchanged |
| Seven-day V1.2 | As-of provider-current UTC instant, unique floor hour younger than one hour | Exact **09:00 Europe/Ljubljana**, also for +2…+6 | Validated Unix hourly inputs aggregated into true civil dates |

At 10:45 the first contract can use 10:00 and the second 11:00. Both are **modelled** soil, not on-site observations. The future hour is nevertheless not the same current/as-of input. Sharing the batch helper with regional/cell-backed scoring means changing it globally would change existing surface contracts; introducing another hidden point scorer would also break consistency. No such change is shipped.

Synthetic impact audit (`pointSamplingAuditSmoke`): 24 hours × minutes 00/15/30/45 × four profiles = **384 cases**, **92 different sample instants**, **40 different rounded totals**, maximum **1 point**, for its documented mild hourly native-layer gradient. V1.1's separate 10:45 fixture retains differences of **2/2/2/3 points** for Generic/Boletus/Cantharellus/Lactarius. These are **fixture diagnostics, not a population estimate**. Actual changed legacy production results in this patch: **0**. No golden snapshot or scorer weight is changed.

### Civil-day assembly and interval validation

`weatherIntervals.ts` defines `open-meteo-utc-hourly-civil-v1`. Midnight boundaries are resolved independently through IANA Europe/Ljubljana and calendar-date arithmetic. No boundary is calculated as previous midnight +86,400 seconds.

- **Precipitation:** API hourly accumulation over the preceding hour. A day sums interval-end timestamps in `(startUtc, endUtc]`; the value at the start belongs to the previous day. Rain, showers and snow are included, in mm.
- **ET₀:** preceding-hour reference-evapotranspiration accumulation, with the same endpoint rule, in mm. It is FAO reference ET₀, not measured forest evapotranspiration.
- **Temperature:** instantaneous hourly model samples in `[startUtc, endUtc)`. Their arithmetic mean is the day's mean of equal-duration hourly samples; temperature is never summed as a physical daily total. Display min/max describe available hourly samples, not claimed sub-hour extrema.

Provider semantics: [Forecast documentation](https://open-meteo.com/en/docs), [Historical API documentation](https://open-meteo.com/en/docs/historical-weather-api). Open-Meteo may interpolate coarser model output to its hourly API resolution; these are modelled API-hourly values, not independent station observations. The app does not interpolate missing values itself. Native ECMWF [0–7/7–28 cm variables](https://open-meteo.com/en/docs/ecmwf-api) are requested by their exact names; absent/wrong-unit layers remain unavailable. No substitution from 0–1/3–9/9–27 cm is introduced.

The indexed validator checks UTC Unix seconds, hour alignment, ordering, unique expected instants, units, response contract and retrieval timestamp. A full day expects **23, 24 or 25** elapsed hourly intervals as appropriate. Duplicate/overlapping/half-hour clocks, gaps, unequal variable-array lengths, null values, invalid units and malformed payloads never become zero. Each variable can fail independently; window requirements then determine profile availability. Structural daily compatibility and per-variable coverage/issues are retained in the frozen snapshot.

DST fixtures verify:

| Date | Civil UTC start → end | Hours | Morning soil instant |
| --- | --- | --- | --- |
| 2026-03-29 | 2026-03-28 23:00Z → 2026-03-29 22:00Z | 23 | 07:00Z = local 09:00 |
| 2026-10-25 | 2026-10-24 22:00Z → 2026-10-25 23:00Z | 25 | 08:00Z = local 09:00 |

Spring's nonexistent 02:00 is not manufactured. Autumn's two local 02:00 samples have distinct UTC epochs and are both included. The existing resolver continues to return both ambiguous instants / no nonexistent instant rather than guessing. Soil metadata records original provider epoch, UTC instant, local clock/offset, both native depths, m³/m³, source and retrieval time.

For current/as-of extraction the provider-current epoch must also be representable and not later than the response retrieval timestamp. An invalid or future-labelled current instant is rejected; it cannot authorize a future soil hour as current. Missing or incompatible native layers remain separately guarded for every future date.

### Windows, source seam and frozen vintage

The unchanged canonical window convention remains **[target−N calendar dates, target)**:

| Profile | Rain windows | Temperature | Other required weekly inputs |
| --- | --- | --- | --- |
| Splošno | D7/D14/D30 | T20 | Both native soil depths; D7 and ET₀7 drying balance |
| Jesenski goban | D26 | T20 | Same soil/drying requirements |
| Navadna lisička | D7/D30 | T14 | Same soil/drying requirements |
| Užitna sirovka | D14/D60 | T20 | Same soil/drying requirements |

One archive response covers the older portion of D60 and one forecast response covers recent history plus all future dates, soil and current metadata. Whole UTC dates include the final midnight accumulation endpoint. Each civil date owns **one** endpoint source: dates before base−7 use archive, base−7…yesterday recent forecast history, today onward forecast. The overlap exists only in fetched raw margins; it is not double-counted or used to fill another vintage's gaps. No per-day request, D60→D30 truncation, target-day lookback inclusion or post-target input leakage is introduced.

All seven scorer inputs use this one hourly forecast response. `legacyToday`/`legacyDaily` are separate **diagnostic references**, never blended into candidate weather inputs. The acquisition hook cannot pass a civil-hourly candidate to the main Razmere `onSnapshot` callback: opening the weekly view therefore cannot silently migrate Today's production weather/cache. Production services remain unchanged apart from exporting the existing `cachedFetch` function for reuse; its body, TTL, SQL schema, stale fallback and dedupe are untouched.

### Parity and availability gate

Compatible deterministic fixtures prove all four profiles × seven dates across ordinary, spring/autumn, leap and year-boundary cases. Parity checks compare unrounded rain windows, T14/T20, D7/ET₀7, both soil values and actual sample instants, component arrays/weights, canonical total, and the point Today explanation. Legacy Tomorrow is still derived independently from legacy daily/soil inputs. Saturated factors or equal rounded totals cannot conceal different inputs. Day +2…+6 invoke the unchanged production scorers on validated target-date inputs.

Live public test coordinate 46.5/14.5, **2026-10-14**, returned:

| Profiles | Day 0/+1 | Day +2…+6 |
| --- | --- | --- |
| All four | Unavailable: strict legacy-input parity fails | Five ready results per profile (20 total) |

For that run, legacy T20 **6.769999999999999 °C** vs hourly-civil **6.773125 °C**, T14 **6.721428571428572** vs **6.728571428571428 °C**, and ET₀7 **7.92** vs **7.999999999999999 mm** demonstrate actual source/aggregation differences even without a DST transition in the short window. D60 also differs at floating-point accumulation precision (**251.10000000000002** vs **251.1 mm**). All four rounded Today diagnostics happened to match (69/50/66/88), but inputs/components did not; the scores are correctly **not published**. No rounding hack or UI override is used to assert parity.

These live scores are transient provider results, not golden fixtures or evidence that every location/day/model has sufficient data. Retained gates cover missing/native-incompatible soil, incomplete rain/temperature/ET₀/D60, invalid hourly source/units/intervals, unknown timestamps, failed source-vintage validation and independent Today/Tomorrow parity. A daily-interval gate is satisfied only by proven civil-hourly coverage, not removed universally. Invalid source requests are errors; missing/partial model inputs are insufficient data; usable expired fallback remains explicitly stale. Missing values are never fake 0 or renormalized full-score substitutes.

### Cache, requests and payload cost

The existing 30-minute SQL cache/timeout/in-flight dedupe is reused. New exact-coordinate keys identify endpoint, civil UTC range/base date, full variable set, GMT/Unix/hourly resolution and interval-contract version. Derived memory keys are versioned `civil-hourly-point-v1-2`, bounded to eight snapshots per database, frozen recursively and invalidated by source freshness/base date or changed legacy seed. Fresh warm reopen reuses memory or disk. Old daily caches are retained solely for unchanged production/parity references; they cannot satisfy a new hourly key.

Measured mocked **and live** cold cost: **4 total requests** (two existing legacy references + two additional hourly sources). Concurrent duplicate adds **0**; warm memory/disk reopen adds **0**; date/profile/detail/scroll selection adds **0**. Offline expired rows attempt refresh, then visibly stale fallback; no valid cache means no invented weekly score.

The live hourly payloads were **1,296 archive hours / 28,410 UTF-8 JSON bytes** and **360 forecast hours / 12,392 bytes**, total **40,802 bytes additional decoded JSON**, not compressed wire size. Payloads cover UTC margins and the necessary D60 history; they are not fetched separately for each target or profile. No private test locations/raw payload files are committed. Location/profile generation guards, local midnight/resume handling, SQLite visit schemas, privacy and MapLibre/GeoJSON/LOD remain unchanged.

### Verification and readiness

New `weatherIntervalsSmoke` and `pointSamplingAuditSmoke` cover endpoint semantics, true 23/25-hour days, repeated/missing clocks, zero/null, invalid/duplicate/overlapping/gapped/unequal-length input, independent variables, full raw-window/component parity, no future leakage, native depth metadata, partial/offline/stale behavior and warm/concurrent request counts. Existing seven-day transport tests now provide realistic UTC hourly fixtures and assert the actual four-request cold cost. Hook tests explicitly prohibit replacing main Today with a new hourly candidate. Source-identity tests permit **only** the new `export` keyword on `cachedFetch`; their old scorer/regional golden baselines are not regenerated.

**Map integration verdict: not ready for unconditional seven-numeric-day publication.** The validated builder can be reused only with all availability gates intact. A complete cross-surface migration needs an explicit versioned decision for individual-point as-of soil sampling and civil-hourly weather aggregates, isolated before/after production input/score tests, cache-policy migration and a decision about intentionally coarser regional/cell/habitat contracts. No map UI is implemented here. Today/Tomorrow discrepancies are a real remaining integration blocker, not a provider incapability that can be solved by disabling checks.

Android preview command: `npm run apk -- --name MushroomApp-preview-seven-day-v1-2.apk`. This environment failed with **Unable to establish loopback connection**; no old APK was substituted. No Android device was attached, so native/TalkBack verification remains separate.

Executed on 2026-10-14: TypeScript and **28 deterministic suites passed**: soilSampling, sevenDayConditions, sevenDayUi, weatherIntervals, pointSamplingAudit, conditionsLoading, conditionsAdvanced, weatherGraphsDiscoverability, weatherGraphsNavigation, weatherGraphs, genericWeatherDetails, conditionsCard, screenSafeArea, locationAccuracy, hotspotConditions, hotspotConditionsUi, hotspotRanking, hotspotRankingUi, rankingControls, hotspotTopThree, hotspotHeatmapIntegration, hotspotOverlay, focusedHotspotMap, locationConditionsHook, bottomMapTabNavigation, heatmapNavigation, heatmapTransition and heatmapLod (each `scripts/*Smoke.ts`). The separate public `sevenDayLiveSmoke` probe completed successfully and exposed the real guarded Day 0/+1 differences above. **84,248 regional + 15,688 pilot comparisons were actually executed and remained identical** against baseline 2822a44. Expected offline/timeout fixture warnings are not failed tests. Initial development fixture/type failures were corrected before this final verification; no failed baseline was regenerated.

## V1.3 — Canonical Point Scoring Migration

Status: **COMPLETE for the individual-point contract migration**. Map forecast integration verdict: **READY_WITH_GATES**. This section supersedes V1.2's production migration blocker and four-request cost. It does not promise a numerical score where provider coverage or native soil layers are missing, and it does not implement a map forecast button.

### Root-cause and migration matrix

| Path | Previous production contract | V1.3 contract |
| --- | --- | --- |
| Razmere Today | Exact requested coordinates, legacy daily API aggregates, provider-current floor soil sample, host-date default | Exact coordinates, true Ljubljana civil-hourly windows, explicit provider-current as-of soil, shared point snapshot |
| Seven-Day Day 0/+1 | V1.2 candidate compared against independently acquired legacy daily/soil references; unequal raw inputs correctly blocked publication | Same acquired snapshot and canonical result as production point Today/Tomorrow |
| Selected map-point details | Regional/cell assessment and centre-based conditions navigation | Actual tapped coordinates; point assessment while regional polygon remains a separate approximation; actual coordinates also passed to Razmere |
| Saved hotspot detail/ranking/Top 3/badge/popup | Prepared weather-cell centre where available, nearest current hour, provider-labelled 09:00 tomorrow, legacy daily bins | Saved coordinates, shared point as-of/exact local09 contract and canonical point assessment |
| Visit snapshot capture | Same cell-backed point hook | Same migrated point hook for **new** records; explicit input-policy version and sampling provenance |
| Regional/pilot polygons and regional batch services | Coarse cell inputs, existing nearest/provider-hour and daily-bin contracts | **Unchanged**, intentionally not represented as identical point weather |

The discrepancies were acquisition/input contracts, not scorer weights. Equal rounded totals sometimes concealed different T14/T20, ET₀, soil instants and D60 floating-point accumulation. Mapping saved locations to different weather coordinates also changed environmental inputs. A regional habitat lookup is retained as descriptive context; it does not replace or modify the point score.

### One canonical point source and time contract

`pointConditions.ts` supplies `loadCanonicalPointSnapshot`, `getCanonicalPointWeatherSummary`, `loadPointSnapshots`, and memoized `pointResults`. The production `loadSevenDaySnapshot` delegates to the same source. The legacy loader and `legacyConditionsForLocation` remain explicitly named **audit/reference** functions, not alternative production scoring paths.

New input policy: **`point-civil-hourly-asof-local09-v1`**, paired with `open-meteo-utc-hourly-civil-v1`:

- Requests identify exact latitude/longitude and Ljubljana base date. No GPS substitution or rounding to a prepared weather-cell centre.
- Today soil: unique latest native hourly sample **not later than the provider's validated current UTC reference**, less than one elapsed hour old and belonging to the same local date. At local 10:45 the chosen hour is 10:00, not 11:00. Cached current conditions remain a model snapshot as of that reference, not newly observed forest measurements.
- Tomorrow and +2…+6: unique exact **09:00 Europe/Ljubljana** sample. Metadata retains requested instant, provider epoch, UTC instant, local clock/offset, native depths, units, source and retrieval time.
- Only native **0–7 cm and 7–28 cm**, in **m³/m³**, satisfy the soil contract. No incompatible-depth substitution, rain-derived soil estimate, interpolation or copying Today's soil into future dates.
- Completed lookbacks use **[target−N local calendar dates, target)**. Today's provisional forecast is excluded from Day 0 lookbacks and enters later target-date windows as forecast, not observed history.
- Civil UTC boundaries are resolved independently for each local midnight. Precipitation and ET₀ use preceding-hour endpoints `(start,end]`; temperature uses instantaneous hourly samples `[start,end)`. Units, unique interval membership and complete 23/24/25-hour coverage are validated independently. No fixed +86,400-second day or missing-as-zero fill.
- D60 remains real 60-day history. Archive owns dates before base−7; the one forecast response owns recent forecast history and all future dates. Raw endpoint margins overlap, but aggregation never double-counts them or substitutes another vintage for gaps.
- Both source retrieval timestamps and frozen snapshot identity remain explicit. The provider model-run issuance time is **unknown (`null`)**; retrieval is not mislabelled as issuance. A coherent weekly forecast uses one forecast response, not seven independently fetched runs.

The profile matrix is unchanged: Generic D7/D14/D30 + T20; Boletus D26 + T20; Cantharellus D7/D30 + T14; Lactarius D14/D60 + T20. All require their canonical soil factor and D7/ET₀7 drying inputs for a comparable full score. Existing production formulas, maxima, factor explanations and weights are byte-identical.

### Production wiring, parity and retained safeguards

Razmere uses the point summary and guarded point result. The shared `useLocationConditions` hook migrates hotspot detail, ranking, Top 3, badges/popups and record capture together; their profile/day selection semantics and comparator are unchanged. Selected map detail invokes that same hook for the actual tapped coordinate. It shows a loading/unavailable point result instead of briefly substituting a regional number. There is no seven-day map UI or camera/source lifecycle change.

Equivalent requests reuse the **same frozen object and memoized production result**, not merely independently equal rounded totals. `canonicalPointSmoke` exercises actual HTTP adapters, SQL cache rows, the point service, weekly service, main summary scorer and hotspot/map assessment adapter. It compares raw rain/temperature/ET₀ windows, soil/time metadata, full canonical components/maxima, score, reasons, date and availability for every profile and Today/Tomorrow. Its five base dates include ordinary October, both 2026 DST weekends, leap February and a year boundary; all four × seven results are valid on complete fixtures.

The legacy-comparison gate is retired **only for the explicitly migrated, validated point contract**. Untagged V1.2 candidates retain the original independent legacy-parity checks. A point policy label alone is not sufficient: validation requires the interval contract, exact UTC/DST boundaries, appropriate source ownership and retrieval timestamps, expected per-variable coverage, native soil units/depths, correct as-of/future instant and matching Day 0 summary coordinates/date/raw inputs. Negative fixtures alter soil, ET₀, location, date, units, requested instant, hourly coverage and archive vintage; they must suppress the numerical score.

Remaining gates: invalid timestamps/units, duplicate/gapped/overlapping hourly arrays, incompatible layers, missing required components, incomplete D7/D14/D26/D30/D60 or T14/T20/ET₀7, mismatched snapshot/date/coordinates/provenance and partial API failure. Missing input is not zero and is not renormalized into an apparently complete 0–100 result. Available factor information can remain inspectable, but unverified components are not advertised as confirmed. Expired offline fallback is explicitly stale; no source response is an error, not a fabricated forecast.

Main point hooks refresh at true local midnight and on foreground resume. Exact coordinate/date fences and existing request generations reject late old-location results. Profile/day selection does not acquire another source snapshot. Ranking still batches order changes; Top 3 waits for all attempts, excludes unavailable scores and retains the existing deterministic ties.

### Live-path evidence and measured production impact

Public probe **46.5/14.5, 2026-10-14**, forecast retrieved **2026-10-14T14:54:44.606Z**:

| Profile | Day 0 | +1 | +2 | +3 | +4 | +5 | +6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Splošno | 69 | 68 | 67 | 67 | 57 | 55 | 50 |
| Jesenski goban | 50 | 48 | 47 | 47 | 45 | 44 | 42 |
| Navadna lisička | 66 | 64 | 62 | 62 | 46 | 44 | 38 |
| Užitna sirovka | 88 | 88 | 89 | 88 | 87 | 86 | 83 |

All **28 results ready**, no blockers. The real point/main/weekly source is identical; all four profiles' Today and Tomorrow raw inputs, canonical component/result/reason objects and point soil metadata matched. This is provider availability evidence for that run, not a future golden or universal coverage promise.

Separate pre-migration audits used three **public** points × four profiles × Today/Tomorrow:

- Exact-coordinate legacy daily candidate audit: **24 cases, 0 changed rounded totals/labels**, despite raw aggregate differences. It diagnoses input changes without pretending equal rounded totals establish parity.
- Former cell-backed hotspot versus migrated exact-coordinate live audit: **24 cases, 9 changed totals, maximum absolute change 5 points, 2 label changes, 0 unavailable**. For public-B (46.6/14.9), the former query was 46.560283/14.858279: T20 changed from **11.985** to **9.813749999999997 °C**, Generic Today **71→69**, Tomorrow **70→68**, Boletus **61→56 / 60→55**, Cantharellus **65→61 / 62→59**, Lactarius **90→91** on both dates. Generic labels changed from very good to good; Generic ordering changed **C,B,A → C,A,B**. The other three profile orderings were unchanged. Endpoint retrievals differ slightly, so this is a representative live migration audit, **not** a controlled same-model-vintage population estimate.
- The retained same-source synthetic soil gradient audit has **384 cases, 92 changed sample instants, 40 changed rounded scores, maximum 1 point**; the stronger independent 10:45 fixture has differences 2/2/2/3. These isolate floor-versus-nearest effects but are not real-location population counts.

Thus V1.3 intentionally changes production **point inputs and potentially labels/order**. It does not claim zero point-score changes. Regional/pilot golden outputs are unchanged and are not regenerated. Future provider runs can differ; the three-point audit is not a bound on all possible score changes.

### Cache, network, versions and privacy

The existing `cachedFetch` body, SQL schema, timeout/dedupe/stale fallback and **30-minute TTL** are unchanged. Exact-coordinate hourly keys already distinguish range/base date, endpoint, variable set, GMT/Unix/hourly format; a `current-temp-code-v1` suffix prevents reuse of old responses missing the current description. Point memory keys additionally carry the new input policy. Derived snapshots are recursively frozen, bounded to 128 per database and shared with all point consumers. Per-snapshot/profile weekly results are memoized; repeated day/detail selection is local. Civil periods use a bounded 256-date memo, avoiding repeated IANA work across saved locations.

Acquisition reserves pending point identities before batch execution. Up to **16 missing exact points** share one archive and one forecast request, with at most two groups/four endpoint requests concurrently. Duplicate coordinates and overlapping single-point requests reuse that work. API `location_id` mapping handles reordered rows and the real API's omitted default ID 0; ambiguous identities are rejected. Per-point SQL rows are populated from a valid batch so later single-point and new database-wrapper consumers can reuse disk cache.

Measured production cost: **2 cold HTTP requests**, not V1.2's four. One point and the nine-distinct-point mock batch both require two; concurrent overlapping single-point request, warm memory/disk reopen, profile/day selection and factor inspection add **0 HTTP**. Only missing source rows are fetched. The final live single-point decoded payloads were **28,410 bytes / 1,296 archive hours** plus **12,452 bytes / 360 forecast hours**, **40,862 UTF-8 JSON bytes total**, not compressed transfer size. Nine-point payload scales with nine model outputs; it is not claimed to remain 40 KB. Expired offline refresh attempts remain normal network attempts before stale fallback.

WeatherGraphs V4.1 and its independent read-only daily display service are intentionally unchanged. Opening cold graphs may still require its existing daily requests; the new hourly point cache is not silently substituted into the graph model. Regional weather requests are also separate, unchanged work and must not be counted as point warm-cache misses. The migrated point hook no longer starts regional data acquisition. Point cache publications do not rebuild regional GeoJSON, remount native sources or initiate LOD/camera transitions.

New visit snapshots retain schemaVersion 1 and the existing scorer versions/configs but record the **new inputPolicyVersion**, exact query coordinates, snapshot identity and soil UTC/provenance metadata. Old JSON visits remain immutable and readable under their old policy; there is no schema migration, rewrite or reinterpretation of historical scores. Snapshot compatibility/privacy tests exercise the existing persistence code unchanged.

No hotspot identifiers/names, visits or sharing permissions are uploaded or changed. Weather requests still go only to the existing weather provider. **Granularity changes for formerly cell-backed saved locations:** Open-Meteo now receives the actual requested saved coordinate rather than the prepared cell centre. This is explicit point-weather acquisition, not community publication or a claim of on-site measurements. No private test locations or raw weather payloads are committed.

### Verification, limitations and map readiness

Executed on 2026-10-14: **TypeScript and 43 deterministic suites passed**. The original 28 suites listed in V1.2 were rerun, plus `canonicalPointSmoke`, `pointWiringSmoke`, and 13 extended suites: heatmapPilot, heatmapVisual, heatmapControlsResponse, heatmapLodThreshold, overviewWeatherLoading, regionalLoading, regionalSpatial, locationRanking, localityResolver, heatmapAreaLocality, boletusHabitat, chanterelleHabitat and zgsEnrichment (each `scripts/*Smoke.ts`). Live `sevenDayLiveSmoke` and the two public before/after audits were also executed separately. Initial source-identity test failures were corrected with narrowly scoped migration guards; the unrelated old Chanterelle guard now also permits V1.2's existing `cachedFetch` **export keyword only**. Numeric goldens were not changed.

**84,248 regional + 15,688 pilot comparisons actually passed unchanged** against 2822a44. New wiring guards compare production scorer/transport/cache bodies, regional/LOD/native source/camera code, WeatherGraphs, ranking comparator, Top 3 helper and SQLite persistence against f84a188. They permit only the declared point-detail/coordinate migration. UI tests cover profile/date state, old-location cancellation, Today/as-of10:45, future09, local midnight/resume, loading/partial/stale, navigation and visit compatibility. Native GPU/TalkBack/touch performance is not inferred from JavaScript tests.

**READY_WITH_GATES**: a future map entry can pass the actual selected coordinate to the existing one-location forecast without GPS substitution, navigation reset or map reload. Point and weekly data/contracts already agree and reuse cache; late location results cannot overwrite a new selection. Normal provider/coverage/native-depth gates must remain enabled. There is no unconditional promise of seven numbers, no parity claim with coarse regional polygons, and no known quantitative confidence/model-issued timestamp. New map integration UI is deliberately deferred.

Android skill/environment check found no attached device; native Redmi 13C verification remains outstanding. Attempted `npm run apk -- --name MushroomApp-preview-seven-day-v1-3.apk`: Gradle failed with **Unable to establish loopback connection**. No old artifact was copied or renamed. Run that command locally for a new preview.

Changed runtime files: `src/services/pointConditions.ts`, `src/services/usePointLocalDate.ts`, `src/services/sevenDayConditions.ts`, `src/services/sevenDayHourlyWeather.ts`, `src/services/useSevenDayConditions.ts`, `src/services/heatmap/useLocationConditions.ts`, `src/domain/sevenDayConditions.ts`, `src/domain/soilSampling.ts`, `src/domain/weatherIntervals.ts`, `src/domain/locationConditions.ts`, `src/domain/types.ts`, `src/domain/heatmap/types.ts`, `src/screens/ConditionsScreen.tsx`, `src/screens/MapScreen.tsx`. Test-only changes cover the point/audit/source-guard fixtures and corresponding existing presentation/navigation regression suites; no scorer or regional numerical source was edited.

Changed test/audit files (all under `scripts/`): `canonicalPointSmoke.ts`, `pointWiringSmoke.ts`, `pointMigrationAudit.ts`, `pointSpatialImpactLive.ts`, `pointMigrationSourceGuards.ts`, `sevenDayLiveSmoke.ts`, `sevenDayConditionsSmoke.ts`, `soilSamplingSmoke.ts`, `locationConditionsHookSmoke.ts`, `hotspotConditionsSmoke.ts`, `hotspotRankingSmoke.ts`, `hotspotTopThreeSmoke.ts`, `hotspotHeatmapIntegrationSmoke.ts`, `focusedHotspotMapSmoke.ts`, `bottomMapTabNavigationSmoke.ts`, `conditionsAdvancedSmoke.ts`, `conditionsCardSmoke.ts`, `conditionsLoadingSmoke.ts`, `weatherGraphsDiscoverabilitySmoke.ts`, `weatherGraphsNavigationSmoke.ts`, `weatherGraphsSmoke.ts`, `chanterelleHabitatSmoke.ts`. Together with this document: **37 changed files (14 runtime, 22 tests/audits, 1 documentation)**.

Final verification repeated on 2026-10-15: **TypeScript and all 43 suites passed again**, after checking the point weather identity used by new visit snapshots. Staged diff whitespace checks passed; the live measurements above remain explicitly dated to their 2026-10-14 provider snapshot.
