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

## Earlier targeted pass: baseline 4e3cb3d (implemented in 5271cdf)

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

## Stuck-transition correction: baseline 5271cdf

### Distinguishing target from display

The previous UI's "Regionalni pregled" label already used `heatmapLod` (the zoom
target), not `handoff.displayed`. Therefore a recording still showing that label
cannot establish that target was detail: it indicates target had not changed yet.
Native Android emits `onRegionIsChanging` on camera movement, but the app only
observed zoom in `onRegionDidChange` (camera idle). A continued slow pinch could
leave logical target overview until the gesture ended. We now observe zoom during
motion, changing React state ONLY on a 9.5/9.0 hysteresis crossing. Viewport bounds
and the 250 ms network scheduling remain camera-idle only; no weather work is
started by intermediate camera events.

Separately, the code can reach target detail / displayed overview while waiting:

- It required a publishable weather score before making the incoming geometry visible.
- It queried the whole native viewport, but restricted results to three sampled IDs,
  omitting neutral/no-weather cells. A rendered cell outside those IDs could not confirm.
- Only a map-wide **fully** rendered event triggered queries, tying local handoff to
  unrelated basemap tile readiness.
- A new frame received while an async query was in flight was discarded. If the first
  reply was empty and no later frame arrived, the last useful opportunity was lost.
- The last native frame could precede the 60 ms JS settlement/re-arming. Byte-identical
  source data and already-visible layers do not necessarily produce another callback.
- A genuine zero-detail viewport was never considered ready and retained stale overview.

These are inspected/reproduced code paths; no device trace was available to assign
the precise 12–16 second recording interval to a single gate. Development logs now
distinguish both cases rather than inferring display state from the overview caption.

### Current handoff

The visual hook exposes `targetLod` (logical zoom choice), `displayedLod` (confirmed
outgoing/current layer), `transitionLod` (incoming), and `interactionLod`. Source
readiness checks current settled viewport geometry, profile and date independently
of weather scores. Missing weather stays neutral/insufficient, never fake 0/100.
The visual-cache entry carries a private selection key (profile/day/base date), not
a new model/native property. Even a zero-feature source has a verifiable selection
revision; neutral cells' fallback assessment dates cannot deadlock geometry readiness.

Both normal and full native render events may trigger a query on the incoming fill
layer across the ENTIRE map viewport, without a center point or sampled-ID filter.
The result must match an expected current visible feature's id/score/renderState/
dataQuality. A partial map frame is not accepted alone: actual rendered incoming
layer evidence is still required. This deliberately avoids waiting for global basemap
"fully loaded" before acknowledging already rendered local polygons. Queries and RAFs
are generation guarded; motion/selection changes cancel stale confirmations. Frames
received during an outstanding query are coalesced and replayed if that query did not
confirm, eliminating the lost-frame deadlock. No polling loop or timed forced promotion.
One RAF after the incoming props commit also initiates a rendered-layer query for
nonempty geometry. This covers an already-rendered source with no future native event:
RAF itself cannot promote the layer; only matching actual native rendered features can.

For a settled viewport with **zero** expected detail features, the source is explicitly
prepared as no-data (distinct from undefined/pending preparation). A post-submission
native frame plus the overlap RAF completes the intentional no-data transition without
requiring impossible nonzero query results. The existing coverage notice remains the UX.
Populated sources are retained while preparation is pending; only a genuinely prepared
empty viewport may replace the old source with empty data.

The outgoing layer is retained for one RAF after confirmation. Stable sources/IDs and
native ranges 0–24 are unchanged. Explicit `afterId` ordering puts detail fill above
overview borders, then detail borders and selection above detail fill. Overview taps
are disabled immediately when target is detail; prepared detail owns taps even during
overlap. Logical captions use target, never the outgoing visual fallback.

`[heatmap-lod camera]`, `[heatmap-lod state]` and `[heatmap-lod]` development-only logs
include camera zoom, target/logical/displayed/incoming/outgoing LOD, source-ready flag,
incoming feature/expected-visible counts, generation/confirmed generation, query result
count, pending RAF, frame sequence and transition age. No GPS coordinates/telemetry.

60 ms visual debounce, 80 ms weather visual coalescing, 250 ms network debounce,
all grids, thresholds, caches, scheduler, scorers and habitat artifacts remain unchanged.

### Tests / limits

Run `node scripts/runSmoke.cjs scripts/heatmapTransitionSmoke.ts` alongside the existing
visual/LOD/loading/navigation/weather/habitat suites. It covers slow threshold crossing,
rapid 8.8→9.7→10.2→9.4→9.8→10.5 zoom, neutral geometry, genuine zero geometry,
an un-sampled rendered cell away from a center hole, frame replay, stale generations,
explicit layer order and tap ownership. State tests forbid a blank covered handoff and
verify transitions complete with legitimate native evidence, not arbitrary timers.

If native rendering/querying itself fails permanently, a nonempty incoming layer is not
falsely certified: outgoing remains for safety, with `query-failed` / `render-pending`
diagnostics. This is an external native failure, not the previous lost-frame, three-ID,
weather-readiness or zero-feature logical deadlock. Actual Android GPU timing and the
absence of a physical flash must still be verified with a new phone recording.

APK helper: `npm run apk -- --name MushroomApp-preview-lod-transition-fix.apk`.
The helper was attempted and Gradle failed with `Unable to establish loopback connection`
(exit 1); no old APK was copied. Run that same command locally for the new APK.
