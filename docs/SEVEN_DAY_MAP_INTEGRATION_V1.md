# Seven-Day Map Integration V1

## Scope and placement

One explicitly selected location, using the unchanged V1.3 point contract. This is not a seven-day regional heatmap, hotspot ranking, Top 3 date filter or new scorer.

The persistent **Napoved · 7 dni** entry sits beside the Rastišča/Pogoji mode switch in the map header, outside the native map viewport and its overlays. It remains available in both map layer modes, but not the internal list view. The row wraps on narrow layouts or larger fonts rather than clipping; no new bottom tab or screen navigator is added.

There are also location-context entries:

- Selected conditions point: forecast action near the existing weather-graphs action, before technical accordions.
- Private hotspot popup: a 48dp calendar action, outside the main detail-tap surface. It shares the close-action rail, or the Top 3 return row, rather than adding a large footer button.

## Explicit coordinate workflow

`mapForecastLocation` accepts the current selected private hotspot, or the actual tap recorded for the current selected heatmap area. Polygon centres, viewport centres, device GPS and the unrelated Razmere/explore location are not fallback inputs.

Without an eligible selection, the entry displays **Izberi točko na zemljevidu za sedemdnevno napoved.** It starts no weather acquisition. A normal tap on the base map, overview or detailed layer selects its actual `lngLat`; tapping a private hotspot uses its actual saved coordinates and existing hotspot focus behavior. Invalid coordinates keep the picker open. Panning/zooming do not choose a point. X or Android Back cancels selection. Existing long-press recording remains unchanged.

Starting this explicit forecast intent cancels a pending GPS acquisition through the existing request gate; starting the picker also cancels an obsolete pending hotspot focus. A late GPS fix cannot move the map or replace the newer forecast selection. Selecting a hotspot within the picker still uses its normal existing focus action.

Ordinary map/marker taps outside this explicit picker retain their existing selection behavior. If the user selects another location while a preview is open, the old forecast closes and the new location's normal detail appears; its forecast action can then be used. An A response is never rendered under B's label.

Layer-mode/session changes clear the transient recorded point, preventing an old cell coordinate from leaking into another mode. A private forecast also checks the saved hotspot ID, current selected ID and exact coordinates. Editing/removing it invalidates the forecast immediately and clears the request, so an obsolete origin cannot silently resurrect.

## Compact preview and full view

The forecast is an expandable part of the existing bottom-detail context: activating its entry temporarily replaces the current detail/filter/Top 3 presentation with a compact forecast panel at the same bottom anchor. It does not stack another large card over the existing panel.

The preview shows the location, inherited profile and seven horizontally scrollable local dates. Each date has its canonical score/label when available, or **Ocena ni na voljo**. A real zero remains a real zero; null is not converted into one. The selected date has a stronger border/background plus accessibility selected state. **Vseh 7 dni** opens the existing `SevenDayConditionsModal` with that day preselected.

The preview and full-screen content do not mount simultaneously. Both use `useSevenDayConditions` and the same point snapshot/result cache; the UI performs no weather-window or suitability calculation. The existing full view retains all profiles, factor contributions, explanations, weather context, source timestamps and uncertainty warnings. Its only API extension is an explicit typed location/source and an optional initial day index (0–6).

Forecast profile selection is local to this one-location inspection. It starts with the map's profile, but exploring another species in the full view does not silently recolor/recalculate the regional map. The map's profile and global Today/Tomorrow remain unchanged on return. Day +2…+6 selection is also strictly local. Razmere's existing controlled profile behavior is unchanged.

## Overlay and Back lifecycle

`MapForecastRequest` is transient MapScreen detail UI intent: picking, preview or full, with explicit coordinates/source, profile, initial day and optional private hotspot ID. It is not another global map mode, navigation stack or scoring state.

While active, the existing map-overlay subtree stays mounted and measured but is visually hidden, noninteractive and excluded from TalkBack. Existing selected point/hotspot, Top 3 origin, filter intent and scroll state are not overwritten just to open a forecast. Only one large presentation is visible. The header discovery control toggles the forecast closed; underlying map controls then resume unchanged.

