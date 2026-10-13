# Razmere V2.1 — Advanced details

## Information hierarchy

The V2 overview order is unchanged: location, Gobarski signal/profile selector, WeatherGraphs, compact weather, saved-hotspot Top 3, advanced disclosure.

Previously opening advanced details exposed extra weather rows, a seven-day forecast table, a separate explanation, and another profile-specific calculation card. The score breakdown came last.

V2.1 uses one score explanation first, followed by two initially collapsed subsections:

1. **Kako je izračunana ocena?** — current profile/Today, canonical total and label, up to two existing scorer reasons, individual factors and contribution bars.
2. **Vhodni vremenski podatki** — compact precipitation, temperature, soil and ET₀ rows, coverage and input/context labels. Both secondary disclosures can be open if desired.
3. **Viri in omejitve modela** — completeness, update/stale state, Open-Meteo attribution, modelled/reanalysis/past-forecast provenance, soil/ET₀ limitations, profile evidence/tuning/season notes and remaining canonical reasons.

## Canonical contributions, not a new score

`ConditionsScreen` passes its existing memoized `MushroomConditionsScore` and coordinate-validated summary to `ConditionsAdvancedDetails`. Presentation helpers never invoke a scorer or derive points from the final score.

Each available factor uses its actual `label`, `weightedPoints` and `weight`. Bar fill is `weightedPoints / weight`, not contribution / 100. The canonical production config identifies expected missing factors, without creating numeric contributions for them. Existing `factorBand` display bands provide qualitative statuses; no new biological threshold is introduced.

| Profile | Separate factor rows | Temperature window |
| --- | --- | --- |
| Splošno | combined rain signal, temperature, soil, drying | 20 days |
| Jesenski goban | D26 rain, temperature, soil, drying | 20 days |
| Navadna lisička | D30 rain, D7 rain, temperature, soil, drying | 14 days |
| Užitna sirovka | D60 rain, D14 rain, soil, temperature, drying | 20 days |

Zero contributes a genuine zero-length bar. Missing or invalid contribution/max values show **Ni podatka**, without a fabricated bar or score. If no numeric contribution exists, canonical textual reasons remain available. The total always comes from the scorer, including its existing missing-signal renormalization and rounding. Raw weighted contributions are explicitly labelled as before any renormalization; their rounded sum is not advertised as equal to the rounded total.

## Technical inputs and retained information

The input disclosure preserves available 3/7/14/26/30/60-day rain, 7/14/20-day mean temperatures, both soil layers and ET₀. Rows distinguish the selected profile's actual rain/temperature inputs from additional weather context; seven-day rain is also the drying input. Missing/nonfinite values remain unavailable, never zero. Units are mm, °C, m³/m³ and mm ET₀. Existing historical coverage counts are shown without inferring completeness.

Forecast totals remain explicitly **trend context**, not today's suitability inputs. The duplicated daily seven-day table is removed; a compact **Vremenski grafi →** action opens the existing full-screen graph modal with the same selected coordinates and validated summary. The prominent main graph entry and WeatherGraphs V4.1 are unchanged. Forecast/history daily inspection remains there.

All original scorer reasons, profile season/tuning notes, scientific names, temperature-reference caveats, source update/stale information and commercial attribution warning remain accessible. The model disclaimer is clear: suitability is not probability of finding mushrooms. No seven-day mushroom prediction is added.

## Explanation navigation and lifecycle

**Zakaj ta ocena?** always reveals the explanation, even when already expanded. Manual opening also puts the breakdown first. The native root `View.onLayout` supplies its content-coordinate Y within the single existing Screen ScrollView; the existing design spacing (`spacing.lg`) provides breathing room. Scrolling runs on the frame after layout, with no fixed absolute offset. The ScrollView may naturally clamp at its content end.

`Screen` only gains optional scroll-ref/drag callbacks; defaults, wrapper structure and safe-area ownership remain unchanged. A generation-guarded local coordinator cancels obsolete frames on close, location/profile changes, unmount or manual drag. Profile changes preserve open secondary sections and update their content; location keys and disclosure remount reset subsection state. Location matching and existing weather-request generation protection prevent old data appearing under new coordinates.

There is no new screen, navigation stack or Back handler. Android Back continues using existing app/graph-modal navigation. The disclosure closes through its original main disclosure control. Charts close back to the still-mounted source screen.

## Accessibility and performance

Controls have 48pt minimum touch heights, expanded accessibility state and clear labels. Factor rows expose the numeric contribution/max and qualitative status as text alternatives to decorative bars. Rows wrap and grow vertically rather than clip or shrink fonts. Header order follows the visual hierarchy. Safe-area and bottom-tab inset ownership are unchanged.

Opening, closing or switching advanced subsections is local UI-only: **0 additional HTTP calls**. Score/profile changes retain the existing scorer memo and weather-load dependencies. Weather services, cache/dedupe, model inputs, WeatherGraphs, MapScreen, MapLibre/GeoJSON/LOD, ranking/Top 3, persistence/privacy and snapshots are untouched.

