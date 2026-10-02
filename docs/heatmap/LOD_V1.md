# Regional Heatmap two-level LOD V1

## Scope and scale choice

The screenshot-like envelope `[13.2,45.8,16.3,48.5]` includes 10,524 detail polygons
and 122 weather points. This envelope is an explicit simulation, not measured phone
camera bounds. Viewport-first alone therefore approaches a full regional refresh.

Two levels, sharing the existing pure weather scorers:

- OVERVIEW: approximately 4 km habitat units, 20 km weather sampling.
- DETAIL: original 1 km units and 10 km sampling, untouched data and rules.

`HEATMAP_LOD` centralizes display policy. Enter DETAIL at zoom >=9.5. Return to
OVERVIEW at <=9.0. Between them retain the previous level. A new session in this band
defaults to overview. Invalid zoom keeps the previous level.

At latitude ~46.5 degrees, Mercator ground resolution is approximately
`40075016.7*cos(latitude)/(512*2^zoom)` metres per logical pixel. For a 400-point map,
zoom 9.0/9.5 covers roughly 42/30 km horizontally; local 15 km width is near 10.5.
A ~200–250 km-wide view is around zoom 6–7. Actual device width/camera must be checked.
Existing local camera defaults (11.5, search 12, GPS/hotspots 15) remain unchanged.
These are engineering display thresholds, not habitat/scoring thresholds.

### Offline alternatives measured before selecting

| Habitat / weather | Polygons | Weather points | Raw JSON bytes |
|---|---:|---:|---:|
| 4 / 20 km | 704 | 40 | 1,051,625 |
| 4 / 25 km | 704 | 29 | 1,050,010 |
| 5 / 20 km | 462 | 41 | 767,720 |
| 5 / 25 km | 462 | 29 | 766,021 |

4/20 is the least coarse tested option and already cuts large-view polygon count
by 93.3% and weather demand by 67.2%. No Android rendering claim is inferred from this
desktop count comparison. Weather points are not cell centroids: blocks share a
regular centre-aligned 20 km grid; some sampling centres can lie outside clipped land.
Only prepared Slovenian polygon geometry is rendered, exactly as in detail.

## Habitat aggregation

Offline grouping uses the existing centre-aligned EPSG:3035 grid. Union **actual
prepared 1 km geometries**, including border fragments; no new rectangular fill
across Austria or holes, no rendered imagery, no fresh WFS import. Stable IDs encode
4 km grid row/column. The representative point is inside the union.

The TypeScript export bridge calls the existing `habitatStateFor` on every actual
enriched detail cell. Python never reimplements species rules. For each profile:

`stateFraction = sum(detail geometry area with that state) / sum(detail geometry area)`.

Tree cover, grassland and ZGS usable coverage are also area-weighted. A count of
constituent cells is retained. Runtime state aggregation uses:

- outside-model if outside-model area fraction >=80%;
- otherwise candidate if candidate area fraction >=60%;
- otherwise unknown, including mixed/invalid fractions.

60% is a clear supermajority and 80% a conservative outside-model supermajority.
These are new **cartographic aggregate thresholds**, not modified detail thresholds
or biological evidence. One small candidate does not imply a candidate block.
Partial-border areas are weighted by actual prepared area, not missing territory.
ZGS fractions retain their existing meanings; this adds no canopy/host inference.

## Sources, transitions and interaction

`regional-overview-source` / `regional-overview-fill` plus the existing separate
detail source. Both sources and all their layers stay mounted while the native map
is mounted. Native layers have a stable 0–24 zoom range; the unchanged 9.5/9.0
React hysteresis requests a readiness-aware visibility handoff. Competing immediate
native zoom cutoffs have been removed: they could hide a source during a gesture
before the settled-camera React state caught up.

Overview remains visible until detail has usable **visible** weather, prepared GeoJSON
and an incoming visible layer has received `onDidFinishRenderingFrameFully`. Both
layers overlap for that acknowledged native frame. The outgoing layer then hides;
no timer can hide it early. Stale callbacks cannot promote a superseded LOD. There is
no crossfade: installed Android code supports fill-opacity transition, but its
data-driven expression behaviour has not been verified on a physical device; the
short overlap avoids depending on it. Remaining cells use existing no-data styling.

Full coarse geometry stays prewarmed. Detail geometry/available in-memory weather
prewarm starts near 9.2 without extra requests. See [render polish](RENDER_POLISH.md)
for visual coalescing, bounded serialization cache and measured desktop results.
Physical-device flicker and touch responsiveness still need acceptance testing.

Overview taps only show “Približaj zemljevid za podrobnejše pogoje.” and do not mutate
detail selection or open a misleading 1 km card. “Regionalni pregled” stays available
even with controls collapsed. Fine selection is retained in shared state; detail cards
and Conditions navigation appear only at detail LOD. Colours are unchanged; overview
borders are lighter. Overview score is a **regional approximation**, never a precise
micro-location finding probability.

