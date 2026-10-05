# Conditions area card V2

UI-only redesign: the production score, class label, components, habitat classification and weather snapshots are unchanged. No occurrence-study result is presented as accuracy or confidence. No charts are included.

## Hierarchy and state

Existing responsive height, fixed title/region/species/X, shared Danes/Jutri and score are retained. Only the body scrolls: short weather interpretation, four factors, habitat, input completeness, expandable technical details, disclaimer and existing Conditions navigation.

Details expansion is child-local React state. It persists across species/day changes, resets for a new area or card unmount, and never changes AppContext, map geometry, source IDs, LOD or weather scheduling. The presentation is memoized independently of the expansion state.

## Display interpretation (not model thresholds)

`src/domain/heatmap/cardPresentation.ts` reuses production `component.value` suitability (0–1, higher is better) and actual component weights. Values at least 0.85 / 0.65 / 0.40 map to very favourable / favourable / moderately favourable; below 0.40 is unfavourable. These are display bands, not ecological thresholds or new scoring formulas. The temperature label deliberately does not claim an exact biological optimum.

All rain components are grouped using the weighted mean of their suitability. A spread of at least 0.45 between separate rain components displays **Mešani signali**, rather than hiding short/long-window disagreement. Individual windows and contributions remain in Details. Generic keeps its existing combined rain component. Temperature uses the scorer's existing 14-day Chanterelle window and 20-day window for the other profiles. Drying's normalized suitability is inverse deficit: high suitability means a small unfavourable influence, not more drying. Missing factors display **Ni podatkov**.

The deterministic two-sentence summary prioritizes rain/temperature suitability or disagreement, then missing data, strong drying pressure or soil suitability. It does not infer mushroom presence. Secondary factor text uses the existing raw windows, never new thresholds.

## Reliability

This describes input completeness, not a statistical confidence interval:

- **Visoka**: complete weather, known habitat state and non-stale inputs, with both soil layers if the soil component is used.
- **Srednja**: limited weather, unknown habitat, stale inputs, or a missing soil layer while the soil component remains available.
- **Omejena**: pending/insufficient/unpublished weather, or both limited weather and unknown habitat.

A known outside-model classification is not itself missing data; a high reliability label does not imply suitable habitat. Habitat always remains separate from the weather score.

## Technical details and attribution

Details show actual component raw values, both soil depths, ET0/rain7, original weightedPoints/weight (no copied maxima), limitations, source age and weather sampling scale. Attribution retains Open-Meteo, ESA WorldCover 2021 and its full attribution, ZGS stand data where available, and geoBoundaries. No new ZGS licence claim is made.

The disclaimer “Ocena predstavlja primernost vremenskih razmer in ne zagotavlja prisotnosti gob.” stays accessible in Details (in the current progressive-disclosure layout: Zanesljivost in viri). Attribution is retained.

## Checks

Run `node scripts/runSmoke.cjs scripts/conditionsCardSmoke.ts` and `npm run typecheck`, plus existing navigation, controls, weather, habitat and regional regression tests. The focused test executes the real card function using a lightweight hook/element harness; it is not a native Android layout test. It also verifies the parent MapScreen function is identical to the pre-redesign baseline.

On a small Android phone, verify a two-line Črna na Koroškem title, fixed X/date/score, scrolling to the last attribution/disclaimer, expand/collapse, species/day updates while expanded, candidate/unknown/outside-model copy, and no controls-panel overlap. Build with `npm run apk -- --name MushroomApp-preview-conditions-card-v2.apk`.

### Validation in this environment (2026-10-05)

TypeScript and 15 smoke/regression scripts passed: card presentation/interaction, navigation, controls response, transition confirmation, LOD/thresholds/visuals, regional/progressive/overview loading, generic weather details, Pilot, Boletus/Chanterelle/ZGS habitat and regional regression. The regional baseline comparison covered 84,248 cases; Pilot weather comparison covered 15,688 cases. Production model files/data remain unchanged.

The requested APK helper failed at Gradle daemon startup with `java.io.IOException: Unable to establish loopback connection`. No new APK was created or copied. Run the same helper command locally; native scroll, wrapping, accessibility and gesture QA remain unverified on a physical Android device.

## Density and hierarchy polish

The same card extent and body scrolling are retained. Header metadata now combines region and species, e.g. `Koroška · Jesenski goban`; the redundant domestic country is omitted only in this compact line and retained in expanded Details. Foreign-country context is retained. Title and metadata wrap naturally without line caps; X remains a 44-point target.

Card/header gaps shrink from 8 to 4 points. Date-control outer padding shrinks from 3 to 1 while each tab keeps a 44-point touch target. Score font size is unchanged. The existing summary wording/logic is unchanged, inside a subtle tinted/accent block labelled `ZAKAJ <score>?` (unpublished score: `ZAKAJ TA OCENA?`, never a fake zero).

