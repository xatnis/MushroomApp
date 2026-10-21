# Point Habitat Context V1

## 1. Purpose and unchanged numerical contract

The existing point forecast evaluates **weather-based environmental suitability**, using canonical point inputs and the four production scorers. It does not verify species-specific trees/vegetation at the exact point. This change adds a separate, static **regional area habitat context**, never a score input, multiplier, bonus, penalty or availability gate.

The main numerical label now says **Vremenski pogoji: …/100**. Totals, labels, factor contributions, snapshot identity, Today/Tomorrow parity, rolling windows, DST/soil semantics and missing-weather safety gates are unchanged. Habitat unknown/outside coverage does not suppress a valid weather score. A high weather score does not establish mushroom presence or harvest quantity.

## 2. Actual lookup architecture

`src/domain/pointHabitat.ts` exports the deterministic `resolvePointHabitat(latitude, longitude, profileId)` and a typed result. It calls the existing **`REGIONAL_INDEX.atPoint([longitude, latitude])`**, then **`habitatStateFor(feature, profileId)`** and **`habitatExplanation`**. No nearest centre, weather-cell lookup, coordinate rounding, geocoder, research snapshot or new habitat formula is involved. The optional source argument is a pure dependency-injection seam for labelled geometry fixtures; production uses the original regional source.

The canonical index first checks prepared envelopes, then the actual Polygon/MultiPolygon rings and holes using `containsPoint`. Its current ray-casting boundary convention is preserved, not replaced: the controlled square fixture includes left/bottom edges and excludes right/top edges; adjacent cells therefore resolve their shared edge under the existing ordering/ring rule. Hole edges follow that same predicate. No buffer/snapping tolerance or claim of precise vegetation boundaries is added. A point inside a broad envelope but outside every actual polygon returns outside coverage.

Result metadata includes context version `point-area-habitat-context-v1`, active profile, optional actual cell ID, canonical explanation, source provenance, actual ZGS availability/capture metadata and explicit invalid-coordinate/no-polygon reason. The result does not contain or export the input coordinates, hotspot ID/name/notes, visit or user identity. No logging, SQLite access or external analytics is added.

## 3. Verified coverage, not a national claim

The **current repository production regional artifact** is `slovenia-regional-v2`, with **10,531 polygons**, nominal 1,000 m habitat cells and metadata bounds approximately:

`[13.8743318864, 45.7951075061, 15.8259368376, 46.7129688049]`.

The bbox is descriptive, not the containment authority. Original clipped polygons, holes and prepared gaps determine support. This is not complete Slovenia coverage. The 696-cell Koroška shadow snapshot and figures from proposed/other research geometry do not enlarge production habitat coverage. Coordinates beyond supported polygons remain uncovered, not unsuitable.

## 4. States and per-profile behavior

| State | UI meaning | What it does NOT mean |
| --- | --- | --- |
| `candidate` | Habitat območja: potencialno primeren | Verified host trees or mushrooms at the exact point |
| `unknown` | Habitat območja: ni dovolj podatkov | Unsuitable habitat or score zero |
| `outside-model` | Habitat območja: zunaj habitatnega modela | Mushrooms cannot grow there |
| `outside-coverage` | Habitat: za to območje še nimamo podatkov | A negative habitat evaluation |

The production classifier, unchanged:

- **Splošno:** existing tree-cover + grassland fraction must meet the existing 0.20 vegetation criterion. It does not require species-specific ZGS evidence; the current canonical generic classifier has candidate/outside-model outcomes, not an invented generic unknown category.
- **Jesenski goban:** existing wooded criterion (tree fraction ≥0.30), then validated ZGS host-group evidence/coverage policy including spruce, fir, pine, beech and oak.
- **Navadna lisička:** same existing wooded gate, its own validated ZGS known-host policy; birch is not separately identified and fir is deliberately excluded by this existing model.
- **Užitna sirovka:** existing wooded gate and validated pine evidence. Insufficient or even valid nonpositive pine evidence remains unknown under the canonical policy, not proof of absence.

All profile-specific coverage, incomplete/invalid stand and overlap checks remain in `pilot.ts`/`zgs.ts`; none are copied into a second model. The helper only reports their result. Selecting a species can legitimately change area context without changing coordinates.

## 5. Dataset provenance and freshness

