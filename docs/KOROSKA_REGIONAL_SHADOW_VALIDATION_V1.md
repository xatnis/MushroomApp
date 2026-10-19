# Koroška Regional Shadow Validation V1

Research date **2026-10-19**, Europe/Ljubljana. Starting `main`: `918fa30cb26586fad4fbd51480904ba464331220`, clean tree. CLI/research/test additions only; production runtime, regional/point contracts, scorers, weights, caches, geometry, MapLibre/LOD, SQLite and user data remain unchanged. No APK or native test.

## 1. Executive verdict

**PARTIAL evidence / functioning reusable CLI. CONDITIONAL GO — decision B: developer-only Koroška seven-day shadow map preview, not public production migration.**

Two authentic operational daily/hourly retrieval snapshots are available, **12.248 hours apart across two local dates**. There are not three meaningfully separated snapshots, and **zero verified independent model cycles**. We obtained one new bounded operational capture and genuine historical archive controls for both past DST transitions. No long-running process or promise of future captures is implied.

The new operational snapshot changes **3/88 weather scores**, all by one point, and **284/4,776 eligible cell/profile/date scores**, with **zero category changes**. The previous snapshot changed 4/88 and 185/4,776 respectively, including 94 categories. These are separate observational comparisons with different target-date pairs, not a representative stability distribution or one pooled parity percentage.

Hourly civil-day coverage is validated on genuine 23-/25-hour historical days. The provider daily product retains fixed 24-hour boundaries; this difference is real and correctly preserved. Retrospective archive score controls do not establish original operational forecast skill or vintage parity. No severe unexplained numerical discrepancy was observed, but two operational snapshots are insufficient for public acceptance. Missing model-run IDs are a structural limitation, not a reason for indefinite audits.

## 2. Baseline and scope

Read in full: [national feasibility audit](SEVEN_DAY_SLOVENIA_HEATMAP_FEASIBILITY.md), [bounded prototype](KOROSKA_SEVEN_DAY_REGIONAL_PROTOTYPE_V1.md) and [authentic weather-contract impact validation](KOROSKA_REGIONAL_WEATHER_CONTRACT_VALIDATION_V1.md), plus their adapters, evidence and regression infrastructure.

The baseline remains **696 existing cells / 11 fixed public weather coordinates / four profiles / seven experimental dates**. Existing centre-bbox selection `[14.65,46.35,15.05,46.59]`, whole clipped polygons, habitat states and cell-to-weather mapping are reused. No administrative boundary or replacement grid is invented. The previous hourly-only prototype is useful evidence but **is not counted as another authentic paired daily/hourly capture**. Its reconstructed-daily parity and synthetic controls are not relabelled as live parity.

Production `pilot-weather-v1` and candidate `regional-civil-week-v1` remain distinct. Both use unchanged regional formulas with completed `[target−N,target)` lookbacks; candidate hourly processing validates civil boundaries, preceding-hour precipitation/ET₀ endpoints, instantaneous temperature means and native soil depths. D60 is retained, not reduced to WeatherGraphs D30.

## 3. CLI architecture and versioned storage

New isolated modules: `koroskaShadowStore.ts`, `koroskaShadowAnalysis.ts`, `koroskaShadowDst.ts`, entry `koroskaShadow.ts`; separate read-only `koroskaRegionalGuardAudit.ts` and focused `koroskaShadowSmoke.ts`.

Operational capture directly reuses existing `captureContracts`, actual production `getHeatmapWeatherBatch`, canonical hourly request/cache plan and the unchanged authentic validation runner. It does **not** reconstruct primary production daily arrays. One frozen input batch supplies seven dates × four profiles per weather coordinate, followed by shared cell/habitat references; no per-cell acquisition/scoring pipeline is added.

Storage under `docs/research/koroska-shadow-v1` uses gzip JSON envelopes `koroska-shadow-snapshot-v1`. IDs include kind, UTC completion timestamp and 20 hex characters of the full payload SHA256; full hashes and production-source fingerprints are retained. Exclusive `wx` creation prevents duplicate overwrite. Baseline import stores a **verified reference**, not another megabyte copy of existing raw evidence. New operational and archive captures retain authentic parsed response values, requests, units, grids, timestamps and errors. Partial captures are retained, never silently replaced with fixtures.

