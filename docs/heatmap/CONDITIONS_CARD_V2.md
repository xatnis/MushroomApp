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

The main body always includes: “Ocena predstavlja primernost vremenskih razmer in ne zagotavlja prisotnosti gob.” Attribution stays accessible in Details.

## Checks

Run `node scripts/runSmoke.cjs scripts/conditionsCardSmoke.ts` and `npm run typecheck`, plus existing navigation, controls, weather, habitat and regional regression tests. The focused test executes the real card function using a lightweight hook/element harness; it is not a native Android layout test. It also verifies the parent MapScreen function is identical to the pre-redesign baseline.

On a small Android phone, verify a two-line Črna na Koroškem title, fixed X/date/score, scrolling to the last attribution/disclaimer, expand/collapse, species/day updates while expanded, candidate/unknown/outside-model copy, and no controls-panel overlap. Build with `npm run apk -- --name MushroomApp-preview-conditions-card-v2.apk`.

### Validation in this environment (2026-10-05)

TypeScript and 15 smoke/regression scripts passed: card presentation/interaction, navigation, controls response, transition confirmation, LOD/thresholds/visuals, regional/progressive/overview loading, generic weather details, Pilot, Boletus/Chanterelle/ZGS habitat and regional regression. The regional baseline comparison covered 84,248 cases; Pilot weather comparison covered 15,688 cases. Production model files/data remain unchanged.

The requested APK helper failed at Gradle daemon startup with `java.io.IOException: Unable to establish loopback connection`. No new APK was created or copied. Run the same helper command locally; native scroll, wrapping, accessibility and gesture QA remain unverified on a physical Android device.
