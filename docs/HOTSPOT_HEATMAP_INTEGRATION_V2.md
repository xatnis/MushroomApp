# Hotspot ↔ Heatmap Integration V2

Rastišča → Seznam and Zemljevid are two views of the same current conditions
selection. Scores describe model conditions, not mushroom abundance or a guaranteed find.

## Focused map presentation V3

Physical V2 testing found too little exposed map: two full-width top control rows,
a multi-row large-score popup and an additional full-width open button. V3 changes
presentation only; the selection, grouped weather hook and evaluator below are unchanged.

`HotspotMapCard` now contains a two-line-bounded name, current profile/day, inline
`score/100 · classLabel`, existing stale/missing/loading state and existing privacy badge.
The main surface opens detail with current profile/day; a separate sibling 44 pt X
closes only the popup. A chevron replaces the large CTA. Long names ellipsize after
two lines but their full name remains in the accessible open label. Profile/score copy
wraps rather than forcing a tiny font. The same card is used in ordinary map mode,
where visit count replaces conditions and no conditions hook is mounted.

The compact presentation's short-copy style budget is approximately **120 pt high**:
18/22 pt title, 13/18 pt metadata, 17/22 pt inline score, existing privacy badge,
4 pt gaps and 12 pt padding. This is not a measured phone height; names, stale copy,
missing-state text and font scaling increase it. There is no fixed popup height and
no extra weather information, charts or technical report in the map card.

The context pill and a **44 × 44 pt** layers toggle now share a wrapping top row.
“Moja rastišča” no longer occupies a full-width text pill; its accessible label is
**Prikaži moja rastišča**, checked follows visibility, and ON has a checkmark as well
as filled/active styling. The context text wraps. The row reserves the existing
48 pt location button plus its design gap/right inset instead of overlapping it.
At 320/360/412 pt screen widths, the calculated controls-area widths are
208/248/300 pt and available pill widths are 160/200/252 pt. These are style-budget
calculations, not Android Yoga/text measurements. Wrapping permits a fallback under
larger fonts; extremely small map heights with large text still require device QA.

The ranking map icon is now a contrasted pin with a subtle background/border and
pressed feedback. It remains a separate sibling 44 pt target, so its action cannot
invoke the main row's detail press. Row height/state/order/evaluation are unchanged.

### Current-request camera measurements

The existing single camera focus effect still uses saved coordinates and zoom 15.
After React commits the selected card/context, one RAF requests native `View.measure`
for both non-collapsible wrapper views. A packet contains card height, measured
controls bottom, the exact camera-target object and the profile/day/enabled/map-height
layout key, including a pending-layout revision. Focus waits for both valid measurements.
If an initial native measurement has zero height, a subsequent `onLayout` notification
retries the pending packet. Equal-sized cards do not depend on `onLayout` firing again.
Previous-request or previous-context packets
cannot move the current camera. Cancellation guards also reject late native callbacks.

`hotspotFocusPadding` reuses these dimensions and the existing 16 pt popup bottom /
8 pt breathing room. Its optional marker-height argument is the **52 pt actual shared
annotation frame**, not a geographic pan offset: bottom-anchored markers extend UP
from the coordinate, so their frame is reserved above the padded center. With that
reservation, the helper does not force an artificial 44 pt camera-center window into
the actual bottom card. Padding geometry tests cover 300/400/500 pt map fixtures;
actual MapLibre screen projection must still be checked on the phone.

Focus executes once and is cleared; later score/text layout changes never re-center
the user's map. A user gesture (region-will-change or region-is-changing), closing
the card, opening the filter, hiding markers or switching to list cancels a still
pending hotspot focus. Native measurement cleanup cancels the RAF; latest focus wins.
The existing location acquisition gate is cancelled at explicit focused entry too,
so an older location request cannot subsequently replace that focus.

### Exclusivity, safe area and isolation

The existing overlay reducer still owns popup/filter exclusivity. Opening the filter
hides the compact card; closing the filter restores it if selected. Bottom coverage
notices are suppressed while a hotspot is selected rather than appearing beneath it.
Closing the card keeps Pogoji/profile/day/visible markers. No second overlay/navigation
or scorer state machine is introduced.