## Loading and cache

The active LOD determines spatial index, required points and weather definitions.
Below the cached-only prewarm band at 9.2, overview does not prepare new detail
geometry or request detail weather. In the band, preparation uses only in-memory
snapshots; network work still exclusively follows the requested, settled LOD.
Existing detail modules/static data still initialize in memory: this is not lazy file
loading, and nationwide static memory is a separate future concern.

Overview point IDs include `overview-20000-weather-…`; detail IDs stay unchanged.
Existing per-point cache keys already include ID, coordinates, date and policy, so the
two sampling grids cannot collide. Shared transport caching at identical coordinates
is safe: the underlying meteorological variables/time windows are identical.

30-minute memory/disk cache, dedupe, timeout, progressive priority and pacing remain.
Each LOD change invalidates the viewport generation and removes queued old work.
Already in-flight batches can finish/cache; the new LOD is next, not behind the old
remainder. One active batch may delay new network data until it finishes/times out;
cached new-LOD data can display immediately. Species/date switches make no new
requests and use the existing Today/Tomorrow derivation/scorers unchanged.

## Reproduction and tests

From the repo root (reuse existing GIS venv):

```powershell
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/prepare_lod.py
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/prepare_lod.py --build --cell-size 4000 --weather-spacing 20000
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/test_lod.py
node scripts/runSmoke.cjs scripts/heatmapLodSmoke.ts --paced
```

Dependencies reuse `requirements-zgs.txt` (Shapely 2.1.2, pyproj 3.7.2), project Node
and TypeScript. No mobile GIS dependency. Artifact records input SHA256 checksums and
existing source attribution. Same WorldCover/ZGS/geoBoundaries reuse conditions as
Regional V2. Only the small derived overview is committed, not raw GIS/build output.
Repeated generation produced an identical SHA256.

## Benchmarks

Real static geometry, **mock 20 ms network**, production scheduler pacing. This is NOT
live API timing or phone frame timing. First-useful measures first weather delivery;
geometry/score preparation is reported separately, excluding native transfer/render.

| View | LOD | Visible / buffered polygons | Points | HTTP | First useful | Full | Score + GeoJSON per profile/day |
|---|---|---:|---:|---:|---:|---:|---:|
| Local 15×22 km, z10.5 | DETAIL | 346 / 625 | 13 | 2 | 37 ms | 37 ms | 1.1–10.1 ms |
| Medium 40×50 km, z9 | OVERVIEW | 117 / 193 | 13 | 2 | 35 ms | 35 ms | 1.0–3.5 ms |
| Large envelope, z6.5 | OVERVIEW | 704 / 704 | 40 | 4 | 26 ms | 2.05 s | 12.5–20.8 ms |

Previous large-view paced simulation: 10,524 polygons, 122 points, 10 HTTP, first
38 ms, completion 62.14 s. First-response timing differences are mock/desktop noise;
the meaningful improvement is less geometry and demand, avoiding the 75-point/minute
budget pause on a fresh overview. Recent other requests can still consume the budget.
All eight profile/day preparations and cached returns add zero network requests.
Repeat run (2026-10-02): large-view first/full 36 ms / 2.05 s; preparation across
profiles/dates 16.5–59.5 ms. Desktop timings vary with host load and are not Android
latency guarantees. The polygon/request reductions, rather than mock latency, are
the reliable before/after comparison.

Data before: 17,288,346 bytes. Overview addition: 1,051,625 bytes (+6.08%); total
18,339,971 bytes. Overview gzip size: 179,348 bytes, **not an APK-size prediction**.
APK delta unavailable: Gradle failed with `Unable to establish loopback connection`.
No older APK was copied. Local output target:
`output/MushroomApp-preview-heatmap-lod-v1.apk`.

Tests pass: TypeScript, LOD boundaries/hysteresis, correct-grid demand/cache keys,
same pure scorers, priority handoff/cache return, area weighting/geometry integrity,
existing progressive loading/navigation/weather/habitat tests, 84,248 regional
baseline comparisons and 15,688 original-pilot weather comparisons.

## Phone acceptance / national future

Check large zoom-out with collapsed/open controls, all four profiles and both days,
pan, coarse taps, slow/offline LOW→DETAIL handoff, threshold oscillation, DETAIL→LOW
cache return, fine selection/Conditions return, markers and border rendering.
No physical Android verification was possible in this run.

LOD is a suitable direction for eventual nationwide display, not approval to roll
out nationwide now: measure device memory/native rendering and provider budget first.
All regional detail artifacts remain in memory; national scale may need geographic
chunks/lazy loading. Overview loses local variation and cannot establish habitat
access, mushroom presence or finding probability.
