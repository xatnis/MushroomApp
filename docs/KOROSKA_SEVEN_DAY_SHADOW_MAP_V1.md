# Developer-only Koroška Seven-Day Shadow Map V1

## 1. Scope and decision

Internal visual proof of concept, not a production regional weather migration or public forecast. The prior **CONDITIONAL GO** remains: software delivery can be tested now; ecological validity, public migration and national delivery are not approved by this preview. Production formulas, thresholds, weather/cache contracts, generated regional assets, private persistence and visit snapshots are unchanged.

The four preceding reports remain authoritative: `SEVEN_DAY_SLOVENIA_HEATMAP_FEASIBILITY.md`, `KOROSKA_SEVEN_DAY_REGIONAL_PROTOTYPE_V1.md`, `KOROSKA_REGIONAL_WEATHER_CONTRACT_VALIDATION_V1.md`, `KOROSKA_REGIONAL_SHADOW_VALIDATION_V1.md`. This milestone implements their developer-only delivery step, not a competing scoring pipeline.

## 2. Explicit feature flag and internal build

Only the literal build-time value `EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW=1` enables the entry. Missing, `0`, `true`, and `__DEV__` alone do not. The user must then explicitly choose **Koroška · 7-dnevni test** in the loaded map controls. There is no automatic activation or stored preference. An active point forecast/focus transition must be closed/completed first. Tab/list departure exits the preview; return does not reactivate it.

From the repository root on Windows:

```powershell
# INTERNAL release: flag and EXPO_NO_DOTENV are set in the SAME process as Gradle.
node scripts/buildKoroskaShadow.mjs
# Intended new artifact, only after successful fresh build:
# output/MushroomApp-INTERNAL-koroska-seven-day-shadow-v1.apk

# Optional dev server, explicit local opt-in (not committed):
$env:EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = '1'
npm start -- --clear

# Disable before an ordinary build / restart Metro:
$env:EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = $null
npm run apk -- --name MushroomApp-preview-normal.apk
```

The wrapper sets `EXPO_NO_DOTENV=1` to prevent accidental `.env` overrides, inherits the flag into the existing Gradle/Expo build and restores its own environment even on failure. Ordinary builds must also remove any manually added flag from local `.env`/CI configuration. No enabled default, credentials or `.env` is committed. This public environment variable is **not a security boundary**; only public regional data are packaged. Metro may include the static JSON module even in an ordinary bundle, but it is not required/parsed and no preview entry/source is mounted when disabled.

**Observed build-cache trap:** two consecutive `expo export:embed` calls with different flags initially reused an enabled transform even after setting `0`. `metro.config.js` now retains Expo defaults and separates transform-cache versions into `koroska-shadow-on/off`. This affects JavaScript build transforms only, not the weather cache/TTL. The Android Gradle plugin also passes `--reset-cache` normally, but Expo can disable that reset under CI; separate namespaces protect both configurations. Release-bundle verification must inspect generated code, not just print the parent environment.

## 3. Authentic snapshot and exact geography

Bundled input is the second stored operational capture:

`operational-20261019082412278-93e09f0a4610a740bf43`

Converted **offline** through the existing `validateContracts` and `buildPrototype` pipelines. No authentic primary daily values were reconstructed from hourly data. The converter rejects synthetic/archive controls and changed production-code fingerprints. Results retain `regional-civil-week-v1`, snapshot hash, capture ID/time, expiry, geometry/scorer fingerprints and 22 archive/forecast source/hash references. Model issue time remains **null/unverified**; retrieval time is not model issue time.

Selection rule is unchanged: existing representative cell centres inside inclusive `[14.65,46.35,15.05,46.59]`, sorted by original ID; retain whole original clipped polygons, not a replacement grid. Exactly **696 original cells / 11 original public weather coordinates**, with original per-profile habitat classifications. No extension outside these polygons. The display viewport action is approximate, not a new region definition.

## 4. Actual dates, profiles and freshness

Seven absolute Europe/Ljubljana dates: **19–25 October 2026**. No rolling Today/Jutri relabelling. Profiles: Splošno, Jesenski goban, Navadna lisička, Užitna sirovka. Both strips announce selected state.

The top warning always reads **“Raziskovalni posnetek — ni aktualna napoved”**, even during its original TTL. Details additionally identify an expired snapshot from its original expiry. Dates/values are frozen, never blended with a later forecast run or silently refreshed. This also prevents the bundled autumn-transition date from implying later observations were already known at capture time.

