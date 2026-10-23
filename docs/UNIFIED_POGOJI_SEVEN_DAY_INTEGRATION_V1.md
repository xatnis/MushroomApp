# Unified Pogoji Seven-Day Integration V1

Baseline: clean `main` at `d830f0b8993661e257c09897338b75d9cbb09e15`. Internal presentation integration, **COMPLETE for this bounded software milestone; CONDITIONAL GO for internal device acceptance, not public migration**. The user's reported physical live-pilot success informs this task; no new physical Redmi test was performed here.

## Architecture decision

Reuse `useKoroskaShadow` as the single owner of pilot selection, geometry, paint, cell inspection, point modal and Back handling. Add a presentation intent for **Pogoji / live-only**, not another map, weather store, scorer or forecast state machine. The existing research workflow remains available through its Rastišča development entry.

`MapScreen` now renders the pilot's compact controls in its **existing controls slot above the map**. It does not add a second floating top toolbar. The existing ordinary Pogoji controls remain intact in the other conditional branch. Both paths retain the same mounted native `Map`, `Camera` and existing production source IDs. During the pilot, legacy regional layers/controls are hidden by the existing shadow gates, not recoloured or merged with hourly results. Their source data and native components are not replaced.

Reused without byte changes: `koroskaLive`, `useKoroskaLive`, `koroskaLivePresentation`, the bundled artifact/flag, canonical point weather services, all numerical models, soil/DST/window logic and production visual/LOD implementation. Existing geometry is constructed once per artifact; paint expressions select shared weather vectors with static habitat masks. No new dependency, endpoint, schema, data asset or national computation.

## Exact workflow

1. Build with the existing explicit internal flag/helper. Open **Zemljevid → Pogoji → 7 dni · Koroška (test)**. The entry is absent with the flag off and in ordinary Rastišča; the separate research entry in Rastišča remains available.
2. The existing controls slot shows **Pogoji · 7 dni · RAZVOJNI TEST**, **Samo Koroška · 696 celic**, selected absolute date/profile, horizontal seven-date selector, manual refresh, `Območje` and freshness. Entry does **not** acquire weather. A compatible cached snapshot may appear immediately with its original dates/age.
3. Press **Pridobi svežo napoved** deliberately. Numeric colours appear only under the existing whole-snapshot validation gates. Not-loaded/loading/error/incomplete/stale/valid-cache labels come directly from `useKoroskaLive`.
4. Tap a date directly. Tap the selected date/profile summary to open the existing safe-area species/details sheet. All four profiles are local to the pilot. The sheet identifies both contracts and the no-coverage distinction. Unified mode has no switch to frozen research data; failed live requests cannot silently select it.
5. Tap a pilot cell for its date/profile-specific **Regionalna ocena**, static habitat status, `Točkovna napoved`, `Viri` and close selection. Provenance remains collapsed by default; opening/closing it cannot scroll away the fixed score heading.
6. **Danes / Jutri** returns to ordinary Pogoji. It does not select a new global day; the accessibility label explicitly says it restores ordinary Pogoji. The original global species/day, selected ordinary area/hotspot and Top 3 state were never written by pilot controls.

The default pilot entry selects the first absolute date of the available pilot window with the incoming ordinary map profile. It does not translate a stale research date into Today. Profile/day choices within the pilot do not change private ranking or Today/Tomorrow marker semantics.

## Coverage, data and source distinctions

Exactly **696 original polygons / 11 original public weather query locations / 4 profiles / 7 dates / 308 shared weather evaluations**. The centre-selection bbox `[14.65,46.35,15.05,46.59]` is a reproducible Koroška study window, not a claimed administrative boundary. The complete original polygons are retained. Outside them the basemap has **no pilot coverage**, not unsuitable terrain. No national seven-day forecast is claimed.

| Mode | Weather contract | Date/source interpretation |
| --- | --- | --- |
| Ordinary Pogoji | `pilot-weather-v1` | Existing daily products, Today/Tomorrow and original regional semantics unchanged |
| Internal unified seven-day pilot | `regional-civil-week-v1`, existing `koroska-live-regional-v1` envelope | Validated civil-hourly weather, actual absolute seven dates, retrieval/cohort identity and original expiry |
| Separate frozen research view | Original research artifact | Immutable **19–25 October 2026**, permanently labelled not current; never substituted for failed live data |
| Exact-coordinate point forecast | Existing canonical point policy | Actual tapped coordinate and independent current weather/cache/horizon; not the regional sample score |

Prior authentic daily/hourly observational differences remain relevant: small input changes can cross a category boundary, and close retrieval times do not prove identical provider model runs. This integration does not migrate or claim parity with legacy daily regional inputs. Numerical formulas, thresholds and all input contracts are unchanged. Provider model issue time remains unverified/null, never inferred from retrieval.