- Full-screen close/Android Back → the same preview.
- Preview/picker close/Android Back → the prior map detail/filter/Top 3 context.
- A Top 3-origin hotspot keeps **Nazaj na Top 3** on return; the next normal Back retains the existing Top 3 hierarchy.
- Selecting another hotspot, changing layer/view/owner, leaving MapScreen, recentering, place navigation or another explicit focus invalidates the old forecast appropriately.

The existing single MapScreen Back listener owns compact forecast dismissal before the underlying overlay hierarchy. The reused full-screen Modal uses its existing `onRequestClose`; no second map Back subscription is added. Opening/closing the forecast does not navigate back through Razmere or recreate the map screen.

A point chosen solely for a forecast in ordinary Rastišča mode is transient: cancelling that flow restores the pre-picker map, not a new persistent saved location. Re-selecting the same coordinate can reuse its valid cache. Existing selected heatmap points and saved hotspots retain their original selection on forecast close.

## Layout, safe area and accessibility

The panel budget uses measured `mapViewportHeight` and existing `topThreePanelMaxHeight`, reserving at least one third of the map. Underlying top overlays are hidden, so their height is not counted twice. The bottom anchor is the existing popup's design spacing **inside the already tab-inset/clipped map container**; no Android-specific navigation-bar offset or duplicate safe-area padding is added.

Long/large-font content has bounded vertical scrolling, with seven dates scrolling horizontally. The small header row can wrap. New actions have at least 48dp touch targets; date cards have an 80dp minimum without a fixed height. Labels and unavailable/stale states do not rely on color. The preview focuses its heading once after layout, rather than on every score update. The full view retains its existing heading focus and all-edge safe areas. A normal forecast point has a small explicit-coordinate pin.

Native map attribution temporarily moves to the free upper-right corner while a forecast is active, then returns to its original bottom-left position. It is not disabled or covered by the new bottom panel. This uses the installed MapLibre ornament-position API, not a camera offset or source change.

Native layout, nested-scroll gesture arbitration, font scaling, focus traversal and ornament rendering still require physical confirmation; JavaScript style budgets are not device measurements.

## Data, safety and caching

No changes to `pointConditions`, `useSevenDayConditions`, soil sampling, hourly interval assembly, production weights or weather transport/cache. V1.3 remains authoritative:

- Today as-of soil; future exact local 09:00.
- Native 0–7/7–28 cm only, with units/provenance checks.
- True Europe/Ljubljana dates and 23/24/25-hour coverage.
- Canonical rain/T14/T20/D60/ET₀ windows and target cutoff.
- Same-snapshot Today/Day 0 and Tomorrow/Day +1 parity.
- All missing-input, coordinate/date/vintage, interval and native-depth gates retained.

Only an active explicit preview/full view mounts the existing weekly hook. Camera events do not invoke forecast acquisition. Previously loaded selected-point/hotspot weather can already make the preview warm. Reopening checks the existing TTL/dedupe; source failure, partial data and stale fallback retain the existing loading/error/insufficient/stale distinctions. Closing or changing coordinates unmounts the hook; its existing generation/key and cleanup guards ignore late results while shared source work can still warm cache.

No new source key, cache TTL, SQLite schema, snapshot version, API variable or endpoint is introduced. No seven independent day requests. Profile/date/strip actions are local. Map rendering, source IDs/data, camera/focus helpers, regional computation and LOD remain unchanged; an individual marker/attribution presentation is not a heatmap source remount.

### Measured network behavior

Both the deterministic production-adapter fixture and an opt-in live public-coordinate probe exercised these steps:

| Step | Additional HTTP |
| --- | ---: |
| Cold selected point preview | 2 |
| Full forecast from that preview | 0 |
| Return to point context | 0 |
| Reopen same fresh point | 0 |
| Different uncached point | 2 |
| Already evaluated profiles/dates | 0 |