The popup remains absolute INSIDE the measured map container at its existing design
bottom margin. MainTabs already owns `62 + insets.bottom` tab height and system bottom
padding, and is not an absolute tab bar. Screen/map do not add that inset again.
Safe-area, Android 3-button/gesture mode and home-indicator behavior are unchanged.

Map sources/layers, LOD/render-confirmation, weather/cache, score/habitat rules and visit
snapshots remain unchanged. UI-only toggles do not rebuild polygons; an explicit focus
zoom can naturally cause the existing LOD pipeline to select detail. Cold popup weather
still uses the same existing grouped/cached point pipeline, not an added request path.
Warm nine-hotspot list-map-list scenarios retain zero extra hotspot HTTP (mock transport).

V3 checks: TypeScript plus 27 smoke suites, including `focusedHotspotMapSmoke`, actual
compact-card/toggle/row handlers, stale measurement/current-context guards, manual-pan
cancellation, viewport padding, warm dedupe and baseline scoring. Regression counts:
**84,248 regional + 15,688 pilot** identical comparisons. No physical device was
attached; native rendering, precise height/font scaling, projection, touch and frame
health have not been measured. The helper failed with the known loopback error and
did not copy a previous APK. Local command:

```powershell
npm run apk -- --name MushroomApp-preview-focused-hotspot-map-v3.apk
```

## Shared selection and view lifecycle

Previously the ranking list had its own profile/day state and unmounted the native
map when selected. V2 adapts the existing AppContext `heatmapNavigation` selection
into the existing typed `ConditionsTargetContext { targetProfile, dayMode }`.
`conditionsContextFromNavigation` / `conditionsNavigationPatch` translate field names;
they are not another store, evaluator or persisted selection. Existing initial map
profile/day defaults are preserved. List and map selectors write the same fields.

The sort remains MapScreen-local, initially **Zadnja sprememba**. Switching to map
and back preserves **Najboljši pogoji** / **Ime**, as well as profile/day. List controls
retain horizontal species chips, segmented dates and the existing three-option menu.

The map stays mounted behind an opaque list sibling, with pointer events/accessibility
disabled and opacity zero while hidden. Its size, camera, source/layer IDs and data
references are retained. Hidden camera events cannot select a different LOD. Regional
weather scheduling/prefetch is paused while the list is visible; caches are not cleared.
The last map render-input reference defers list-only profile/day changes until returning
to the map. The shared selection itself remains current. On return, an actually changed
profile/day legitimately updates polygon colors using the existing visual pipeline;
an unchanged view switch or marker toggle does not rebuild regional GeoJSON.

A normal List → Map switch activates Pogoji for the own-location conditions workflow
without creating a camera target or replacing the current viewport. Sources are not
remounted and no LOD transition is requested. Keeping the native map allocated has
a memory/possible idle-render cost; its Android behavior needs physical-device QA.

## Row map action and overlays

Primary row tap still opens HotspotDetail with current profile/day. A separate sibling
44 × 44 pt map-icon action, labelled “Prikaži [rastišče] na zemljevidu”, reuses
`requestHotspotFocus`. It passes the actual saved coordinates and current conditions
selection. The existing queued intent switches to map, enables Pogoji, selects the
hotspot, shows its popup and collapses the global filter. It also restores marker
visibility if previously disabled.

There is no new camera focus implementation: the existing zoom and measured popup /
compact-controls layout padding are used. The expanded compact controls are measured
as one group for that padding. Only explicit focus actions move the camera. Opening
the global filter hides the popup through the existing exclusive-overlay reducer;
closing the filter restores the selected popup. Closing a popup preserves conditions.
“Odpri rastišče” from a conditions popup also passes the current profile/day to detail.

## Moja rastišča

