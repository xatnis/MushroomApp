# Razmere V2 — Clean Overview

Order: location and relevant GPS/network notices; primary Gobarski signal/profile/score;
Weather Graphs; Vreme na kratko; Najboljša rastišča (up to three); collapsed advanced details.
The primary score is still `calculateMushroomWeatherScore` on the same selected-location
summary and local `weatherProfileId`. It is today's weather suitability, not finding
probability. A location-match display guard hides the previous location's weather while
the existing request generation loads the new point. The loader itself is unchanged.
Two existing reasons and the existing trend are shown; complete reasons,
coverage, species caveats and contribution explanations remain below.

`Zakaj ta ocena?` and `Napredni podatki in razlaga modela` share existing local disclosure
state. Expanded content preserves 3/7/14/30-day rain, 7/14/20-day temperatures, both soil
layers, ET0, forecast dates/rain/min/max, provenance and all original species explanation
components. Extra weather rows omit values already covered by that profile's existing
model breakdown, so the same soil/ET0 table is not repeated. No input, weight or formula
changes. The overview keeps current temperature,
description, existing rain14 and a coverage-safe seven-date forecast sum from the existing
daily-series/presentation helper. Missing data is not zero; forecast includes unfinished
today. Full Weather Graphs V4.1 and its native modal/back/location behavior are unchanged.

The old Razmere-only quality/distance ranking and per-hotspot loaders are no longer used
on this screen. `useLocationConditions` and `topThreeHotspots` reuse the same grouped
point/cache evaluator and deterministic comparator as Rastišča list/map. All saved
hotspots participate, not just the legacy first 30. Wait for evaluation attempts to finish;
exclude unavailable scores but include a genuine zero. Show 0–3 actual results, with
loading/empty/unavailable/retry wording. The main profile also selects the ranking profile;
day remains today, preserving this screen's existing score semantics.

Row tap retains hotspot-focused map navigation with explicit profile/today context.
`Poglej vsa rastišča` sends a typed, timestamped entry intent to the existing Map tab:
list view, own hotspots, cleared search, conditions sorting, same profile/day. Map consumes
the request once per mounted session, using its existing view-switch handler; no camera
focus or map-mode reset is requested. MapLibre/native sources, regional code and LOD are
unchanged outside this additive list-entry handler. No global navigation system added.

No private coordinates are displayed in overview rows or uploaded. Details toggles,
profile selection and graph entry do not add a weather acquisition path. The selected
location still uses its existing loader; hotspot conditions use existing bounded/grouped
cache/dedupe and fetch only missing points. Cold missing points may need the normal batch;
warm profile/list-map reuse is covered by existing hook/cache tests.

Profile chips are horizontal and 48 pt; overview actions/rows are at least 48 pt. Score
and technical rows wrap at larger fonts. One vertical Screen scroll and existing tab
safe-area ownership remain; no extra bottom inset is added. Native Redmi 13C layout,
TalkBack and three-button navigation need separate physical verification.

Verification: TypeScript and 19 relevant suites passed, with 84,248 regional and 15,688
pilot identical comparisons. One existing overview-loading scheduler diagnostic assertion
failed on the last combined run and passed on isolated rerun (about 22 ms handoff); its scheduler,
test thresholds and production sources were not modified. The Android build was attempted
but failed with `Unable to establish loopback connection`; no old APK was substituted.
No phone was attached. Local build:
`npm run apk -- --name MushroomApp-preview-razmere-cleanup.apk`.
