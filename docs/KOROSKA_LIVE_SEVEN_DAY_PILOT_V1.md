# Koroška Live Seven-Day Pilot V1

Baseline: `af26a6106bdc7a567b292296e7810b91bb32e9f5`. Developer-only, manual and bounded. **Implemented; CONDITIONAL GO for internal physical validation, not public Pogoji integration.** No real weather acquisition or Redmi test was performed during development. Measurements below are explicitly offline fixtures.

## 1. Architecture decision

The existing `loadPointSnapshots(db, locations, date)` supports 11 exact query coordinates in one ≤16-location group and two endpoints. It already owns the validated D60/civil-hourly/soil assembly and immutable point snapshots. Direct use against the ordinary point store is insufficient for atomic regional publication: per-point memory/raw-cache hits may have different retrieval vintages, and permissive positional response fallback does not establish strict multi-location identity.

`src/experimental/koroskaLive.ts` therefore wraps, rather than copies, that pipeline:

1. Validate the **original 696 cells and 11 public query coordinates** against the unchanged bundled artifact, including original IDs, geometries, weather mapping, habitat and model/geometry fingerprints.
2. Reuse `sevenDayHourlyRequestPlan` to construct the same two complete-batch raw keys as `pointConditions.fetchGroup`, and call the existing `cachedFetch` once per endpoint in parallel.
3. Strictly map provider `location_id` to requested positions, allowing the actual omitted default ID 0. Reordering is supported; ambiguous all-unnumbered, duplicate or partial responses are rejected. Returned grid coordinates/elevations are recorded, not substituted for requested coordinates or assumed identical to them.
4. Validate a whole-pair acquisition receipt and create an ephemeral **read-only cohort DB view** of exactly those 22 canonical source rows. It delegates no private data queries and refuses any unknown cache key before HTTP can occur.
5. Call the **actual `loadPointSnapshots`**, then `pointResults` for all four profiles. This reuses `withCivilHourlyWeather`, `weatherIntervals`, `soilSampling`, the date-aligned input builder and the unchanged production formulas/gates. There is no copied numerical algorithm or production-service edit.
6. Retain compact results/inputs/factors and source metadata. Join the original habitat masks by reference for display. There are **308 weather/profile/date evaluations**, not 19,488 per-cell calculations. Intermediate hourly assembly is shared by 11 samples; existing profile-specific validation is not falsely claimed deduplicated to 77 CPU operations.

The regional interpretation remains **`regional-civil-week-v1`**, wrapped in `koroska-live-regional-v1`. The canonical point input policy is provenance/validation infrastructure, not a claim that each polygon is an exact-point observation. Actual configuration hashes supplement the frozen model/source fingerprint. No production regional migration is performed.

## 2. Fixed scope, geometry and habitat

Reuse the frozen artifact's whole original polygons and representative-centre selection `[14.65,46.35,15.05,46.59]`. This is not a new administrative boundary or national grid. The immutable research artifact still represents **19–25 October 2026**, exactly 696 cells / 11 query locations / four profiles. Its bytes and values are unchanged.

Live mode changes weather only. Original candidate / unknown / outside-model classifications remain static across dates and modes. Candidate cells may display the shared complete weather score; unknown/outside cells remain nonnumeric, never 0. No habitat multiplier, bonus, renormalization or new vegetation model exists. The production regional index used by point habitat remains a separate spatial assessment.

One existing GeoJSON source is built once. Small cell-ID groups map each polygon to one of the 11 weather samples. Live paint expressions reuse the existing production palette and thresholds; the original categorical properties retain static habitat masks. Neither source geometry nor the native Map/Camera is rebuilt when changing date, species, source, selection or sheets. Source switching preserves cell ID/profile/camera and retains the absolute date when it exists in the destination window, otherwise visibly selects its first date. Refresh/rollover displays the returned absolute window; it never renames research dates Today/Tomorrow.

## 3. Request budget and cache

| Operation | Weather HTTP upper bound / observed fixture |
| --- | --- |
| Fully cold 11-location refresh | **2**: one archive, one forecast, parallel |
| Concurrent refresh taps | Share one regional task; no extra requests |
| Valid derived memory snapshot | **0**, no rescoring |
| Restart/replay with valid raw pair + matching receipt | **0**, reconstruct 308 local results |
| Date/profile/source toggle, cell selection, map gesture, sheet, foreground | **0** |
| Expired/offline refresh | At most **2 attempts**, no automatic retry |
| Exact-coordinate point forecast | Independent existing point-cache policy; different coordinates can legitimately require its own requests |

The facade prevents an unexpected second acquisition phase: even stale/invalid rows cannot escape into another point request. Two `cachedFetch` invocations are the only acquisition path. Timeout is the existing 18 seconds per endpoint. These are application HTTP calls, **not provider billing units, paid quotas or commercial permissions**.