## Verification

`conditionsAdvancedSmoke.ts` executes the actual new component and pure presentation/layout coordinator: all four profiles, canonical numerator/max/ratio, zero/missing/invalid handling, unchanged totals, input usage/units/coverage, collapsed states, complete canonical explanations/attribution, profile changes, stale/unavailable states and guarded post-layout focus.

`weatherGraphsDiscoverabilitySmoke.ts` exercises the actual ConditionsScreen reveal/layout/frame callbacks and graph location handoff, plus unchanged overview/Top 3/context behavior. Screen safe-area tests cover the optional ref/drag plumbing and unchanged inset handling. Existing graph navigation/weather-cache, map/navigation, hotspot/ranking/Top 3 and LOD tests retain their production-source guards; the focused-map guard permits only the precise optional Screen scroll additions.

Automated JavaScript/TSX tests are not a native layout engine. Physical Redmi 13C checks, large system fonts, TalkBack traversal and native scroll animation still need device verification. APK generation is separate from automated test success.

Executed for this change: TypeScript and 21 focused/smoke suites (advanced conditions, graphs/discoverability/navigation/cache, generic detail presentation, conditions card, hotspot conditions/UI, ranking/UI/controls, Top 3, heatmap integration/overlays/focused map, shared location hook, bottom Map tab, heatmap navigation/transition/LOD and shared Screen safe areas). All pass after updating precise presentation-only expectations. The existing production regression runner executed **84,248 regional** and **15,688 pilot** identical comparisons. Warm weather/cache fixtures retain **0 extra HTTP** requests.

The requested `npm run apk -- --name MushroomApp-preview-razmere-advanced-v2-1.apk` was attempted. Gradle failed with `java.io.IOException: Unable to establish loopback connection`; no old APK was copied or renamed. No device was connected (`adb devices` empty), so native verification was not performed. Run the same APK command locally to build the preview.

## Razmere V2.2 — Advanced Details Final Polish

### Safe-area investigation

Both the root Tabs stack screen and tab headers use `headerShown: false`. Inspection of the installed navigator's Screen implementation confirmed that a hidden header supplies no top layout spacer. App-level StatusBar config only sets dark icons; the existing shared Screen used left/right safe-area edges, leaving the headerless Razmere ScrollView without a top-inset owner. This is a confirmed code-level gap consistent with scrolling content behind status icons, not a reproduced native recording artifact (no device is connected).

Razmere alone opts into `Screen.topSafeArea`. The non-scrolling native SafeAreaView owns the actual top inset once and retains its opaque app background. Its ScrollView explicitly clips overflow within the safe viewport; automatic content inset adjustment is disabled for this opt-in to avoid double insets. No status-bar height, manual top content padding, global StatusBar change, absolute mask or new fixed header is introduced. Other Screen defaults, keyboard behavior, bottom-tab inset ownership and graph modal remain unchanged. The Android CLI skill guided environment/inset checks; physical clock/icon overlap still requires phone QA.

The V2.1 measured content-Y focus helper is byte-identical. Its scroll target remains relative to the now-safe ScrollView, with the same design breathing room, post-layout frame and generation/gesture cancellation. Input disclosure changes do not request another scroll.

### Shorter input hierarchy

The main **Vhodni vremenski podatki** remains initially collapsed. On expansion, **Uporabljeno pri oceni** contains only finite values consumed by components actually present in the canonical result. Compact categories are Padavine, Temperatura, Vlaga tal and Izsuševanje; empty categories are omitted. **Dodatni vremenski podatki** is a secondary, initially collapsed disclosure for the remaining context, missing/non-included inputs and forecast totals. Closing/reopening the input disclosure resets the extra disclosure to compact presentation.

| Profile | Rain component inputs | Temperature | Other dependencies |
| --- | --- | --- | --- |
| Splošno | 7/14/30 days, only if its combined rain component exists | 20 days | both soil layers required for soil component; ET₀ + D7 rain for drying |
| Jesenski goban | 26 days | 20 days | available soil layer(s); ET₀ + D7 rain for drying |
| Navadna lisička | independent 30-day and 7-day inputs | 14 days | available soil layer(s); ET₀ + D7 rain for drying |
| Užitna sirovka | independent 60-day and 14-day inputs | 20 days | available soil layer(s); ET₀ + D7 rain for drying |

This is a presentation dependency map of inspected production code, not another scorer. Canonical component presence determines inclusion, so a lone Generic soil layer or D7 rain without an active drying/rain component is not falsely labelled used. Every historical input appears in exactly one subsection. D7 rain is shared by rain/drying but rendered once. Forecast data is always context, never a current-score input. Unknown/non-included values are neutrally identified as additional context; missing values remain **Ni podatka**. Existing units and partial coverage stay visible; full-coverage metadata no longer adds a repeated line to each row.

### Concise explanation and preserved breakdown

