# Quota Math (priced accounting)

The one place the money formula lives. `scripts/quota-math.mjs` implements exactly
this page; no other file may restate a constant, and no report may use a second
formula for the same column.

Sections:

- Where the constants live
- Formula v2 (per assistant message)
- Context tiers and peak hours
- Derived quantities
- Reverse-solving the plan pool (and the circular dependency)
- Windows: what "30 days" means
- Known gaps and how each is handled this version
- Calibration constants (bias, pool)
- Degradation when a field is missing
- Seed freshness (the "expired" label)
- Running the calculator

## Where the constants live

`references/model-prices.json` is the only price/limit table. This page defines
the fields and the fallbacks; it never repeats a value.

| Field | Meaning | Source | Missing means |
|---|---|---|---|
| `inputPer1M` / `outputPer1M` | uncached input and output, USD per 1M tokens | models.dev (`refresh-prices.mjs`) | not priced — the run must say so |
| `cacheReadPer1M` | cached-input read price | models.dev | a request with cached tokens cannot be priced |
| `cacheWritePer1M` | cache-write price; only models that bill it carry one | models.dev | `null` = not billed, counted as 0 and reported as `assumed` |
| `ctxTiers[]` | `{ overK, input, output, cacheRead, cacheWrite }`, ascending by `overK` | models.dev `cost.tiers` (`type: context`) | single price for every request length |
| `capUsd` | the model's monthly dollar cap on the selected plan | plan page, hand-verified | no per-model share can be printed |
| `monthlyLimitUsd` | the same number under its v2 field name | plan page | `null`; readers fall back to `capUsd` |
| `estReq5h` / `estReqWeek` / `estReqMonth` | the plan page's own estimate, from its stated token assumptions | plan page | official capacity cannot be printed |
| `peak` | `{ multiplier, utcHours: [[start,end]], weekdaysOnly }`, hours in UTC | plan page | `k_peak = 1`, flagged "unverified peak" |
| `promo` / `promoUntil` | the promo text and the date it ends | plan page | no promo caveat; re-check next run |
| `status` | `active` / `preview` / `free-limited-time` | plan page | unknown status — treat as active but flag |
| `context` / `outputLimit` | window sizes, not money | models.dev | irrelevant to cost |
| `priceVerifiedAt` / `planVerifiedAt` | when the price / plan field was last verified | each refresh | stale — label the date, re-verify |
`capUsd` and `monthlyLimitUsd` are one fact with two names: `refresh-prices.mjs`
writes both together and `quota-math.mjs` reports a mismatch instead of picking
one. A live read always beats the seed (`references/data-sources.md`
§Offline fallback).

**`verifiedAt`.** There is no third field by that name: a record carries the two
precise timestamps above, and "verified at" means the newer of them. `quota-math.mjs`
computes that (`seedFreshness`), so a report can print one date and one age for the
whole seed without anyone re-deriving it — and without a third copy of the fact.

## Formula v2 (per assistant message)

```text
C = (T_in·p_in + T_out·p_out + T_cr·p_cr + T_cw·p_cw) / 1e6 × k_peak
```

- **T_*** — that message's tokens. `T_cr` is cached read, `T_cw` cache write.
  **`T_out` is visible output + reasoning tokens**: OpenCode stores them in two
  separate counters and the provider charges both at the output rate. Dropping the
  reasoning counter under-prices a message by up to a third, so
  `billedOutputTokens()` adds them and nothing else does.
- **p_*** — the price of the **context tier** the request falls into (below).
- **k_peak** — 2 during peak hours for a model that declares `peak`, otherwise 1.
  It is decided **per message** from that message's own timestamp; a session that
  starts off-peak and runs into peak is priced in both bands.

Cost is accumulated per assistant message and then summed. A *session* in every
table of this skill means one OpenCode session: its cost is the sum of its
assistant messages, not one price applied to the session's aggregate tokens
(that would let a single peak hour reprice hours of off-peak work).

**How the formula was checked against reality.** For each sampled message,
`scripts/quota-math.mjs` reproduces the provider's own per-message cost to the
last digit once reasoning tokens are included and the peak multiplier is applied
from the message timestamp; without the reasoning term the same messages come out
4–34% low, depending on how much the model reasoned. When the local numbers are
compared with the Console at session/window level, a few percent of residual
difference is expected (rounding, retries, provider-side pricing changes) and is
exactly what the bias in §Calibration constants absorbs — but a per-message error
means the formula, not the data, is wrong.

