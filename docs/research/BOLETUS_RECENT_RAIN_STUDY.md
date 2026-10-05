# Boletus recent-rain diagnostic study — research only

Study date: 2026-10-05. Production baseline: `55a28418f0128ebf37f85d2617e7d992046a2cb2`.
**Production code, scoring constants, UI, heatmap and habitat are unchanged.** No candidate is registered in the app.

## Main finding

The same 29 V2 occurrences replay exactly. Adding 15 points of D14 rainfall reduces the mean from **90.24 to 89.14**, with median **91 to 93**. Retention >=60 and >=70 is unchanged; >=80 loses one observation, >=90 loses four. These are **score distributions among documented occurrences**, not accuracy.

**The pre-specified high-D26/low-D14 subgroup has N=0.** Therefore this presence sample cannot directly establish whether the reported old-rain/high-score phone situation is biologically implausible or whether the candidate improves discrimination. No subgroup threshold was relaxed after seeing this result.

## Cohort, cache and historical semantics

Reuse [Occurrence Validation V2](OCCURRENCE_VALIDATION_V2.md), acquired 2026-10-04: iNaturalist Research-grade Observations through GBIF, dataset `50c9509d-22c7-4a22-a47d-8c48425ef4a7`, [DOI 10.15468/ab3s5x](https://doi.org/10.15468/ab3s5x), CC BY-NC 4.0, non-commercial research with credit to iNaturalist contributors. Exact accepted Boletus edulis key 5954958: 43 records, eligible Tier A 27 + Tier B 2 = **29**. Dates/taxonomy/presence/geospatial/uncertainty/dedup gates are the existing V2 gates, applied to the same cached GBIF pages with the original audit cutoff. No new records are admitted to either side.

The runner verifies the eligible GBIF ID set equals the saved V2 provenance set, each saved weather request hash matches, and all 29 replayed production scores/components/dataQuality match saved V2 results exactly. Replayed historical inputs also match saved inputs, excluding acquisition timestamp and JSON-omitted undefined properties. All five candidate signals are available for every record (available weight 100); no failures or exclusions added.

Historical source: `https://archive-api.open-meteo.com/v1/archive`, **era5_seamless**, Europe/Ljubljana, identical V2 variables and coordinate rounding (0.01 degrees, not improved GPS precision). Daily histories are **D-60 <= history < D**; D daily totals and all later weather are removed. Soil uses **D00:00 local**, not an inferred observation time. No future-rain input or realised historical forecast is added. Reanalysis is retrospective, not a forecast available to the observer.

Transport: **0 GBIF HTTP, 0 weather HTTP, 29 weather disk-cache hits**. No cache/refetch mode is exposed by the study. Missing/corrupt inputs fail the run; they are not silently replaced or scored as zero. The immutable V2 cache remains ignored. Weather cache includes the daily data needed for D14 already.

## Formulas and D14 normalization

| Component | Production V1 | Candidate B | Sensitivity A | Sensitivity C |
| --- | ---: | ---: | ---: | ---: |
| D26 rainfall | 50 | 35 | 40 | 30 |
| D14 rainfall | — | 15 | 10 | 20 |
| Temperature20 | 30 | 30 | 30 | 30 |
| Soil | 15 | 15 | 15 | 15 |
| Drying/ET0 | 5 | 5 | 5 | 5 |
| Total | 100 | 100 | 100 | 100 |

Production V1 is called directly with `calculateMushroomWeatherScore(summary, 'boletusEdulis')`. The research variants reuse its normalized D26/temperature/soil/drying components exactly, change only D26's weight and add D14. Available weights are renormalized and rounded with Math.round in the same manner; missing is not zero. In this complete cohort no renormalization is needed.

**D14 target is 60 mm**, from `MUSHROOM_SCORE_V1_CONFIG.rain.targetsMm.days14` in `src/domain/mushroomWeather.ts`, not the hypothetical 30 mm mentioned in the request. Generic's existing semantics are `clamp(D14/60)` and D14 horizon weight 0.35. Its private normalization is not exported. To avoid either editing production or duplicating normalization, `genericRain14Signal` calls the real Generic scorer with D7/D30 rain terms set to zero in a separate diagnostic probe, then divides its rain component by the existing D14 horizon weight. This isolates exactly its D14 term. **The probe does not replace Boletus weather inputs**, and the other four components come exclusively from the unmodified real V1 summary.

No rain target, window, ecological threshold or weight was fitted. With complete inputs the pre-rounding change is:

`candidate − V1 = recentRainWeight × (normalized D14 − normalized D26)`.

Thus the proposed mechanism reduces scores when recent normalized support is below long-window support, preserves them when equal, and can increase them when recent support is higher. This is an arithmetic property, not evidence of superior biology.

## Full distributions

| Statistic | V1 | Candidate 35/15 |
| --- | ---: | ---: |
| N | 29 | 29 |
| Mean | 90.24 | 89.14 |
| Median | 91 | 93 |
| P10 | 81.4 | 77.6 |
| P25 | 88 | 85 |
| P75 | 98 | 98 |
| P90 | 100 | 100 |
| Minimum | 53 | 49 |
| Maximum | 100 | 100 |

Quantiles use the existing validation helper's linear interpolation `(N−1)×p`; distributions use rounded integer scores. Rising median alongside falling mean is not an error: the candidate changes the ranks of several observations.

| Bucket | V1 count (%) | Candidate count (%) |
| --- | ---: | ---: |
| 0–39 | 0 (0%) | 0 (0%) |
| 40–59 | 1 (3.45%) | 1 (3.45%) |
| 60–69 | 1 (3.45%) | 1 (3.45%) |
| 70–79 | 1 (3.45%) | 2 (6.90%) |
| 80–89 | 6 (20.69%) | 9 (31.03%) |
| 90–100 | 20 (68.97%) | 16 (55.17%) |

| Retention | V1 count (%) | Candidate count (%) |
| --- | ---: | ---: |
| >=60 | 28 (96.55%) | 28 (96.55%) |
| >=70 | 27 (93.10%) | 27 (93.10%) |
| >=80 | 26 (89.66%) | 25 (86.21%) |
| >=90 | 20 (68.97%) | 16 (55.17%) |

Candidate retains most documented dates in the requested ranges. This does not tell us whether it gives fewer high scores on dates without findings. No observations were deleted for low score.

## High D26 / low D14 — primary diagnostic

Pre-specified component diagnostic: **D26 normalized >=0.80 and D14 normalized <=0.40**, equivalent here to D26 >=80 mm and D14 <=24 mm. These are diagnostic bands requested for analysis, **not biological or runtime habitat thresholds**.

**N=0.** V1/candidate mean/median, mean delta and max downward delta are **NA**, not zero. There are 0 observed 90+→<90, 80+→<80 and 70+→<70 crossings in this empty subgroup; that is not evidence of retention/safety. Each sensitivity variant likewise has N=0 and NA subgroup results. Do not choose a winner or relax the gate to obtain examples.

The formula would structurally decrease a complete-input score by at least 6 pre-rounding points in this subgroup for 35/15 (up to 15), but the actual dataset contains no such finding dates. This is conditional arithmetic only.

## Raw rainfall and signal-gap diagnostics

D26 and D14 overlap. **D26−D14 is rain in D-26 through D-15**, not an independent new measurement. A large raw amount in the older window is not itself a poor recent signal if D14 is also high.

Largest normalized gaps, ranked without another cutoff:

| Row | Date | D14 mm | D26 mm | D15–26 mm | nD26−nD14 | V1→B |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 24 | 2019-10-19 | 14.2 | 72.0 | 57.8 | 0.483 | 79→72 |
| 6 | 2025-08-12 | 36.0 | 106.7 | 70.7 | 0.400 | 91→85 |
| 7 | 2025-08-12 | 36.0 | 106.7 | 70.7 | 0.400 | 90→84 |
| 14 | 2024-09-05 | 2.8 | 32.9 | 30.1 | 0.282 | 53→49 |
| 1 | 2026-09-06 | 43.9 | 101.7 | 57.8 | 0.268 | 89→85 |
| 18 | 2023-10-07 | 45.7 | 101.1 | 55.4 | 0.238 | 90→87 |
| 11 | 2025-09-25 | 45.7 | 98.2 | 52.5 | 0.220 | 90→87 |
| 12 | 2025-10-24 | 31.1 | 69.5 | 38.4 | 0.177 | 82→79 |
| 4 | 2025-04-21 | 35.3 | 74.2 | 38.9 | 0.154 | 85→82 |
| 3 | 2026-09-08 | 35.5 | 64.2 | 28.7 | 0.050 | 68→67 |

Raw older-window top 10 rows/amounts (mm): **15/222.1, 16/155.7, 5/125.1, 13/93.7, 2/85.3, 28/82.2, 8/73.2, 9/72.6, 23/71.4, 6/70.7**. Their complete D14/D26 values appear in the occurrence table below and machine output. The largest raw older-rain cases mostly saturate both normalized signals and therefore have zero candidate delta. Ranking raw amounts alone would misidentify the recent-dry hypothesis.

## High D26 / high D14

Symmetric diagnostic: **both normalized >=0.80** (D26 >=80 mm, D14 >=48 mm). N=18:

| Metric | V1 | Candidate |
| --- | ---: | ---: |
| Mean | 95.33 | 95.56 |
| Median | 96 | 96 |
| Minimum | 86 | 86 |
| >=80 | 18/18 | 18/18 |
| >=90 | 16/18 | 16/18 |

Mean delta **+0.22**, median 0, range **0 to +2**; no downward crossings or score reductions here. Candidate does not collapse scores where both rainfall signals are high in this sample.

## Largest score reductions and increases

Top ten reductions (all ten negative-delta observations; ties retain original replay order):

| Row | Date | V1 | Candidate | Delta |
| --- | --- | ---: | ---: | ---: |
| 24 | 2019-10-19 | 79 | 72 | -7 |
| 6 | 2025-08-12 | 91 | 85 | -6 |
| 7 | 2025-08-12 | 90 | 84 | -6 |
| 1 | 2026-09-06 | 89 | 85 | -4 |
| 14 | 2024-09-05 | 53 | 49 | -4 |
| 4 | 2025-04-21 | 85 | 82 | -3 |
| 11 | 2025-09-25 | 90 | 87 | -3 |
| 12 | 2025-10-24 | 82 | 79 | -3 |
| 18 | 2023-10-07 | 90 | 87 | -3 |
| 3 | 2026-09-08 | 68 | 67 | -1 |

Across all 29 records: four 90+→<90, one 80+→<80, zero 70+→<70. These are not counts of false negatives.

Three increases: row 17 (2023-10-21), **84→88 (+4)**, D14 72.1 mm / D26 74.9 mm, normalized 1 / 0.749; rows 20 and 21 (2023-10-01), **91→93 (+2 each)**, D14 83.6 / D26 89.5 mm, normalized 1 / 0.895. D14's lower existing full-signal target saturates earlier, so transferring weight to it can increase scores. Different legitimate occurrence IDs on the same date remain separate; near-shared inputs reduce statistical independence.

## Delta distribution and sensitivity

35/15 delta: mean **-1.10**, median **0**, P10 **-4.4**, P90 **+0.4**, minimum **-7**, maximum **+4**.

| Delta band | Count |
| --- | ---: |
| 0 | 16 |
| -1 to -4 | 7 |
| -5 to -9 | 3 |
| -10 to -19 | 0 |
| <=-20 | 0 |
| Positive | 3 |

The decimal P90 does not imply a fractional individual score: it is an interpolated quantile.

| D26/D14 | Mean | Median | >=70 count (%) | >=80 count (%) | >=90 count (%) | Mean delta vs V1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| V1 50/0 | 90.24 | 91 | 27 (93.10%) | 26 (89.66%) | 20 (68.97%) | 0 |
| A 40/10 | 89.52 | 93 | 27 (93.10%) | 26 (89.66%) | 16 (55.17%) | -0.72 |
| B 35/15 | 89.14 | 93 | 27 (93.10%) | 25 (86.21%) | 16 (55.17%) | -1.10 |
| C 30/20 | 88.76 | 93 | 26 (89.66%) | 25 (86.21%) | 16 (55.17%) | -1.48 |

All three retain 28/29 >=60. High-D26/low-D14 sensitivity results are **N=0 / NA for A, B and C**. C moves row 24 from 79 to 69, below >=70; report this rather than optimizing away an inconvenient finding. No variant is selected as a winner.

## Every occurrence, without locations/identifiers

Rows are study-local labels, not GBIF identifiers. Dates and publicly reported uncertainty tiers only; **no GPS, locality, observer identity or occurrenceID is published**. Rain in mm; n14/n26/T/S/E are normalized suitability (higher is more favourable), not weighted contributions. Numbers are display-rounded; the ignored JSON preserves full precision. V1/B are already production-style rounded scores.

| Row | Date | Tier | D14 | D26 | n14 | n26 | T20 | Soil | Drying | V1 | B | Delta |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2026-09-06 | A | 43.9 | 101.7 | .732 | 1.000 | .713 | 1.000 | .473 | 89 | 85 | -4 |
| 2 | 2026-09-13 | A | 105.2 | 190.5 | 1.000 | 1.000 | .549 | 1.000 | 1.000 | 86 | 86 | 0 |
| 3 | 2026-09-08 | A | 35.5 | 64.2 | .592 | .642 | .656 | .891 | .544 | 68 | 67 | -1 |
| 4 | 2025-04-21 | A | 35.3 | 74.2 | .588 | .742 | .914 | 1.000 | 1.000 | 85 | 82 | -3 |
| 5 | 2025-07-29 | A | 77.4 | 202.5 | 1.000 | 1.000 | .939 | 1.000 | 1.000 | 98 | 98 | 0 |
| 6 | 2025-08-12 | A | 36.0 | 106.7 | .600 | 1.000 | .865 | 1.000 | .076 | 91 | 85 | -6 |
| 7 | 2025-08-12 | A | 36.0 | 106.7 | .600 | 1.000 | .836 | 1.000 | .068 | 90 | 84 | -6 |
| 8 | 2025-09-11 | A | 114.4 | 187.6 | 1.000 | 1.000 | .999 | 1.000 | 1.000 | 100 | 100 | 0 |
| 9 | 2025-09-27 | A | 91.0 | 163.6 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 100 | 100 | 0 |
| 10 | 2025-09-29 | B | 66.8 | 135.0 | 1.000 | 1.000 | .955 | 1.000 | 1.000 | 99 | 99 | 0 |
| 11 | 2025-09-25 | A | 45.7 | 98.2 | .762 | .982 | .700 | 1.000 | .990 | 90 | 87 | -3 |
| 12 | 2025-10-24 | A | 31.1 | 69.5 | .518 | .695 | .899 | 1.000 | 1.000 | 82 | 79 | -3 |
| 13 | 2024-09-24 | B | 106.5 | 200.2 | 1.000 | 1.000 | .982 | 1.000 | .301 | 96 | 96 | 0 |
| 14 | 2024-09-05 | A | 2.8 | 32.9 | .047 | .329 | .738 | .983 | .000 | 53 | 49 | -4 |
| 15 | 2024-10-25 | A | 61.4 | 283.5 | 1.000 | 1.000 | .592 | 1.000 | 1.000 | 88 | 88 | 0 |
| 16 | 2024-10-05 | A | 129.0 | 284.7 | 1.000 | 1.000 | .955 | 1.000 | 1.000 | 99 | 99 | 0 |
| 17 | 2023-10-21 | A | 72.1 | 74.9 | 1.000 | .749 | .883 | 1.000 | 1.000 | 84 | 88 | 4 |
| 18 | 2023-10-07 | A | 45.7 | 101.1 | .762 | 1.000 | .806 | 1.000 | .228 | 90 | 87 | -3 |
| 19 | 2023-10-28 | A | 180.7 | 185.7 | 1.000 | 1.000 | .684 | 1.000 | 1.000 | 91 | 91 | 0 |
| 20 | 2023-10-01 | A | 83.6 | 89.5 | 1.000 | .895 | 1.000 | 1.000 | .344 | 91 | 93 | 2 |
| 21 | 2023-10-01 | A | 83.6 | 89.5 | 1.000 | .895 | 1.000 | 1.000 | .344 | 91 | 93 | 2 |
| 22 | 2022-10-04 | A | 74.9 | 139.7 | 1.000 | 1.000 | .997 | 1.000 | 1.000 | 100 | 100 | 0 |
| 23 | 2021-10-09 | A | 87.6 | 159.0 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 100 | 100 | 0 |
| 24 | 2019-10-19 | A | 14.2 | 72.0 | .237 | .720 | .867 | 1.000 | .427 | 79 | 72 | -7 |
| 25 | 2017-09-16 | A | 115.7 | 132.0 | 1.000 | 1.000 | .760 | 1.000 | 1.000 | 93 | 93 | 0 |
| 26 | 2017-09-17 | A | 126.4 | 166.2 | 1.000 | 1.000 | .832 | 1.000 | 1.000 | 95 | 95 | 0 |
| 27 | 2017-09-18 | A | 159.6 | 185.0 | 1.000 | 1.000 | .760 | 1.000 | 1.000 | 93 | 93 | 0 |
| 28 | 2017-09-23 | A | 251.0 | 333.2 | 1.000 | 1.000 | .988 | 1.000 | 1.000 | 100 | 100 | 0 |
| 29 | 2013-09-13 | A | 61.6 | 103.9 | 1.000 | 1.000 | .879 | 1.000 | 1.000 | 96 | 96 | 0 |

## Reported phone case (D14 approximately 2.9 mm)

**Not reproducible from an identified exact weather snapshot in the available research cache/fixtures.** D26, temperature, both soil layers, ET0/rain7, location/day and the matching app snapshot are required. No V1/40-10/35-15/30-20 scores are invented for it. Row 14 has D14 2.8 mm, but D26 is only 32.9 mm and V1=53; this historical occurrence is **not** the user's high-score phone case. Synthetic unit tests exercise the mechanism, but are explicitly not real-world reconstructions.

## What the data show vs interpretation

**Observed:** exact same 29 records and inputs; moderate average change; ten reductions, sixteen unchanged, three increases; most >=60/70 retained; no high-D26/low-D14 example; high/high subgroup unchanged or slightly higher; continued ceiling scores. Many soil signals saturate at 1.0 in this reanalysis cohort, an existing input/model characteristic, not something altered here.

**Mechanistic interpretation:** V1 has no independent D14 rain term, so rearranging rain within D26 can leave its D26 component unchanged (rain7/drying and soil may still respond). The candidate adds explicit recency sensitivity, reducing score when nD14<nD26. That addresses the *arithmetic omission*, not yet a demonstrated ecological failure or false-positive problem. D14/D26 are correlated overlapping windows, not independent evidence.

**Cannot establish:** calibration, accuracy, false-positive rate, superiority or deployment safety. This is a small presence-only convenience sample, no reliable absences/control dates, geographic/seasonal/observer/access/reporting/identification biases, uncertainty up to 10 km, rounded request location/reanalysis mismatch, soil at midnight instead of live time, retrospective assimilation, ceiling effects and near-shared weather inputs. Occurrence score retention is not classification performance. No accuracy/precision/recall/specificity/ROC-AUC is calculated.

**Recommendation: investigate further; keep V1 in production.** Candidate is a transparent hypothesis worth testing later with the exact phone snapshot and pre-specified matched control dates, independent holdout years/regions and a design deliberately covering high-D26/low-D14 conditions. Do not deploy, choose weights, change the D14 target or tune to maximize these 29 occurrence scores. A later control-date analysis must be separate from this diagnostic study.

## Reproduce / files / checks

```powershell
node scripts/runSmoke.cjs scripts/research/boletusRecentRainStudy.ts
node scripts/runSmoke.cjs scripts/research/boletusRecentRainStudySmoke.ts
npm run typecheck
```

Requires the same ignored V2 GBIF/weather cache and audit/private provenance/private scores. It fails if these are unavailable or drift; no automatic live replacement. Machine output:
`research-output/occurrence-validation-v2/boletus-recent-rain/boletus_recent_rain_results.json` (ignored), with all rows/variants/diagnostics, cohort/input hashes, baseline and zero-request counters. Full raw weather/provenance remains ignored; no coordinates in the study output/report.

Only the new research runner/test and this report are committed. No production imports the candidate. Tests cover 35/15/30/15/5, all three research variants, exact production Generic D14 reuse, missing-data renormalization, input immutability, no fake zeros and future leakage prevention. Relevant production files are byte-compared to the existing V2 baseline; UI is compared to the current pre-study commit. No APK is needed.

Validation completed: TypeScript and 10 focused/existing scripts passed (new study smoke, occurrence V2, BI V1, Generic weather details, location-ranking scorer consistency, Pilot, Boletus/Chanterelle/ZGS habitats and regional regression). Regional **84,248** and Pilot **15,688** baseline comparisons remain identical. The full offline paired run scored all 29 with no API requests. No runtime change or Android build was made.
