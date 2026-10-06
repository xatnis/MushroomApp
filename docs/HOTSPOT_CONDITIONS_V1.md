# Hotspot Conditions V1

## Purpose and data flow

Saved locations, the regional conditions map and visit history now share conditions context. Scores describe weather suitability, not the probability of finding mushrooms. No ranking, recommendation, feedback UI or new ecological model is introduced.

`saved coordinate → REGIONAL_INDEX.atPoint → existing cell.weatherCellId → loadHeatmapPilot/getRegionalWeather → assessHeatmapWeather → regionalAreaAssessmentFor`

The containing **clipped polygon**, not the closest town or polygon centre, determines habitat and the existing 10 km detail weather point. Point lookup uses the already-created geometry-envelope index; it does not rebuild regional GeoJSON. `regionalAreaAssessmentFor` reuses `areaAssessmentFor` and the same Regional V2 ZGS provenance adjustment as map rendering. Scores, labels, components and classifications are identical for identical inputs/profile/day.

Outside prepared habitat coverage, the saved coordinate is sent to the existing weather batch provider as a stable coordinate-specific point. Weather can still be scored; habitat stays **unknown**, without invented WorldCover/ZGS evidence. This does not extend the prepared heatmap AOI.

## Reused architecture

- Four existing `MUSHROOM_WEATHER_PROFILES` and unchanged production scorers.
- Existing historical windows, current/tomorrow soil sampling, missing-input renormalization and Ljubljana date semantics.
- Existing WorldCover/ZGS habitat rules and regional spatial index.
- Existing 30-minute memory/SQLite cache, point-level in-flight dedupe, multi-coordinate batching, request budget and partial-failure handling.
- Existing marker annotations and selected-hotspot popup flow above heatmap fills.
- Existing local diary repository, transactional inserts and visit editing.

New code adds a point lookup, a read-only shared bundle subscription, a grouped location hook, compact UI and a nullable visit snapshot column. It does **not** add another weather provider or scoring formula.

## Saved-location card and navigation

The compact card appears between basic hotspot information and actions. It provides four profile choices, Danes/Jutri, score/label, existing factor status labels, habitat status, retry and **Odpri pogoje na zemljevidu**.

Default selection comes from the latest visit identifying an exact supported catalogue species. Custom names, unsupported species (including Marela), unknown species and taxonomic groups do not acquire a fake species scorer. Without a supported identification, the default is Splošno, with a short explanatory note. Stored species are never changed.

The map focus request carries the hotspot ID, actual coordinates, selected profile and day. It enables Pogoji, clears unrelated selected-area context, focuses the saved location at the existing local zoom, and opens its hotspot popup. Plain **Prikaži na zemljevidu** remains available without forcing conditions mode.

## Map badges and performance

Private saved-hotspot markers remain view annotations above the heatmap sources. Ready markers receive a small numeric badge; unavailable scores keep the normal marker. A legitimate computed zero is distinct from missing data.

Badges and the compact popup use the map's selected profile/day, **not each hotspot's recorded species**. They use the canonical **1 km/detail habitat + 10 km weather** location model even when the underlying low-zoom map shows approximate 4 km/20 km overview cells. Therefore a coarse polygon's approximate score need not equal the saved-location badge. Zooming into the matching detail cell provides the exact parity comparison.

Only visible/selected saved locations require marker weather, grouped by unique weather point. Requests are settled/debounced at 250 ms and use the existing bounded scheduler. The already-loaded shared bundle is used immediately, then memory/disk/in-flight results fill missing data. Profile/day changes only select existing assessments: the transport effect has no profile/day dependency. Foreground re-entry refreshes through the same freshness/cache policy.

Marker/card subscriptions only rerender their child components. Map's `useHeatmapVisuals` does not subscribe to the location store. Marker progress, popup selection and compact card UI cannot publish a regional GeoJSON source, remount it or initiate a LOD handoff. Existing 60/250 ms map debounces and 9.2/8.5/8.8 thresholds are unchanged.

Loading: **Pridobivam pogoje ...**. Missing/insufficient data: **Ocene trenutno ni mogoče izračunati.** No fallback `0 / 100`. Partial weather uses the existing scorer semantics. Stale/over-30-minute displayed cached data is explicitly labelled while refresh proceeds. Retry goes through the same deduped loader.

## Visit snapshot schema

SQLite migration **v2 → v3** adds nullable `finds.conditionsSnapshotJson`. `FindRecord.conditionsSnapshot` is optional, `schemaVersion: 1`.

It stores:

- recorded/evaluated/observed dates, target profile and day mode;
- the saved score and label, scorer ID/version **and copied scorer configuration**;
- input-policy version, saved coordinate, containing area ID and weather sampling point;
- historical aggregate inputs and their coverage, current sampled soil values/time;
- normalized component values, effective weights and weighted contributions;
- habitat classification, compact original cell properties/ZGS aggregates and source vintage/provenance;
- input completeness, modelled-history days, weather provider, fetch time and stale flag.