- **ESA WorldCover — 2021 v200**, source raster 10 m, aggregated into the existing ~1 km regional cells. Attribution retained: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium; CC BY 4.0 in existing metadata.
- **Zavod za gozdove Slovenije – podatki o sestojih**, existing source schema `opis podatkov 2.8 / WFS live`. “WFS live” describes the acquisition interface in the original metadata, **not a real-time forest observation**.
- Regional capture: **2026-09-27T20:59:20.571108+00:00**. Inherited `area-…` pilot cells retain **2026-09-22T17:39:41.263887+00:00**, matching the existing regional provenance rule.
- Stand-data observation vintage is **unknown**, explicitly represented as null, not inferred from retrieval time. A missing ZGS result is not given a fake per-cell capture date.

The full-screen disclosure exposes source/version/resolution, supported polygon count, cell ID where present, ZGS availability and appropriate capture timestamp, attribution and limitations. A composition aggregate for part of a cell is not a measurement of trees at the tapped point. No elevation, terrain, soil type or unsupported tree species is inferred.

## 6. UI and entry paths

One shared `PointHabitatContext` component is used by both existing forecast surfaces:

- **Full screen:** below the selected weather score, a status, short area-vs-point limitation and a ≥48dp “Viri in omejitve habitata” disclosure. Sources and the canonical explanation stay collapsed by default. During weather loading/failure with no results, the independent habitat context remains available; it does not masquerade as completed weather evaluation.
- **Compact map preview:** short status text only when the existing readable-date-strip space/font budget permits it. Smaller/larger-font fallback retains the pinned full-screen action, where the full context is always available. No permanent large map card or extra map controls are added; text is not clipped to manufacture a single line.

Coordinates/profile come directly from the existing forecast location props: explicit map tap, region-point actions, saved hotspot map preview and Razmere selected location. Existing hotspot detail → map/focus behavior is preserved; this task adds no new navigation route/action. The full-screen modal also covers the developer shadow map’s explicit exact-point action, but its context comes from **production regional habitat**, not experimental scores/dates.

Changing points or profile updates the context synchronously. Component `useMemo` keys are exact latitude, longitude and profile. The source is a build-static module identity; source updates require a new bundled dataset/build. Date, weather loading, snapshot freshness and weather/profile cache callbacks are not habitat dependencies. A moved/deleted hotspot is handled by existing forecast identity/navigation guards; no prior coordinate result is persisted or globally cached.

TalkBack receives the text and area-level qualifier, the source disclosure announces expanded/collapsed state, and status does not depend on colour. Existing safe areas, Back, global map day/profile, camera, sources and LOD remain unchanged. Physical narrow-screen/large-font/TalkBack behavior is not claimed verified by JavaScript tests.

## 7. Performance and import cost

No new geographic dataset, dependency, index, transform or serialized geometry is created. The helper lazily requires existing regional modules only on first lookup and subsequently reuses their module/index instances. Merely importing the forecast/helper does not eagerly load geometry through this new dependency. Normal navigation starts with the existing Map tab, whose regional data/index are already used; this feature does not parse a second copy. A future standalone forecast-only app entry must account for the existing heavy regional first import.

Actual **Windows / Node v24.21.0** observations from the focused smoke process (TypeScript transpilation included, not Hermes/Redmi timings):

| Measurement | Observed |
| --- | ---: |
| First standalone lookup including original regional/pilot module imports | 343.584 ms in one pass; 433.159 ms in a subsequent pass; 1,070.700 ms under concurrent work |
| First import heap increase | approximately 41–73 MB across passes (GC was not forced) |
| First import RSS increase | approximately 67–85 MB |
| 1,000 warm lookups of the profile/state test points | 1.510–7.355 ms across those passes |
| 1,000 warm lookups spatially spread over all 10,531 cells | 211.262 ms total (about 0.211 ms/query, one measured pass under concurrent work) |
| Weather/habitat HTTP from context/tests | **0** |

The first-import memory is the **existing** regional/pilot raw datasets, enrichment, prepared features and index, not extra per-forecast geometry or native PSS. Original regional habitat JSON is 5,798,294 B; original ZGS JSON 11,454,066 B, both already shipped. No copies of those files were added. Warm lookup is a bounded envelope scan + exact geometry test once per coordinate/profile, not a per-frame/per-day scan. No Android latency/FPS/memory guarantee follows from these desktop numbers. Final APK size delta cannot be measured because Gradle failed.

Weather acquisition hooks, frozen snapshots, request deduplication, TTL/cache keys, point scorer invocation and regional recomputation remain byte-unchanged. Neither disclosure toggle nor date selection requests data or reevaluates the regional map. No habitat spinner is needed.

## 8. Verification and numerical preservation