**Peak pricing is the one axis the data can contradict.** A 30-day sample
(2026-10-29) of DeepSeek messages inside the documented peak window was billed at
**exactly** the off-peak rate (`n = 1016`, ratio 1.000 per message), while every
off-peak message matched at 1.000 as well. The multiplier stays in the formula
because the plan page publishes it and it may apply to newer requests; the
`recomputed` vs `actual` columns from `scripts/calibrate-usage.mjs` are what tell
you whether it is being charged today. Never assume either way from an old run.

## Context tiers and peak hours

- **Tier selection uses the prompt length**: `T_in + T_cr + T_cw` — everything that
  was sent. Output never chooses the tier. When `ctxTiers` is absent the single
  `inputPer1M` / `outputPer1M` pair applies to every request.
- A tier applies when the prompt length is **strictly greater** than its `overK`.
- **Peak hours** come from `peak.utcHours` as half-open `[start, end)` UTC hours,
  restricted to Monday–Friday when `weekdaysOnly` is true. The multiplier applies
  to the whole request, not only the input.
- Only models that declare `peak` are affected. For every other model `k_peak = 1`,
  and the calculator reports `peak hours (assumed 1x)` in its `assumed` list.

## Derived quantities

Let `C` be one session's cost, `cap` the model's monthly cap, `P_month` the plan pool.

| Quantity | Formula | Note |
|---|---|---|
| Share of the model's monthly cap | `C / cap` | `cap` is re-read every run |
| Share of the plan pool, 5h / week / month | `C / P_5h`, `C / P_week`, `C / P_month`, with `P_5h = 0.2 * P_month`, `P_week = 0.5 * P_month` | three **independent** windows; never add or merge them |
| Sessions the pool can serve | `R_month = P_month / C`, `R_week = R_month / 2`, `R_5h = R_month / 5` | follows from the fractions above; a smaller pool shrinks both dollars and sessions in the same direction |
| Official capacity | `N_official = cap / c_req_official` | `c_req_official = cap / estReqMonth`, i.e. the plan page's own published estimate |
| Observed capacity | `N_observed = cap / c_req_observed` | `c_req_observed = Console $ / Console requests` for the same window |
| Pool reverse-solve | `P_month = C_account / monthPct` | `provisional`; see the order below |
| Actual-account conversion | `C_account = C_db / bias` | `bias = DB_cost / Console_cost`, dated |
| Month-end forecast | `sessions_cycle * (0.7 * median + 0.3 * P90) / P_month` | linear over the **billing cycle's** elapsed days |

Official and observed capacity are reported **together**. A capacity number
without its counterpart is a half-truth: the published estimate assumes a
provider-chosen token mix, while the observed one is what your traffic costs.

## Reverse-solving the plan pool (and the circular dependency)

`P_month` needs `C_account`; `C_account` needs `bias`; `bias` needs a Console bill —
which the middle fallback level does not have. Resolve in this order and stop at
the first that applies:

1. **The user can read the cycle's spend in dollars** → `P_month = that / monthPct`. No
   circularity: this is the exact path, marked `provisional` only because the
   percentage is rounded.
2. **No dollar figure, but a previously measured bias exists** → convert the local
   DB cost first (`C_account = C_db / bias`) and then divide by `monthPct`. The bias is a
   dated estimate: label the pool `provisional` and re-calibrate on the next bill.
3. **Neither** → do **not** reverse-solve. Give the relative ranking only and state
   that absolute percentages cannot be computed without a Console reading.

