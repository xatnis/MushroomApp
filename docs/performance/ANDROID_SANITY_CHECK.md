# Regional Heatmap V2: Android performance sanity check

Windows-first, non-root, **manual** test for `si.mushroomapp.preview` (e.g. Redmi 13C).
No app UX/runtime changes, touch automation, production dependency, telemetry or GPS capture.

## Quick workflow

Enable Android Developer options / USB debugging, connect USB and accept the phone's authorization dialog.
Install Android SDK Platform Tools if needed. The helper finds ADB through `ANDROID_SDK_ROOT`,
`ANDROID_HOME`, Windows `%LOCALAPPDATA%\Android\Sdk`, or PATH. Open the installed app yourself.

From PowerShell in `C:\Users\Uporabnik\Documents\MushroomApp`:

```powershell
adb devices
npm run perf:android -- check
npm run perf:android -- reset baseline
# Manually perform baseline for 20-30 seconds; keep the app foreground.
npm run perf:android -- capture baseline
npm run perf:android -- report
```

Repeat **reset LABEL → manual scenario → capture SAME-LABEL** for each row below.
Reset clears only package gfxinfo counters, **not** memory, weather cache, visits or user data.
If multiple devices are attached, add `--serial DEVICE` to check/reset/capture.
Unauthorized/offline devices, missing package and stopped app fail before creating a capture.
There are finite command timeouts. Optional metrics unavailable on an OEM are recorded as unavailable/null,
never fake zero. Errors are in `summary.json` and the corresponding text file.

For CPU **during** an action, run capture while continuing that action on the phone:

```powershell
npm run perf:android -- capture detail --cpu-samples 10
```

Gfxinfo is read first; memory follows, then 1-second-spaced `top` samples. Thus gestures during top
are **not part of the preceding gfxinfo capture**. For clean isolation, do separate repeated frame and
CPU runs. `--cpu-samples` accepts 1-10. Default 3 is a short snapshot, not a 30-second CPU trace.
The first top sample can have different/lifetime accounting: compare subsequent samples and retain raw output.

## Reproducible scenarios

Use the **same release APK**, phone, refresh-rate setting, viewport/zoom, species/day and gesture sequence.
Record APK commit/version manually (native helper cannot infer the JS Git revision), Android version,
device RAM configuration, battery-saver state, charging/temperature, Wi-Fi/network and cache condition.
Avoid screen recording during metric runs; it changes rendering/CPU load. Repeat each scenario 3 times.
Rest 10 seconds between runs, keep checkpoints equally settled; avoid comparing different PIDs/processes.

| Label | Manual action (20-30 seconds unless stated) |
| --- | --- |
| `baseline` | Rastišča, same map area, idle 5 s then 3 slow pan gestures; no heatmap. |
| `overview-cold` | Pogoji, overview zoom <=8.5, same large regional viewport; pan once, wait for weather coverage. Note first useful/80%/complete wall-clock times. Capture at 30 s; if incomplete also capture `overview-cold` later (cumulative since reset; not a second independent run). |
| `overview-warm` | Same viewport, valid cache, repeat identical pans after cold completion. |
| `restart-warm` | Close/reopen the app yourself **without clearing app storage** within 30 min; reset after reopening, revisit same overview. Native process may change; treat memory as a separate session. |
| `detail` | Zoom >=9.2, pan about one screen three times, same area. |
| `species` | In settled DETAIL with cached weather: Goban → Lisička → Sirovka → Splošno, about 3 s apart; repeat. |
| `date` | Same cached view: Danes → Jutri → Danes, about 3 s apart; repeat. |
| `lod-stress` | Overview → detail → overview, then a few rapid pinches through 8.5/9.2. Observe no empty/stuck layer. |
| `card` | DETAIL, tap ready cell; open/close card five times, no pan/profile/date changes. |
| `lod-cycle-1` … `lod-cycle-5` | Each run: overview → detail → overview → detail → overview; then idle 10 s and capture. Use same viewport/profile/day and same foreground process throughout. |
| `idle-after` | After cycles, leave map idle 30 s, then capture; repeat later if CPU/memory remains elevated. |