Live probe: `node scripts/runSmoke.cjs scripts/mapForecastNetworkSmoke.ts --live`, 2026-10-15, public 46.5/14.5 and 46.6/14.9, forecast retrieval **2026-10-15T12:56:36.590Z**. Both points returned **28/28 available results**, no snapshot blockers. Counts are measurements, not a UI-enforced two-request rule. An existing warm selected-point/badge snapshot can make the first open zero; expiry/offline refresh can add attempted requests. The offline fixture measured two expired refresh attempts followed by explicitly stale results.

Native pan/zoom/scroll HTTP was not captured on a phone. Source/handler tests show no new forecast request path in camera events; the unchanged regional and visible-hotspot weather pipelines may still do their ordinary independent work. Those requests must not be confused with a forecast reopen miss.

## Privacy

Only coordinates needed by the unchanged weather service are sent to Open-Meteo. Hotspot IDs, display names and annotations stay in local UI/state; no names/IDs are weather query parameters. No community publication, sharing-permission mutation, visit rewrite or private-coordinate test artifact. Saved hotspot persistence and versioned visit snapshots are byte-identical to V1.3.

## Verification and native checklist

New suites: `mapForecastSmoke` executes the actual map entry, base/detail/overview tap, marker, modal profile/close and Android Back handlers, plus the actual preview JSX. It covers no-point/no-GPS behavior, identity invalidation, same-map restoration, Top 3 origin, initial forecast day, loading/null/stale/error, 320/360/412 widths with font scales 1/1.3/2 and accessibility props/layout focus. `mapForecastNetworkSmoke` exercises actual production adapters/cache with cold/warm/different-point/concurrent/offline steps and full-input/factor equality across all four profiles. Existing hook tests still exercise rapid location/profile changes and unmount/late-response protection.

Full-source guards allow only declared forecast UI/tap interception and modal input changes. All V1.3 weather/scoring/sampling/gating services, regional sources, comparator, persistence and navigation implementations remain pinned. Existing test harnesses gained forecast bindings; numerical goldens are not regenerated.

Executed on **2026-10-15**: TypeScript, **45 deterministic smoke/regression suites** (the existing 43 plus the two map forecast suites), and both build-argument/performance-helper smoke tests passed. The helper performance numbers are synthetic parser fixtures, not phone measurements. The complete public live service probe above also passed. Regional **84,248** and pilot **15,688** comparisons actually passed unchanged against 2822a44. Initial failures were missing forecast bindings / old whole-source UI identity expectations; these were corrected narrowly and rerun. Final map handler/source-identity checks were rerun after the last UI cleanup. No production golden values were regenerated.

Native verification checklist (not claimed completed):

1. Redmi 13C, three-button and gesture navigation: discovery row, both map modes, no clipping or system-bar overlap.
2. No point → cancel/tap/drag; ordinary detail and saved-hotspot entries; no centre/GPS substitution.
3. Detail → preview → day +5 → full → Back → preview → X; same camera/zoom/bearing/mode/day/profile and detail scroll.
4. Top 3 → hotspot → calendar → full → return → Nazaj na Top 3.
5. Large fonts/TalkBack: heading focus, seven selected-state labels, unavailable text, last scrollable control, horizontal/vertical gestures.
6. Pan/zoom while loading, rapid A/B selection, close during fetch, offline/stale cache; no mismatched label/coordinates.
7. Native attribution upper-right during preview and bottom-left after close; no native source remount or GPU blank frame.

No Android device was attached (`adb devices` empty). APK helper attempted `npm run apk -- --name MushroomApp-preview-seven-day-map-v1.apk`; Gradle failed with **Unable to establish loopback connection**. No old APK was copied or renamed. Run the same command on the local Windows environment for a new build.

## Changed files

Runtime (5): `src/screens/MapScreen.tsx`, `src/components/SevenDayMapForecast.tsx`, `src/components/SevenDayConditionsView.tsx`, `src/components/HotspotConditions.tsx`, `src/domain/mapForecast.ts`.