Reuse the existing `weather_cache` table, raw batch keys, 30-minute TTL and transport deduplication. No new schema, competing raw weather store, cache reset or private persistence change. A small versioned `koroska-live-regional-v1:cohort:…` receipt is metadata, not a duplicate weather payload. It records the actual raw hashes/timestamps/query/configuration identity. Derived result retention is bounded to the latest snapshot per DB; old transient cohort views can be collected.

Warm replay never renews original source timestamps/expiry. Different local-date horizons have different raw keys. No per-day/cell acquisition, scheduler, continuous polling or prefetch exists. Only the explicit refresh action starts acquisition. One UI-only expiry/midnight deadline and foreground listener update labels, never fetch or score; they are removed when leaving live mode.

## 4. Atomicity and source-vintage gates

A newly acquired pair must have both non-stale retrievals within the deliberate operation and ≤20 seconds apart. That bound is an internal acquisition gate, **not evidence of a common forecast model run**. A cached pair is accepted only if its exact source bytes, timestamps, date, query keys and configuration identity match the persisted cohort receipt. Missing/corrupt receipts or one new endpoint combined with an older cached endpoint block publication. The UI gives an explicit retry-after-both-expire time rather than clearing caches or silently issuing more requests.

Within each endpoint, all 11 rows retain the common batch retrieval time and a consistent UTC time axis. Current reference instants must agree across the batch and be within one hour before the original forecast retrieval. This is a stricter regional publication check, not a changed point sampler. Per-point production coverage/unit/depth/time/window checks still run unchanged. A receipt proves an operational **retrieval cohort**, not independent provider/model-vintage uniformity. Best-match/model issue identity remains unverified and `modelIssuedAt` stays null; retrieval time is never presented as issue time.

Publication is intentionally conservative: **all 308 weather vectors must pass and the cohort checks must pass** before live numeric map colours/scores are exposed. A missing D60 window, layer, variable, invalid interval or source inconsistency blocks the entire numeric live layer, even if some individual vectors are valid. Available component diagnostics are retained; the UI explicitly says incomplete and does not silently publish a partial region. This whole-batch gate is a limitation of V1, not a new scorer requirement. Genuine canonical 0 remains 0; unavailable remains null.

Metadata includes actual seven dates, input/regional/configuration versions, requested/returned coordinates, endpoint URLs and requested variables, available variables/units, hourly extents/counts, current reference epochs, native soil sample provenance, hashes, retrieval/assembly/expiry timestamps, completeness reasons and original cache age. Capture hashes are not invented provider run IDs.

## 5. Date and model semantics

All four unchanged production profiles: Splošno D7/D14/D30 + T20; Jesenski goban D26 + T20; Navadna lisička D7/D30 + T14; Užitna sirovka D14/D60 + T20. All require the canonical D7/ET₀7 drying inputs and original 0–7 / 7–28 cm soil layers.

Lookbacks remain `[target local date − N calendar days, target local date)`. Archive and recent/forecast own complete dates across the canonical seam. Rain/ET₀ use preceding-hour endpoints `(start,end]`; temperature uses means of instants `[start,end)`. Local midnight boundaries are independently resolved in Europe/Ljubljana, including 23/25-hour days. Today uses the provider-referenced as-of soil sample; future dates use true local09. No future-day rain leaks into earlier numerical windows, no soil copying/interpolation or D60 truncation.

If local midnight passes during acquisition/assembly, discard the old-date result. An already loaded old window may remain explicitly stale with its absolute dates, never as a fresh rolling horizon. An explicit new refresh obtains the new date-keyed pair. Out-of-order tasks, exit and mode switches have generation guards; old completions cannot overwrite the latest selected UI context.

## 6. UI and exact-point independence

Internal flag remains **OFF by default**. Explicit entry opens the immutable research view, with no weather requests. The existing compact date/species button opens the safe-area controls sheet, now containing:

- **Raziskovalni posnetek** — permanent historical warning, original dates and values.
- **Sveža napoved — razvojni pilot** — not loaded until a previous valid manual snapshot exists or the user presses **Pridobi svežo napoved**.

Live states distinguish not loaded, loading, ready, valid cache, stale cache, incomplete inputs and source/network failure. Detailed error text stays in the sheet/`Viri`, not a giant map overlay. No failed live attempt silently changes source to research. The fixed score heading, close/point actions, measured region fitting, selected-date/profile reveal, 48dp targets and Back policy remain. Exit/tab/list departure resets to a fresh research entry; a deliberately cached live snapshot may be selected again without a fetch.

