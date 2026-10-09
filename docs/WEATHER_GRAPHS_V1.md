# Weather Graphs V1

## Placement and interaction

Two native charts are mounted **only** inside MapScreen's expanded **Več informacij →
Vreme** accordion and Conditions/Razmere's **Podrobnosti** section. The main decision
card, navigation tabs, compact hotspot card, ranking and Top 3 are unchanged.
Map graphs use the selected assessment's weather representative coordinates and cell ID,
not an overview polygon colour as a point score. The caption explicitly says “Vremenska
točka območja”. The full Razmere screen uses its existing selected-location weather summary.

Padavine uses solid historical bars and outlined forecast bars; total precipitation includes
rain/showers/snow, not rain alone. A true zero has a small baseline mark and reads `0 mm`;
missing precipitation has a dash and reads “Ni podatka”. Temperature shows the daily mean
line/dots and an independent min/max range/caps. Missing means break the line, including
when valid min/max exist. No arithmetic mean, gap interpolation or synthetic weather.
Negative temperatures remain below zero on an explicitly labelled scale.

Both plots expose the same 37-date axis, history/forecast legend and dashed today boundary.
Tap a date to select it in both charts; the readable detail area shows exact values, phase
and the endpoint's retrieval time. Scroll each plot horizontally: initially recent history
and the start of the forecast are visible. All 37 slots remain reachable. Each date has a
44 pt minimum touch target, accessible date/value/phase and selected state. Font scaling
increases cell/axis widths and date-label space rather than shrinking text. Selection
feedback is not colour-only. No WebView, SVG/native chart dependency or production logging.

Graphs live within existing scroll/safe-area containers. Existing accordion anchors still
position the newly opened section, and neither chart installs any MapLibre gesture listener.
Tiny screens/large text require more horizontal/vertical scrolling. Physical Redmi 13C
three-button navigation QA remains necessary; desktop style tests are not native Yoga/GPU QA.

## Canonical weather reuse