Offline load checks envelope/ID/data hashes and safe reference paths. Replay rejects production-code fingerprint mismatch, wrong coordinates/date, incompatible units, missing required inputs and altered source timestamps via existing validators. It disables external fetch, restores process-global transport/timing wrappers, and never populates production caches or renews original TTL. The store is bounded to 100 snapshot envelopes per report pass; it has no background loop. Reports and measurement files are content-addressed, append-only and separate; repeated identical report content reuses its artifact.

## 4. Manual commands

Run from the repository root; `runSmoke.cjs` is the existing TypeScript loader.

```powershell
# Once: import the old authentic capture by reference; duplicate import deliberately errors.
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts import-baseline

# Explicit new capture: <=4 public HTTP requests, same 11 locations, no retry.
# Appends a new ID; does not overwrite the previous capture.
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts capture --live

# Offline: replay a known capture (substitute any printed operational ID).
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts replay operational-20261019082412278-93e09f0a4610a740bf43

# Offline: compare all saved snapshots, emit consolidated report + separate timing artifact.
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts report

# Optional separately deliberate archival experiment: four archive requests, one PUBLIC anchor.
# Not needed again to reproduce this report; raw evidence is already stored.
node scripts/runSmoke.cjs scripts/research/koroskaShadow.ts capture-dst --live

# Read-only source-guard investigation; runs the old suite and records its expected failure.
node scripts/runSmoke.cjs scripts/research/koroskaRegionalGuardAudit.ts
```

`capture`/`capture-dst` without `--live` fail before network access. `report`/`replay` never fall back to live requests. Each analysis reports captured freshness/as-of, not a claim that an old artifact is a current forecast. Incompatible snapshots remain visible as incompatible/excluded; they are not included in compatible group statistics. No private IDs/names/notes are accepted as weather-request inputs.

For the remaining third retrieval, run `capture --live` manually at least six hours after the latest capture: **not before 2026-10-19 14:25 UTC / 16:25 Europe/Ljubljana** (rounded up), or on a later date. Then run `report`. This is an earliest separation time, not a prediction of a new provider model cycle or a scheduled background job.

## 5. Actual captures obtained

| Evidence | UTC completion | Local completion | Target dates / scope | Real HTTP this task |
| --- | --- | --- | --- | ---: |
| Existing authentic paired baseline | Oct 18 20:09:18.364 | Oct 18 22:09 | Oct 18–19, 11 locations × four profiles | 0, referenced |
| New authentic paired operational | Oct 19 08:24:12.278 | Oct 19 10:24 | Oct 19–20, same 11 × four | 4 |
| New historical archive DST controls | Oct 19 08:25:01.035 | Oct 19 10:25 | Mar 29–30 2026 and Oct 26–27 2025, one existing anchor | 4 |

Operational IDs:

- `operational-20261018200918364-ae22cb9bf04245b5491e`
- `operational-20261019082412278-93e09f0a4610a740bf43`

DST ID: `historical-dst-20261019082501035-8d845484884decbf3559`. All **eight new requests returned HTTP 200**. No probe, retry, additional model-specific or paid request was made. The historical anchor is existing `weather-2-2` (46.47045,14.85009), not a private hotspot.

## 6. Snapshot comparability and provider vintages

Each operational capture covers **88/88 fully comparable input sets**: same query coordinates, profiles, target dates, units, formula and habitat mapping. Requested and returned grid metadata are preserved; daily versus hourly returned coordinates/elevations match for each corresponding archive/forecast product at all 11 locations. Archive grids and forecast grids remain different from each other and from many habitat cells.

No model/run identifier or actual issue time is verified. Default/best-match endpoints can mix underlying sources; requested model and verified run fields remain null. HTTP Date, retrieval time, current-time metadata and generation duration are not issue timestamps. The original capture's retrieval skew is 134 ms, the new one **254 ms**: neither proves same-vintage source identity. Both are **authentic observational** comparisons, not fully controlled common-run experiments.

