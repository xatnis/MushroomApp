# Hotspot Ranking V1

V1 behavior below is historical. [Hotspot ↔ Heatmap Integration V2](HOTSPOT_HEATMAP_INTEGRATION_V2.md)
now shares the existing heatmap profile/day, preserves list sort, keeps the map mounted
and adds a secondary row map action plus the own-marker display toggle.

The saved-location **Seznam** view answers “Which of my saved locations currently
has the best model conditions?” It does not rank mushroom abundance or finding probability.
Only the current local user's saved locations are evaluated; the existing friends list
and sharing semantics are unchanged.

## Selection and sorting

The compact list header reuses `MUSHROOM_WEATHER_PROFILES` for Splošno, Jesenski goban,
Navadna lisička and Užitna sirovka, with Danes/Jutri. Ranking defaults to Splošno/Danes.
The target is a comparison profile for ALL rows, not the species saved at each hotspot.

### Controls presentation polish

Species remain one horizontally scrolling chip row, with a subtle horizontal-arrow cue,
hidden native scroll indicator and accessibility swipe hint. Below it, Danes/Jutri share one segmented
container; the adjacent sort trigger displays the selected label and chevron. It opens a
small React Native Modal menu with only the same three choices, a selected checkmark,
outside-tap dismissal and Android-back dismissal. No new dependency is needed.

The controls row uses wrapping flex layout: its nominal minimum budget is 136 pt for
day + 156 pt for sort + 8 pt gap. With the list's 32 pt horizontal inset, 360/412 pt screens
fit both in one row; 320 pt can wrap safely. These are style-budget checks, not measured
native Yoga/font results. Text is not truncated or reduced; it may wrap under large text
settings. Chips, segments and menu targets remain at least 44 pt high.

Day/sort now occupy one 44 pt row instead of two on normal phone widths, saving one
row plus its gap. Header gaps are 4 instead of 8 pt; the shorter disclaimer also reduces
wrapping. Exact first-card height improvement depends on font scaling and native layout
and must be checked on the phone. The header says “N ocenjenih · M brez ocene” and
“Razvrstitev primerja pogoje, ne zagotavlja najdb.” Existing hotspot cards are unchanged.

Menu state belongs to the memoized presentation child, below the conditions hook;
opening/cancelling it cannot invoke ranking evaluation or transport. Choosing a sort uses
the original state setter. Ranking/domain, hook inputs, row content and navigation are
pinned unchanged in `scripts/rankingControlsSmoke.ts`.

Final control polish: the dayMode equality check was already correct, but selected day
used a pale surface against a green-tinted inactive container. Selected now uses the same
dark green/white active palette as species chips, with a neutral inactive surface.
`accessibilityState.selected` and `checked` both follow that same equality check. The menu
has no Cancel row; selecting, tapping outside or Android Back are its dismissal paths.

Final polish verification: TypeScript and 8 focused/regression suites passed, including
84,248 regional and 15,688 pilot parity cases. The release helper failed with the known
Gradle loopback error; no old APK was copied. Local build command:

```powershell
npm run apk -- --name MushroomApp-preview-hotspot-ranking-final-polish.apk
```

- **Zadnja sprememba** remains the default, preserving repository `updatedAt DESC` order.
- **Ime** uses Slovenian name ordering and deterministic ID tie-breaking.
- **Najboljši pogoji** sorts available scores descending; unavailable scores come last.
  Equal scores preserve the original list order, including unavailable ties.

The input list is never mutated or reordered before weather loading. Search retains its
existing filtering/empty states. The own-location list is now virtualized/scrollable.
Rows retain title, coordinates, visit count, sync/local-only status and detail navigation;
they add the shared score/label, a neutral missing/loading state and stale-cache notice.
The compact header reports available/unavailable counts and offers retry after partial
failure. No numeric zero is invented for missing inputs; a real model score of zero is valid.

## Shared evaluation, loading and performance