**Cold is not the same as restart.** Existing memory/disk weather cache lasts 30 min and snapshots are
date-specific. For a genuine cold run, use a not-yet-cached viewport or wait for expiry (and verify cache
miss diagnostics in a dev run). Merely force-stopping/restarting does not clear disk cache. Do not run
`pm clear` or uninstall on a personal diary to make a test cold. A separate disposable test install may
be used with the owner's deliberate consent; the helper never deletes app data or restarts the app.

## Output and interpretation

Each capture goes to ignored `perf-output/<UTC timestamp>-<label>-<unique suffix>/`:

```text
gfxinfo.txt       # package gfxinfo + recent framestats buffer
meminfo.txt       # package memory only
cpu-top.txt       # target PID rows and column headers only
cpuinfo.txt       # sampling-period header + this package's lines only
device-model.txt
device-sdk.txt
summary.json     # parsed metrics, interval validity, time bounds, unavailable fields
```

`report` works offline, prints the checkpoint table and writes `perf-output/report.json`.
It does not automatically pronounce the phone healthy or diagnose a leak. Reset metadata binds the
label/device/PID/process-start time; a missing/mismatched reset or restart invalidates frame comparisons.
If an OEM denies `/proc` start-time access, native snapshots still work but the interval is marked
unverified (the comparison table leaves frame metrics null; raw counters remain available for review).
Device serial is not persisted (only a short hash for interval identity). Outputs are local and ignored;
review before sharing. No logcat, location/diary/database dumps, screenshot or other-app CPU data is saved.

### Memory

Compare total PSS (KiB; table shows MiB), native/Dalvik **heap PSS** and the separately labelled
App Summary categories: Java/native heap, graphics, code, stack, private other and system.
App Summary private/PSS attribution depends on Android output format; it is **not heap allocated size**.
Use raw meminfo column headings when interpreting OEM differences. Missing graphics/category is null.
PSS apportions shared pages and is suitable for same-device comparisons; it is not all reserved memory.

Compare baseline → overview → detail → cycle checkpoints → idle-after. A cache warm-up rise can be
normal. A repeatable upward slope after identical already-warm cycles without settling merits a longer
memory investigation; five short captures alone neither prove nor rule out a leak. Compare Java/native/
graphics deltas and allow GC/renderer caches to settle. No arbitrary MiB failure threshold is imposed.

### Frames and CPU

Use OS-reported total frames, janky count/%, and available 50/90/95/99th percentiles. The helper does not
invent a 16 ms budget on a non-60 Hz phone. Slow/frozen counts are null unless the OS explicitly reports
them. Framestats covers a **bounded recent-frame buffer**, not necessarily every frame in the scenario;
the summary counters are since-reset only with a valid interval. A zero-frame sample is inconclusive.

**gfxinfo is HWUI/window health, not FPS or a complete GPU/MapLibre OpenGL profiler.** A smooth RN panel
can coexist with native map jank unrepresented by these counters. Cross-check physical pan/LOD behavior;
if that conflicts with gfxinfo, escalate to an Android Studio System Trace/Perfetto session, not a fake
FPS calculation. Top CPU percentages may exceed 100 on multicore systems; cpuinfo has its own sampling
period (not exactly reset-to-capture). Short CPU spikes are normal; repeat idle snapshots to investigate
sustained work after requests/gestures cease. Unsupported top flags on an OEM are recorded, not silently
replaced by CPU numbers from unrelated processes. Native snapshots don't separately measure JS CPU.

## Optional existing development diagnostics

Release builds disable `__DEV__`; native helper works on release without instrumentation. For a separate
dev session, use the existing Metro console diagnostics. Do **not** compare dev timings directly with
release native runs and do not export unrestricted logcat (it may contain sensitive information).
Manually record **counts/timings only**, not coordinates, geometry, full URLs or cache keys:

| Existing marker | What to compare |
| --- | --- |
| `[heatmap sources]` | Delta `rebuilds`, `overviewDataUpdates`, `detailDataUpdates`, commits/render attempts per gesture. Source props submissions, **not native acknowledgment counts**. |
| `[heatmap visual prepare]` | Active vs inactive-prewarm, feature count, key/build/serialization durations. |
| `[heatmap selection tap]` / `[heatmap selection state]` | Tap → committed profile/day; active-LOD-first prep. |
| `[heatmap source submitted]` / `[heatmap frame after submit]` | Props commit → next map-wide frame proxy, **not proof of a specific source render**. |
| `[heatmap-lod]` / `[heatmap native handoff]` | Current-generation query confirmation, one-RAF overlap, transition age. |
| `[Heatmap viewport weather]` | Cache hits/disk hits/joined, points, batches, scheduler wait, duration, failed points. |
| `[heatmap overview coverage]` | First useful and 50/80/100% coverage timings. |

