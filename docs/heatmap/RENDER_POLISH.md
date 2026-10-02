# Regional LOD render polish

## Confirmed code causes (baseline 8ec4daf)

- Detail `GeoJSONSource` was conditionally mounted only for detail LOD. IDs were
  stable, but overview/detail transitions destroyed/recreated the detail source.
- Overview maxzoom changed to 9.0 immediately when JavaScript saw usable detail
  weather. Detail minzoom was 9.0. Native camera zoom could cross the limit before
  React received `onRegionDidChange`; JavaScript readiness was not native readiness.
- There was no explicit pan clear-to-empty, but a newly mounted detail source could
  still be processing while overview was already hidden. An out-of-coverage filter
  could also replace source data with an empty collection.
- Every progressive bundle identity rebuilt overview; its changed reference also
  invalidated detail. Selected-card state was part of geometry dependencies.
- The installed MapLibre RN `GeoJSONSource` stringifies object data in its render,
  not in a data-identity useMemo. Inline child/press props meant unrelated MapScreen
  renders could repeatedly serialize the same geometry.

These are inspected code paths, not a recording of the user's Android GPU frames.

## Implementation

Stable source/layer IDs, no key-based remount, both sources mounted for the lifetime
of the native map (switching to the separate list view legitimately unmounts the map).
Visibility uses a native-full-frame acknowledged overlap, not competing zoom cutoffs.
The LOD selection remains >=9.5 detail / <=9.0 overview. In-flight stale handoffs
cannot promote an obsolete target. The full-frame event describes the map, not a
per-source fence; physical-device validation remains required.

Populated detail data are retained until a new complete JS collection/string can be
swapped in. Empty selections do not clear a populated source. Initial hidden detail
has an empty placeholder until first preparation; this is not a visible transition
frame. No camera, selection or model changes are made.

All 704 coarse features stay prewarmed, even at detail zoom. This is a small bounded
static source, not extra regional weather fetching. Detail prewarm near 9.2 uses only
snapshots already held in memory. No new detail weather requests start at overview.

Local visual settlement: 100 ms after the existing **settled** camera event, cancelled
if motion resumes. Network settlement: the existing separate 250 ms timer is unchanged.
Previously visuals had no explicit local debounce; only network used 250 ms. Gains
come from stable source lifetime, cache hits and fewer native submissions, not a
claim that a previous visual timer was reduced from 250 ms.

Weather visual updates use an 80 ms fixed coalescing window (first batch immediate),
not a trailing debounce which could starve. Five quick updates produce one visual
commit of the latest snapshot. Requests, disk/memory TTL, pacing and dedupe are unchanged.

A 12-entry LRU caches render results plus serialized GeoJSON by LOD, profile, day,
base date, ordered effective cell IDs and identities of only relevant immutable
weather assessments. UI/card selection and irrelevant weather are not keys. Both
native data props receive stable strings: unchanged data are not repeatedly encoded.
Selected-card assessment is separate and does not regenerate the grid. At a profile
or date change, both prepared sources update to that selection, with no network work.

Native source `tolerance` (0.375), `buffer` (128), `maxzoom` (18) remain the installed
defaults. No physical native-processing benchmark justified changing them. No geometry
simplification, scoring, habitat interpretation, sampling or date-semantic changes.

## Desktop benchmark and limitations

Run `node scripts/runSmoke.cjs scripts/heatmapVisualSmoke.ts` from the repo root.
Fixtures reuse all real geometry and pure scorers with synthetic weather. This is
not a live HTTP benchmark, Android React profiler or native/GPU frame capture.

Representative single-run results on this desktop (timings vary):

| Operation | Local preparation | GeoJSON rebuilds before → after | Data submissions before → after |
|---|---:|---:|---:|
| Overview pan, unchanged weather | ~0.09 ms cache hit | 1 → 0 | 1 → 0 |
| Detail pan, 625 buffered cells | ~2.3 ms filter + 1.9 ms prepare | 2 → 1 | 2 → 1 |
| Overview → detail, cached prewarm | ~0.06 ms | 0 | 0; visibility changes only |
| Detail → overview, prewarmed | ~0.13 ms | 0 | 0; visibility changes only |
| Species switch, both sources | ~7.2 ms | 2 → 2 | 2 → 2 |
| Danes → Jutri, both sources | ~6.8 ms | 2 → 2 | 2 → 2 |
| Twenty unrelated UI operations | cache hits | 0 | 0 |
| Five rapid relevant weather updates | one 80 ms window | up to 10 → at most 2 | up to 10 → at most 2 |

These counts are state/cache path counts, not measured React commit counts. A source
with byte-identical serialized results is not submitted again. The script separately
reports key formation, model/property construction and serialization durations.
60/100/120 ms settlement candidates are simulated with real timers and local work;
100 is an initial engineering compromise, **not a measured Android optimum**.

Estimated settled detail update is local delay + local filter/prepare + React/native
processing. The native part and perceived latency remain unmeasured. Overview pan
with unchanged weather already has the whole coarse source installed and needs no
source update. A LOD handoff requires a full native frame before hiding the old layer;
there is no assumed 16 ms or invented first-rendered timing.

Dev-only logs contain render attempts/commits, per-source submitted data-change
counts, cache rebuild counts, preparation/serialization timings and handoff latency.
They contain no GPS coordinates or telemetry. For physical comparisons, subtract
counter snapshots before/after each gesture; `[heatmap native handoff]` is a map-wide
render proxy, not proof of which tile first appeared.

## Validation and physical acceptance

Focused tests cover nonblank handoff, stale callback refusal, rapid zoom
8.8→9.2→9.6→9.3→9.7→8.9, effective-set/cache reuse, relevant/irrelevant weather,
date isolation, empty-grid retention, UI independence and coalescer cleanup.
Existing LOD/progressive/navigation/spatial/pilot/species tests remain applicable.
Regional baseline verifies 84,248 cases; pilot weather/habitat baseline 15,688 cases.

On Android: repeat overview/detail pans, rapid zoom, species/date changes during
progress, card open/close, zoom near the border, and controls hide/reopen. Observe
that old coverage stays visible, no blank flash occurs, selection/camera stay put,
and counters do not grow for unchanged data. Brief overlapping shading may be visible
for the acknowledged frame. Native basemap/style loading can postpone the full-frame
event; until then the outgoing layer remains rather than creating a blank map.

Build attempted with `npm run apk -- --name MushroomApp-preview-heatmap-render-polish.apk`.
This environment failed with `java.io.IOException: Unable to establish loopback connection`;
no new APK was copied and no older APK was substituted. Build locally with the same
command, or the requested Gradle assembleRelease + output copy commands.