Factors use name and a textual neutral green pill, then a shorter secondary value. Row vertical padding shrinks from 8 to 5 points and section padding from 8 to 2. Text and pills can wrap; nothing is line-clipped. Short formats retain the same values/windows, e.g. `13 °C / 20 dni`. Drying's main labels are Neugodno / Manj ugodno / Ugodno / Zelo ugodno using the identical display bands; the original detailed influence labels and long descriptions remain in Details. No ecological/scoring threshold was changed.

Habitat copy is unchanged with tighter spacing. Reliability level and heading share one row and the main description is shorter (`Na voljo so vsi glavni podatki.` for Visoka). The full explanation and input-completeness/non-statistical-confidence clarification are retained in Details. Details toggle keeps a 44-point target; body has right padding for scrollbar clearance and unchanged bottom padding. Technical contribution rows, all sources, disclaimers and navigation remain available.

These are style/layout-contract checks, not a measured native screenshot result. On Redmi 13C verify summary plus 2–3 factors below the fixed header, all four after a short scroll, long unknown/limited states, expanded attribution at the end, large-font settings, and one-finger scroll. Build with `npm run apk -- --name MushroomApp-preview-conditions-card-density-polish.apk`.

Density-pass validation (2026-10-05): TypeScript, the updated card harness and 11 existing navigation/controls/LOD/loading/weather/habitat/regional scripts passed. Regional 84,248 and Pilot 15,688 baseline comparisons remain identical. The density APK helper failed at Gradle startup with the same loopback error; no new APK was copied. The helper command above must be run locally.

## Progressive-disclosure redesign (before the accordion polish below)

Three levels now replace the expanded monolithic report:

1. **Decision:** fixed title/compact metadata/date/score, unchanged short summary, four name/status-only factor rows, compact Habitat and Zanesljivost statuses, and Poglej podrobnosti. No secondary raw values or long explanations in the main view. Candidate habitat is shortened to `Potencialno ustrezno`; unknown/outside-model keep their specific labels.
2. **Explanation:** Poglej podrobnosti reveals three initially collapsed, independent accordions: Vreme, Habitat, Zanesljivost in viri. Multiple sections may remain open. Headers have 44-point targets, textual labels, expanded accessibility state and forward/down chevrons from existing Ionicons.
3. **Technical:** Vreme contains four groups with the actual per-species component breakdown, raw periods/values, unchanged weightedPoints/weight, normalized interpretation, both soil layers and ET0/rain7. Rain/temperature raw values are not repeated a second time as secondary factor prose. Missing groups retain Ni podatkov and their existing explanation. No charts or new dependencies.

Habitat contains the full classification, production species-specific explanation, WorldCover dataset/vintage/full attribution and ZGS source/acquisition date where available. The existing areaAssessmentFor contract puts the habitat explanation first in limitations; that first item is shown here, while remaining weather caveats appear under Zanesljivost in viri. Nothing is discarded.

Zanesljivost in viri retains the unchanged reliability level/full explanation, weather caveats, source age/fetchedAt/sampling scale, full location metadata, all four source names and both weather/presence and access/permission disclaimers. It explicitly states that completeness is not a statistical probability of correctness. These are not repeated below the accordions.

State remains local to HeatmapAreaCard. Species/day retain outer expansion and all independent section states. Hiding/reopening the outer details preserves the user's section choices; new area or card unmount resets everything. Stable section keys and the unchanged ScrollView preserve normal scroll reconciliation: no scrollTo calls, animation, height changes to the maximum, or source remounts. Expanding above/below existing content can naturally change scrollable content size; device QA must confirm comfortable behaviour.

No production/domain helper, model, habitat rule, weather service or parent MapScreen logic changed in this pass. The focused test checks actual accordion handlers, multi-open behaviour, collapse, date/species updates, missing data, reset, preservation of technical values/attribution/caveats and the unchanged parent function. Native wrap/scroll/Redmi 13C visual density still need a physical test.

Build: `npm run apk -- --name MushroomApp-preview-conditions-progressive-disclosure.apk`.

Validation (2026-10-05): TypeScript and 12 focused/existing test scripts passed, including navigation, weather/habitat, loading and LOD checks. Regional 84,248 and Pilot 15,688 comparisons remain identical. The requested helper failed with `Unable to establish loopback connection`; no APK was created/copied. Physical Android scroll/accordion usability remains to be checked after a local build.

## Current layout: mini accordion polish

The header and decision view are identical to the progressive-disclosure baseline. Only Details changes:

- One local `openSection: 'weather' | 'habitat' | 'reliability' | null` replaces three independent booleans. Opening a section closes the previous one; tapping the open section closes it. The first `Več informacij` expansion starts with all sections closed (no automatic Weather expansion).
- `Poglej podrobnosti` becomes `Več informacij`, with `Manj informacij` for collapsing the inline details. `Poglej podrobne razmere` becomes `Odpri celoten pregled razmer`, retaining the existing Conditions navigation.
- Reliability/Sources is grouped with small labels and whitespace: `ZANESLJIVOST` (level and existing compact explanation), `OMEJITEV` (input completeness, not statistical certainty; existing weather caveats/age/sampling/acquisition/location context), `VIRI` (four source names), and `DISCLAIMER` (weather suitability/no mushroom guarantee and access caveat). Full WorldCover attribution and ZGS metadata remain in Habitat. No nested accordions or charts.

Weather and Habitat accordion content is unchanged. Species/day updates preserve the one open section; hiding/reopening inline Details preserves the choice. New area/card unmount resets both `detailsExpanded` and `openSection`. All state is child-local: no weather requests, GeoJSON preparation, LOD changes or source remounts. Presentation memoization is unchanged.

The focused harness checks exclusive opening/closing, default/null state, CTA wording, the four reliability groups, source/caveat/disclaimer preservation, species/day updates and reset. It also compares the parent MapScreen, fixed header/main view and Weather/Habitat content to their baselines. Native scrolling and long-text wrapping still require phone QA.

Build: `npm run apk -- --name MushroomApp-preview-conditions-accordion-polish.apk`.

Validation (2026-10-05): TypeScript and all 12 card/navigation/controls/transition/LOD/loading/weather/habitat/regional smoke scripts passed. Regional 84,248 and Pilot 15,688 baseline comparisons remain identical. Gradle failed with `Unable to establish loopback connection`; the helper exited unsuccessfully and the named output APK does not exist. No old APK was copied. Run the same command locally for phone QA.

## Accordion scroll positioning

Code diagnosis: the single-open implementation changed only `openSection`. ScrollView had no ref, anchor measurements or post-layout alignment. Closing a long section changed content height/header positions while the native view retained (or bounded) the old offset; nothing associated the new section with a new offset. This matches the reported phone symptom; no physical device measurements were made here.

Each stable section View is a non-collapsible native anchor. After an explicit opening, a post-commit RAF performs fresh `measureLayout` against ScrollView's inner content View; section/parent layout and content-size events coalesce/remeasure the same pending request. Thus the measurement includes nested Details offsets and does not reuse the previous structure's Y. A selection generation plus per-measurement revision prevents both stale section callbacks and superseded same-selection measurements from scrolling. The callback consumes the request exactly once and issues animated `scrollTo`.

The fixed header is outside the scroll viewport, not an overlapping sticky element. Its height is already excluded: the target is measured content Y minus the existing content top padding (8 points), providing the same breathing room without subtracting the header twice. ScrollView's actual `onLayout` height supplies the open section's minimum height, so short/final sections have enough scroll range to reach the top rather than being clamped to the bottom. This is dynamic scroll room, not a fixed card/header height.

Only opening a section requests alignment. Closing it or revealing the three initially closed headers does not. Day/species/weather changes keep the section and do not request alignment. A new click cancels queued RAF/invalidates callbacks and stops an ongoing alignment at the last observed offset before the new target. Hiding Details, card X, area changes and unmount invalidate pending work. Refs are removed by native unmount; no old callback can scroll a new card.

Header/main contents, CTA wording, scores/summary/factors, Weather/Habitat/Reliability semantics and single-open behaviour are unchanged. No parent MapScreen, service, model or LOD code changed; refs/layout/scroll handlers are confined to HeatmapAreaCard. Scroll events update only a ref, not React state. Native Android animation and physical title alignment still require phone QA.

The card harness simulates content/viewport layout, native measurements and RAF: all direction changes, rapid taps, stale layout/measurement callbacks, repeated layout in one generation, short-section scroll room, no scrolling on close/day/species, and card-close/unmount cancellation. Native measurement is mocked; this is not a screenshot or native animation test.

Build: `npm run apk -- --name MushroomApp-preview-conditions-accordion-scroll-fix.apk`.

Validation (2026-10-05): TypeScript and all 12 card/navigation/controls/transition/LOD/loading/weather/habitat/regional scripts passed. Regional 84,248 and Pilot 15,688 comparisons remain identical. The requested APK helper failed at Gradle startup with `Unable to establish loopback connection`; the named output APK does not exist and no stale artifact was copied. Physical Android animated alignment remains unverified; run the same helper locally and check all three direction changes plus rapid taps.