Tests/guards (13, under `scripts/`): `mapForecastSmoke.ts`, `mapForecastNetworkSmoke.ts`, `mapForecastSourceGuards.ts`, `conditionsCardSmoke.ts`, `focusedHotspotMapSmoke.ts`, `hotspotHeatmapIntegrationSmoke.ts`, `hotspotOverlaySmoke.ts`, `hotspotTopThreeSmoke.ts`, `hotspotRankingSmoke.ts`, `pointMigrationSourceGuards.ts`, `pointWiringSmoke.ts`, `sevenDayUiSmoke.ts`, `weatherGraphsDiscoverabilitySmoke.ts`.

Documentation: this file. No seven-day map color layer, multi-location forecast, seven-day ranking/Top 3 or new model is included.

## Map Forecast UX V1.1

### Findings and selected-day feedback

V1 stored a preview-local day index, but only used it for the card border and full-screen initial index. There was no dependent selected-day detail section. This was a presentation gap, not a scorer failure. Full-screen day changes also had no return channel to the preview.

The existing transient map forecast intent now retains an absolute `selectedDate` plus its fallback horizon index. Every date tap updates a detail block immediately after the strip: Slovenian weekday/date, canonical score/label or unavailable reason, comparison with Today, and up to two canonical factor contributions. Equal scores explicitly say **Enaka ocena kot danes**; selecting another date still changes the heading, selected accessibility state and its factor context. An unavailable date remains selected. At local midnight the unchanged hook refreshes the date horizon; a selected date still in that horizon remains selected, otherwise the existing valid index is the fallback.

`forecastComparison` is a pure presentation helper. It subtracts actual valid scores only for verified ready/stale results from the same explicit coordinates, profile, snapshot ID, retrieval/assembly timestamps and validated canonical point/hourly contract. Today must be the snapshot's Day 0. Missing, invalid, incompatible or unknown-contract results say **Primerjava z današnjim dnem ni na voljo.** A real zero is valid; null is not. Differences are suitability **points**, never probability percentages. No score override or additional scorer is involved.

Factor insights reuse `advancedFactors`, including the same canonical numerator, maximum, status wording and per-profile factors as the full view. The strongest and weakest available factors are chosen by normalized contribution (`points / maximum`), not raw weighted points. They describe the selected day; they do **not** claim that a factor caused a day-to-day increase/decrease. Unverified components are not presented as confirmed contributions. No weather value or environmental explanation is invented to make equal-score days look different.

### Connected conditions, location and actions

There is still one bounded map-bottom panel, not two stacked detail cards. Its header identifies the location, actual coordinates (display rounded only), forecast profile, and the unchanged regional map day/profile or Rastišča layer. When the forecast date differs from the map's active Today/Tomorrow day, a compact **Pogoji te točke** score for that active day stays visible, using the same point snapshot/profile. The duplicate summary is omitted when it would repeat the selected day's score.

**Napoved za točko** labels the local selected date. Selecting Day +2…+6 does not mutate map Today/Tomorrow, change regional colors, rebuild GeoJSON or represent a point estimate as a regional polygon estimate. Local profile exploration in the full view also does not change the map profile; both profile identities are labelled when different.

The panel directly exposes **Vremenski grafi**, plus **Odpri rastišče** for a saved hotspot or **Shrani rastišče** for a point. The latter uses the existing Record navigation with the exact point coordinates. Existing point explanations/actions remain available via **Pogoji in dejanja točke**, which restores the original mounted detail context; a picker-only point instead offers **Nazaj na zemljevid**. X has the same restoration semantics. The current native map/filter/Top 3 subtree is still kept mounted but occluded, not duplicated. Top 3 origin, underlying selection and scroll state remain intact.

Saved hotspots retain their existing private ID/name and actual saved coordinates. Their existing moved/deleted/selection identity fences remain unchanged. No hotspot name, ID or annotation is added to weather requests, storage schemas or sharing.

### Full view, Back and async identity

