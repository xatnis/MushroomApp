# Regional Heatmap V2

Offline/static regional expansion. Desktop validation is separate from physical Android acceptance.

## AOI and reproducibility

Centre: **46.470450, 14.850090**, inherited from the verified Pilot V1 geocoder result.
AOI: 75,000 m buffer in EPSG:3035 intersected with Slovenia ADM0. Measured area:
**10,224.214439 km²**. Geographic bbox:
`[13.8743318864, 45.7951075061, 15.8259368376, 46.7129688049]`.

Boundary: [geoBoundaries gbOpen SVN ADM0 metadata](https://www.geoboundaries.org/api/current/gbOpen/SVN/ADM0/),
boundary ID SVN-ADM0-8885693, represented year **2009**, Public Domain according to provider metadata.
Pinned geometry: [revision 9469f09](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/SVN/ADM0/geoBoundaries-SVN-ADM0.geojson).
Attribution: geoBoundaries (William & Mary), underlying source Wikipedia.
This generalized historical boundary is not a cadastral or access-rights map.
Its border precision is a known limitation, particularly near disputed/historically adjusted sections.

```powershell
python -m venv scripts/heatmap/.cache/zgs-venv
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe -m pip install -r scripts/heatmap/requirements-regional.txt
# Cheap dry-run, no WorldCover/ZGS import:
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/prepare_regional.py
# WorldCover bounded COG windows, no global raster download:
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/prepare_regional.py --build
# Resumable, bounded WFS 2.0.0 acquisition and EPSG:3794 aggregation:
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/enrich_zgs.py --regional --data-dir src/data/heatmapRegional
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/test_regional.py
```

Raw boundary/WFS cache remains ignored under `scripts/heatmap/.cache/`.
The published acquisition is dated 2026-09-27. ZGS is a live service without a pinned
historical snapshot endpoint: replaying the retained acquisition cache reproduces that
snapshot; `--refresh` intentionally obtains newer source data and can change results.
WorldCover 2021 v200, class interpretation, pixel-centre aggregation and all species
habitat heuristics remain those documented in `PILOT_V1.md`.

## Size estimate and actual preparation

Dry run: 10,531 cells, **5.3702×** the 1,961-cell baseline; 126 weather points.
Initial area-scaled ZGS estimate: 126,403 stands. Live WFS BBOX hits: **223,386**;
this is a rectangular acquisition envelope, not the final AOI-intersection count.
Do not confuse requested BBOX counts with imported in-AOI stands.
Estimated combined artifacts: 16,109,568 bytes; actual habitat GeoJSON: **5,798,294 bytes**.

The original Pilot artifacts remain immutable regression fixtures. **1,353** original
cells fit wholly within the clipped AOI and retain exactly their IDs, geometry,
WorldCover properties, weather mappings and ZGS aggregates. Original Austrian/border
cells cannot simultaneously retain their geometry and satisfy Slovenia clipping:
clipped replacements receive `regional-*` IDs. Excluded originals remain in the
baseline fixture, not in the active regional extent.

## Transport policy

Reuse the existing daily history/current/forecast derivation without formula changes.
Engineering batching: 25 sampling points per group, at least 15 seconds between cold
group starts. 126 points imply 6 groups / **12 HTTP requests** for one fully cold refresh.
Species/date changes reuse the same dataset; they do not require another weather fetch.
Persistent envelope cache and in-flight dedupe include exact coordinates, base date,
history window and soil policy. Partial failures are not pinned as successful cache entries.

[Open-Meteo docs](https://open-meteo.com/en/docs) support comma-separated coordinates.
[Terms](https://open-meteo.com/en/terms) list free non-commercial limits of 600/minute,
5,000/hour and 10,000/day. [Pricing](https://open-meteo.com/en/pricing) explains that long
date ranges/many variables and multiple locations count as multiple API calls.
HTTP request count is therefore **not** provider-billed call count. Batch25 is our
transport choice, not a claimed API maximum. Reassess commercial terms before rollout.

## Preliminary benchmark and tests

Desktop Node: habitat read/JSON parse 34.5 ms; serialization 29.1 ms;
heap after parse+serialization approximately 23.9 MiB. These are not Android frame-time measurements.
Spatial index build: 20.2 ms; buffered viewport lookup: 1.0 ms. A Črna-area viewport
returned 458 of 10,531 polygons, reducing plain geometry/property payload from
5,797,902 to 211,758 characters. Therefore the mobile source uses viewport filtering
with 20% overscan, preserving the selected polygon; static artifacts are not split
into files. Pan changes rendering only, not weather acquisition.

Live Open-Meteo check on 2026-09-27: 126/126 points, 0 archive failures, 0 forecast
failures. Cold refresh 75,150.8 ms (paced starts dominate); memory-backed SQLite
adapter replay 5.85 ms, identical cells. The latter measures parsing/cache orchestration,
not physical Android SQLite I/O. Planned network count: 12 HTTP requests.

WFS boundary exception: `sestoji.324118` was a legitimate envelope-only BBOX hit;
its exact geometry lay 16.37 m outside the requested box. The importer now excludes
such hits but still rejects features whose envelopes do not intersect the box.
Final GIS tests: all five checks passed, including complete ZGS paging and exact
retained baseline aggregates. Existing nine ZGS tests passed. Source regression
checks preserve weather.ts, mushroomWeather.ts, assessment.ts, config.ts and zgs.ts;
15,688 baseline cell/profile/day fixture comparisons preserve score/components/dataQuality.
Existing navigation, Pilot smoke and Chanterelle regression passed.

## Final data statistics

WFS requested/received/unique: **223,386 / 223,386 / 223,386**, paging complete.
AOI stands: **191,955**. Valid pine values: 191,761; positive pine: 49,670.
194 impossible composition sums remain invalid/missing, not repaired.
Regional cells: **10,531**; wooded: **9,362**; vegetation: **10,422**.
Average ZGS usable coverage: **0.572739**; median: **0.620035**; no ZGS: **348 cells**.

| Profile | Candidate | Unknown | Outside-model |
|---|---:|---:|---:|
| Generic | 10,422 (98.96%) | 0 | 109 (1.04%) |
| Boletus | 8,129 (77.19%) | 1,233 (11.71%) | 1,169 (11.10%) |
| Cantharellus | 8,129 (77.19%) | 1,233 (11.71%) | 1,169 (11.10%) |
| Lactarius | 3,869 (36.74%) | 5,493 (52.16%) | 1,169 (11.10%) |

Pilot artifact directory: **2,999,797 bytes**. Regional directory: **17,288,346 bytes**
(5.76×), including 11,454,066 bytes ZGS enrichment. Baseline remains in Git and is
currently also imported by shared helpers; eliminating that extra runtime baseline
payload is a possible later data-module separation, not a scoring change.

Both regional JSON data files read/parse: **95.25 ms** desktop Node. Full render
preparation: **13.1–27.2 ms** across all eight profile/date combinations. Species/date
switch uses that same pure preparation and makes **0 HTTP requests**. Index creation
plus one selected-area lookup: **7.26 ms**; UI rendering/MapLibre frame timing not measured.
No file chunking was needed on desktop; viewport filtering limits native source payload.

Live search results (all inside coverage): Črna 46.47045/14.85009;
Slovenj Gradec municipal result 46.51088/15.08377;
Velenje municipal result 46.35719/15.11277;
Maribor 46.55583/15.64593; Celje 46.23092/15.26044.
No town coordinates are hardcoded in the app's search.

## Limits / next validation

## Release verification

TypeScript passed. Android `assembleRelease` succeeded in 6m48s; `apksigner verify`
passed. Output: `output/MushroomApp-preview-regional-heatmap-v2.apk`.
Previous APK: 136,162,178 bytes; Regional V2: **140,269,558 bytes** (+4,107,380,
approximately 3.02%). The increase is principally the regional static habitat/ZGS payload.
APK and raw GIS files are not committed.

No national rollout or backend. No new mobile GIS/WFS requests. No model tuning.
Physical Android checks still required: startup memory, cold 75-second loading UX,
pan/zoom across the regional extent, all four profiles, Today/Tomorrow, cell tap/scroll,
conditions navigation, search, private markers and boundary notice. Desktop timing is
not evidence of Android frame rate. Coverage follows a generalized 2009 boundary.

Do not proceed directly to national rollout: first measure native rendering/memory on
the target phone and assess provider usage and slow cold-loading UX. The existing
offline aggregation is reproducible, but nationwide weather acquisition likely needs
selective loading or precomputed distribution under suitable provider terms.