It does not store raw API responses, daily/hourly arrays or unused future rainfall. Production scores use historical aggregates; forecast rainfall affects trend, which is not saved as an occurrence predictor. Tomorrow semantics remain unchanged in the current card.

The recording form reuses one grouped, 250 ms settled conditions load for its actual location and today's assessment. Saving does **not wait** for it. A snapshot is captured only for a new visit with an available numeric/core-complete assessment whose evaluation date matches the visit's Ljubljana calendar date. Optional-signal `limited` assessments can be saved. Past dates and missing data do not receive today's score. Opening Add Visit from hotspot detail carries the selected profile; a new actual visit records **today**, even if the browsing card was showing tomorrow. Direct recording defaults from exact supported recorded items, otherwise Splošno.

The snapshot records conditions available **at save time**, not a reconstruction of weather at an earlier observation hour. Both timestamps are retained. Editing a visit or asynchronously adding historical hourly weather cannot overwrite the saved snapshot. JSON serialization isolates it from live cache/model changes. History and visit detail display the saved value, never a current recalculation. Old visits have no score placeholder and retain existing weather presentation.

## Privacy and compatibility

No Supabase schema, sharing policy or community API changes. Private locations/visits remain private/local under existing rules. Snapshot metadata is **device-local even for an otherwise synced/shared visit**: it is excluded from find outbox payloads. Existing cloud pull/upsert statements leave the new local column intact. No snapshots are invented when downloading old visits or migrating old rows. Local diary export can include the snapshot because it is an explicit private export.

Weather requests use the existing Open-Meteo provider; that is not publication to other users. Development diagnostics contain counts/durations, not saved GPS coordinates. Sources retain existing attribution requirements; no unverified ZGS licence is claimed.

## Verification and limitations

Run from the project root:

```powershell
npm run typecheck
node scripts/runSmoke.cjs scripts/hotspotConditionsSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotConditionsUiSmoke.ts
node scripts/runSmoke.cjs scripts/locationConditionsHookSmoke.ts
```

The integration smoke uses real in-memory SQLite (Node's built-in `node:sqlite`, tested on Node 24.21) to test fresh creation, actual v2 migration, old/new visits, immutable edits/weather enrichment and cloud-outbox exclusion. It tests shared bundles, grouped cache/dedupe, unknown outside habitat and parity for all profiles/days. Frozen production source checks and assessment comparisons cover **84,248 regional** and **15,688 pilot** cases against pre-task baseline `2822a44`. Fixture request example: nine colocated saved locations → one weather point → one batch/two endpoint requests; duplicate/warm/profile/day requests → zero. Different locations may require more unique points; this is not a real-network timing measurement.

UI smoke executes actual compact card/popup/marker functions in a JS harness; it is not a native renderer. The hook smoke executes real selection/load/subscription effects, testing rapid profile/day changes, cache reuse on focus/foreground, stale cancellation and listener cleanup. Existing card/navigation/LOD/progressive-weather/scorer/habitat/GPS suites remain required. Existing conditions-card regression now pins weather/LOD/source code rather than forbidding the intentional hotspot navigation/marker integration.

Physical Android checklist:

1. Supported-species hotspot defaults correctly; unsupported Marela defaults Splošno without changing the diary.
2. Today/tomorrow and all profiles update compact factors/score; airplane-mode warm cache remains usable.
3. Map CTA preserves selection, focuses the exact saved location and shows its marker/popup above both LOD fills.
4. Compare a badge/card with the containing detail cell under identical loaded inputs; overview approximation may differ.
5. Pan across saved hotspots; missing weather leaves their markers visible. Switching species/day does not add weather requests.
6. Save a ready visit; history/detail show its captured score. Save immediately/offline without ready conditions and an old dated visit; no invented score appears.
7. Restart, inspect both legacy and new visits, edit notes/date and verify the original snapshot stays immutable.
8. Confirm controls X-close, detail-card scrolling, LOD handoff and map interaction remain healthy with nine hotspots.

Build: `npm run apk -- --name MushroomApp-preview-hotspot-conditions-v1.apk`. Do not reuse an old APK if Gradle fails.

Known limits: native badge/popup placement and responsiveness still require phone verification; outside AOI habitat is unknown; snapshots are not cloud-synced; immediate saves may legitimately lack a snapshot; current weather and forecast inputs remain model estimates, not finding probabilities.

## Future extensions

Location evaluation is expressed in terms of `targetProfile` and can support other foraging targets later without coupling a new scorer to diary mushrooms. A future “best hotspot today” feature can batch the same evaluator/cache; no ranking is added now. Versioned saved inputs, timestamps and immutable scores provide a basis for optional field-outcome/effort/confidence validation later, with a separate schema and honest treatment of effort/negative outcomes. No field-outcome UI or pseudo-validation claim is introduced in V1.
