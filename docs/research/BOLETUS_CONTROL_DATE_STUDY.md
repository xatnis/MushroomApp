# Boletus matched control-date study — V3

Study date: 2026-10-05. Baseline: `a68d4f80cab3b5bbb961ee20949a0ee66c706fa2`.
Research only. Production Boletus scorer, UI, heatmap, runtime weather, habitat and LOD are **unchanged**.

## Executive finding: observed, not calibrated accuracy

The same 29 documented occurrences were compared with 108 scoreable matched **pseudo-control dates**. These dates are not confirmed fungal absences.

There were eight high-D26/low-D14 controls. Candidate B (35/15) reduced their scores by a mean 10.50 points, while the 47 high/high controls changed by only −0.02 points on average. Occurrence retention at >=70 remained 27/29. However, pairwise occurrence-over-control wins **decreased** from 78.70% (V1) to 75.93% (B), despite an increase in mean paired separation. The ±28-day sensitivity also did not establish a consistent ranking advantage for B.

This supports the mechanical hypothesis that recent-rain weighting targets old-rain situations. It does **not** show that V1's high scores are biologically false positives, or that B is a superior production model. Keep V1 in production; investigate A/B on independent, better season-matched controls and a held-out cohort. No weights or thresholds were fitted here.

## Source and frozen cohort

Reuse the [V2 validation](OCCURRENCE_VALIDATION_V2.md) and [recent-rain study](BOLETUS_RECENT_RAIN_STUDY.md), not a new GBIF retrieval:

- iNaturalist Research-grade Observations, GBIF dataset `50c9509d-22c7-4a22-a47d-8c48425ef4a7`; [DOI 10.15468/ab3s5x](https://doi.org/10.15468/ab3s5x); CC BY-NC 4.0, non-commercial research attribution.
- Original snapshot: 2026-10-04. Exact accepted Boletus edulis species key 5954958, Slovenia, exact calendar day, GBIF coordinate/no-geospatial-issue filters, present or unspecified status, deduplicated occurrence identities, public uncertainty <=10 km.
- Exact accepted source records: 43. Unchanged eligible/scored cohort: 29; Tier A 27, Tier B 2. No synonym/infraspecific expansion or new cases.
- Case years: 2013:1, 2017:4, 2019:1, 2021:1, 2022:1, 2023:5, 2024:4, 2025:9, 2026:3.
- Original coordinates remain private to ignored research caches. Controls use the **identical public location** of their case, with the same V2 0.01° representative rounding. This rounding is neither claimed GPS accuracy nor weather-model resolution; Tier B uncertainty remains substantial.

## Weather-blind matched design

Before downloading control weather, the runner freezes the following algorithm:

1. Enumerate calendar dates D−60 through D+60 inclusive, in the occurrence's year.
2. Exclude dates with absolute offset <=21 days, including D itself. Repeat with <=28 for sensitivity.
3. Restrict to April 1–November 30 in that same year. This is a deliberately broad **calendar study boundary**, not a new biological fruiting rule. It includes the cohort's April observation but removes winter dates. ±60 days is only approximate season matching, not temperature/day-of-year matching.
4. Require date <=2026-09-30. This frozen cutoff allows the [documented archive delay](https://open-meteo.com/en/docs/historical-weather-api) of approximately five days at the study date; actual field availability is still checked rather than assumed.
5. Split dates into before/after, each sorted ascending. If a side has <=2 candidates, retain all. Otherwise select indices `floor((n−1)/3)` and `floor(2*(n−1)/3)`: two interior tercile positions. Do not backfill a missing side with extra dates from the other side.
6. Never inspect rain/score to select dates. Never resample a weather failure. Same seed is unnecessary: selection is entirely deterministic.

For an unconstrained September case, primary offsets are −48, −35, +34, +47 days; ±28 sensitivity gives −50, −40, +39, +49. Season and archive edges modify these positions deterministically.

| Stage | Cases | Requested controls | Selected dates | Scored controls | Controls per case |
|---|---:|---:|---:|---:|---|
| Primary, exclude ±21 | 29 | 116 | 111 | 108 | selected: 26×4, 1×3, 2×2; scored: 25×4, 4×2 |
| Sensitivity, exclude ±28 | 29 | 116 | 108 | 108 | 25×4, 4×2 |

All 29 cases retain controls. Primary cases 1–4 have two scored controls; cases 5–29 have four. The April 2025 case has only after-controls; the September 2026 cases ultimately have only before-controls. This loss of directional balance is a limitation, not an exclusion of those cases.

Three planned primary control dates are unscoreable: 2026-09-28, 2026-09-29 and 2026-09-30. Their returned archives contain missing precipitation and ET0 on September 25–26. Production completeness gates reject the required rain signal; values were **not** made zero or inferred. The ±28 sensitivity does not select these dates. Reported results use 108 scoreable controls, not an invented 111/116 complete weather sample.

Different legitimate observations can share a weather evaluation; they are not collapsed into one observation. Shared locations/windows reduce statistical independence. Control summary N counts matched slots; transport counts unique representative-location/date evaluations.

## Identical historical semantics and cache acquisition

The runner imports V2's `weatherRequest`, `strictAssessment` and the production scorer. Same endpoint `https://archive-api.open-meteo.com/v1/archive`, `era5_seamless`, Europe/Ljubljana, variables and aggregation as V2:

- History D−60 <= day < D; rain D14/D26, mean T20, ET0 and rain D7 come from production aggregation.
- Soil uses D00:00 local, not afternoon/end-of-day soil. Actual observation hour is not known consistently.
- No rain on/after D is used. No realised future rain substitutes for an issued historical forecast. This is retrospective reanalysis, not an as-issued forecast backtest or proof of real-time predictor availability.
- Interval downloads are a transport optimisation only: slice each target to the original 60-day window, then invoke unchanged V2 strict trimming and production aggregation.
- All 29 original score/component and data-quality objects replay exactly from original V2 cache. At 27 cases covered by the new interval responses, the new transport independently reproduces the same original components; the other two intervals do not cover their entire original case window.
- All scored cases and controls have complete component availability (100 weight units); missing-signal renormalisation remains tested, not manually changed.

| Transport metric | First acquisition | Offline repeat |
|---|---:|---:|
| New GBIF HTTP | 0 | 0 |
| Original case cache hits | 29 | 29 |
| New historical-weather HTTP requests | 26 | 0 |
| Cached interval responses read | 0 | 26 |
| Total cache response reads | 29 | 55 |
| Representative-location/year interval groups | 26 | 26 |
| Unique planned location/date evaluations across both analyses | 238 | 238 |
| Unique scoreable evaluations | 235 | 235 |
| Unique unscoreable weather targets | 3 | 3 |

Concurrency is one, minimum request-start spacing 2 seconds, timeout 30 seconds, up to three attempts with backoff/Retry-After. No HTTP transport failures occurred. An initial completeness assertion correctly flagged the missing-weather targets; the final runner separately audits legitimate missing weather instead of aborting later valid controls. No new HTTP was needed to finish the analysis.

ResearchCache verifies URL and SHA-256, deduplicates identical requests, persists immutable disk envelopes, and only downloads missing intervals. This research cache is not the app's live cache. Interval responses are reused in memory within a run; the offline repeat consumed zero network requests. Date-specific failures remain recorded rather than silently changing matching.

## Models and normalization

| Model | D26 | D14 | T20 | Soil | Drying |
|---|---:|---:|---:|---:|---:|
| V1 production | 50 | 0 | 30 | 15 | 5 |
| A | 40 | 10 | 30 | 15 | 5 |
| B | 35 | 15 | 30 | 15 | 5 |
| C | 30 | 20 | 30 | 15 | 5 |

`boletusRecentRainStudy.ts` is reused unchanged. D14 normalization calls the actual production Generic rain component with its D7/D30 probe terms set to zero, then divides by Generic's D14 horizon weight. The existing target is **60 mm**, with the same production saturation; no copied research normalization formula or fitted target. D26 and all non-rain normalized values are the actual production Boletus components. Candidates change weights only in research memory, retain missing-component renormalisation and production-style integer rounding. Every model uses exactly the same weather data and matched slots.

Quantiles below use linear interpolation at `(N−1)*p`. Scores are rounded production-style; paired differences are not rounded before statistics. Tables display two decimals. These are **score distributions and matched comparisons**, not accuracy estimates.

## Primary score distributions

### Occurrences (N=29 for each model)

| Model | Mean | Median | P10 | P25 | P75 | P90 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 90.24 | 91 | 81.40 | 88 | 98 | 100 | 53 | 100 |
| A | 89.52 | 93 | 78.80 | 86 | 98 | 100 | 51 | 100 |
| B | 89.14 | 93 | 77.60 | 85 | 98 | 100 | 49 | 100 |
| C | 88.76 | 93 | 76.20 | 83 | 98 | 100 | 48 | 100 |

### Pseudo-controls (N=108 for each model)

| Model | Mean | Median | P10 | P25 | P75 | P90 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 74.65 | 77 | 54.70 | 65 | 86 | 98 | 19 | 100 |
| A | 73.31 | 74 | 53 | 63 | 85.25 | 97.30 | 17 | 100 |
| B | 72.68 | 73.50 | 51.70 | 61 | 85 | 98 | 17 | 100 |
| C | 72.06 | 73.50 | 50.70 | 59.75 | 84.25 | 98 | 16 | 100 |

### Bucket counts and occurrence retention

| Model/subset | 0–39 | 40–59 | 60–69 | 70–79 | 80–89 | 90–100 |
|---|---:|---:|---:|---:|---:|---:|
| V1 occurrences | 0 | 1 | 1 | 1 | 6 | 20 |
| A occurrences | 0 | 1 | 1 | 1 | 10 | 16 |
| B occurrences | 0 | 1 | 1 | 2 | 9 | 16 |
| C occurrences | 0 | 1 | 2 | 1 | 9 | 16 |
| V1 controls | 5 | 15 | 17 | 27 | 21 | 23 |
| A controls | 5 | 16 | 21 | 24 | 21 | 21 |
| B controls | 5 | 17 | 23 | 24 | 18 | 21 |
| C controls | 5 | 22 | 20 | 22 | 19 | 20 |

| Model | Occurrences >=60 | >=70 | >=80 | >=90 |
|---|---|---|---|---|
| V1 | 28/29 (96.55%) | 27/29 (93.10%) | 26/29 (89.66%) | 20/29 (68.97%) |
| A | 28/29 (96.55%) | 27/29 (93.10%) | 26/29 (89.66%) | 16/29 (55.17%) |
| B | 28/29 (96.55%) | 27/29 (93.10%) | 25/29 (86.21%) | 16/29 (55.17%) |
| C | 28/29 (96.55%) | 26/29 (89.66%) | 25/29 (86.21%) | 16/29 (55.17%) |

## Paired differences: each case gets equal weight

These are occurrence score minus its own controls' mean/median, **N=29 sets**, not the subtraction of pooled overall means. This distinction matters with unequal numbers of controls.

| Model | Minus mean: mean | Median | P25 | P75 | Positive/zero/negative sets |
|---|---:|---:|---:|---:|---|
| V1 | 14.97 | 9.25 | 3.75 | 30.75 | 27 / 0 / 2 |
| A | 15.63 | 12 | 3 | 31.75 | 26 / 0 / 3 |
| B | 15.91 | 14.25 | 3 | 31.50 | 26 / 0 / 3 |
| C | 16.19 | 15.75 | 3.25 | 31.25 | 22 / 1 / 6 |

| Model | Minus median: mean | Median | P25 | P75 | Positive/zero/negative sets |
|---|---:|---:|---:|---:|---|
| V1 | 14.52 | 10.50 | 2 | 31.50 | 27 / 0 / 2 |
| A | 15.05 | 12 | 3 | 32 | 24 / 0 / 5 |
| B | 15.33 | 13.50 | 3 | 32.50 | 24 / 0 / 5 |
| C | 15.57 | 15.50 | 3 | 32.50 | 22 / 1 / 6 |

### Pairwise occurrence-over-control rate (108 matched pairs)

| Model | Wins | Ties | Losses | Win % | Tie % | Loss % |
|---|---:|---:|---:|---:|---:|---:|
| V1 | 85 | 1 | 22 | 78.70 | 0.93 | 20.37 |
| A | 82 | 0 | 26 | 75.93 | 0 | 24.07 |
| B | 82 | 1 | 25 | 75.93 | 0.93 | 23.15 |
| C | 82 | 1 | 25 | 75.93 | 0.93 | 23.15 |

### Matched-set ranks (29 occurrences)

Competition rank = 1 + number of controls strictly above the occurrence. Unique/tied rank 1 are exclusive; rank 2 can have a tie at rank 2. Rank is among at most five dates, not a population percentile.

| Model | Unique rank 1 | Tied rank 1 | Rank 2 | Rank 3+ |
|---|---:|---:|---:|---:|
| V1 | 14 | 0 | 10 | 5 |
| A | 13 | 0 | 9 | 7 |
| B | 13 | 0 | 10 | 6 |
| C | 13 | 1 | 8 | 7 |

## High-D26 / low-D14 pseudo-controls

Pre-specified diagnostics: D26 normalized >=0.80 and D14 normalized <=0.40, not ecological gates. **N=8 controls; zero occurrences in this quadrant.**

| Raw input (mm) | Mean | Median | P10 | P25 | P75 | P90 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| D26 | 176.48 | 163.50 | 99.98 | 119.30 | 243.80 | 260.12 | 89.90 | 270.90 |
| D14 | 17.65 | 19.45 | 11.68 | 15.10 | 20.83 | 23.24 | 5.80 | 23.80 |

| Model | Mean | Median | P10 | P25 | P75 | P90 | Min | Max | Mean delta vs V1 | Median delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 78.13 | 77 | 71 | 71 | 79.75 | 86.50 | 71 | 97 | 0 | 0 |
| A | 71.13 | 71 | 63.40 | 64.75 | 72.75 | 79.20 | 62 | 89 | −7 | −7 |
| B | 67.63 | 68 | 59.80 | 61 | 69.75 | 75.90 | 57 | 85 | −10.50 | −10 |
| C | 64.25 | 64 | 56.50 | 58 | 66.75 | 72.90 | 53 | 82 | −13.88 | −13 |

V1 >=90: **1/8**; V1 >=80: **2/8**. Largest downward deltas A/B/C: −9/−14/−18 points.

| Candidate | V1>=90 → <90 | V1>=80 → <80 | V1>=70 → <70 | Of V1>=80, drop below70 |
|---|---:|---:|---:|---:|
| A | 1 | 1 | 3 | 0 |
| B | 1 | 1 | 6 | 0 |
| C | 1 | 1 | 7 | 1 |

No initially >=90 example drops below80/70. The other initially >=80 control drops below80 for every candidate, and below70 for C. These are threshold crossings, not measured false positives.

| Case slot/date (no coordinates) | D26 mm | D14 mm | V1 | A | B | C |
|---|---:|---:|---:|---:|---:|---:|
| 3 / 2026-08-04 | 138.60 | 23.80 | 82 | 75 | 72 | 69 |
| 17 / 2023-09-16 | 104.30 | 14.20 | 97 | 89 | 85 | 82 |
| 17 / 2023-11-24 | 270.90 | 19.50 | 71 | 64 | 61 | 58 |
| 18 / 2023-08-20 | 239.90 | 19.40 | 79 | 72 | 69 | 65 |
| 19 / 2023-11-22 | 255.50 | 20.10 | 71 | 65 | 61 | 58 |
| 19 / 2023-11-26 | 188.40 | 5.80 | 71 | 62 | 57 | 53 |
| 23 / 2021-08-22 | 124.30 | 23 | 78 | 72 | 69 | 66 |
| 23 / 2021-11-20 | 89.90 | 15.40 | 76 | 70 | 67 | 63 |

Observed: one non-occurrence date reaches 97 despite a low recent-rain signal. Unknown: whether fungi were present that day. Several diagnostic controls are late November, so seasonal cooling can independently lower their total score; the subgroup is not an independent set of eight biological experiments.

## High-D26 / high-D14 pseudo-controls

Both normalized signals >=0.80. N=47 controls; 18 occurrences. Raw controls: D26 mean/median 170.50/136.50 mm, range88.80–400.90; D14 99.04/80.60 mm, range49.60–281.60.

| Model | Mean | Median | P10 | P25 | P75 | P90 | Min | Max | Mean delta | Median delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 86.94 | 87 | 74 | 79 | 97 | 99.40 | 67 | 100 | 0 | 0 |
| A | 86.91 | 87 | 74 | 79 | 96.50 | 99.40 | 67 | 100 | −0.02 | 0 |
| B | 86.91 | 87 | 74 | 79 | 97 | 99.40 | 68 | 100 | −0.02 | 0 |
| C | 86.94 | 87 | 74 | 79 | 97 | 99.40 | 68 | 100 | 0 | 0 |

Delta ranges A/B/C: −2..+1 / −3..+2 / −3..+2. V1 >=90:21; >=80:34. Each candidate has one >=90→<90 crossing, zero >=80→<80 and zero >=70→<70. Signals need not be equal within the high/high quadrant, explaining small positive and negative differences; no systematic high/high penalty is observed in the primary sample.

## Four rain quadrants

High >=0.80; low <=0.40; intermediate values are mixed/mid; missing signals have their own category. Means shown as **V1 / A / B / C**.

| Quadrant | Occurrence N | Control N | Occurrence means | Control means |
|---|---:|---:|---|---|
| Q1 high D26 / high D14 | 18 | 47 | 95.33 / 95.56 / 95.56 / 95.67 | 86.94 / 86.91 / 86.91 / 86.94 |
| Q2 high D26 / low D14 | 0 | 8 | NA | 78.13 / 71.13 / 67.63 / 64.25 |
| Q3 low D26 / high D14 | 0 | 0 | NA | NA |
| Q4 low D26 / low D14 | 1 | 6 | 53 / 51 / 49 / 48 | 40.50 / 39.67 / 39.33 / 39.17 |
| Mixed/mid | 10 | 47 | 84.80 / 82.50 / 81.60 / 80.40 | 66.13 / 64.38 / 63.55 / 62.70 |
| Missing | 0 | 0 | NA | NA |

**Q3 is structurally impossible under these thresholds**, not a discovered ecological absence: low D26 implies <=40 mm while high D14 implies >=48 mm, contradicting D14<=D26. The threshold scales differ (100 versus60 mm); this asymmetry must not be hidden when interpreting the quadrants.

## Mechanical sensitivity analysis — not biological validation

Sweep D14 `[0,3,10,20,40,60,80]` and D26 `[20,40,60,80,100,120,160]`, retaining only D14<=D26: **43 physically admissible pairs**. Every pair's production-normalized D14/D26 and four unrounded rainfall contributions are in the ignored machine-readable output. No temperature/soil/drying/full scores are synthesised.

Representative rows:

| D14 mm | D26 mm | D14 norm | D26 norm | V1 rain points | A | B | C |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 40 | 0 | 0.40 | 20 | 16 | 14 | 12 |
| 0 | 100 | 0 | 1 | 50 | 40 | 35 | 30 |
| 3 | 100 | 0.05 | 1 | 50 | 40.50 | 35.75 | 31 |
| 20 | 40 | 0.3333 | 0.40 | 20 | 19.33 | 19 | 18.67 |
| 20 | 100 | 0.3333 | 1 | 50 | 43.33 | 40 | 36.67 |
| 60 | 100 | 1 | 1 | 50 | 50 | 50 | 50 |
| 60 | 160 | 1 | 1 | 50 | 50 | 50 | 50 |

### Phone-like D14=2.9 mm: rainfall contribution ONLY

The full phone weather snapshot is not unambiguously recoverable. These are mathematical inputs, **not reconstructed phone scores**.

| D26 mm | D14 norm | D26 norm | V1 rain points | A | B | C |
|---|---:|---:|---:|---:|---:|---:|
| 80 | 0.048333 | 0.80 | 40 | 32.48 | 28.73 | 24.97 |
| 100 | 0.048333 | 1 | 50 | 40.48 | 35.73 | 30.97 |
| 110 | 0.048333 | 1 | 50 | 40.48 | 35.73 | 30.97 |
| 120 | 0.048333 | 1 | 50 | 40.48 | 35.73 | 30.97 |

At D26>=100, B reduces the rainfall contribution by 14.275 points. A final weather score cannot be inferred without the actual remaining inputs and availability. V1 retaining50 rainfall points here is a confirmed formula property, not proof of biological miscalibration.

## Temporal similarity and ±28 exclusion sensitivity

Primary absolute occurrence/control score differences:

| Model | Median | P10 | P25 | P75 | P90 | 0–5 points | 6–10 | 11–20 | >20 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 18 | 2 | 8 | 32.25 | 42.60 | 23 | 16 | 19 | 50 |
| A | 20.50 | 3 | 7.75 | 32 | 43.30 | 22 | 9 | 23 | 54 |
| B | 21.50 | 3 | 8 | 33 | 43.90 | 21 | 11 | 21 | 55 |
| C | 21 | 2 | 9 | 34.25 | 45.30 | 21 | 10 | 22 | 55 |

Most pairs are not nearly identical by a five-point score criterion; 23/108 V1 pairs (21.30%) are within five points. This is a **score-similarity diagnostic**, not a formal temporal autocorrelation coefficient. Rain/soil persistence, shared weather grid locations, repeated observers and seasonal temperature trends still induce dependence; a minimum21-day exclusion alone cannot guarantee independent weather windows.

### Sensitivity: exclude inclusive ±28, same other matching rules

29 cases, 108 selected/scored controls, 25×4+4×2, no unscoreable targets. Case distributions are identical to primary.

| Model | Control mean | Median | P10 | P25 | P75 | P90 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 74.09 | 75.50 | 49.70 | 63 | 87 | 98 | 28 | 100 |
| A | 72.48 | 73.50 | 50.40 | 61.75 | 85.50 | 97.30 | 29 | 100 |
| B | 71.67 | 72.50 | 48.70 | 59.25 | 84.25 | 97.30 | 29 | 100 |
| C | 70.92 | 71.50 | 45.70 | 58.25 | 84.25 | 97.30 | 30 | 100 |

| Model | Paired-minus-mean: mean / median | P25 / P75 | Positive/zero/negative | Paired-minus-median: mean / median | P25 / P75 | Positive/zero/negative |
|---|---|---|---|---|---|---|
| V1 | 15.44 / 14.50 | 4.25 / 30.75 | 27/0/2 | 15.33 / 11 | 3.50 / 30 | 26/0/3 |
| A | 16.32 / 15.75 | 7.75 / 31 | 25/0/4 | 15.95 / 14 | 5.50 / 31.50 | 25/0/4 |
| B | 16.75 / 17.75 | 8.50 / 31.50 | 25/0/4 | 16.34 / 13.50 | 4 / 31.50 | 25/0/4 |
| C | 17.10 / 17.75 | 8.25 / 31.75 | 25/0/4 | 16.66 / 15.50 | 3.50 / 31 | 25/0/4 |

| Model | Wins/ties/losses | Win/tie/loss % | Unique rank1 / tied rank1 / rank2 / rank3+ | Median absolute difference |
|---|---|---|---|---:|
| V1 | 83/0/25 | 76.85 / 0 / 23.15 | 14 / 0 / 7 / 8 | 20 |
| A | 84/0/24 | 77.78 / 0 / 22.22 | 15 / 0 / 7 / 7 | 22.50 |
| B | 82/3/23 | 75.93 / 2.78 / 21.30 | 15 / 0 / 8 / 6 | 23.50 |
| C | 82/2/24 | 75.93 / 1.85 / 22.22 | 15 / 1 / 5 / 8 | 23.50 |

Sensitivity high/low controls: N=10, raw D26 mean/median155.24/140.30 mm, D14 10.64/6.40 mm. V1/A/B/C means74.90/66.90/62.80/59.10 and medians71.50/63.50/59.50/56; mean deltas A/B/C −8/−12.10/−15.80. V1 >=90:1, >=80:2. B crosses one below90, one below80, six below70 from corresponding initial thresholds.

Sensitivity high/high: N=42. Means V1/A/B/C86.33/86.21/86.12/86.05; all medians86. Mean deltas −0.12/−0.21/−0.29, not a large overall penalty. B/C nevertheless move two initially >=70 controls below70 (small boundary effects); do not claim literally identical high/high classifications.

Sensitivity quadrant counts occurrence/control: Q1 18/42, Q2 0/10, Q3 0/0, Q4 1/6, mixed10/50. Full distributions, crossings and per-case differences are retained in machine output. A's win rate direction changes versus primary; B's paired mean improves but its win rate does not. Conclusions are sensitive to which nearby dates are used.

## Interpretation, limitations and recommendation

**Observed:** B targets the hypothesised rain configuration with a material10.50-point mean reduction; high/high mean scores stay essentially intact; >=70 occurrence retention is unchanged. Mean paired separation rises14.97→15.91 and median rises9.25→14.25. However, win rate falls78.70→75.93, unique rank1 cases fall14→13, and positive paired-minus-mean sets fall27→26. These different metrics do not justify declaring a winner. Stronger C sacrifices one >=70 occurrence and has more negative paired sets.

**Interpretation/hypothesis:** giving D14 part of the fixed rain weight is a plausible way to reduce reliance on old rain. This study establishes the mechanism and its selective effect, not the ecological necessity or optimal strength. A is the milder retention-preserving comparator; B remains a targeted candidate for further validation, not an approved replacement. Do not select B solely from its larger median separation, or A solely from its sensitivity win rate.

Important limitations:

- Presence-only cases and unsurveyed pseudo-control dates: fungi may have been present on controls. No true absence/effort data. No accuracy, sensitivity, specificity, false-positive rate or probability calibration can be estimated here.
- Small, geographically/temporally clustered cohort, unequal observer effort/accessibility, identification/community and reporting biases; controls share weather and case locations. Pairs are not108 independent biological samples.
- ±60-day matching across April–November does not remove phenological/temperature trends. Lower late-season control temperatures can create separation without rain discrimination. One-sided boundary controls add selection/seasonality bias. No causal case-crossover effect is claimed.
- Historical reanalysis/provider elevation/grid uncertainty differs from live forecast inputs. Public location uncertainty and rounding remain. Modern habitat is not used to claim historical presence/absence.
- Missing recent archive rain excludes3 planned primary controls; no assumption that missingness is random. Frozen cached inputs and provenance make this visible/reproducible.
- Quadrant thresholds are pre-specified display diagnostics, not fitted biological limits. Q3 is impossible given their unequal normalization scales. No high/low occurrences exist to assess retention specifically in that subgroup.
- Descriptive statistics only; no p-values or confidence claims. Bootstrap inference is omitted because independence assumptions are weak. The optional whole-season random control analysis is deliberately deferred, to avoid expanding this study or selecting controls post hoc.
- No tuning on these29 cases: weights/normalization unchanged from the requested candidates. Independent holdout and a prospectively specified control design are necessary before considering a production change.

Recommendation: **keep V1**, investigate A and B with held-out, finer season/day-of-year/effort matching; obtain the exact phone snapshot separately. Evidence is **not strong enough for a production change**.

## Reproduction and outputs

From repository root (Windows supported; no new dependencies):

```text
node scripts/runSmoke.cjs scripts/research/boletusControlDateStudy.ts --plan
node scripts/runSmoke.cjs scripts/research/boletusControlDateStudy.ts --fetch
node scripts/runSmoke.cjs scripts/research/boletusControlDateStudy.ts --offline
```

These commands require the **original** V2 cache/provenance artifacts. Do not reretrieve GBIF and silently replace the 29-case cohort: the V3 runner checks exact identity/size against original outputs. A fresh machine needs those original ignored caches and V2 artifacts; no sensitive data are bundled with this commit. `--fetch` downloads only missing historical intervals; default is offline. The matching cutoff is frozen in source for this study.

Generated, gitignored:

- `research-output/occurrence-validation-v3/matching-plan.json` — pre-weather date selections.
- `research-output/occurrence-validation-v3/boletus_control_date_results.json` — primary/sensitivity summaries, matched slots, all43 mechanical grid pairs, phone-like rainfall contributions, acquisition/replay counters. No raw coordinates.
- `research-output/occurrence-validation-v3/private-weather-manifest.json` — URL/date/hash provenance (private URLs contain rounded public coordinates; never commit).
- Existing `research/.cache/occurrence-validation-v2/weather/` — immutable raw interval envelopes; ignored.

The report commits aggregate results and a few anonymous diagnostic date slots, not GBIF identities or individual locations. Exact reproducibility requires saved cache hashes; a future live reretrieval can legitimately revise reanalysis data.

## Verification

- TypeScript and focused control-date, recent-rain, V2/V1 validation, weather/scorer tests.
- Matching tests: deterministic selection, same location/year, inclusive21/28 exclusion, ±60 range, season/cutoff, no own-date, max4, no future leakage.
- Candidate weights and Generic production D14=60 reuse; incomplete inputs renormalise, impossible synthetic pairs excluded, statistics/ranks tested.
- All tracked runtime `src/` files compared byte-for-byte (normalized line endings) against `a68d4f80`; unchanged.
- Existing navigation, LOD/transition, progressive loading and habitat tests pass. Regional regression **84,248** and Pilot regression **15,688** comparisons remain identical (fixture-weather/real-habitat regressions, not additional occurrence validations).
- No APK required: research scripts/docs only.