Expected: settled pan events are coalesced, not an update per camera frame. DETAIL species/date updates
the active source first (inactive overview is lazy); cached repeat may cause no data change. Panel/card
open/close alone should cause **0 unrelated source-data updates**. Measure deltas, not cumulative totals.
No hard FPS/source-rate SLA is invented. Unexpected repeated updates on idle map warrant investigation.

Network expectation (not measured on a physical phone here): full cold LARGE overview has at most 40
20 km points, one batch / **two HTTP calls** (history + forecast), absent retries/errors/budget contention.
Six-point zoom-out prefetch plus remaining foreground can be two batches/four HTTP calls with dedupe.
Warm valid memory/disk cache, species and date switches: **0 new calls**. Pan fetches only missing points.
Check existing dev counters; ADB snapshots cannot count HTTP calls. Don't capture packet payloads.

## Static audit / current limitations (2026-10-04)

No ADB phone was attached (`adb devices -l` empty), so **all physical memory/frame/CPU values and native
source-update rates remain unmeasured**. Neither a native performance clearance nor a memory-leak verdict
is claimed. Runtime code is unchanged by this task.

- Visual cache is LRU-bounded to 12 views; prepared collections/assessments **and serialized strings**
  retain memory. Static regional geometry/ZGS remain resident. Measure real PSS; source bundle/file size
  is not Android heap usage. This is a known footprint, not evidence of a leak.
- Weather memory cache rejects expired entries on read but does not evict older date-key entries.
  This merits a multi-day/session check, not a refactor based on a short gesture test. The scorer's
  WeakMap permits collection once snapshot objects are no longer retained by other caches.
- Visual debounce/coalescing and deferred prewarm timers/RAFs cancel on cleanup; transition confirmation
  generations guard stale callbacks. Sources keep stable IDs and serialize only on visual cache misses.
- Map weather/search effects cancel queued work and abort/invalidate stale requests. Already-started
  weather work may finish into cache intentionally; HTTP timeout timers clear in finally. No runaway
  heatmap interval was found in the reviewed paths.
- GPS removes watchers on completion/abort, including subscriptions returned after cancellation; auth,
  linking, NetInfo and AppState subscriptions have cleanup. This static check is not a heap profiler.
- Weather transport emits a resolved batch through microtasks, while completion also awaits SQLite
  cache writes; slow device I/O is a measurement risk, not a demonstrated blocker.

Regional V2 has no new blocker demonstrated by this audit, but physical results are required to call its
native performance healthy. A national rollout is **not** cleared: measure larger static data, native
source memory and rendering demand separately before expanding; current regional results cannot prove it.

## Local validation / references

```powershell
npm run typecheck
node scripts/androidPerfSmoke.mjs
node scripts/runSmoke.cjs scripts/heatmapLodSmoke.ts
node scripts/runSmoke.cjs scripts/heatmapTransitionSmoke.ts
node scripts/runSmoke.cjs scripts/heatmapVisualSmoke.ts
node scripts/runSmoke.cjs scripts/heatmapLodThresholdSmoke.ts
node scripts/runSmoke.cjs scripts/heatmapControlsResponseSmoke.ts
node scripts/runSmoke.cjs scripts/overviewWeatherLoadingSmoke.ts
node scripts/runSmoke.cjs scripts/regionalLoadingSmoke.ts
node scripts/runSmoke.cjs scripts/heatmapNavigationSmoke.ts
```

Helper tests use synthetic outputs/failed transports, **not fabricated phone benchmarks**. No new APK is
needed for scripts/docs only. Existing `npm run apk` is unchanged.

Official references: [Android dumpsys (gfxinfo, framestats, PSS)](https://developer.android.com/tools/dumpsys),
[Android slow rendering and custom rendering limitations](https://developer.android.com/topic/performance/issues/render).