**Podrobna napoved** reuses `SevenDayConditionsModal` with the selected calendar date. Its optional date callback reports changes back into the same map intent; Android Back/close returns to the preview with that date and local profile. Razmere callers keep their existing uncontrolled selection behavior. Weather graphs use the existing modal in a mutually exclusive `graphs` phase; Back returns to the same forecast preview. Preview Back then restores the original map detail/Top 3 context. The single existing map Back subscription remains in charge; native modals retain their own `onRequestClose`.

Date/graphs callbacks are fenced by the stable location object of that forecast intent. Multiple batched day taps within one intent accept the latest tap, while a callback captured for A cannot change a newly opened B intent, even for the same numerical coordinates after a new selection. The unchanged weekly hook still owns acquisition generation guards, stale/offline states, profile memoization and late-response rejection. No GPS/viewport/cell-centre fallback is added.

### Android layout and accessibility

The existing measured map-height budget, bottom anchor, attribution placement and safe-area behavior are unchanged; at least a third of the map stays free. Date cards now reserve a 64dp minimum instead of 80dp and put the full score label in the selected-day detail rather than repeating it seven times. They retain a fixed readable horizontal width, flexible text height and >=48dp practical targets. The entire panel has one bounded vertical scroll, with a horizontal date strip and wrapping secondary actions. Long location names are no longer truncated in this inspection view. Small screens/large fonts may require vertical scrolling to read all factors/actions; the overlay does not expand to cover the map.

Selected border/background, actual date text, accessibility selected state, explanatory hint and a polite live detail region provide feedback beyond color. Heading focus remains once on entry, not on every day tap. Native text measurement, TalkBack live announcements, focus traversal, nested scroll gestures, all-factor visibility and Redmi 13C safe areas still require physical verification; no attached Android device was available.

### Verification and performance

Executed on 2026-10-15: TypeScript, all **45 deterministic smoke/regression suites**, build-argument smoke and synthetic performance-helper smoke passed. Regional **84,248** and pilot **15,688** comparisons passed unchanged against 2822a44. No golden model outputs were regenerated. Added focused assertions cover all 4×7 day/detail updates, canonical factor alignment, positive/negative/equal/zero deltas, unavailable/mismatched Today, normalized insight ordering, local date formatting, explicit full-view date precedence and return, rapid batched selections, stale native callbacks, graphs coordinate identity, original context and byte-pinned native map/weather/scoring paths.

The production-adapter network fixture measured **2 cold requests**, **0** for concurrent full view, full-from-preview, return, warm reopen and cached profile/date actions; a different cold point used **2**. It additionally checks comparison/factor presentation against actual production-adapter results. Live public-coordinate probe at 46.5/14.5 and 46.6/14.9 (forecast retrieval **2026-10-15T15:49:17.977Z**) independently measured 2/0/0/0/2/0 for those steps, with **28/28 available outcomes per point** and no snapshot blockers. The UI adds **0 forecast HTTP** on date selection/strip scrolling and no acquisition path in map pan/zoom. Counts are service measurements, not native gesture telemetry. Opening weather graphs explicitly uses their existing separate daily-series cache/request behavior; it is not claimed universally free on a cold graph cache.

No weather transport, TTL, cache keys, canonical point builder, scorer weights/formulas, soil sampling, DST aggregation, safety gate, regional source, camera, LOD, privacy or visit snapshot code changed. Existing source guards now narrowly normalize only the declared V1.1 presentation callbacks/optional modal inputs; an additional whole-MapScreen comparison against 1b71f11 protects the rest of V1.

APK attempted: `npm run apk -- --name MushroomApp-preview-map-forecast-ux-v1-1.apk`. Gradle failed with **Unable to establish loopback connection**. No previous APK was substituted. Run that exact command locally to build; physical Redmi 13C validation remains separate.

## Map Forecast UX V1.2 — Compact Map Experience

### Audit and chosen presentation

