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
