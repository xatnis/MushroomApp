# Koroška Shadow Map UX & Navigation Fix V1.1

Implementation baseline: `8efa381eb763546253f22dfeca735f369c68b0a9`.
This is a presentation/navigation patch, not a weather, habitat or regional-contract migration.

## Confirmed causes and changes

The reported mechanisms were reproduced in source-level deterministic component/hook tests. The physical recording was not replayed on an attached device during this task.

| Observation | Confirmed cause | New behavior |
| --- | --- | --- |
| Large permanent research overlay | Always-visible date and profile strips, repeated selection headings and technical content competed with the map. | Default toolbar contains the development label, permanent stale-research warning, selected absolute date/profile, `Območje` and `Izhod`. Date/profile controls open deliberately in a safe-area sheet. |
| `Območje` placed cells behind controls | Fixed centre/zoom and zero camera padding ignored both overlays and whole polygon extents. | Compute the bounds of the actual 696 polygons once. Pass measured top/bottom overlay frames and map viewport to `fitBounds` on the existing Camera. |
| Score heading clipped after collapsing details | Main score and long provenance shared the same retained vertical ScrollView. | Main score/reason/actions are not scrollable. `Viri` opens a separate bounded sheet which unmounts on close; its scroll offset cannot hide the score or survive reopening. |
| Selected late date/profile off-screen | State changed correctly, but neither horizontal strip revealed its selected item. | Shared measured-strip hook reveals the actual selected item after layout, selection, viewport/content changes or native strip remount. Full-screen and compact date strips use it; the full-screen profile strip and research controls do too. |
| Research date appeared comparable to current point date | Existing out-of-window date gate was correct but origin information was lost at the UI boundary. | Pass immutable display-only research origin into the existing forecast modal and explain the actual loaded point horizon and selected date. |
| Habitat labels seemed contradictory | Frozen research-cell and production-index assessments were not identified separately. | Name both assessment contexts and explain that cells, boundaries, profile or data context may differ; neither verifies habitat at the tapped coordinate. Classifications are untouched. |
| Old research selection/details survived re-entry | Exit/availability cleanup did not clear all local UI state. | Fresh entry starts at research day 0 with the incoming map profile, no cell, no sheet and no point modal. |

## Layout and camera contract

- The selected research date and species remain in the main toolbar, including while a research cell is selected. They are not duplicated in the score card. No old dates are renamed Today/Tomorrow.
- Both persistent cards use natural wrapping text, modest spacing and controls with minimum 48dp height/width. No fixed-height score clipping or nested technical scroll remains.
- Date/profile selection and provenance are deliberate modal sheets, not another navigation stack or forecast implementation. Their height is bounded by the safe-area viewport, with one vertical scroller and a pinned close action. Only date/profile rows scroll horizontally.
- Overlay frames are measured relative to the map, already inside existing app safe areas/tab layout. Camera padding includes those measured frames and ordinary spacing margins, not a device-specific centre offset. The actual polygon extent is used, not the narrower cell-centre selection bounding box.
- `Območje` is the only new bounds-fit trigger. If layout is not ready or fewer than 48dp of unobstructed viewport remain, show a short message rather than fitting into an invalid viewport. It does not schedule a delayed camera jump. Closing the selected cell gives the region action more room.
- Profile/date changes never move the camera. The existing native Map/Camera/source IDs remain stable. Existing exit viewport restoration and ordinary Pogoji LOD logic are unchanged.

Large-font/extremely short viewports can still consume substantial space with essential wrapping text. This patch does not shrink fonts or truncate the date/profile to claim universal fit. The sheets are bounded; the default cards require native font/layout QA, especially at maximum accessibility font scale. An impossible camera-fit viewport is explicitly rejected.

## Selected-strip visibility

`useSelectedStrip` records real item positions, content width, viewport width and native horizontal offset. It scrolls only enough to reveal the selected item, without animation, guessed widths, timers or React per-frame state. A wider-than-viewport item is aligned to its beginning rather than clipped by guessed centring.