Inspection found no reusable chart infrastructure. `getMushroomWeatherSummary` already
requests 60 historical days and seven forecast days, including daily precipitation and
temperature min/mean/max. Its existing hybrid boundary is archive D−60…D−8 and Forecast
API past-days D−7…D−1 plus D…D+6. Official documentation supports these variables and
local-time daily dates; archive availability can lag, hence recent past-days remain separate:
[Forecast API](https://open-meteo.com/en/docs),
[Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api).

`weatherGraphs.ts` first reads the **existing raw weather_cache** payloads. The regional
scoring timeline ends at D+1, but its cached raw forecast already contains D…D+6. The
read-only adapter resolves the selected point within the batched cache key and response
`location_id`/array index. It does not load a regional grid or publish weather changes to
MapScreen. Existing canonical point caches are reused too. The per-endpoint fetch timestamp
and expiry are retained rather than labelling an old forecast with a newer archive timestamp.
An expired point cache does not hide a newer usable regional batch. The immediate summary
preview deliberately has no per-endpoint timestamp: its aggregate update time cannot prove
when the forecast was retrieved. Raw cache reads supply that metadata.

When cached data is insufficient/expired, the same canonical summary service is called for
**one inspected weather point**. It retains SQLite caching, 30-minute TTL, stale fallback,
18-second request timeouts and in-flight request dedupe. Graph loads also join by database,
coordinate/cell/day key before asynchronous cache reads. Cold load is at most the existing
two endpoint requests per inspected point, not 37 requests or a hotspot batch. Existing
provider/default model/variables/units and scoring windows are unchanged. An optional
`baseLocalDate` anchors only graph callers to Europe/Ljubljana; existing scorer callers
keep their original default calendar handling. `mapDailyWeather` is exported for reuse,
not reimplemented.

Deterministic mock transport verified:

| Scenario | Extra HTTP |
|---|---:|
| Cold inspected point | 2 |
| Concurrent duplicate graph load | 0 beyond shared pair |
| Complete fresh canonical point cache | 0 |
| Complete fresh regional raw batch cache | 0 |
| Warm reopen | 0 |
| Point selection / chart scroll | 0 |

These are mock request counts, not live latency measurements. Missing endpoints, expired
cache or retry can require network. Charts don't trigger all-hotspot refreshes. Rapid location
changes ignore old UI publications, while already-started canonical requests may finish into
cache. Each load has only the canonical pair of requests; existing transport dedupe remains.

## Daily model and provenance

`WeatherSeriesPoint` extends the existing `DailyWeatherPoint` conventions: `date`, `kind`
(`historical`/`forecast`), four independently nullable numeric values, optional ET0, source
(`archive`/`recentForecastHistory`/`forecast`), per-source `fetchedAt`, stale state,
`isCompleteDay` and `isProvisional`. Missing slots have null source/timestamp.
`WeatherDailySeries` includes coordinates, Europe/Ljubljana, today, assembly timestamp,
available range, per-variable missing counts and partial/stale flags. Assembly time is
**not** forecast issue time. Provider issue/run time is not available in these canonical
payloads; the UI accurately labels **retrieval** time, not forecast issuance.

The adapter emits exactly 30 completed local calendar slots and today + six dates, in
chronological order. The recent forecast-history payload overrides duplicate archive dates
following existing semantics. Invalid dates/non-finite values/negative precipitation are
unavailable. Different array lengths do not turn missing entries into zeros. Means are
never inferred from min/max. Source inference for an initial summary follows the known
hybrid boundary; raw cached endpoint provenance takes precedence when available.

`weatherLocalDate` uses Intl with Europe/Ljubljana. Existing `shiftLocalDate` operates on
calendar strings at UTC noon purely for safe calendar arithmetic; date labels use their
literal calendar fields, not a UTC-to-device-zone conversion. Leap/month/year boundaries
and both DST transitions are tested. Today/future are provisional forecast dates even
though today's daily total includes elapsed and forecast hours. “Completed day” means the
calendar day has ended, **not** an on-site measurement or a complete set of variables.

## Partial/offline lifecycle

The supplied summary can render immediately while a cache read/load is pending. History,
forecast and individual temperature fields degrade independently. Missing phases retain
their date slots; a chart without any values explicitly says unavailable. Partial/stale
results expose retry; an entirely failed load settles to unavailable, never endless loading.
Selected stale days show their actual retrieval timestamp and stale wording. Expired raw
cache remains usable on error. Corrupt cached JSON is treated as a cache miss.

The component keys state to location/cell/local-day and guards asynchronous publication
after location change or unmount. A profile/day rerender updates existing inputs but does
not restart the chart request. The child unmounts when details close. No fetch is wired to
chart scrolling or tapping. Neither locally saved hotspots nor visits are mutated.

## Preparation for Seven-Day Conditions V1

The daily representation is reusable, but **Weather Graphs V1 computes no mushroom scores**.
It is a presentation/provenance adapter, not a replacement for validated scorer inputs.
A future target-date input builder must:

- Anchor to a target local date and explicit evaluation cutoff.
- Combine historical and forecast precipitation/temperatures only up to the target's
  permitted cutoff, with date-aligned 3/7/14/26/30/60-day windows and completeness counts.
- Retrieve the retained canonical 60-day history where required: the displayed 30-day
  series alone cannot satisfy rain60 or every future rolling-history window.
- Preserve retrieval/issue/run provenance. Never treat a later realised outcome or a
  forecast retrieved after the target as information available at the evaluation time.
- Use forecast soil moisture/ET0 only where actually available for that target. Current
  soil and tomorrow-morning soil must not be copied into all seven targets; missing
  signals require the validated production renormalization policy.
- Keep targetProfile species semantics and forecast uncertainty explicit. Accuracy of
  weather forecasts and mushroom suitability are separate uncertainties.
- Evaluate each target independently; don't repeat Today's score seven times. Test all
  source boundaries, cutoff leakage, missing signals and surfaces before enabling it.

Potential cost is seven local evaluations per point, not seven weather fetches, with memoized
input windows and shared snapshots. Forecast uncertainty, source/model differences and
missing future inputs remain limitations. Seven-day hotspot ranking, future heatmap, best
forecast day, chestnut models and notifications are deferred. Current weights, scoring,
Today/Tomorrow behavior, snapshots and privacy defaults were not changed.

## Verification

`node scripts/runSmoke.cjs scripts/weatherGraphsSmoke.ts` covers calendar slots, date/DST
handling, boundaries/duplicates, null/zero/negative/invalid values, missing means/min/max,
heavy rain, cache reuse, batching provenance, request counts/dedupe, stale/partial/offline/
timeout/corrupt responses, actual native-component JSX interactions, scaling and late
location responses. Existing scoring regression tests compare **84,248 regional + 15,688
pilot** cases. Existing default weather implementation is pinned after removing only the
explicit graph calendar option and exported mapper; formulas/scheduler/LOD remain pinned.
Native placement/touch/animation is not proven by those tests.
TypeScript and 24 focused suites passed, covering the new adapter/UI, conditions details,
hotspots/ranking/Top 3, map/navigation, weather cache, progressive loading, LOD and habitats.
The older habitat source pin was adjusted only for the optional graph date anchor/mapper
export, with default weather behavior and all numerical rules still strictly pinned.

The Windows release helper was executed for this feature, but Gradle failed with
`java.io.IOException: Unable to establish loopback connection`. No APK was produced or
copied. `adb devices` listed no attached phone, so native Redmi 13C verification is pending.

Build locally if the release helper encounters the known loopback failure:

```powershell
npm run apk -- --name MushroomApp-preview-weather-graphs-v1.apk
```

Never deliver an old APK after a failed build.
