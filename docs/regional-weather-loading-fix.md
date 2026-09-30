# Regional V2 loading regression — root cause

Baseline: 604313e (Regional V2 introduced in 567e5db). Existing uncommitted loading changes were present when this investigation started and are being completed, not discarded.

## Findings before implementation

A. MapScreen called loadHeatmapPilot without a viewport. That service passed all metadata.weatherCells (126) to getRegionalWeather. Its promise resolved only after all six groups of at most 25 points finished. Each group uses two multi-coordinate HTTP calls (archive and forecast); cold starts were paced 15 seconds apart. The supplied desktop benchmark of 75.2 s / 12 requests is consistent with five mandatory pacing intervals.

B. Individual batch exceptions were caught and converted to failed sources. They did not discard successful batches, but no progress callback existed, so even successful cells stayed invisible until the entire loop returned. All-batch failure threw. Each Open-Meteo HTTP request has an 18 s abort timeout. Partial errors returned by the lower service could also enter the bundle's 30-minute memory cache, delaying recovery.

C. Loading and coverage notice were independent JSX branches. Loading depended on the service promise; coverage depended on !isRegionalPoint(mapCenter). Both could be true. Static habitat was imported offline, but heatmapView returned undefined until a complete weather bundle existed.

D. Coverage used the map center against the regional coverage polygon. It did not test selected/search target, current GPS, or the prepared cells intersecting the visible viewport. AppContext stores navigation (enabled/profile/date/selection/viewport), not weather readiness.

E. A center in Austria caused the global not-prepared notice even with prepared Slovenian cells visible. Viewport filtering occurred only after constructing assessments/render geometry for all 10,531 cells, and did not reduce weather requests.

## Scope

Only loading, scheduling, cache ownership, progressive rendering and UI status change. Score functions, habitat rules/artifacts, grids, AOI, species mappings and day semantics remain unchanged. Measurements and validation follow below.

## Implementation

MapScreen selects exact intersecting prepared cells with 20% buffer and their unique weather IDs. loadHeatmapPilot requires explicit pointIds. The untouched national overview gets a local initial heatmap camera; saved/user-chosen viewports are preserved. Initial getBounds and region events supply bounds; camera movement plus a 250 ms debounce defer requests until the viewport settles.

Static habitat renders immediately with insufficient/null-score placeholders. Only visible/buffered geometry enters MapLibre. Original scoring and habitat rules remain unchanged. Successful progress preserves useful cells during pan/retry.

Per-point promises are registered before asynchronous SQLite reads. Overlapping callers share requests and receive progressive results. Successful batches publish before disk persistence. Cache TTL is 30 minutes; keys contain ID, sampling coordinates, policy, base date and time range, but no species or target day. Existing grouped Regional V2 disk entries and the lower Open-Meteo cache remain usable.

Only missing points are multi-coordinate batched (25 maximum; archive + forecast). Existing 15-second batch pacing and 18-second HTTP abort timeout remain. Failures resolve per point; retry skips healthy points. Missing/failed cells have insufficient/limited data quality, never a fabricated score zero.

One derived status chooses LOADING, READY, ERROR or OUT_OF_COVERAGE. Coverage tests exact prepared geometry in the actual viewport, including polygon holes, without using map center. Buffered/selected offscreen cells cannot make an empty viewport covered. Search/GPS moves the camera and its resulting viewport is evaluated. AppContext continues to own navigation only.

Development diagnostics report visible/buffered cells, required points, cache hits, joined promises, missing points, requested batches, request/first-useful/ready durations and failed points. No new precise user GPS logging was added.

## Live cold viewport benchmark — 2026-09-30

Reproducible town windows: +/-0.1 degree longitude/latitude, approximately 15 x 22 km, plus 20% overscan per edge. Raw final measurements and public town bounds: regional-weather-loading-benchmark.jsonl.

