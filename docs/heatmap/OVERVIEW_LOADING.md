# Overview weather loading (2026-10-04)

## Confirmed bottleneck

Baseline e505307 used a 25-point batch for BOTH grids, one batch operation in
flight and 2,000 ms start spacing. LARGE `[13.2,45.8,16.3,48.5]` contains 704
coarse cells and requires all 40 overview points. Two batches (25+15) meant four
HTTP requests. With 120 ms mocked transport, about 1.86 s was imposed between
batches; a live baseline measured 1.26 s imposed waiting. Archive and forecast
were already independent concurrent requests (`Promise.allSettled`); unchanged.
JS preparation of all 704 polygons takes milliseconds/tens of milliseconds on
this host, not the two-second pacing gap. Native MapLibre transfer/frame latency
is not measured by Node; do not present JS readiness as Android colored-frame timing.

## Bounded transport policy

- An exclusively overview request set of at most 40 points uses a 40-point cap.
  Larger/mixed/detail requests retain 25. This is an engineering cap, NOT a
  documented provider maximum. Both actual endpoints returned the 40-point set
  successfully with unchanged variables/windows; there were no failed points.
- One archive+forecast pair in flight, not 40 individual requests. No increased
  batch concurrency and no global removal of spacing. Cold LARGE is one batch / two
  HTTP requests. Cache misses only are sent; both LOD keys retain IDs/coordinates/date.
- Shared rolling budget remains 75 points/minute, including speculative work.
  Other request sets still observe 2,000 ms starts. Exhausted budget may still
  impose a long foreground wait; this optimization does NOT bypass that safeguard.
- Optional zoom-out prefetch is at most six points, after 250 ms settlement,
  only descending DETAIL zoom in `(8.5,8.8]`. It does not run on pinch frames,
  alter target/displayed/transition LOD, or change user loading/error state.
- A successful small prefetch can allow ONE serial foreground overview
  continuation within five seconds: initial+continuation <=40 points, with the
  SAME shared rolling budget. This avoids a prefetch creating a new two-second
  delay before remaining points. No subsequent burst slot is retained. DETAIL
  cannot use this exception. Speculative work that would wait for spacing/quota
  is skipped; cancellation drops unstarted work. In-flight results cache normally.
- Foreground and prefetch use the same per-point Promise ownership, memory and
  SQLite cache (30 minutes). No repeated requests for pan-back or selection changes.
  Invalid/failed speculative data is not merged over useful foreground snapshots.