A compact checkbox-style layers icon for **Moja rastišča** is available alongside the compact
profile/day control and inside the existing global filter. It defaults ON and persists
for the mounted MapScreen session, including list/map switches. It is not permanent
storage. OFF removes only own-marker annotations/badges and closes their popup;
ON restores markers, including those without a score. It does not remove locations,
change sharing or alter heatmap source data. Explicit hotspot focus restores ON.

Native marker annotations remain above heatmap fills. Their badges use the common map
profile/day, never the species saved at an individual location. Badge acquisition is
disabled while the list is visible or own markers are hidden; warm cache data is reused
when shown again. Friends/sharing behavior remains unchanged.

## Evaluation and cache reuse

Ranking, detail, markers and popup still use the same `useLocationConditions` →
`mapConditionsLocation` → `conditionsForLocation` flow, existing point/cell habitat
lookup, production scorers and Today/Tomorrow semantics. No formula, weighting,
weather window, cache duration, grid resolution or scheduler budget changes.

The grouped hook uses the existing memory / SQLite 30-minute weather cache, in-flight
dedupe, progressive subscription and request batching. Ranking results are not copied
into a second assessment store. Warm weather snapshots are evaluated for the selected
profile/day on each surface without HTTP. Only genuinely missing/stale data is fetched.
Regional overview weather is a separate existing spatial pipeline: a 4 km polygon
with 20 km weather is a coarse approximation, whereas own-location scores consistently
use the canonical point/detail mapping (1 km habitat / 10 km weather inside the AOI).
Parity requires the same snapshot/freshness, profile/day and habitat inputs; a refresh
between views can legitimately change a score.

## Privacy and future extensions

Only display/selection/navigation changes are made. Local/private locations remain so;
no community publication, Supabase schema change, visit-snapshot mutation or upload of
private diary data. Existing weather-provider queries retain existing privacy semantics.

An optional popup rank badge is **not implemented**: there is no shared ranked-result
store and a popup must not trigger a whole-list computation. The typed target/day
context can later support ranked-map overlays, score filters, distance-aware comparison,
field-outcome evaluation and other foraging targets. None are implemented in V2.

## Verification and limitations

Focused tests execute actual Map handlers, native source lifetime structure, actual
ranking row actions and rendered card/row/badge/popup components. They cover both
selection directions, list-map-list sort/context retention, real-coordinate focus,
collapsed filters, marker toggle/default/restoration, unchanged evaluator/cache/runtime
sources and exclusive overlays. Equality is checked for all four profiles × two days.

Nine-hotspot **mock transport** scenarios:

| Shared weather points | Cold batches | Cold endpoint requests | Warm/species/day extra | Warm list-map-list extra hotspot HTTP |
|---|---:|---:|---:|---:|
| 1 | 1 | 2 | 0 | 0 |
| 4 | 1 | 2 | 0 | 0 |

These are deterministic mocked forecast/archive counts, not live API timing. Regional
missing viewport weather may independently require requests. Cold loading remains
progressive; cache expiration and larger lists may need more existing-budget batches.

```powershell
npm run typecheck
node scripts/runSmoke.cjs scripts/hotspotHeatmapIntegrationSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotRankingSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotRankingUiSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotConditionsUiSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotOverlaySmoke.ts
npm run apk -- --name MushroomApp-preview-hotspot-heatmap-v2.apk
```

Physical Redmi 13C QA must check row-icon discoverability, compact controls versus
popup space, camera visibility/padding, hidden-map native rendering and returning to
an unchanged viewport. Desktop smoke tests do not measure native frames or actual
phone layout. Never copy a previous APK after a failed build.

Verification for V2: TypeScript and 26 smoke suites passed, covering ranking controls /
UI, shared conditions / hook, overlays, navigation, conditions card, rendering / LOD,
progressive / overview loading, regional indexing, weather, habitat, safe area and
location accuracy. **84,248 regional + 15,688 pilot** baseline assessment comparisons
remain identical; production scoring / weather / habitat / LOD sources are unchanged.
The release helper was attempted, but Gradle failed with
`Unable to establish loopback connection`. No old APK was copied. Run the same command
locally to create `output/MushroomApp-preview-hotspot-heatmap-v2.apk`.