| Viewport | Visible cells | Buffered cells | Points | HTTP | First useful | Complete |
|---|---:|---:|---:|---:|---:|---:|
| Črna na Koroškem | 345 | 624 | 13 | 2 | 266.80 ms | 266.89 ms |
| Velenje | 380 | 727 | 12 | 2 | 233.20 ms | 233.29 ms |
| Maribor | 383 | 690 | 12 | 2 | 209.62 ms | 209.71 ms |
| Celje | 385 | 729 | 14 | 2 | 204.27 ms | 204.32 ms |

All four: zero failed points; immediate repeat visits use zero HTTP requests. Actual fetch calls were counted. These are live desktop transport + assessment/render-collection timings using an empty in-memory SQLite adapter, NOT physical Android startup timings. They exclude static/module initialization, real SQLite overhead, UI debounce/camera animation and native frame presentation. First useful means a visible candidate cell has a non-null score; completion covers the buffered window.

The supplied old desktop baseline is 126 points / 12 requests / 75.2 s. Old UI could not become useful before the all-region promise completed; its first frame was not independently remeasured. An earlier successful new run measured 271–323 ms; the table is the final run. A deliberately zoomed-out viewport containing the whole region can still require all points, with progressive batch rendering.

## Pan and border

Fixture with real-town geometry: Velenje requires 12 points; Celje requires 14, including 8 new points. HTTP sequence Velenje / Celje / Velenje / species / date = 2 / 2 / 0 / 0 / 0.

Live pan (regional-weather-pan-benchmark.jsonl): Velenje 2 HTTP, 348 ms; Celje 2 HTTP, cached useful weather after 0.15 ms and complete after 14.887 s; Velenje return 0 HTTP and 0.38 ms; all species/date assessments 0 HTTP. Celje's completion delay is retained provider pacing, not unrelated regional requests. These service timings exclude native rendering.

Border fixture [14.75,46.45,15.05,46.85] has center [14.9,46.65] outside Slovenian coverage, but prepared Slovenian cells remain visible and covered. Wholly Austrian/distant viewports have no prepared cells. Exact geometry checks also reject envelope-only false positives and holes. No Austrian geometry is fabricated.

## Validation

Passed: TypeScript; regionalLoadingSmoke; regionalRegression; regionalSpatialSmoke; heatmapPilotSmoke; genericWeatherDetailsSmoke; boletusHabitatSmoke; chanterelleHabitatSmoke; zgsEnrichmentSmoke; heatmapNavigationSmoke; heatmapAreaLocalitySmoke.

The regional regression loads the original renderer from 604313e and compares its complete output for 10,531 cells x four profiles x two days = 84,248 comparisons. Regional artifacts and original pilot/model sources are checked unchanged. Pilot checks cover 1,961 cells and 15,688 profile/day combinations; 1,353 pilot cells preserved in Regional V2 remain identical.

Focused tests cover viewport/buffer selection, border/hole geometry, exclusive states, memory/disk/legacy cache reuse, TTL expiry, in-flight dedupe and joined progress, partial failure/retry, actual abort timeout, broken disk storage, real-town pan, bundle preservation and species/date zero-refetch.

Reproduce: node scripts/runSmoke.cjs scripts/regionalLoadingSmoke.ts (add --live or --live-pan for network runs); node scripts/runSmoke.cjs scripts/regionalRegression.ts. The runner uses the existing TypeScript dependency; npm run typecheck is separate.

## Android and device limitation

The production Android Expo/Hermes export passed (1,283 modules; approximately 8.8 MB bundle). The requested assembleRelease failed with java.io.IOException: Unable to establish loopback connection. No old APK was copied, renamed or committed. ADB lists no connected device; physical Android visual/pan/startup validation remains unverified.

Build locally:

    cd C:\Users\Uporabnik\Documents\MushroomApp\android
    .\gradlew.bat assembleRelease

After a successful local build, the intended APK destination is C:\Users\Uporabnik\Documents\MushroomApp\output\MushroomApp-preview-regional-weather-loading-fix.apk. This run did not produce that file. APKs/output remain ignored by Git.