Live cell text now says **Habitat območja · statični podatki**. Candidate, unknown and outside-model classifications remain unchanged; unknown/outside are nonnumeric, never zero. There is no weather-times-habitat multiplication. The static research cell context and production regional index used for point habitat remain distinct spatial assessments. Neither verifies trees or mushrooms at the exact coordinate. A 1 km polygon does not provide independent 1 km weather precision.

## Network/cache and safety gates

The existing manual acquisition is unchanged: two parallel bounded endpoint requests for all 11 public sample locations; current D60, native soil layers, true 23/24/25-hour days, completed windows and full-input gates. Existing whole-batch atomic receipt/fingerprint/freshness checks prevent silent source-pair mixing. All 308 vectors must pass before numeric publication. Missing values stay null; actual canonical zero remains zero.

| Action | Weather HTTP measured in offline tests |
| --- | ---: |
| Cold manual refresh | 2 mocked endpoint calls |
| Valid warm refresh / valid raw-pair restart | 0 / 0 |
| Entry, date/profile switch, cell/details/Back, pan/zoom | 0 |
| Exact-point modal | Independent existing acquisition policy; an uncached actual coordinate may require its own weather requests |

No actual provider HTTP was made in this task. There is no automatic refresh on entry, gestures, date/profile changes, foreground or TTL/midnight. Original 30-minute raw TTL/receipt expiry is not renewed by UI use. Mixed vintage, missing D60/soil/units, invalid intervals, partial responses and rollover remain blocked or explicitly stale. Closing/reopening cannot allow an old asynchronous task to resurrect the UI. These lifecycle/service implementations are unchanged and their existing race/receipt tests were executed again.

No hotspot names, IDs, notes, visits or private coordinates enter the regional acquisition or exported datasets. Existing exact-point requests disclose only their existing required coordinates. Operational/commercial provider access, quota, billing and licensing still need independent approval before public rollout; two HTTP calls do not establish billable units or permissions.

## Camera, navigation and rollback

Unified controls are laid out **above** the actual map viewport. Camera fitting therefore supplies an explicit zero-height top occlusion rather than counting that header twice; the original region helper still measures the map size and selected bottom-card frame, reserves margins and rejects an impossible viewport. The zero-height frame means no overlaid top control, not an unmeasured floating panel. Separate frozen mode keeps its measured top overlay. Only `Območje` invokes the existing `Camera.fitBounds`; date/profile/entry do not animate or reset it.

Gesture handlers retain the existing shadow policy: remember the viewport, do not trigger production LOD/weather preparation. Exit settles the ordinary viewport using the existing bridge without remounting/animating the camera. A native resize from changing controls height still requires physical projection/layout verification.

Back order: point modal → same regional date/profile/cell → close sheet, if open → close selected cell → exit pilot to ordinary Pogoji. Point-local date/profile changes never recolour regional results. `Točkovna napoved` passes the actual tap, not GPS/cell centre; selected regional date is passed only if inside the point's current horizon. Existing source/date notice explains independent snapshots and any Today fallback. Tab/list departure, loss of map availability or leaving Pogoji resets local selection/sheets/point modal; returning never auto-enables the pilot or acquires weather. Fresh entry reuses immutable geometry and any valid cached weather, not a ghost selection.

Rollback: press **Danes / Jutri** (or Back after closing selection) to restore ordinary Pogoji. For public builds leave `EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW` unset/off. No cache migration, new schema, scorer rollback, native source replacement or private-data operation is needed. The flag is public build configuration, not a secret/security boundary.

## Actual automated checks and measurements

**TypeScript PASS; all 57 active root deterministic `*Smoke.ts` packages PASS.** The new focused test was rerun after its deterministic clock/measurement refinement. Three helper suites also PASS: `buildKoroskaShadowSmoke.mjs`, `buildAndroidReleaseSmoke.mjs`, `androidPerfSmoke.mjs` (synthetic metrics, not a device test).

Active unchanged comparisons: **84,248 regional; 15,688 pilot; 2,400 soil-sampling**. No golden or source fingerprint regenerated. The known standalone **`regionalRegression.ts` FAILS**, exit 1, at the full-source `weather.ts` expectation against `6127609` before its comparisons; it and production `weather.ts` are untouched. Do not call every repository test green.

The new test executes the real presentation hook and actual MapScreen controls/gesture JSX with deterministic native boundaries: default-off/no asset load, entry only in Pogoji, live-only manual behavior, all 28 date/profile transitions, all masks, snapshot identity/freshness/error labels, point-coordinate/date/profile independence, fixed score/provenance, Back/tab/mode reset, exact one Map/Camera, one geometry build and 0 HTTP. The production Map remainder is still source-pinned; only enumerated opt-in integration is excluded, with its handlers exercised separately. Numerical/weather/habitat/geometry/cache modules remain pinned byte-identical to baseline.

Retained **Windows/Node** observations, not Android timing or real network latency:

| Measurement | Observed |
| --- | ---: |
| 28 date/profile JSX/hook test transitions plus assertions | 56.644 ms in one focused pass |
| Geometry construction count across switches/re-entry | 1 |
| Existing geometry source bytes | 450,073, unchanged |
| Cold shared adapter / 308 evaluation-and-validation phase | 132.401 / 131.076 ms |
| Whole cold source/assembly/evaluation task | 303.486 ms; source boundary mocked |
| Mocked decoded archive / forecast semantic JSON | 507,904 / 235,728 B |
| Cold heap / RSS delta | +15,690,168 / +10,526,720 B |
| Retained live snapshot JSON | 527,557 B |
| Peak whole smoke-process RSS | 417,411,072 B, includes compiler/imports/negative fixtures |
| Weather mock calls across all service negative/DST controls | 50; actual provider calls 0 |

Nested timings are not additive. Source/point/scoring stages are unchanged, not a claimed performance improvement. Native style update/GPU/FPS/PSS, camera projection, screen-reader behavior and bundle/APK size are unmeasured. No new dataset is bundled.

Commands actually executed:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/runSmoke.cjs scripts/unifiedPogojiSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaLiveUiSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaShadowMapSmoke.ts
$smokeFiles = Get-ChildItem scripts -File -Filter '*Smoke.ts' |
  Where-Object { $_.Name -notmatch 'LiveSmoke' } | Sort-Object Name
foreach ($file in $smokeFiles) {
  node scripts/runSmoke.cjs $file.FullName
  if ($LASTEXITCODE -ne 0) { throw $file.Name }
}
node scripts/buildKoroskaShadowSmoke.mjs
node scripts/buildAndroidReleaseSmoke.mjs
node scripts/androidPerfSmoke.mjs
# Independent known failure, not omitted from reporting:
node scripts/runSmoke.cjs scripts/regionalRegression.ts
```

## Internal build and physical checklist

SDK confirmed with `android info sdk`. Attempted **`node scripts/buildKoroskaShadow.mjs`**. Gradle failed with **`java.io.IOException: Unable to establish loopback connection`**, exit 1. No new APK produced/copied and no stale APK reused. A successful new native JavaScript bundle/flag verification cannot be claimed from this failed build. The unchanged helper's explicit flag inheritance/restoration/default-off assertions passed.

Local Windows:

```powershell
Set-Location 'C:\Users\Uporabnik\Documents\MushroomApp'
node scripts/buildKoroskaShadow.mjs
# Only after a successful NEW build:
# output/MushroomApp-INTERNAL-koroska-seven-day-shadow-v1.apk
```

The helper sets `EXPO_PUBLIC_ENABLE_KOROSKA_SHADOW_PREVIEW=1` and `EXPO_NO_DOTENV=1` in the same Gradle/Expo process, then restores them. Ordinary APKs must not inherit a manually persisted enable flag from shell/env/CI.

Redmi 13C checks **still required**:

1. Ordinary flag-off APK: no internal entry/layer; original Pogoji/Today/Tomorrow/profile, hotspots/Top 3 and research flag behavior unchanged.
2. Internal Pogoji → **7 dni · Koroška (test)**: same camera, compact controls, explicit 696-cell coverage, no automatic acquisition. Manual cold refresh ≤2 endpoint requests; warm repeat/re-entry adds 0. No frozen fallback on failure.
3. Cycle seven absolute dates/four profiles: correct labels/colours/masks, no request, camera reset or native remount. Check large fonts, TalkBack selection, 48dp controls, horizontal-vs-map gestures, safe areas, attribution and three-button navigation.
4. `Območje` with/without selected bottom card, portrait/landscape: all pilot polygons fit the unobstructed viewport. Outside coverage is not presented as unsuitable.
5. Select a cell → Viri → point forecast: exact actual tap/profile/date gate, independent weather/habitat contexts. Back restores regional date/profile/cell/camera. Point changes do not mutate regional/global day/profile.
6. Rapid taps/refresh/exit/tab/list/search/return and offline/partial-source/TTL/midnight cases: no ghost overlay or stale completion, accurate freshness/error, no fake zero. Exit restores ordinary selection/day/profile and Top 3 origin.

## Public migration remains gated

This proves bounded internal integration architecture, not a public regional weather migration. Remaining gates: new native release/layout/camera/resource acceptance, explicit product acceptance/versioning of daily-versus-hourly/category effects, provider operational/commercial permissions/cost, source coverage/failure behavior, and honest uncertain model-vintage/spatial/ecological claims. No national expansion, public seven-day selector, backend, point/habitat formula change or historical visit reinterpretation is included.

Changed files: `src/screens/MapScreen.tsx`, `src/experimental/useKoroskaShadow.tsx`, `src/experimental/shadowLayout.ts`; `scripts/unifiedPogojiSmoke.ts`, `scripts/koroskaShadowSourceGuards.ts`, `scripts/koroskaLivePilotSmoke.ts`; this report.