Commands actually used:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/runSmoke.cjs scripts/pointHabitatSmoke.ts
Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' | Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
node scripts/buildAndroidReleaseSmoke.mjs
node scripts/buildKoroskaShadowSmoke.mjs
# Run/reported independently, not hidden by the active suite:
node scripts/runSmoke.cjs scripts/regionalRegression.ts
```

Focused tests use genuine prepared cells for all available profile/state combinations; synthetic labelled polygons test holes, shared/outer borders and multipolygons through the **actual** spatial index. They verify distinct coordinates/profiles, no stale memo, no habitat date changes, source/vintage semantics, disclosure accessibility, full/compact consistency for **3 origins × 4 profiles × 7 dates**, loading independence, null behavior and no private-data export. All 28 canonical weekly results and snapshots remain deeply identical before/after habitat resolution. Scorer/weather/domain/map/shadow-source files remain pinned byte-for-byte to `6c54e0a`; the old view pins strip only the exact new informational JSX/text additions, which this new suite separately executes.

Initial runs exposed Node harnesses that did not yet supply the new child component and the old soil suite’s full-view byte pin. These were updated only at the declared UI boundary. No weather/scorer golden or legacy standalone fingerprint was changed.

**Actually executed final results:** TypeScript **PASS**; complete rerun of all **53 deterministic root smoke suites PASS**, including the new context suite, Koroška shadow/prototype/authentic research, MapScreen/conditions/navigation, weekly/point weather, ranking/Top 3, cache and scorer tests. The original APK helper and internal-shadow APK environment helper `.mjs` suites also **PASS**. Actual unchanged comparisons: **84,248 regional; 15,688 pilot; 2,400 soil sampling**. No live provider smoke or physical Android test was run.

The separate standalone **`regionalRegression.ts` remains FAIL** on its previously documented stale byte-level expectation for **`src/services/weather.ts`**, including pre-existing chart/calendar/timing/export differences. It was explicitly executed and neither modified nor bypassed. Active comparison success is not a claim that every repository test passes.

## 9. APK and native status

Attempted:

```powershell
npm run apk -- --name MushroomApp-preview-point-habitat-v1.apk
```

The build reached Gradle and failed with **`java.io.IOException: Unable to establish loopback connection`**. No new APK was produced/copied, no older artifact renamed. The same command above is the exact local Windows build command (from `C:\Users\Uporabnik\Documents\MushroomApp`). Android CLI SDK inspection located `C:\Users\Uporabnik\AppData\Local\Android\Sdk`; its update notice is not a device verification. No physical Android test, screenshots, native frame timing or TalkBack run was performed.

Separately, the actual Expo Android production **JavaScript export PASS** (`export:embed --platform android --dev false --minify false --entry-file index.ts --bundle-output output/point-habitat-verification/index.android.js --max-workers 2`, with shadow flag absent). It bundled **1,326 modules** (two new code modules, no new geographic dataset/dependency), output 27,797,757 B unminified including the existing app/data. The 87,849 ms Metro bundle phase is desktop build time, not runtime latency. The output contains both new components/resolver and **`KOROSKA_SHADOW_ENABLED = false`**. This ignored JS artifact is not an APK or native verification; no unsupported compressed APK-size delta is claimed.

## 10. Future coverage and scientific limits

Slovenia-wide habitat context needs an actually prepared, versioned, legally reusable national geometry/enrichment dataset with validated coverage, host-group completeness, boundary/hole rules and native memory/performance acceptance. Enlarging a bbox or borrowing a research forecast snapshot is not sufficient. Species evidence/thresholds require separate model/ecological validation; this UI must not silently change the regional classifier or point weather model.

Unknown is not unsuitable. Outside the model is not ecological impossibility. Candidate describes regional evidence, not exact-point trees or mushrooms. Historical cover/composition can lag forest management and disturbance. Context is informational and not a guarantee of access, safety or a successful harvest.

## 11. Changed files

- `src/domain/pointHabitat.ts` — pure static regional resolver/provenance/labels.
- `src/components/PointHabitatContext.tsx` — shared compact/full accessible presentation.
- `src/components/SevenDayConditionsView.tsx`, `src/components/SevenDayMapForecast.tsx` — contextual sibling and explicit weather-score label only.
- `scripts/pointHabitatSmoke.ts` — focused spatial, provenance, parity, composition and performance tests.
- `scripts/pointMigrationSourceGuards.ts` — narrow informational-UI normalization, with full remaining view pinned to baseline by the new suite.
- `scripts/sevenDayUiSmoke.ts`, `scripts/mapForecastSmoke.ts`, `scripts/mapCompactForecastSmoke.ts` — provide the new child boundary to existing weather/navigation harnesses.
- `docs/POINT_HABITAT_CONTEXT_V1.md` — this report.
