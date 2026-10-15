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