Official [forecast](https://open-meteo.com/en/docs) and
[archive](https://open-meteo.com/en/docs/historical-weather-api) docs support
comma-separated coordinates. [Terms](https://open-meteo.com/en/terms) specify
600/minute, 5,000/hour and 10,000/day for non-commercial use;
[pricing](https://open-meteo.com/en/pricing) explains long-range/multi-location
weighted accounting. Two HTTP calls are NOT two billable/quota calls. The local
point budget is not an account/IP-wide daily/hourly quota guarantee or permission
for commercial free-tier use. Do not multiply burst concurrency for national scale.

## Coverage priority and diagnostics

Overview ordering: focused/selected point if inside viewport, one central visible
point, then descending visible-cell gain with distance as tie-breaker, then buffer.
Each coarse cell maps to exactly one weather point, so static per-point counts
equal marginal gain after cached points are filtered out. No spatial optimizer,
interpolation, grid/resolution, model or habitat change. For this LARGE view the
first 25 points would cover 65.20% under distance ordering versus 84.66% under gain
ordering. The full 40-point cold batch removes the remaining inter-batch gap.

Dev-only `[heatmap overview coverage]` logs first/50/80/100 once per
viewport/date/profile using publishable weather assessments. It is **weather
readiness**, not verified mushroom habitat or proof of native colored pixels.
Unknown/outside habitat and legitimately limited optional inputs can stay neutral
even at 100% weather readiness. Logs include counts/timing, never user coordinates.
Transport diagnostics split request duration, scheduler waits and cache hits.
Existing source-submit/map-frame diagnostics and 80 ms result coalescing remain.

All 704 overview geometry references stay static. The measured cold path prepares
an initial neutral view plus one useful view (previously neutral + two batches).
No incremental-GIS rewrite is justified by the current measurements. First useful
results are published without waiting for disk persistence or other batches. Copy
already changes from 'Nalagam vreme …' to 'Dopolnjujem podatke …' when useful data
exists; controls never acquire a loading lock.

## Benchmarks

Actual production loader with real geometry and deterministic weather. Isolated
desktop run, 120 ms transport fixture; native rendering/React commits excluded:

| LARGE cold | Baseline | Optimized |
|---|---:|---:|
| Points / batches / HTTP | 40 / 2 / 4 | 40 / 1 / 2 |
| First request start | 68 ms | 47 ms |
| First useful / 50% JS ready | 229 ms | 204 ms |
| 80% / 100% JS ready | 2,220 ms | 204 ms |
| Last transport completed | 2,206 ms | 184 ms |
| Imposed between-batch gap | 1,857 ms | 0 ms |
| Initial + weather source preparations | 3 | 2 |
| Final GeoJSON build+serialization | 20 ms | 19 ms |

Live desktop observations (different requests/times/provider cache conditions,
NOT controlled Android SLA): baseline first/50% 766 ms, 80/100% 2,134 ms, full
2,140 ms; optimized first/50/80/100% 567 ms, full 592 ms. Optimized transport
498 ms, scheduler wait 0 ms, failed points 0. A separate raw 40-point validation
took 251 ms transport. Endpoint latency varies; faster 80% coverage is primarily
the removed pacing gap, not a promise that a larger batch always returns first sooner.

Warm memory: 0.65 ms, zero requests. New loader + populated mock SQLite: 3.25 ms,
zero requests, 100% cache hits. Android process restart with real SQLite must be
checked on a phone. Round-trip overview/detail selections do not share wrong-grid
keys; return to valid overview cache sends zero additional requests.

Zoom-out simulation: 6-point prefetch covers 19.60% initially; remaining 34 use
one continuation, 28 ms from handoff to full readiness with **10 ms mocked
transport**, zero imposed wait, max batch concurrency one. Total HTTP including
prefetch is four (two before handoff, two after), not an increase in sampled points.
Rapid zoom back-in cancels queued work; one already-running prefetch may finish
before the next detail batch, but no stale background queue remains ahead of it.

The normal 250 ms settled-viewport debounce and 60 ms visual settlement are
unchanged and excluded from service-only cold timing. First useful coalescer output
is immediate; subsequent near-simultaneous progress is coalesced within 80 ms.

## Reproduce and acceptance

```powershell
node scripts/runSmoke.cjs scripts/overviewWeatherLoadingSmoke.ts
node scripts/runSmoke.cjs scripts/overviewWeatherLoadingSmoke.ts --benchmark --before
node scripts/runSmoke.cjs scripts/overviewWeatherLoadingSmoke.ts --benchmark
node scripts/runSmoke.cjs scripts/overviewWeatherLoadingSmoke.ts --live
npm run apk -- --name MushroomApp-preview-overview-weather-speed.apk
```

Tests cover batching/budget, gain ordering, coverage milestones, stable descending
prefetch, skipped speculative waits, single bounded continuation, in-flight dedupe,
restart cache, stale in-flight caching/detail priority, partial failures and actual
cached profile/day bundle access. LOD/render/navigation/controls/progressive tests
pass; 84,248 regional and 15,688 pilot model comparisons remain identical.

Phone acceptance: cold zoom-out time to mostly useful coverage; real disk restart;
rapid zoom-out/back-in; all species/days while loading; border/unknown habitat;
panel X stays dismissed; provider errors/retry. A larger batch makes failure apply
to more points, though partial endpoint failures retain existing semantics and
retry remains available. Free-provider latency/account-wide limits can still dominate.

The release helper was attempted and failed with `Unable to establish loopback
connection` (Gradle exit 1). No previous APK was copied; the named output does not
exist. Run the same `npm run apk` command above locally for this revision.