The repeated introductory rain/temperature measurement paragraphs are replaced by one sentence naming the actual largest canonical weighted contribution. This is not a new score or a new biological threshold. Zero, unavailable and incomplete contribution cases have honest wording. All original scorer reasons remain accessible in **Viri in omejitve modela**, alongside attribution, uncertainty, renormalization/rounding, soil modelling and historical/forecast caveats.

`advancedFactors` is byte-identical to V2.1: total, names, weights, contribution/max bar ratios, statuses and missing/qualitative fallbacks are unchanged. Main overview order, profiles, graph entry, ranking/Top 3 and navigation architecture are unchanged.

### Accessibility and checks

New headings expose header roles; the extra disclosure announces expanded/collapsed state and retains a 48pt minimum touch height. Key/value rows and long values can wrap and grow with system fonts. Factor text alternatives remain intact. No fixed metric-row heights or smaller fonts are introduced.

Executed: TypeScript and all **21** focused/smoke suites listed above, all passing. Expanded advanced tests cover per-profile actual inclusion, Generic versus species single-layer semantics, absent drying, non-duplicated D7 rain and all input rows, zero/missing/coverage, extra disclosure default/reset, concise contribution-derived explanation, retained canonical reasons, and unchanged factor/focus implementations. Screen tests cover top edge ownership, static background, clipping, disabled auto-insets, no extra manual top padding and unchanged bottom/keyboard behavior. Discovery tests execute the existing measured reveal path and correct source location; source guards preserve models/weather/cache/graphs/Map/navigation/LOD/privacy.

Production regressions executed again: **84,248 regional** and **15,688 pilot** identical comparisons. Disclosure, selection and scroll changes add **0 HTTP requests**; warm weather/ranking fixtures retain zero extra requests. There is no new network or scoring pipeline. Native Redmi 13C status-bar drawing, large fonts, keyboard transitions and TalkBack still need physical verification; JavaScript tests cannot certify native rendering.

V2.2 preview build attempted with `npm run apk -- --name MushroomApp-preview-razmere-v2-2.apk`. Gradle failed with `Unable to establish loopback connection`; the requested APK does not exist and no stale artifact was substituted. Run the same command locally on Windows.

## Razmere — Loading state fix

Confirmed UI bug: the overview unconditionally rendered the canonical scorer result even when the loader had not supplied inputs. `calculateMushroomWeatherScore(undefined, profile)` correctly returns an insufficient-data result, but the screen mistakenly displayed that as a completed evaluation during GPS acquisition, the initial pre-effect render, weather loading and location replacement. This was not a scorer calculation bug.

Presentation now derives readiness from existing GPS/weather flags, coordinate-matched summary, source errors and the current request's coordinate key. No new state machine, timer, acquisition, scorer or cache is added. Initial GPS shows **Pridobivam lokacijo ...**; weather loading shows **Preračunavam razmere ...**. No resolved location shows a selection prompt. Completed input loading shows the canonical score or genuine **Premalo podatkov**. A rejected request or unusable partial response with source errors shows an error/retry message, not model insufficiency. Valid partial results remain usable with existing source warnings. Cached/stale scores remain canonical and visibly show update/stale metadata.

The current-request coordinate ref associates errors with the right location, including the render before the next loader effect clears old error state. Existing summary-coordinate checks, request generations, cancellation, scorer memo dependencies and location/profile selection remain intact. Readiness gates prevent premature insufficient-data text in the primary score card and open advanced section, and missing-value placeholders before the compact weather block finishes loading. Usable completed partial weather remains visible independently of suitability availability. **Zakaj ta ocena?** is disabled only until a completed evaluation is available; genuine insufficient results can still be inspected. Main screen hierarchy and advanced breakdown component are unchanged.

`conditionsLoadingSmoke.ts` executes the actual ConditionsScreen hooks/effects with controlled async GPS/weather promises: pre-effect launch, GPS acquisition/failure, slow weather, profiles while pending, rapid locations/late results, retry/offline/timeout, usable partial data versus source failure, actual insufficient data, warm/stale cache, offline launch and late unmount response. It checks no extra acquisition on profile/disclosure changes and no scorer recomputation on opening details. Existing weather/cache transport suites separately verify warm-cache zero extra HTTP and request deduplication. Production scorers, weather transport/cache, graph components, advanced factor components, map/navigation/LOD, ranking/privacy and snapshots remain unchanged. Native phone confirmation remains separate (no device attached).

The requested `npm run apk -- --name MushroomApp-preview-loading-fix.apk` was attempted and failed with `Unable to establish loopback connection`. No older APK was copied or renamed. Build with the same command locally.

Verification executed: TypeScript and **23** focused/smoke suites (the previous 21 plus loading lifecycle and GPS accuracy), passing. Initial checks required the old discovery test's missing-value expectation to change to loading, and an explicit numeric annotation in the new test harness; the corrected checks were rerun successfully. Regional **84,248** and pilot **15,688** comparisons remain identical. Added presentation generates **0 additional HTTP requests**; loader dependencies and canonical scorer sources are unchanged. Offline/timeout warnings printed by the suites are deliberate test scenarios, not failing tests. Native device verification is still outstanding.