19,488 cell/date/profile combinations: **16,716 numeric, 2,646 habitat-unknown, 126 outside-model**. There are 308 shared weather/profile/date vectors, not 19,488 on-phone scorer invocations. Missing/incompatible numeric inputs remain null; real zero is distinct. No incomplete normalization or fake category is introduced.

## 5. Layer/source architecture

One separate `koroska-shadow-source`, 696 original polygon geometries and 28 small categorical properties `s0…s27`. Geometry is constructed/serialized once when the opt-in asset is first loaded. Date/profile changes rewrite a copy of the existing categorical fill expression to use the selected property. No geometry reconstruction, weather fetch, regional score calculation or independent palette/threshold is needed per switch.

Three experimental layers: fill, border, selected-cell outline, ordered after the existing detail selection layer. Production overview/detail sources remain mounted with their original data/paints; their visibility is temporarily hidden while active. Original marker badges/condition overlays are hidden, not replaced with research scores. Exit restores their normal visibility immediately. The same Map/Camera remain mounted with no new key. The helper never changes the production paint object.

## 6. Controls, camera and Back

Manual entry only; **Območje / Prikaži Koroško** is the only new camera animation. Entering, changing dates/profiles, inspecting a cell, opening point details and exiting do not issue camera commands. Preview gestures remember the last viewport without scheduling production LOD/weather acquisition. Exit applies the settled viewport through the original mechanism, without moving the camera. Production fetching can then resume for that actual viewport under its unchanged policy.

Normal global Pogoji/Rastišča, Today/Tomorrow, profile, selected point and Top 3 origin state are not rewritten. Experimental profile/date are explicitly local. Old production source-tap callbacks are ignored while preview is active. Android Back closes point modal → selected regional cell → preview → original map Back flow. Search intentionally exits preview first.

## 7. Regional cell inspection and exact-point independence

Tap a research polygon to see actual selected date/profile, cell ID, regional score/category or unavailable habitat/weather reason. **Viri** reveals source/contract/snapshot/weather ID/freshness, attribution and limitations. No private hotspot names, notes, IDs, visits or SQLite content enter the artifact.

**Točkovna napoved** reuses the existing full-screen `SevenDayConditionsModal`, passing the **actual tapped coordinate**, never GPS, representative centre or polygon centre. Its source is explicitly `map-point`; name says “Izbrana točka · točkovna napoved”. It uses current canonical source/cache/gates independently. The selected research date is passed only if it lies in the current exact-point forecast horizon; otherwise the point view uses its actual supported current horizon, never fabricated historical scores. Point profile/date changes do not recolor the research map, and Back retains the research selection. No comparison/equality of unlike vintages/resolutions is implied.

## 8. Category and scientific limitations

Category values come from the existing canonical suitability labels; colours/opacity copy the existing production paint. Unknown and outside-model remain separate nonnumeric states; invalid weather uses unavailable grey and explicit text. No smoothing or changed boundaries. The earlier 94 boundary crossings from one-point weather changes are documented research evidence, **not newly observed native flicker**.

Small polygons describe habitat geometry, not equally precise weather measurements. Shared weather sampling spans multiple habitat cells and mountain/elevation variation is unresolved. A score estimates modelled environmental suitability, not mushroom presence, harvest quantity or probability of a find. Regression and software parity do not establish ecological prediction skill.

## 9. Mobile layout and accessibility

Existing top safe-area owner and bottom tab layout are retained. Preview overlays use the measured map viewport, not hardcoded device pixels. The top area is capped at 40% of that viewport, cell detail at 28% (32% for larger fonts); details/source text scroll internally. Exit/region and point/close actions are outside those scrollable text areas. Horizontal date/profile strips do not use map gestures. Practical button minimum is 48dp, text wraps, active dates/profiles have textual and TalkBack selected state, and Viri announces expanded/collapsed state. Attribution remains in the native lower-left free edge; exact clearance, extreme font wrapping and real TalkBack traversal require phone verification.

## 10. Data/performance measurements

Retained `docs/research/koroska-shadow-map-v1.export.json`, Windows / Node v24.21.0, **not Redmi/GPU/FPS measurements**:

| Measurement | Observed |
| --- | ---: |
| Bundled JSON / gzip | 212,746 / 19,452 B |
| One native GeoJSON string / gzip | 450,073 / 20,807 B |
| Median JSON parse, 5 passes | 1.399 ms |
| Median geometry+serialization, 5 passes | 7.299 ms |
| 1,000 paint-expression switches | 1.310 ms total |
| Offline adapter / evaluation+windows / join | 201.458 / 215.494 / 9.584 ms |
| Entire export including authentic validation | 1,563.214 ms |
| Process CPU user / system | 1,687 / 219 ms |
| Peak research-process RSS | 278,036,480 B |

RSS includes TypeScript/research imports/raw evidence/geography; it is not incremental app heap/PSS. Geometry + parsed artifact + native rendering entail additional copies; native source-update cost, GPU memory and FPS are **unmeasured**. JSON/gzip sizes are not final APK compressed-size deltas.

**Weather HTTP: 0** for conversion, preview open/reopen, date/profile switch, cell selection and preview pan/zoom. No per-cell or per-day requests. Existing production weather acquisition resumes on exit if needed; explicit exact-point action can use its normal cold/warm HTTP policy and is not claimed universally network-free. There is no new derived/weather cache or background capture loop.

## 11. Capture status and safe replacement

Exactly **two authentic operational retrieval snapshots** exist, plus separate historical DST evidence. No third capture was made in this task; independence/model-run identity is not inferred from a UI build. Prior three-snapshot public-readiness gate remains incomplete.

Manual, deliberate commands (no polling):

```powershell
# Optional bounded live capture, ONLY when explicitly desired and meaningfully separated:
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts capture --live
# Offline review of the returned immutable ID:
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts replay <operational-id>
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts report
# Explicit conversion/replacement of the developer bundle only:
node scripts/runSmoke.cjs scripts/research/exportKoroskaShadowMap.ts --snapshot <operational-id> --write
# Reproduce THIS bundled snapshot:
node scripts/runSmoke.cjs scripts/research/exportKoroskaShadowMap.ts --snapshot operational-20261019082412278-93e09f0a4610a740bf43
```

`--write` explicitly replaces only the generated preview JSON/measurement report; immutable captures are never overwritten. Review dates, completeness, fingerprints, absolute UI labels and tests, then rebuild the APK. No on-device refresh button or provider workload is introduced. Data attributions are retained (Open-Meteo and the existing public habitat/boundary sources); procurement/commercial terms remain a separate production gate.