`HotspotRankingList` calls the existing **single grouped** `useLocationConditions` hook
with the original hotspot locations and a 250 ms acquisition debounce. It uses exactly
the point/cell mapping, `conditionsForLocation`, habitat context, scorer implementations,
weather history/day semantics, memory/disk 30-minute cache, in-flight dedupe, provider
batching and progressive subscription already used by cards/popups/markers. There is
no ranking scorer or weather implementation.

The FlatList and all rows render before weather completes. Ready labels update immediately;
only conditions-sort ORDER updates coalesce in fixed **200 ms** windows. Continuous
updates cannot postpone publication indefinitely. A new target/day/sort/filter generation
publishes immediately, cancels old work and ignores stale callbacks; unmount cleans timers.
Recent/name order does not wait for scores. Stable hotspot IDs are FlatList keys.

Progress/order state lives in a child component; it has no MapLibre, GeoJSON, LOD or
cloud mutation calls. Profile/day use cached snapshots and are deliberately absent from
the existing weather transport effect dependencies. A sort never feeds reordered locations
back into that hook. Map's weather/render calculations and native sources remain unchanged.

## Navigation and future integration

The transient `ConditionsTargetContext { targetProfile, dayMode }` lives in MapScreen's
list-selection state, independently of heatmap evaluation state, and survives list/map
switching while that screen is mounted. This avoids recomputing regional GeoJSON when
only a ranking selection changes. It is not written to storage/AppContext or the cloud.
Row navigation passes optional `conditionsContext` to HotspotDetail. The detail initializes
from that context; ordinary callers still use the existing species fallback and Danes.
Refresh does not reset a user's subsequent detail selection. Its existing map CTA then
passes the current context through the already implemented hotspot-focused map intent.

There is no additional row map action in V1, avoiding clutter. Future ranking↔heatmap
integration can reuse the typed context and shared evaluator without introducing a new
formula. No mini ranking overlay, 70+ filter, recommendation or route planning is added.
`targetProfile` is not a Boletus-specific API, permitting later foraging profiles. Existing
immutable visit snapshots remain untouched and can later support effort/field-outcome
validation; ranking itself is not validation or a production accuracy claim.

## Privacy and limits

Ranking stays local, with existing weather-provider queries for public sampling coordinates.
It never publishes hotspots, modifies sharing, changes Supabase or uploads private diary data.
Outside the regional AOI the existing evaluator may provide weather with unknown habitat;
limited inputs/stale cache remain model limitations. Overview is still an approximation,
so compare exact parity with the 1 km detail model under identical snapshots/profile/day.
Large personal lists may need more weather points/batches; the existing rate budget is
unchanged. Physical list scrolling/tap readability still requires Android QA.

## Reproduce checks

```powershell
npm run typecheck
node scripts/runSmoke.cjs scripts/hotspotRankingSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotRankingUiSmoke.ts
node scripts/runSmoke.cjs scripts/hotspotConditionsSmoke.ts
node scripts/runSmoke.cjs scripts/locationConditionsHookSmoke.ts
npm run apk -- --name MushroomApp-preview-hotspot-ranking-v1.apk
```

The ranking tests use mocked transport and actual production evaluators, not measured
network timings: nine colocated hotspots → one weather point → one batch / two endpoint
requests; nine across four points → one batch / two endpoint requests. Concurrent duplicate,
warm and profile/day evaluation → zero additional HTTP. The existing shared hook/scorer
regressions remain required, including 84,248 regional and 15,688 pilot comparisons.
Never reuse an old APK if Gradle fails.

## Verification for this change

TypeScript and 22 smoke suites passed: ranking/domain/UI, safe area, hotspot overlay,
shared conditions/hook, conditions card/navigation/controls, render/transition/LOD,
regional/overview loading and spatial indexing, pilot, generic weather, location ranking
and habitat/ZGS. Production parity: **84,248 regional + 15,688 pilot** assessments;
scorer/weather/habitat/LOD sources remain byte-identical to the regression baseline.

The release helper was attempted with the command above, but this environment's Gradle
failed with `Unable to establish loopback connection`. No APK was copied. Run the same
command locally for `output/MushroomApp-preview-hotspot-ranking-v1.apk`; physical list
layout, scrolling and interaction are not asserted by desktop smoke tests.