The selected local date remains the existing source of truth; the helper never selects another day or changes profile. Stable rerenders do not snap a manually browsed strip back. Layout/content/scroll callbacks carry revision guards, including A → B → A transitions. On data-identity changes only the small native strip remounts to obtain fresh measurements, not the forecast, weather hook or MapLibre. Native remount/reopen also reveals the retained selection.

## Frozen research versus current point forecast

The bundled artifact remains **19–25 October 2026**, four profiles, 696 cells and 11 weather coordinates. Values, provenance, source versions and default-off flag are byte-identical to the baseline. The always-visible warning remains:

> Raziskovalni posnetek — ni aktualna napoved

`Točkovna napoved` continues to use the exact tapped coordinate and existing current-window date gate. A research date outside the current Today + 6 window is not passed as a point date; the existing point view starts at Today. New copy uses the actual returned point dates and says explicitly when the research date is outside that range. If the date is in range, it still warns that matching dates do not imply matching weather snapshots or a regional score. No frozen weather is merged into current weather.

Display-only origin preserves the original research date/profile/habitat/cell/snapshot/contract while the user changes the live point profile/date. It is never passed to acquisition, scorers, habitat resolution, caches, persistence or analytics. Research provenance stays under `Viri` rather than dominating the map.

Frozen research-cell habitat and the production regional index are separate spatial assessments, not necessarily different base source datasets. No particular vegetation or vintage difference is invented. The production point habitat resolver and research habitat result remain unchanged, including unknown/outside-model distinctions. Neither is exact-coordinate ecological validation.

## Lifecycle and Back policy

| Action | Result |
| --- | --- |
| Research date/profile change | Deliberate cell selection persists with newly labelled research context; geometry/camera unchanged. |
| New cell tap | Close research sheets and replace the cell and exact tapped coordinate. |
| Full-screen Back | Close point forecast; retain regional selection/date/profile and existing map context. Point profile/date remain local and do not mutate research/global selections. |
| Research sheet Back | Close that sheet; technical scroll is discarded. |
| Preview Back | Close selected cell first, then exit preview. |
| Explicit exit or loss of availability (tab/list/departure) | Clear cell, sheets, origin and point modal. Do not resurrect them on return. |
| Fresh entry | First absolute research date, incoming global map profile, no selected cell/sheet. Reuse immutable loaded asset/geometry. |

## Tests and scope protection

Commands (repository root, PowerShell):

```powershell
npx tsc --noEmit
node scripts/runSmoke.cjs scripts/shadowUxSmoke.ts
$smokeFiles = Get-ChildItem scripts -File -Filter '*Smoke.ts' | Where-Object { $_.Name -notmatch 'LiveSmoke' } | Sort-Object Name
foreach ($smokeFile in $smokeFiles) {
  node scripts/runSmoke.cjs $smokeFile.FullName
  if ($LASTEXITCODE -ne 0) { throw $smokeFile.Name }
}
node scripts/runSmoke.cjs scripts/regionalRegression.ts
```

The new suite executes real hooks/component wiring with deterministic native boundaries: compact default/warning; explicit measured fit bridge; full polygon coverage; missing/impossible layout; fixed main score; unmounted technical scroll; seven-date and profile reveal, index 5/6 and programmatic selection; late obsolete layout callbacks; compact strip reveal; frozen/current-date and habitat copy; reset/Back; one geometry build; 28 unchanged weekly score objects; zero HTTP. Existing suites continue to cover all 19,488 artifact mappings and global map/navigation/scoring invariants.

Legacy source-pin harnesses isolate only the exact declared strip/source-notice additions. Actual additions are exercised separately, while numerical/weather/habitat/artifact/flag files are pinned unchanged. No golden score, old source fingerprint or standalone guard was regenerated.