## 12. Verification commands and scope

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/runSmoke.cjs scripts/koroskaShadowMapSmoke.ts
Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' | Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
node scripts/buildKoroskaShadowSmoke.mjs
node scripts/buildAndroidReleaseSmoke.mjs
node scripts/androidPerfSmoke.mjs
# Independently known legacy guard (do not hide its result):
node scripts/runSmoke.cjs scripts/regionalRegression.ts
```

Focused coverage executes the real hook with retained state/effect/memo semantics, original Map event guards, all 28 combinations and all 19,488 canonical result mappings. It verifies flag-off no-entry/no-require/no-source, manual activation/exit/tab-return, original geometry/habitat, null versus zero, immutable paints/source, cell identity, exact clicked-coordinate modal, local point state, Back/viewport behavior, absolute dates, source metadata, no HTTP, 48dp/font states and public-data allowlists. Existing source pins normalize only enumerated gated integration additions; the focused suite pins the remainder byte-for-byte to `8a790ca`. No golden/scorer fingerprint is regenerated. Native rendering is not simulated by this harness.

## 13. Execution results

Executed: **TypeScript PASS; all 52 deterministic root `*Smoke.ts` suites PASS**, including prototype, authentic-contract/shadow research, point/seven-day/cache, map/navigation/ConditionsScreen/hotspot/ranking/Top 3. Initial source-pin/harness failures were addressed by retaining original production comparisons and explicitly testing the new opt-in path. The second complete loop passed 51/52; its remaining WeatherGraphs callback fixture was then corrected to supply the disabled shadow context and rerun successfully. No live smoke suite or new weather capture was executed. The internal build helper, original APK helper and Android performance helper `.mjs` suites also **PASS**; performance helper uses synthetic fixtures, not a device.

Actual unchanged comparisons: **84,248 regional; 15,688 pilot; 2,400 soil sampling**. Offline reconversion reproduced the identical artifact digest `0190e9d55fb2a31a63a909359ecf8c5bbbc3d0136a38b25eb5aee7fd28682126`, without replacing evidence. The standalone `regionalRegression.ts` remains independently **FAIL** at its previously documented stale `src/services/weather.ts` byte-level assertion. Neither that guard nor production weather code was changed here. No blanket claim that every repository test passes is appropriate.

## 14. Build outcome and bundle inspection

The INTERNAL wrapper was attempted. The first sandboxed attempt could not acquire the Gradle lock; the authorized retry reached Gradle and failed with **`java.io.IOException: Unable to establish loopback connection`**. No new APK was produced/copied and no older APK was renamed. Expo Android production JS export is a separate check, not a successful native APK. Verify the output with:

```powershell
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = '1'
node node_modules/expo/bin/cli export:embed --platform android --dev false --minify false --entry-file index.ts --bundle-output output/koroska-shadow-verification/index.android.js --max-workers 2
$env:EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW = $null
node node_modules/expo/bin/cli export:embed --platform android --dev false --minify false --entry-file index.ts --bundle-output output/koroska-shadow-verification/public-default.android.js --max-workers 2
rg -n 'KOROSKA_SHADOW_ENABLED =' output/koroska-shadow-verification/*.js
```

Both exports deliberately use the actual Expo/native `export:embed` path and inherited process flag. **Verified after the namespace fix**, consecutively without `--reset-cache`: the internal bundle contains `var KOROSKA_SHADOW_ENABLED = true;`, the ordinary bundle (environment variable absent) contains `var KOROSKA_SHADOW_ENABLED = false;`. Respective Expo bundle phases: 14,879 / 20,747 ms on Windows, not on-device loading latency. Unminified exports are ignored verification artifacts; the failed APK itself cannot be inspected or claimed verified.

## 15. Redmi 13C physical checklist — NOT executed

- Ordinary release: no developer entry/source; production heatmap, markers, ranking/Top 3, day/profile and point forecasts work normally.
- INTERNAL release: manually enter, locate Koroška explicitly, confirm 19–25 October dates and permanent research/stale warning; no pilot colour outside original polygons.
- Cycle 7 dates × 4 profiles, inspect numeric/unknown/outside cells, verify original categories and one-point threshold changes without smoothing.
- Pan/zoom/rotate; confirm attribution, insets, visible map area, 48dp controls, font 1/1.3/2, horizontal scroll vs map gestures and TalkBack announcements.
- Open clicked-point forecast, check explicit coordinates/current horizon, profile/date independence, missing/offline/stale gates, Back to same cell and camera, exit to original mode/day/profile/Top 3 context.
- Count weather HTTP on switches/gestures (zero), cold point acquisition separately, inspect native source updates, frame timings/PSS and 100 repeated switches for leaks/jank. No native claims until measured.

## 16. Remaining gates

Developer preview is reversible and bounded, not public migration readiness. Remaining work: physical build/device acceptance, the deliberate third separated operational capture and its explained deltas, explicit versioned regional migration decision, qualified source/vintage/freshness representation and production provider/licensing/access approval. National tiles/CDN, production date selector, new species, private ranking forecasts and ecological validation are outside this milestone.

## 17. Changed-file inventory

20 files, no production scorer/weather/persistence changes:

- Presentation/build: `metro.config.js`, `src/screens/MapScreen.tsx`, `src/experimental/koroskaShadowData.ts`, `src/experimental/useKoroskaShadow.tsx`, `src/data/koroskaShadow/snapshot.json`, `scripts/buildKoroskaShadow.mjs`.
- Reproducible conversion/evidence: `scripts/research/exportKoroskaShadowMap.ts`, `docs/research/koroska-shadow-map-v1.export.json`.
- New tests/isolated source-pin allowlist: `scripts/buildKoroskaShadowSmoke.mjs`, `scripts/koroskaShadowMapSmoke.ts`, `scripts/koroskaShadowSourceGuards.ts`.
- Existing test-context/source-pin updates: `scripts/conditionsCardSmoke.ts`, `scripts/heatmapLodSmoke.ts`, `scripts/hotspotHeatmapIntegrationSmoke.ts`, `scripts/hotspotTopThreeSmoke.ts`, `scripts/mapCompactForecastSmoke.ts`, `scripts/mapForecastSmoke.ts`, `scripts/pointRefreshSourceGuards.ts`, `scripts/weatherGraphsDiscoverabilitySmoke.ts`.
- This document: `docs/KOROSKA_SEVEN_DAY_SHADOW_MAP_V1.md`.
