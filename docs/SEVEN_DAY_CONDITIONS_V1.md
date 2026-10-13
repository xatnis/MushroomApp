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