V1.1 correctly updated the selected day, but its bottom panel accumulated a repeated forecast heading, location/coordinates, map/profile context, current score, selected score, factors, multiple action rows, timestamps and explanatory paragraphs. That content filled the previous two-thirds-height budget, with the main full-view action inside the vertical scroller. Above the map, the title/count, view switch, permanently visible labelled search field and layer/forecast controls also consumed space. The horizontal date strip nested inside the long vertical panel competed with map exploration. None of those presentation states directly changed the camera; source acquisition was already guarded by explicit point identity.

V1.2 defaults to one compact panel: location heading, profile, regional map-day indication, a horizontal date strip, selected weekday/date, one canonical score/label, and the existing valid comparison with Today. The selected date remains visibly reactive even for equal scores or unavailable results. Numeric scores are no longer repeated inside every date chip; their actual values remain in accessible day labels and the selected summary. Factors, raw inputs, complete explanations and provenance remain in the **existing SevenDayConditionsModal**, opened by **Podrobnosti napovedi** on the same selected date. There is no second inline forecast-detail mode or new sheet dependency.

The primary details action and a single **Dejanja točke** overflow button are outside the panel's vertical ScrollView. Users do not need to find the main action after a long scroll. Coordinates, model-factor rows, source paragraphs and several large buttons are absent from the default body. Saved hotspots show their saved name; arbitrary map-point previews use **Izbrana točka**, without new reverse geocoding. Long headings may ellipsize, with the complete identity available to TalkBack and in secondary actions/full view.

### Responsive budget and fallback

`compactMapForecastHeight` uses the actual measured map viewport: panel maximum = `max(0, mapHeight / 2 - existingBottomAnchor)`. Including its existing bottom spacing, it may occupy at most half the map rather than two thirds. There is no added Android system/tab offset or camera padding. For example, a 560dp map gives a 264dp panel plus its existing 16dp bottom anchor; this is a **style-budget example, not a measured Redmi result**.

The date-strip decision uses the available height and system font scale with readable line/48dp-control budgets, not a Redmi-specific resolution. When that compact budget cannot reasonably accommodate the strip, date choice is deliberately delegated to the full-screen seven-day view. The existing selection and its summary remain; the pinned button's accessibility hint explains that all days are available in the full view. This is the intentional small-screen/large-font tradeoff: do not shrink fonts or expand the overlay across most of the map. The short summary body can still scroll for long labels, unavailable reasons or extreme fonts, while the primary action stays outside it. These budgets do not replace native Yoga/text measurements.

### Header, search and floating controls

Map mode omits the redundant screen-title/count block and uses smaller header padding. The existing top **Zemljevid / Seznam** controls remain. A discoverable 48dp magnifier opens the original search input/results on demand; the close action explicitly clears the query and dismisses the keyboard. Choosing a place/hotspot returns to the compact header using the existing selection/focus actions. An existing nonempty list query remains visible when switching to the map. During a forecast, search presentation is hidden; explicitly choosing search restores it and closes the forecast. No second query state or new geocoding service is introduced.

List mode retains its original title/count, always-available search, conditions controls, sorting and rows. Permission/location warnings and owner controls remain available; they are not suppressed to meet a size target. Header controls wrap naturally at narrow widths/large fonts. Opening search can resize the existing map viewport and invoke its normal viewport pipeline; this is not a forecast acquisition, forced zoom/LOD transition or custom regional rebuild.

The headerless tab/stack and installed navigation `Screen` do not reserve a visible top header inset. Before reducing design padding, MapScreen therefore opts into the existing local `Screen.topSafeArea` contract (as Razmere already does). The native safe-area wrapper owns the real top inset/background once; no guessed clock-height padding, global status-bar change, navigator change or duplicate bottom inset is added. The compact header's design padding is separate from that system inset. Native status-bar rendering still needs phone confirmation.

The single existing location control now sits outside the occluded detail subtree and remains reachable during the preview. Its existing `recenter` action is unchanged: only an explicit press requests GPS/recentering and closes the forecast. Forecast selection still never silently substitutes GPS. Native attribution moves to the free upper-left corner during a forecast, away from both the bottom panel and the upper-right location button, then returns to its original bottom-left position. Native sources/rendering are unchanged.

