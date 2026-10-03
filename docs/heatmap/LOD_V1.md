# Regional Heatmap two-level LOD V1

## Scope and scale choice

The screenshot-like envelope `[13.2,45.8,16.3,48.5]` includes 10,524 detail polygons
and 122 weather points. This envelope is an explicit simulation, not measured phone
camera bounds. Viewport-first alone therefore approaches a full regional refresh.

Two levels, sharing the existing pure weather scorers:

- OVERVIEW: approximately 4 km habitat units, 20 km weather sampling.
- DETAIL: original 1 km units and 10 km sampling, untouched data and rules.

`HEATMAP_LOD` centralizes display policy. Enter DETAIL at zoom >=9.2. Return to
OVERVIEW at <=8.5. Between them retain the previous level. A new session in this band
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
is mounted. Native layers have a stable 0–24 zoom range; the 9.2/8.5
React hysteresis requests a readiness-aware visibility handoff. Competing immediate
native zoom cutoffs have been removed: they could hide a source during a gesture
before the settled-camera React state caught up.

Overview remains visible until current detail geometry is prepared and the incoming
layer is confirmed by a whole-viewport native rendered-feature query. Weather is
not a geometry-readiness requirement: neutral no-score cells are valid. A genuinely
empty detail source uses a post-submission native frame rather than a positive query.
Both layers overlap for one additional RAF after confirmation. The outgoing layer then hides;
no timer can hide it early. Stale callbacks cannot promote a superseded LOD. There is
no crossfade: installed Android code supports fill-opacity transition, but its
data-driven expression behaviour has not been verified on a physical device; the
short overlap avoids depending on it. Remaining cells use existing no-data styling.

Full coarse geometry stays prewarmed. Detail geometry/available in-memory weather
prewarm starts at 8.8 without extra requests. See [render polish](RENDER_POLISH.md)
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
Below the cached-only prewarm band at 8.8, overview does not prepare new detail
geometry or request detail weather. In the band, preparation uses only in-memory
snapshots; network work still exclusively follows the requested, settled LOD.
During a gesture, crossing the prewarm band captures **one current visual-only
viewport**. It does not filter the previous zoomed-out bounds or update network
bounds on every native camera frame. On settlement the normal 60 ms visual path
prepares the final bounds. Superseded prewarm views cannot certify a different
current source revision; the existing native generation/queued-frame guards remain.
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

### Earlier activation camera-cost check (2026-10-03)

Run `node scripts/runSmoke.cjs scripts/heatmapLodThresholdSmoke.ts`.
Actual regional geometries, north-up / zero pitch Web Mercator camera, a **400×650
logical-point map** centred on Črna (46.470450, 14.850090). Weather points include the
unchanged 20% overscan, not one request per polygon. Preparation includes building
and serializing neutral/static-habitat GeoJSON; the median is five fresh-cache builds
after the first build. Timings are one desktop run, not Android/native frame timing.

| Zoom | Visible detail cells | Buffered cells | Required detail weather points | Prepare median |
|---|---:|---:|---:|---:|
| 8.5 | 3,590 | 6,577 | 83 | 39.0 ms |
| 8.7 | 2,816 | 5,134 | 67 | 31.9 ms |
| 9.0 | 1,975 | 3,522 | 49 | 25.7 ms |
| 9.1 | 1,768 | 3,115 | 45 | 25.3 ms |
| **9.2** | **1,577** | **2,760** | **39** | **19.3 ms** |
| 9.5 | 1,125 | 1,947 | 28 | 15.4 ms |

At Celje with the same screen, zoom 9.0 requires 5,162 buffered cells / 66 points /
3,488.5 KiB serialized source; 9.2 reduces this to 4,237 / 57 / 2,863.8 KiB.
The larger 520×800 Črna simulation similarly reduces 5,411 / 70 / 3,606.9 KiB to
4,204 / 54 / 2,770.4 KiB. Five-build medians at 9.2 are ~23 ms (Celje) and ~31 ms
(larger Črna); source cache hits are normally sub-ms, but host pauses can be longer.
The first/JIT-heavy run and GC/host contention have visible variance.

**Choose 9.2, not 9.0:** the latter almost doubles buffered polygon load versus 9.5
and can approach the existing 75-point/minute scheduler budget on a larger view,
before other recent requests. 9.2 is an earlier compromise, reducing demand versus
9.0 by 14–23% in these samples. It still has more detail demand than the old 9.5
threshold: this is not a promise of unchanged cold-start network volume or zero
Android jank. The map at activation is ~23% wider than at 9.5. Local typical zooms
10.5–15 and all data/scoring results remain unchanged.

At 9.2 a completely cold view needs 4 HTTP requests at Črna or 6 for the other two
samples (two per group of up to 25 points); cache/in-flight hits reduce this.
Prewarm sends **zero** requests and changes no target LOD. Identical prepared
cell sets/snapshot/profile/day return the same serialized source object; a changed
viewport gets its own cached revision. Species/day switches remain zero-refetch.
The 60 ms visual and 250 ms network debounce remain unchanged. Slow zoom switches
target at 9.2 (not 9.5); zoom-out retains detail until 8.5. Rapid zoom and native
confirmation tests preserve outgoing fallback, stale-generation rejection and
the no-empty-frame state invariant. Actual device response requires another video.

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