Consolidation groups by production-code fingerprint, input-contract versions, geometry and absolute target-date pair. These two snapshots belong to different date groups. Oct 19 is Tomorrow in the earlier capture and Today in the later one; as-of/lead-time and source refresh differences are intentional, not silently treated as equivalent refresh contexts. No same-role/date refresh-flicker measurement exists yet. Synthetic metadata tests verify same-date grouping, incompatible version/date separation and duplicate-near-time handling; these tests do not count as additional real captures.

A six-hour retrieval gap is only a pragmatic separation rule. Current count: **two separated retrievals, multi-snapshot evidence incomplete, verified independent model cycles zero**. The program does not invent a third run or combine historical archive controls with the operational headline comparison.

## 7. Weather inputs and canonical factors

Requirements verified against production config: Splošno D7/D14/D30 + T20; goban D26 + T20; lisička D7/D30 + T14; sirovka D14/D60 + T20. All complete results require D7/ET₀7 drying and native 0–7/7–28 cm soil. Maxima, normalization and formulas remain unchanged.

| Maximum absolute input difference | Baseline Oct 18 | New Oct 19 |
| --- | ---: | ---: |
| D7 | 8.88e−16 mm | 8.88e−16 mm |
| D14 / D26 / D30 | ≤7.11e−15 mm | ≤7.11e−15 mm |
| D60 | 2.84e−14 mm | 5.68e−14 mm |
| T14 | 0.027381 °C | 0.025298 °C |
| T20 | 0.025208 °C | 0.023750 °C |
| ET₀7 and drying deficit | 0.12 mm | 0.12 mm |
| Soil, either depth | 0 m³/m³ | 0 m³/m³ |

Each column contains 22 unique coordinate/date pairs, not 88 independent weather observations. Both captures have 0/88 exact full raw-input equality; precipitation differences are diagnostic floating-point summation noise, not evidence of changed rain. The 1e−9 reporting tolerance never changes scores or gates.

Temperature factors change materially in 66/88 cases in each capture; maximum weighted-point differences **0.069163 / 0.063897**. Drying changes in 76/88, maximum **0.06** points; soil and rain factors do not materially change. Existing same-source soil-policy and history-only scorer controls identify historical temperature/ET₀ inputs as the numerical cause of the changed totals in these captures. Separate quantization/aggregation is plausible, not a proven exclusive provider-internal cause; unknown model vintage remains a confounder.

Soil instants and both native layers agree in all 22 pairs per operational snapshot. Today sampling happens to agree at these current instants; the nearest-versus-as-of policy difference remains covered by labelled 10:45 fixtures and must not be assumed resolved by these observations. No future soil carry-forward or depth interpolation is used.

## 8. Full-score differences

| Operational snapshot | Compared | Equal | Different | Delta histogram | MAE / median / max | Category changes |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Oct 18 baseline | 88 | 84 | 4 | −1:1, 0:84, +1:3 | 0.045455 / 0 / 1 | 1 |
| Oct 19 new | 88 | 85 | 3 | −1:1, 0:85, +1:2 | 0.034091 / 0 / 1 | 0 |

All three new differing cases: goban `weather-1-2`, Oct 19 **62→63**; Splošno `weather-2-3`, Oct 19 **67→68**; lisička `weather-2-2`, Oct 20 **47→46**. The previous four remain documented in the original report, unaltered. Missing-data availability changes are zero in both authentic operational captures. Similar maximum deltas over two retrievals are promising but do not establish long-term stability or national bounds.

## 9. Cell-level propagation

Existing candidates per date: generic 696, goban 635, lisička 635, sirovka 422. Scores are shared weather estimates masked by actual habitat state, not independent per-cell weather or invented habitat multipliers.

| Snapshot | Eligible cases | Unchanged | Changed | Category changes | MAE / max |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline | 4,776 | 4,591 | 185 (+91/−94) | 94 | 0.038735 / 1 |
| New | 4,776 | 4,492 | 284 (+190/−94) | 0 | 0.059464 / 1 |