### Secondary functions, identity and Back

**Dejanja točke** uses the app's existing native transparent-modal action-menu pattern, not another forecast screen or bottom-sheet library. It exposes the same-point active-map-day conditions/profile, weather graphs, save-point or saved-hotspot-detail action, and restoration of the original point detail/context. Coordinates, retrieval time, stale indication and the model disclaimer live here as secondary information. All forecast factors/technical analysis remain in the one full-screen forecast. Menu Back/outside/close dismisses only the menu; choosing an action closes it before invoking the existing callback.

Private IDs, saved coordinates, moved/deleted-hotspot checks, Top 3 origin and async location guards remain unchanged. Weather services still receive only the required coordinates, not private labels/annotations. No SQLite, sharing or visit-snapshot change.

Full-screen Back → compact preview → original map context remains the same. Local profile/date changes do not mutate global Map/Ranking Today/Tomorrow or species, nor imply a future regional heatmap. The explicit selected calendar date is passed to the full view even while preview weather is loading, instead of being discarded when results are temporarily absent. Camera center/zoom/bearing and original point/hotspot state are not reset by date, menu or modal transitions.

### Accessibility, performance and verification

Date chips, primary action, overflow/menu actions and search control have >=48dp practical targets. Date selection retains a border/background, actual changing date/value, TalkBack selected state and polite live summary. Overflow and search announce expanded state. The menu uses all-edge native safe areas, bounded scrolling and a heading focus on show; the existing full-screen heading focus is unchanged. No decorative actionless icons, new animations or UI dependency were added. Enlarged text is not forced into fixed-height rows; the full-view fallback avoids an unreadably compressed seven-column layout.

Executed 2026-10-16: TypeScript; **46 deterministic smoke/regression suites**, including new `mapCompactForecastSmoke`; build-argument smoke; and synthetic performance-helper smoke passed. The latter is not phone performance telemetry. Regional **84,248** and pilot **15,688** comparisons passed unchanged against 2822a44, without golden regeneration. Focused tests execute actual compact header/search/selection handlers, all seven dates across four profiles, loading/unavailable/stale states, selected-date/full return, pinned-action hierarchy, menu actions/Back/outside/48dp/safe area, small/large-font budgets and location-control/attribution placement. Narrow source guards compare the remaining MapScreen against 8967e45 and continue byte-pinning weather/scoring/cache/regional/camera implementations. Original full-screen forecast, weather graphs and navigation implementation files are unchanged.

The production-adapter fixture still measures cold point **2 HTTP**, full-from-preview/return/warm reopen/cached date-profile changes **0**, and different cold point **2**. The 2026-10-16 live public-coordinate probe (46.5/14.5 and 46.6/14.9, retrieval **2026-10-16T07:50:50.644Z**) independently returned the same 2/0/0/0/2/0 request pattern, with **28/28 available outcomes per point** and no blockers. Opening/closing the local action menu mounts no weather hook, and neither date-strip scrolling nor map pan/zoom has a forecast acquisition path. There is no date/menu-triggered MapLibre remount, regional GeoJSON generation or forced LOD transition. Ordinary regional viewport weather may still load as before; graph requests retain their own existing cold/warm cache behavior.

Native checklist remains outstanding: Redmi 13C three-button navigation; actual compact height and last summary line; 320/360/412dp and enlarged fonts; fallback discoverability; horizontal-strip vs map gestures; TalkBack focus/return; menu-to-graph/modal transition; search keyboard/result selection; attribution and location-button spacing; Top 3 → hotspot → forecast → Back roundtrip; pan/zoom during loading and offline/stale states. No device was attached, so these are **not** claimed physically verified.

APK attempted: `npm run apk -- --name MushroomApp-preview-map-ux-v1-2.apk`. Gradle failed with **Unable to establish loopback connection**. No older APK was copied or renamed. Build with the same command locally, then perform the native checklist. Remaining UX limitations are the deliberate full-view date selection on constrained layouts and possible short summary scrolling for unusually long/missing-data text.