`scripts/quota-math.mjs` `solvePool()` implements exactly these three and returns
`level: 1 | 2 | 3` plus `method`, so a report can say which path produced a number.
In the library `monthPct` is a **fraction** (`0.325` for the Console UI's 32.5%);
`scripts/calibrate-usage.mjs --month-pct` takes the UI's `0–100` number and converts
it, so nobody has to remember which side is which.

## Windows: what "30 days" means

Two different denominators exist and they are not interchangeable:

- **Rolling 30 days** — the accounting window for "what did I actually spend".
  Comparable 1:1 with the Console's own `30d` range, which is what makes the bias a
  clean ratio.
- **Billing cycle** — the denominator for "will I run out this month". Use the
  cycle's elapsed days for a linear projection; a rolling window would understate
  the remaining days.

Every printed number states which window it came from, and never mixes them inside
one comparison. Go's windows (5h / week / month) are usage windows, not accounting
windows: they are separate budgets, and a 5h overspend does not subtract from the
week in this arithmetic.

## Known gaps and how each is handled this version

| # | Gap | Handling |
|---|---|---|
| 1 | Tiered pricing (context-length tiers on several models) | implemented: `ctxTiers` + prompt-length tier selection |
| 2 | Cache write assumed free on every model | implemented: `cacheWritePer1M`; a missing value stays 0 and is reported as `assumed` |
| 3 | Peak/off-peak decided at session start | implemented: per-message timestamps |
| 4 | Adding the 5h / week / month windows together | forbidden in this page and in the script: there is no merge helper |
| 5 | Rolling 30 days used as if it were a billing period | every output is labeled with its window (§Windows) |
| 6 | Bias treated as a constant | recomputed every run, dated, and a >10% drift is reported |
| 7 | Whether failed/retried requests are billed | unverified; cross-check with the Console request delta when a bill exists, and report the failed count separately |
| 8 | A median hides the long tail | median **and** P90 are printed; forecasts use 0.7·median + 0.3·P90 |

## Calibration constants (bias, pool)

A calibration constant is only trusted together with **how and when** it was
measured.

- Every bias carries its date and the two numbers it came from. Every pool carries
  `provisional: true` and its `source` (`calibrated`, or the default seed).
- Re-measure both on every run that has a Console bill. A change wider than **10%**
  from the stored value is reported as drift, never averaged away.
- The provisional default pool (`$60`/month, i.e. `DEFAULT_POOL_MONTHLY_USD` in
  `scripts/quota-math.mjs`) exists so the first run can print a shape; it is
  replaced by the first reading and is never presented as a verified limit.
- A constant stored in the snapshot (`plan.go`, `calibration`) is skill state, not
  agent config: writing it never touches the user's agent files.

## Degradation when a field is missing

The calculator never invents a number:

| Missing | Behavior |
|---|---|
| `inputPer1M` / `outputPer1M` | the request is unpriced; say which model could not be priced |
| `cacheReadPer1M` and cached tokens > 0 | unpriced (do not pretend cached input is free) |
| `cacheWritePer1M` | priced with 0 and listed under `assumed` |
| `ctxTiers` | one price per request, flagged as flat |
| `peak` | `k_peak = 1`, flagged "unverified peak" |
| `capUsd` | no share-of-cap, no capacity — print `-` |
| `estReqMonth` | no official capacity — print only the observed one |

## Seed freshness (the "expired" label)

Offline, the committed seed is still the best number available — but it is a dated
one, and the report must say so. `seedFreshness()` (in `scripts/quota-math.mjs`)
turns the seed's own verification dates into `{ verifiedAt, ageDays, stale, reason }`:

- `verifiedAt` is the newest `planVerifiedAt` / `priceVerifiedAt` in the table.
- `stale` is `ageDays > 7` (`SEED_STALE_AFTER_DAYS`). Seven days because the plan
  page changes caps and promos on its own schedule; a week is the longest a number
  can go unconfirmed and still be called "current-ish".
- `scripts/quota-math.mjs` prints it on every CLI run and marks an expired seed with
  `⚠ EXPIRED`; `scripts/calibrate-usage.mjs` reports it as `prices` (and as a
  `# prices …` line in `--text`).
- An expired seed is **usable, labelled, and never called current**. A missing seed
  is not: with no price at all, drop to level 3 (relative selection only, money
  columns empty) — see `references/console-mcp.md` §Three-level fallback.

## Running the calculator

```bash
node scripts/quota-math.mjs --self-check
node scripts/quota-math.mjs --model <id> --input 410 --cache-read 71300 --output 310 --count 10
node scripts/quota-math.mjs --model <id> --input 300000 --cache-read 0 --output 1000 --at 2026-10-30T07:00:00Z --json
```

The CLI applies the same functions the report uses and prints the cost, the tier
that applied, `k_peak`, the share of the model cap and of each pool window, the
sessions each window can serve, and the official capacity. Anything it had to
assume is listed under `assumed` — copy that list into the report rather than
hiding it.

`--self-check` re-computes a few published plan-page examples and exits non-zero
if the arithmetic disagrees by 1% or more. Run it after editing the price seed.