New profile/date concentration: generic Today 100 changed cells; goban Today 90; lisička Tomorrow 94; every other profile/day has zero changes. **756 unknown-habitat and 36 outside-model cases per snapshot stay nonnumeric**, not 0/100. No changed source availability. Repeated cells sharing one weather vector are not independent statistical samples. These are research deltas, not publicly rendered map colours.

## 10. Category threshold sensitivity

Thresholds are imported from actual production configs: generic **25/50/70/85**, other profiles **30/50/70/85**. The production scorer first rounds the canonical normalized total; regional `renderStateFor` maps its canonical label to the same category, not a separate threshold. Point and regional evaluations call the same scorer. Focused tests compare actual point-formula and regional-assessment labels for all 88 baseline cases; existing cross-surface suites add broader protection.

There is exactly **one weather-level boundary crossing**: previous lisička Tomorrow `weather-2-2`, **50→49**, affecting **94 candidate cells**. It crosses threshold 50 directly; no unexplained category change exists. The complete weighted-point sums are **49.546433→49.477270** around the actual round-to-50 boundary **49.5**, only **0.046433 / 0.022730** away. This is expected rounding/category sensitivity, not a one-percent change in find probability. Full weights are asserted to sum to 100 before computing raw-boundary distances; incomplete factors are excluded from this diagnostic.

Transition matrices (daily product → hourly contract):

| Category transition | Baseline weather / eligible cells | New weather / eligible cells |
| --- | --- | --- |
| Excellent → Excellent | 22 / 844 | 22 / 844 |
| Very good → Very good | 1 / 88 | 1 / 88 |
| Good → Good | 63 / 3,699 | 57 / 3,417 |
| Good → Average | **1 / 94** | **0 / 0** |
| Average → Average | 1 / 51 | 8 / 427 |

Distances across both old/new values (176 values per snapshot): nearest integer-threshold distance mean **5.204545 / 5.551136**, median 6, minimum 0, maximum 10. Nearest raw rounding-boundary distance mean **5.370496 / 5.647099**, minimum **0.022730 / 0.226810**. Full per-case distances/matrices are in the consolidated artifact.

One shared weather estimate can visibly change an entire category-colour cluster. This is a **potential** flicker risk; cross-contract differences are not measured refresh flicker, and the current captures lack same-role/date repeated refresh groups. Recommend coherent atomic publication, visible update age and inspectable numeric values/near-boundary explanation in a later preview; **do not change thresholds, smooth scores, add hysteresis or manufacture stability** in this task.

## 11. Genuine historical DST controls and remaining gap

Four real archive requests cover the one public anchor around **2026-03-29** and **2025-10-26**, with ≥D60 history/margins and original soil layers. Daily product is authentic provider daily JSON mapped through existing `mapDailyWeather`; hourly product uses existing UTC index/coverage/civil aggregation helpers. Scorer controls call the existing production formula. This secondary archival assembly is deliberately **not** passed off as the operational hybrid `getHeatmapWeatherBatch` or an originally issued forecast. No daily primary product is reconstructed from hourly data.

| Transition | True civil UTC interval | Valid hourly intervals, all 3 variables | Fixed daily provider interval | Daily → hourly day values |
| --- | --- | ---: | --- | --- |
| Spring 2026-03-29 | Mar 28 23:00Z → Mar 29 22:00Z | **23/23** | Mar 28 22:00Z → Mar 29 22:00Z | rain 0→0 mm; T 6→6.047826 °C; ET₀ 2.60→2.56 mm |
| Autumn 2025-10-26 | Oct 25 22:00Z → Oct 26 23:00Z | **25/25** | Oct 25 22:00Z → Oct 26 22:00Z | rain 5.1→5.1 mm (noise); T 6.9→6.808 °C; ET₀ 0.64→0.65 mm |

