# Regional LOD render polish

## Earlier pass: confirmed code causes (baseline 8ec4daf)

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

## Final targeted pass: baseline 4e3cb3d

The native-zoom suspicion is **not supported by current code**. Before/after this
pass, both overview and detail fill/border/highlight layers use native minzoom 0,
maxzoom 24. `HEATMAP_NATIVE_RANGES` now centralizes those SAME values and tests their
overlap. React selection remains detail >=9.5, overview <=9.0. There is no reason to
narrow the native range to 9–10: readiness must take precedence at any supported zoom.

The confirmed code defect is an unqualified render acknowledgement: Android's
`MLRNMapView.onDidFinishRenderingFrame(fully,...)` forwards a **map-wide** event,
without a source/layer generation. Previously `pendingFrame=true` plus any such
event immediately finished the handoff. A queued old/basemap frame could therefore
hide overview without proving the new detail layer was in that frame. A focused
test reproduces this ordering; exact physical GPU provenance remains unmeasured.

## Implementation

Stable source/layer IDs, no key-based remount, both sources mounted for the lifetime
of the native map (switching to the separate list view legitimately unmounts the map).
Visibility uses a native-render-query acknowledged overlap, not competing zoom cutoffs.
The LOD selection remains >=9.5 detail / <=9.0 overview. In-flight stale handoffs
cannot promote an obsolete target. A full-frame event only triggers
`MapRef.queryRenderedFeatures` on the incoming **fill layer**. The installed Android
implementation queries rendered viewport features on the UI thread, not raw source
data. The request is filtered to at most three expected visible cell IDs. At least
one result must match the current expected id, score, renderState and dataQuality.
Old no-data tiles and empty/basemap-only replies cannot complete the handoff.

Each incoming data/viewport revision gets a generation token. Query replies and
scheduled RAF callbacks from previous generations are discarded. Motion, LOD changes,
profile/date readiness changes, disable and unmount cancel the confirmation. Only one
query per current generation can be in flight; no interval/polling loop is introduced.
After a matching native query, retain the outgoing layer for exactly one additional
requestAnimationFrame, then hide it. No opacity animation/crossfade is added. Query
failure conservatively retains the outgoing layer and a later native frame may retry.
This is stronger layer evidence, not a GPU screenshot fence; phone validation remains
required before claiming physical ZERO EMPTY FRAME acceptance.

Populated detail data are retained until a new complete JS collection/string can be
swapped in. Empty selections do not clear a populated source. Initial hidden detail
has an empty placeholder until first preparation; this is not a visible transition
frame. No camera, selection or model changes are made.

All 704 coarse features stay prewarmed, even at detail zoom. This is a small bounded
static source, not extra regional weather fetching. Detail prewarm near 9.2 uses only
snapshots already held in memory. No new detail weather requests start at overview.

Local visual settlement: **60 ms** (previously 100 ms) after the existing **settled** camera event, cancelled
if motion resumes. Network settlement: the existing separate 250 ms timer is unchanged.
Before the earlier pass, visuals had no explicit local debounce; only network used 250 ms. Gains
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

Earlier-pass single-run results on this desktop (baseline 8ec4daf → 4e3cb3d; timings vary):

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
The final pass benchmarks 100/60/45 ms. A deterministic settled-event burst at
0,20,70,90,140 ms runs the actual production visual and network timer wrappers with
a virtual clock and real grid filtering/preparation:

| Visual delay | Updates / source changes | After final event | Stable network callbacks |
|---|---:|---:|---:|
| 100 ms | 1 / 1 | 100 ms | 1, at +250 ms |
| 60 ms | 1 / 1 | 60 ms | 1, at +250 ms |
| 45 ms | 3 / 3 | 45 ms | 1, at +250 ms |

60 is the lowest tested value retaining burst coalescing, reducing software latency
by 40 ms without a source-update storm in this fixture. Real timer checks also run;
they include host timer jitter and are not an Android optimum/jank guarantee.

Final-pass local-path measurements (synthetic weather, real geometry; representative):

| Operation | Calculation only | Debounce before → after | Rebuilds/source changes before → after |
|---|---:|---:|---:|
| Overview pan, full 704-cell source already installed | ~0.1–0.3 ms cache; no visual filter needed | 100 → 60 ms local check | 0/0 → 0/0 |
| Detail pan, 625 buffered cells | ~2–3 ms filter + ~2 ms prepare/serialize | 100 → 60 ms | 1/1 → 1/1 |
| Overview → detail, cached geometry | ~0.05 ms cache + unmeasured native query + one RAF | cached handoff, no network wait | 0/0 → 0/0 |
| Detail → overview, prewarmed | ~0.1–0.2 ms cache + unmeasured native query + one RAF | cached handoff, no network wait | 0/0 → 0/0 |

Current-case rebuild counts are compared to **4e3cb3d**, not the earlier remounting
implementation. This pass reduces waiting and strengthens confirmation, not model
calculation cost. Neither queryRenderedFeatures nor RAF rebuilds GeoJSON. Species/day
switches still update both prepared sources (~7–8 ms combined in a desktop sample),
with zero weather requests, source remounts or unrelated card-driven rebuilds.

Estimated settled detail update is local delay + local filter/prepare + React/native
processing. The native part and perceived latency remain unmeasured. Overview pan
with unchanged weather already has the whole coarse source installed and needs no
source update. A LOD handoff requires matching rendered incoming features plus one
RAF before hiding the old layer; there is no assumed 16 ms or invented first-rendered
timing. Source/layer IDs, nonempty retained data and overview tap behaviour are unchanged.

Dev-only logs contain render attempts/commits, per-source submitted data-change
counts, cache rebuild counts, preparation/serialization timings and handoff latency.
They contain no GPS coordinates or telemetry. For physical comparisons, subtract
counter snapshots before/after each gesture; `[heatmap native handoff]` records
`verifiedLayer` and `extraRaf:1`, but is still not a pixel/framebuffer capture.

## Validation and physical acceptance

Focused tests cover nonblank handoff, stale callback refusal, rapid zoom
8.8→9.2→9.6→9.3→9.7→8.9, effective-set/cache reuse, relevant/irrelevant weather,
date isolation, empty-grid retention, UI independence and coalescer cleanup. Final
tests also cover map-wide basemap-only callbacks, stale native query replies, wrong
incoming properties, cancelled extra RAF, native query failure, native range overlap,
the rapid sequence 8.8→9.6→9.3→9.7→9.1→9.6 and stable 250 ms network scheduling.
Existing LOD/progressive/navigation/spatial/pilot/species tests remain applicable.
Regional baseline verifies 84,248 cases; pilot weather/habitat baseline 15,688 cases.

On Android: repeat overview/detail pans, rapid zoom, species/date changes during
progress, card open/close, zoom near the border, and controls hide/reopen. Observe
that old coverage stays visible, no blank flash occurs, selection/camera stay put,
and counters do not grow for unchanged data. Brief overlapping shading may be visible
for the acknowledged frame. Native basemap/style loading can postpone the full-frame
event; until then the outgoing layer remains rather than creating a blank map.

The final-pass build was attempted via the helper and failed with
`java.io.IOException: Unable to establish loopback connection` (Gradle exit 1).
The helper did not copy an old APK; no successful new Android build is claimed.
Final-pass build command (fresh-success-only helper, no old APK substitution):

```powershell
npm run apk -- --name MushroomApp-preview-heatmap-final-render-polish.apk
```

Successful output: `output/MushroomApp-preview-heatmap-final-render-polish.apk`.
If the same environment error recurs, run this exact command locally; the helper
copies only the successfully rebuilt fresh APK.