`Točkovna napoved` passes actual tapped coordinates, local profile and only a date in the current point horizon. The existing modal/weather/cache/gates remain independent. New origin copy distinguishes shared regional weather and static research habitat from the exact-coordinate point weather and production-index habitat. If the old regional date is outside the current point horizon, Today is explicitly identified. No score equality, precise forest habitat or mushroom presence is implied; private hotspot IDs/names/notes never enter the regional sources or provider URLs.

## 7. Failure outcomes

| Condition | Result |
| --- | --- |
| Archive or forecast unavailable without a coherent old pair | Explicit source error, no numeric publication |
| Both stale source fallbacks match an old receipt | Explicit stale snapshot, original expiry/date/age retained |
| One fresh source + one older source | Cohort error; no hybrid publication or hidden retry |
| Missing units/layers/D60/coverage, duplicate relevant intervals | Canonical unavailable vectors; whole live numeric publication blocked |
| Reordered provider responses with valid IDs/default zero | Correct original coordinate mapping |
| Ambiguous IDs, partial batch or missing spatial metadata | Reject before publishing |
| Changed cached bytes, future/invalid timestamps or mismatched receipt | Reject, do not reinterpret old provenance |
| Close/source switch during acquisition | Completion ignored for that old UI generation; valid cache work can finish without reopening anything |
| Foreground/TTL/midnight | Relabel age/window only; no automatic weather request |

## 8. Actual automated measurements

Final retained focused pass: Windows / Node v24.21.0, synthetic provider responses, **0 actual weather HTTP**. The fixture date is **23–29 October 2026**, not an authentic live capture. Earlier research evidence stays separate; no third paired operational capture/model run is claimed.

| Metric | Measured |
| --- | ---: |
| Cold endpoint requests / warm / cached restart | 2 / 0 / 0 mocked |
| Total mocked requests including all negative/DST controls | 50 |
| Parsed semantic archive / forecast JSON | 507,904 / 235,728 B |
| Cold source cache/acquisition/decode phase | 9.419 ms, mocked boundary |
| Canonical 11-location assembly | 142.959 ms |
| 308 shared evaluations, including required input validation | 134.990 ms |
| Preparation excluding source-pair phase | 307.209 ms, includes hash/DB/JSON work |
| Entire cold call including scope checks | 323.232 ms |
| Process CPU during cold call, user / system | 390 / 16 ms |
| Cold process heap / RSS delta | +16,010,832 / +10,100,736 B |
| Retained compact live snapshot JSON | 527,564 B |
| Existing GeoJSON source | 450,073 B, unchanged |
| ID group preparation / 1,000 paint-expression preparations | 0.224 / 1.322 ms |
| Peak process RSS over the entire negative-test matrix | 403,288,064 B |

Timings vary and nested stages are not additive. Mock header/decode timings are not real network performance. JSON sizes are decoded semantic serialization, not wire bytes/billed units/APK growth. Heap deltas include process activity/GC; peak includes transpiler, research imports/large regional fixtures and many tests, not one cohort or Android PSS. No native FPS, GPU, camera projection, style-update cost or Redmi latency is measured. See the small labelled [offline evidence](research/koroska-live-pilot-v1.offline-metrics.json); rerunning tests produces new timings, not a new weather capture.

## 9. Tests and unchanged production

Executed: **all 56 active root deterministic smoke suites PASS**, TypeScript PASS, `buildKoroskaShadowSmoke.mjs`, `buildAndroidReleaseSmoke.mjs` and `androidPerfSmoke.mjs` PASS. The performance-helper tests use synthetic device fixtures, not a physical phone. Focused suites were rerun after final rendering/zero/provenance checks.

Unchanged comparisons: **84,248 regional; 15,688 pilot; 2,400 soil samples**. The standalone `regionalRegression.ts` remains independently **FAIL**, exit 1 at the known full-source `weather.ts` assertion against `6127609`; it is untouched and is not hidden by the active suites. No blanket claim that every repository test passes.

New tests execute actual transport/cache, actual point batch assembly/scorers, all 308 input/factor/soil/score comparisons, all 19,488 cell/style-mask results, 308-per-transition DST score comparisons, D60, current10:45/future09, null versus genuine zero, explicit gates, cache receipt/restart/expiry/mixing/tampering, bounded failures, concurrent dedupe, midnight and latest-generation rules. UI tests execute the real manual lifecycle and map hook; old shadow tests isolate the new lifecycle boundary while retaining their original frozen behavior checks.

`MapScreen`, MapLibre source geometry/LOD, regional/pilot scorers, point weather services, soil/DST logic, public flag, research artifact, hotspot/ranking/Top 3/visit/SQLite schemas remain byte-identical to baseline. No default public acquisition or rendering changes. New runtime modules are experimental plus a display-only live origin branch in `forecastSourceContext.ts`.

