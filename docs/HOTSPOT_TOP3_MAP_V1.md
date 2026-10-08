# Top 3 moja rastišča na heatmapu

Top 3 answers “which of my saved locations currently has the highest model conditions
score?”, not “where are the most mushrooms?”. Pogoji remains the existing weather/habitat
model. No new scoring, ranking bonuses, regional grids or profile/day store.

## UI and context

The 44 pt `Top 3` podium entry is available in Pogoji's existing filter and compact
controls row. The row reserves the location button and wraps on narrower screens;
Top 3 can occupy a second row instead of squeezing the profile text. It is absent
in ordinary Rastišča mode. The panel has current profile/day, up to three ranked rows
(name, score, label, chevron), X, and “Ocena ne zagotavlja najdbe.” No coordinates,
history, factors or duplicate selectors. Long names have two lines and a full accessible
map-action label. Rows and close targets are at least 44 pt.

The bottom panel stays inside the existing map container at its normal design margin.
Its maximum height is the smaller of 50% of measured map height and space below the
measured top controls minus bottom margin/breathing room. All contents scroll internally,
including the header at extreme font sizes. MainTabs already accounts for system bottom
insets; no additional navigation/system padding is applied here. Font scaling, Android
projection and tiny map heights still need physical device QA; this is not a fullscreen modal.

## Shared ranking and completeness

`topThreeHotspots` calls the existing `sortHotspots(..., 'conditions')`, excludes unavailable
or invalid scores and takes the first three. A real zero remains a valid score. Ties retain
the existing repository input order. Neither existing comparator nor list coalescing changes.
Top 3 considers **all own saved hotspots**, not just search matches or visible markers.
With an unfiltered list its final order matches the same conditions-sort list; a deliberately
filtered list can naturally have a different population.

The child uses the same grouped `useLocationConditions` hook as ranking/detail/markers.
The hook now exposes `complete`, keyed to locations/coordinates, base date, active state,
retry/foreground generation and existing debounce. It is false even on the first render
before the loading effect runs. Only the current load's finally publishes completion and
the latest shared bundle; aborted generations cannot finish a newer one. Invalid locations
are unavailable, not fabricated zeros. Empty locations require no request.

Until attempts settle, partial assessments are never presented as final Top 3. Afterwards,
show 1–3 valid entries, or unavailable copy and retry. No hotspots shows the save-first
message. Failed points do not block successful entries after completion. Cached stale results
retain the same assessment/ranking semantics as the list; Top 3 isn't a separate freshness policy.

Profile/day are always shared current context. They synchronously re-evaluate the same
snapshot and do not restart transport or completion. No async ranking result store can label
one species' results with another species' heading.

## Overlay lifecycle and focus

The existing `heatmapControlsReducer` owns `topThreeOpen` alongside filter intent.
Opening Top 3 collapses the filter, closes the selected-hotspot popup and temporarily
hides a selected regional card without clearing regional selection/source geometry.
Opening the filter closes Top 3 and gives the existing filter temporary priority over
any preserved regional selection; dismiss/leave clear that priority. X / Android Back close Top 3 without changing profile,
day, heatmap mode, list sort or marker visibility. Listener cleanup runs on close/blur.
Leaving map, switching to list or disabling Pogoji clears the transient open state.

Row tap closes Top 3, clears search so the chosen marker is not accidentally filtered out,
and calls the existing `focusHotspot` with saved coordinates. Existing zoom/padding,
post-layout native measurements, latest-target guards and gesture cancellation stay intact.
The existing compact popup and selected marker highlight are used. Explicit focus restores
“Moja rastišča” ON; merely opening Top 3 never changes that preference. OFF doesn't prevent
ranking own saved locations. At most one large filter/popup/Top 3/regional-card overlay is visible.

## Cache, performance and privacy

Top 3's child mounts lazily after first use, then stays mounted when closed. Reopening does
not restart acquisition. It disables weather work while the map/list is inactive or Pogoji
is off. Existing memory/SQLite cache, point/grid lookup, source assessment memoization,
bounded batching and in-flight dedupe are reused. There is no copied evaluation cache:
returning from the list evaluates the shared cached snapshot with the same point evaluator.
The first activation uses the existing 250 ms settled load/cache check.

Weather/progress updates stay inside the child; MapScreen doesn't subscribe to Top 3 progress.
Pan does not alter its location/context acquisition key. No regional GeoJSON rebuild, source
remount or LOD transition is requested just to open/close the panel. An explicit hotspot focus
can naturally change viewport/LOD using the existing pipeline. No runtime weather/scorer,
cache expiry, visit snapshot, AppContext/cloud schema or sharing permissions change.

Deterministic transport fixtures: nine locations sharing one weather point use one cold
batch / two forecast+archive endpoint requests, not nine pipelines. Warm disk/memory,
species/day changes and reopen have **zero extra hotspot HTTP**. Existing four-point fixtures
also use one batch/two endpoints and zero warm roundtrip requests. These are mocks, not live
provider latency measurements; cold missing points and expired caches can require requests.

All own hotspots remain private under existing rules. No community publication, coordinate
logging/upload pathway or Supabase change. `targetProfile/dayMode` remains reusable; future
ranked-map filters, distance-aware presentation, field outcomes and other foraging targets
are not implemented.

## Verification

Run `npm run typecheck` and `node scripts/runSmoke.cjs scripts/hotspotTopThreeSmoke.ts`.
The focused suite executes the real panel and Map intents/back listener, shared comparator,
ties/invalid/partial/empty cases, current profile/day, focus coordinates, visibility and overlay
cleanup. Location-hook tests cover first-render completeness, generation cancellation,
foreground/cache, nine-point dedupe, zero selection/refetch and retained-child reopen.
Existing conditions UI tests compare ranking/detail/badge/popup/**Top 3** scores for all
four profiles × two days. V3 focused tests continue exercising native measurement guards,
padding geometry, manual-gesture cancellation and no second camera snap.

Phone layout/touch/GPU behavior is not proven by desktop smoke tests. Local APK command:

Implementation checks passed: TypeScript and 28 smoke suites; **84,248 regional +
15,688 pilot** unchanged scorer comparisons. No physical device was attached. The release
helper was attempted and Gradle failed with `Unable to establish loopback connection`;
no old APK was copied and the named output was not created.

```powershell
npm run apk -- --name MushroomApp-preview-hotspot-top3-map.apk
```

Never copy a previous APK after a failed build.