Final execution: **TypeScript PASS; all 54 root deterministic smoke suites PASS**, including the new UX suite and existing Koroška prototype, authentic-provider offline replay, point forecast, conditions, cache, ranking, Top 3, habitat, navigation and LOD tests. Active comparisons remain **84,248 regional**, **15,688 pilot** and **2,400 identical soil samples**. The root suite list deliberately excludes live-provider suites; no new authentic weather capture or physical Android result is claimed.

Separately executed `regionalRegression.ts`: **FAIL**, the existing `src/services/weather.ts` normalized-source equality assertion at line 31 against `git show 6127609:src/services/weather.ts`. Its old expectation predates existing optional chart calendar anchors and transport timing/export additions. Neither `weather.ts` nor this standalone guard was changed in this task. This failure is not hidden by the passing active comparisons; the entire repository is not claimed green. No other failure remains in the final active run. During test development a missing native-module mock and an incorrect runner filename were corrected; those were test invocation/harness issues, not scorer failures.

## Performance and unchanged systems

- New UI tests: **0 HTTP**, one bundled acquisition and one geometry construction across date/profile changes, exit/re-entry and local sheet interactions.
- Whole-polygon bounds are computed once per immutable artifact. Measured camera padding and strip lookups do not recalculate weather, scores, habitat or LOD.
- Source data object remains identical across research date/profile changes; only existing paint expressions change. Production MapScreen changes only the marked shadow camera callback.
- No new packages, timers, public flags, datasets, SQLite changes or private-data exports. No CPU/FPS/native GPU timing improvement is claimed.
- Opening an uncached live point forecast still has its existing weather acquisition cost; the new source notice does not add requests or bypass safety gates.

## Changed files

Runtime UI: `useKoroskaShadow.tsx`, `shadowLayout.ts`, the marked MapScreen shadow callback, `SevenDayConditionsView.tsx`, `SevenDayMapForecast.tsx`, `useSelectedStrip.ts`, `forecastSourceContext.ts`.

Tests: new `shadowUxSmoke.ts` and `shadowUxSourceGuards.ts`; focused updates to `koroskaShadowMapSmoke.ts`, `sevenDayUiSmoke.ts`, `mapForecastSmoke.ts`, `mapCompactForecastSmoke.ts`, `pointHabitatSmoke.ts` and `pointMigrationSourceGuards.ts`.

## Build and remaining native verification

Android SDK was found by `android info sdk`. Attempted the existing explicit internal helper:

```powershell
Set-Location 'C:\Users\Uporabnik\Documents\MushroomApp'
node scripts/buildKoroskaShadow.mjs
```

Gradle failed with **`java.io.IOException: Unable to establish loopback connection`**, before a new APK could be produced. No old APK was copied or renamed. This helper enables the flag in the same build process; public defaults remain off.

An optional flagged `expo export --platform android --output-dir dist/shadow-ux-v1-1` verification subsequently stalled without output or an artifact. Only that identified child process was stopped; no JavaScript-export success is claimed. This is separate from the successful TypeScript/smoke checks and the observed Gradle error.

Physical Redmi 13C checklist (not executed here):

1. Default toolbar leaves a useful map area; warning/date/species remain readable at normal, 1.3x and large font scales, portrait and short landscape viewports.
2. Select edge cells; `Območje` fits all polygons between measured controls while maintaining map bearing. Repeat with/without selected card and after rotation.
3. Scroll `Viri` to the bottom, close/reopen, verify the main score never shifts and new details start at top.
4. Open a point date at index 5/6; verify native strip reveals it, and programmatic profile changes reveal the selected species without animated snap loops.
5. Open an out-of-window frozen date; verify Today and loaded point window are explicit, both habitat contexts clear, no implied same-date/source comparison.
6. Exercise Android Back, close buttons, exit/re-entry, list/tab departures and returns; confirm no ghost sheets/cells and unchanged ordinary camera/global day/profile.
7. Check TalkBack selected/expanded states, safe areas, attribution, three-button navigation, touch targets and horizontal-vs-map gestures.

Remaining uncertainty is native layout/gesture/camera projection behavior, not evidence of changed numerical scores or a newly discovered model defect.
