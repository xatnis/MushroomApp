# Regional progressive weather loading

The baseline pacing measurements below are retained for comparison. For the
current bounded 40-point OVERVIEW transport and zoom-out prefetch policy see
[Overview loading](OVERVIEW_LOADING.md). DETAIL pacing/model semantics are unchanged.

## Diagnosis

The small-window benchmark did not represent the phone's low zoom. A reproducible
Linz/Klagenfurt/northern-Slovenia envelope `[13.2, 45.8, 16.3, 48.5]` intersects
10,524 prepared polygons and requires 122 weather points including overscan.
This is a representative envelope, not bounds extracted from a device screenshot.
Previously five batches imposed at least 60 seconds of pacing alone. Loading
finished only after every requested point. Camera cleanup ignored old UI results
but did not remove their queued requests. Metadata order also replaced viewport
priority. Every progress/merge recalculated all eight profile/date assessments;
SQLite hits could emit one expensive UI update per point.

There was no `disabled` on species/date controls. JS/native rendering pressure is
a plausible cause of perceived non-interactivity, not a physically proven diagnosis.
This change reduces redundant computations and schedules weather UI updates as
React transitions; physical Android interaction remains an acceptance check.

## Policy

- Selected area's point first, then visible points ordered by distance to viewport
  centre, then overscan. Existing 20% overscan/grid/geometry are unchanged.
- 250 ms settled-camera debounce; camera movement invalidates the UI generation
  and aborts its queued work. Already running requests can finish and populate cache.
- At most one batch (25 points, archive + forecast HTTP requests) in flight.
  Starts are at least 2 seconds apart. A conservative local rolling budget of
  75 points/minute applies to these long-history requests. Large views may still
  take over a minute to complete; first useful data does not wait for completion.
- FIRST_USEFUL_READY: at least one required point has a publishable assessment for
  the selected profile/date. VIEWPORT_FULLY_LOADED: all required points do.
  Failures terminate loading and offer retry without removing successful cells.
- Controls and map gestures have no loading lock. Species/date change only selects
  cached assessments. Missing scores remain null; static habitat remains visible.
- Memory + SQLite TTL remains 30 minutes with existing per-point keys and legacy
  grouped-cache migration. In-flight dedupe remains. Completed old requests cache;
  unstarted old work releases pending entries. Return to cached viewport does not fetch.
- Score each immutable source/profile/day only once. Coalesce disk-cache progress,
  suppress unchanged bundle updates, retain prior points on final completion.

Open-Meteo official [pricing](https://open-meteo.com/en/pricing) and
[terms](https://open-meteo.com/en/terms) specify 600/minute, 5,000/hour and 10,000/day
for the non-commercial free service. Long time ranges and multiple locations count
as multiple API calls, not just HTTP requests. The local point budget is an engineering
safeguard, not an account/IP-wide quota guarantee. Other screens/users also consume
quota. [Historical API](https://open-meteo.com/en/docs/historical-weather-api)
documents comma-separated multi-coordinate requests. No provider/semantics change.

## Reproducible tests and measured simulation

`node scripts/runSmoke.cjs scripts/regionalLoadingSmoke.ts --paced`

Real static regional geometry; **mocked 20 ms transport**, actual production pacing.
These are not live API or Android frame-time measurements.

| Window | Visible cells | Required points | First batch | Batches / HTTP | First useful | Full |
|---|---:|---:|---:|---:|---:|---:|
| SMALL ~15 × 22 km | 346 | 13 | 13 | 1 / 2 | 39 ms | 39 ms |
| MEDIUM ~40 × 50 km | 1,579 | 41 | 25 | 2 / 4 | 35 ms | 2.05 s |
| LARGE envelope above | 10,524 | 122 | 25 | 5 / 10 | 38 ms | 62.14 s |

The large completion time intentionally includes the rolling budget. Partial-profile/
date computations were exercised before completion (32 switches in LARGE), with no
extra requests. This does not prove touch responsiveness on a physical phone.
Tests also cover stale queue removal, in-flight caching, debounce, partial failure,
retry, SQLite restart reuse (mock database), pan return, border/hole coverage and null
scores. Verify actual SQLite persistence after Android process restart on device.

Regional regression: 84,248 regional baseline comparisons and 15,688 original-pilot
weather comparisons pass. Scorers, habitat rules, data artifacts and date windows
are unchanged. Desktop full-regional render preparation remains approximately
11–23 ms in the existing regression run; this excludes native MapLibre transfer/render.

Android release attempt failed in Gradle with `Unable to establish loopback connection`.
No old APK was copied. Locally run from the project `android` directory:

```powershell
.\gradlew.bat assembleRelease
Copy-Item -LiteralPath 'app\build\outputs\apk\release\app-release.apk' -Destination '..\output\MushroomApp-preview-progressive-heatmap-loading.apk'
```

On device verify low-zoom progressive rendering, rapid pan, species/date taps during
background fill, polygon details, partial Austria coverage, network failures/retry,
and warm app restart. Real network latency and native large-GeoJSON performance are
not established by the simulation.