```powershell
node scripts/runSmoke.cjs scripts/koroskaLivePilotSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaLiveUiSmoke.ts
node node_modules/typescript/bin/tsc --noEmit
Get-ChildItem scripts -File -Filter '*Smoke.ts' |
  Where-Object Name -NotMatch 'LiveSmoke' | Sort-Object Name |
  ForEach-Object { node scripts/runSmoke.cjs $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }
# Independent known failing legacy source guard:
node scripts/runSmoke.cjs scripts/regionalRegression.ts
```

## 10. Build and exact physical checklist

Android SDK was confirmed with `android info sdk`. Attempted the unchanged internal helper; Gradle failed with **`java.io.IOException: Unable to establish loopback connection`**. No new APK was produced/copied and no old APK renamed. Native flag verification in this failed APK is impossible; helper environment inheritance/default-off behavior passed its deterministic test.

Windows local build:

```powershell
Set-Location 'C:\Users\Uporabnik\Documents\MushroomApp'
node scripts/buildKoroskaShadow.mjs
# Install ONLY after a successful new build:
# output/MushroomApp-INTERNAL-koroska-seven-day-shadow-v1.apk
```

The helper sets `EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW=1` and `EXPO_NO_DOTENV=1` in the same Gradle/Expo process and restores them. No flag/default/build-helper change is committed. Before an ordinary build, remove any manually set flag from the shell, local env and CI; EXPO_PUBLIC is not a security boundary.

Redmi 13C verification, **not executed**:

1. Open the internal APK → map → **Koroška · 7-dnevni test**. Verify frozen 19–25 October and warning, no acquisition on opening or `Območje`/pan/zoom.
2. Open date/species controls → **Sveža napoved — razvojni pilot**. Verify no request merely from this toggle. Press **Pridobi svežo napoved** once. Check real seven dates, retrieval/expiry/source state and valid or honestly unavailable scores; cold source acquisition ≤2 HTTP.
3. Tap rapidly during loading, switch source or leave/return. No duplicate acquisition or old completion should reopen/replace another context. Repeat valid refresh/reopen: 0 additional HTTP.
4. Cycle all dates/profiles, tap cells, open/close `Viri`, pan/zoom/rotate. Source geometry, camera/bearing and global Danes/Jutri must remain unchanged; no acquisition from these actions. Check 48dp targets, large fonts, attribution and safe areas.
5. Turn network off: valid warm data remains valid until expiry; expired refresh is stale with its old dates/age or explicitly blocked/error. Never a fake 0 or silent frozen fallback. Test endpoint failures separately with development tooling where possible.
6. Observe local midnight or a controlled device-clock test: old window becomes stale, no automatic request; manual refresh obtains the new horizon. Exercise the autumn DST window without changing sampling semantics.
7. Open **Točkovna napoved** at an actual tap. Verify location/profile/date, independent canonical weather and separate habitat source. Back returns to the same regional source, date/profile/cell/camera. Point profile/date changes do not recolour the region.
8. Exit/re-enter and change tabs/list: default research mode, no old cell/sheet resurrected. Ordinary flag-off release has no preview/live entry and unchanged Pogoji, hotspots/ranking/Top 3 and point forecasts.

## 11. Remaining gates and next-phase decision

**CONDITIONAL GO: perform the bounded internal Redmi live-pilot validation next. Public Pogoji integration is not yet approved.** Required before public integration: successful release/device acceptance, measured native memory/style/gesture/camera stability, reviewed real source coverage/failure/cache-midnight behavior, explicit acceptance/versioning of legacy daily-versus-hourly score/category changes, and independently verified provider operational/commercial access, quotas, licensing and billing. HTTP count alone establishes none of those terms.

Model-run identity remains structurally unverified; do not replace that limitation with endless captures or invented issuance times. The pilot tests software/data contracts, not mushroom occurrence, yield or exact forest microclimate. Original historical WorldCover/ZGS habitat is not refreshed by new weather. No national coverage, public forecast, new tile layer/backend, private-location export or scorer migration is included.

## 12. Changed-file inventory

12 task files; no production weather/scorer/geometry/flag change:

- Runtime: `src/experimental/koroskaLive.ts`, `useKoroskaLive.ts`, `koroskaLivePresentation.ts`, `useKoroskaShadow.tsx`; display-only `src/components/forecastSourceContext.ts`.
- Tests: `scripts/koroskaLivePilotSmoke.ts`, `koroskaLiveUiSmoke.ts`, `koroskaLiveTestSupport.ts`; two narrow lifecycle stubs in `koroskaShadowMapSmoke.ts` and `shadowUxSmoke.ts`, whose frozen assertions remain intact.
- Documentation: this report and `docs/research/koroska-live-pilot-v1.offline-metrics.json`.