Actual daily responses return fixed **+7200 s**; hourly UTC returns 0. The provider documents this fixed-offset behavior, including across DST, and preceding-hour accumulation semantics. [Historical API documentation](https://open-meteo.com/en/docs/historical-weather-api), checked 2026-10-19. Both products return the same archive grid/elevation for the anchor. This does not verify model/run identity.

Nominal provider09 soil versus true civil09: spring samples agree at 07:00Z; autumn provider09 is **07:00Z = 08:00 Ljubljana**, while true09 is **08:00Z**. Archive metadata explicitly identifies these as retrospective sample controls, never current observations or forecast issue times. Actual layers are retained, not substituted. All **16 date/profile retrospective score pairs** are numeric and equal in this particular archive control, despite differing inputs/instants. On March 30, D60 differs **−1.6 mm**, demonstrating a meaningful rolling-boundary effect even though rounded totals match. Equality does not establish input parity.

The report also retains 62 per-day diagnostics for each transition and a **secondary**, explicitly non-primary fixed-bin hourly control. Its rain sums match actual provider daily rain to arithmetic tolerance (max residual 3.55e−15 / 7.11e−15 mm). January 28 has civil-minus-provider rain **+1.6 mm**, January 29 **−1.6 mm**, with zero residual product difference in both; the shift cancels in March 29's D60 but no longer cancels after its lower boundary advances on March 30. This traces that observed D60 difference to interval membership, not a new formula or zero filling. Temperature/ET₀ retain separately recorded residual product differences. The decomposition is a numerical control using genuine hourly values, not a reconstruction replacing authentic daily primary inputs or proof of common provider runs.

These are best-match reanalysis/analysis archive products, not archived original forecasts. Live operational forecast parity across the upcoming **2026-10-25** remains unverified; no future historical observation is claimed. Existing deterministic spring/autumn/missing/repeated-hour fixtures remain necessary. Actual missing-interval and layer controls block numeric outputs rather than fill gaps with zero. No universal DST bypass is added.

## 12. Source-byte guard investigation

`scripts/regionalRegression.ts:31` asserts full LF-normalized `weather.ts` equality with `git show 6127609:src/services/weather.ts`. It fails **before** that script's numeric/render comparisons. The standalone suite remains **FAIL**, unchanged.

Precise intentional historical changes: **dcd8cdf** (Oct 9): optional chart calendar anchor, export existing daily mapper; **f84a188** (Oct 14): export `cachedFetch` for hourly reuse; **b63e18a** (Oct 17): optional timing callbacks. The current full source therefore cannot equal the older fingerprint. AST-based read-only inspection confirms **all 12** checked regional bodies/constant initializers are unchanged: batch acquisition, soil selection, response mapping, daily mapper, rolling-summary/window helpers, calendar shift, forecast summary and 30-minute TTL. Export modifiers do not change those bodies.

`koroskaRegionalGuardAudit.ts` runs the old script, records exit 1 and the weather.ts/line31 assertion, source history and per-body hashes. The audit itself succeeds only if those expected facts hold; that is **not a claim the old regression passes**. No hash/string was updated, no assertion deleted and no production file altered.

A focused future test-maintenance replacement should separate scorer/geometry pins from weather behavior: actual adapter URL/variables/ranges, rolling inputs and soil, TTL/dedupe/stale/error/partial handling, default versus explicit calendar anchor, and existing 84,248/15,688 pinned numeric/render comparisons. Authentic replay, weather/cache/point suites already exercise much of this. Do not replace the old guard with a new unexamined full-file hash. That cleanup is not implemented here and is not the next product milestone.

## 13. Network, computation, memory and size

**Eight actual new HTTP requests total**: four operational (11 coordinates batched each), four historical (one coordinate each). Baseline replay adds none. Operational warm daily/hourly lookups add **0 HTTP**; offline capture/date/profile/cell analysis adds **0**. No credentials, paid service, background process or national acquisition.

New operational decoded UTF-8 body bytes: daily archive **29,618**, daily forecast **130,958**, hourly archive **372,870**, hourly forecast **156,154** = **689,600 B**. Historical body bytes **49,236 + 56,698 + 49,328 + 57,548 = 212,810 B**. Total new decoded bodies **902,410 B**; these are not compressed wire bytes or billable provider units. Minimized semantic operational JSON is **608,962 B**. Old raw capture is referenced, not downloaded again.

New operational capture wall **1,363.996 ms**, actual daily cold adapter **1,215.486 ms**, hourly acquisition **1,304.657 ms**, concurrent, not additive. Header response waits **518–1,136 ms**; body reads **19–399 ms**. Captured operational parse timings include integrity hashing, not pure parsing. Warm adapter timings **10.429 / 10.551 ms** on this instrumented run. DST four-request wall **1,233.381 ms**. These include CLI instrumentation and host load; no mobile latency guarantee.

Retained final replay measurement, Windows/Node v24.21.0:

| Phase | Baseline replay | New replay |
| --- | ---: | ---: |
| Actual daily-adapter replay | 18.508 ms | 14.029 ms |
| Hourly adapter | 154.194 ms | 151.773 ms |
| Window validation + scorer evaluation | 161.281 ms | 154.380 ms |
| Shared cell join | 11.494 ms | 11.327 ms |
| Entire operational analysis | 539.213 ms | 504.702 ms |
| Process CPU user / system | 625 / 62 ms | 515 / 47 ms |

Across both operational analyses and both historical controls, synchronous wrappers record **1,176 scorer calls / 12.369 ms**, **1,598 daily aggregates / 95.174 ms**, **206 soil samples / 293.766 ms**. Nested timings are not additive. Each weekly operational build has 308 weather score evaluations, not 19,488 per-cell evaluations; each primary comparison adds 88 legacy and 176 attribution-control calls. Historical controls add 32 formula calls for 16 pairs. Target-window validation still runs per profile where the existing adapter requires it; no unimplemented CPU sharing is claimed.

Peak process RSS **295,723,008 B (~282 MiB)** includes transpiler, imported geometry, raw objects and reports, not isolated forecast heap or Redmi PSS. CPU uses `process.cpuUsage`, distinct from wall/network time. Replays under concurrent TypeScript/testing took longer; retained timings are one labelled pass, not a guaranteed benchmark.

| Retained artifact | JSON bytes | gzip bytes |
| --- | ---: | ---: |
| Baseline reference envelope | 1,020 | 619 |
| New operational envelope | 1,073,740 | 180,553 |
| Historical DST envelope | 203,265 | 39,110 |
| Consolidated report `74f9e95a8d4a393494f6` | 851,072 | 58,123 |
| Separate measurements `efd8e02b0ea445a66262` | 2,590 | 1,048 |
| Source-guard audit `2419df6f4a92ff766513` | 4,949 | 1,880 |
| Total new retained evidence | **2,136,636** | **281,333** |

Original authentic parsed values are losslessly retained; duplicate baseline payloads and superseded generated reports are not committed. Timings change on replay and belong in separate content-addressed artifacts. Full input/score/factor/category evidence is reproduced offline from immutable captures; no new provider calls are needed.

## 14. Safety gates and verification

Existing gates remain unchanged for missing native soil, incompatible depths/units, incomplete profile windows, invalid/duplicate/gapped hourly coverage, source/snapshot mismatch, stale policy and exact coordinates/date. New research checks quarantine incompatible capture groups rather than publish partial normalized scores. Numeric zero stays distinct from null. Historical controls validate profile-specific interval needs, not an unconditional 24-hour count.

Focused tests cover append-only storage/duplicates/hash tampering, actual two-snapshot replay, offline equality, source-code/date grouping, model-vintage uncertainty, category matrices/distances, actual point/regional canonical labels, missing soil/units/intervals, failed archive controls and actual 23-/25-hour coverage. Controlled mutations and synthetic metadata are explicitly test-only, not extra live evidence. Temporary fixtures use a task-specific OS temp directory; no private DB is opened.

Commands:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/runSmoke.cjs scripts/koroskaShadowSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaContractValidationSmoke.ts
node scripts/runSmoke.cjs scripts/koroskaRegionalPrototypeSmoke.ts
Get-ChildItem -LiteralPath scripts -Filter '*Smoke.ts' |
  Where-Object Name -NotLike '*LiveSmoke.ts' | Sort-Object Name |
  ForEach-Object {
    node scripts/runSmoke.cjs $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $($_.Name)" }
  }
```

Executed successfully: **TypeScript and all 51 deterministic root smoke suites**, including this new shadow suite, authentic validation, prototype, cache/weather, point/weekly, ConditionsScreen/map/navigation/hotspot/ranking/Top 3 tests. Actual unchanged comparisons: **84,248 regional, 15,688 pilot, 2,400 soil sampling**. The old standalone suite is independently **FAIL** on the obsolete source guard; no blanket claim that every repository test passes is appropriate. No live test suite beyond the bounded eight-request capture was run. No APK/native Android claim.

## 15. Privacy and licensing

Only public fixed regional geography/weather is used. No private hotspot ID/name/notes, visits, GPS trace, user account or SQLite content is read or transmitted. Provider requests contain only the fixed public weather coordinates and weather parameters. Raw responses contain no credentials. Existing Open-Meteo CC BY 4.0 attribution and modification notices are retained in envelopes; archive controls are labelled retrospective, not issued forecasts. API access terms and commercial procurement remain separate from data reuse attribution. WorldCover/ZGS/boundary provenance remains in the unchanged prototype; no national data preparation or public deployment occurs.

## 16. Evidence limitations

Two operational retrieval snapshots cannot establish representative stability, independent forecast cycles, occurrence prediction accuracy or a worst-case national delta. Unknown model/run metadata remains structural. The archive DST controls validate available historical products and actual interval handling, not a 2025/2026 forecast known at the original decision time. Current operational-to-archive seams and future missing data must remain gated by the canonical validators. Nearest/as-of behavior at fractional provider hours is covered by deterministic controls, not newly observed here. No native colour flicker, tile decoding, device memory or GPU performance was measured.

The seven experimental dates are locally evaluated from each frozen operational batch; the paired legacy comparison remains Today/Tomorrow because the actual production regional contract has only those dates. No fabricated legacy Day+2…+6 baseline is invented. Exact-point and habitat-masked regional products remain distinguishable; model suitability is not probability of finding mushrooms.

## 17. Finite production-readiness gate

For this first bounded gate, stop repeated sampling after **three complete retrieval snapshots ≥6 hours apart across at least two local dates**, plus the two genuine past-DST controls already obtained. One more deliberate manual capture is needed; there is no background promise or demand to wait indefinitely for three unverifiable model runs.

At that checkpoint require: correct identities/units/profile-specific coverage or explicit unavailable states; no unexplained absolute operational score delta >2 points (a **review trigger**, not a scorer threshold or forced equality); every category delta traceable to actual canonical boundaries; explained soil/time/source differences; bounded requests/performance; immutable versioned payloads/freshness and visible best-match/vintage uncertainty. Large but explained contract effects require explicit product acceptance, not automatic rejection or smoothing. Provider run IDs are not an unfulfillable mandatory condition if the published claim is honestly observational/as-of.

The internal preview may proceed now only as developer-only, non-public and explicitly gated: public legacy heatmap untouched, candidate contract separately versioned, coherent snapshot updates, no invalid input numeric publication, no implied future-date legacy heatmap. Before public rendering review the third capture and a separately measured native preview. Do not add another open-ended audit solely because the provider never exposes issue IDs; decide whether the qualified product is acceptable at this finite gate.

## 18. Final decision

**B — CONDITIONAL GO for an internal shadow map pilot.** Data construction, authentic archive DST handling, factor reuse and bounded cost are sufficiently supported for a developer-only preview. **A — public production-facing migration is not approved**: multi-snapshot evidence is incomplete and native delivery remains unmeasured. **C — NO-GO is not warranted** by the observed one-point differences or missing provider metadata alone. Production behavior stays unchanged in this commit.

## 19. Exactly one next milestone

**Developer-only Koroška seven-day shadow map preview.** Reuse this bounded versioned artifact/CLI and existing 696-cell geometry, preserve the current public heatmap, surface candidate-date/profile/age/unavailable distinctions explicitly, and evaluate native map/context/performance before public approval. Obtain the one remaining manual capture within that timeboxed milestone; do not turn unavailable issue-time metadata into endless repeat audits. No map preview is implemented here.
