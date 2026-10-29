# Data Sources for OpenCode Go Plan Data

Fetch fresh on every run, except ranking scores, which are cached with a short TTL
(1 day — see `references/model-snapshot.md`). Every number is reported with source
+ fetch date. Never guess a price, limit, or model id.

Sections:

- Console bill (priority 0)
- Offline fallback (committed price seed)
- Two quota layers — never mix them
- Estimated request counts (throughput) — official vs observed
- Snapshot file and snapshot shape
- Failure handling
- Rules and parse notes
- Capability verification (esp. vision)
- Capability and compliance table (geo, training, retention)
- Limited-time usage multipliers; geo restrictions and privacy-for-discount models
- Ranking / ability scores (for the snapshot)

| Priority | Source | URL | Gives | Method | Notes |
|---|---|---|---|---|---|
| 0 | Console MCP | `https://opencode.ai/console/mcp` | authoritative `cost_usd`, requests, tokens, per-model split, budget policies with `spentDollars` / `resetsAt` | Console tools in-run (`get_usage`), else `node scripts/probe-console.mjs` | **Only authoritative money source.** State machine, guidance and fallbacks: `references/console-mcp.md`. Never a substitute for a price list — the bill says what you spent, not what a model costs per 1M |
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table with estimated requests per 5h | webfetch (markdown) | **Most timely**; surfaces limited-time multipliers and the featured caps |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model list, price table, monthly limits, overall limits, estimated requests (assumptions + req/5h/week/month), privacy table | webfetch | Anchor `#usage-limits`; authoritative for prices and per-model caps; also the "Estimated requests" and privacy/geo sections |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog (ids) | `node scripts/fetch-go-models.mjs` or curl | Unauthenticated; includes preview/deprecated ids |
| 4 | Models.dev | https://models.opencode.ai/providers/opencode-go/ | context/output/price/capabilities | webfetch | Third party |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change log / deprecation | webfetch | Third party |
| 6 | LMArena (rankings) | https://lmarena.ai/ — dataset [lmarena-ai/leaderboard-dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) via the HF datasets-server | Arena ELO: overall / coding / vision | `node scripts/refresh-scores.mjs` (no key, no browser) | Official LMArena dataset; cost absent (stays null); proxy auto-enabled; seed at `references/model-scores.json` |
| 7 | models.dev (prices) | https://models.dev/api.json — provider `opencode-go` | machine-readable prices (incl. cache write and context tiers), context, output limit per model | `node scripts/refresh-prices.mjs` | Committed seed `references/model-prices.json` reused while each model's `upstreamUpdatedAt` still matches models.dev; plan-page caps and est req stay manually verified |

## Console bill (priority 0)

Read this before anything else, because it is the only source that can make an
absolute percentage true:

- Call the Console tool (`get_usage`) for `24h` / `7d` / `30d` / `all`. A non-empty
  `cost_usd` means the report's basis is `Console bill (authoritative)`.
- No tool in this run → `node scripts/probe-console.mjs` decides the state from the
  host's own list, the config, and at most one `initialize` request. `authorized`
  requires a bill; a reachable server alone is `unknown`.
- Feed what you read into `node scripts/calibrate-usage.mjs` so the bias, the pool
  and the per-agent split land in the snapshot instead of in your head.
- The bill is per user and per workspace; it does not tell you a model's unit
  price. Prices still come from the plan page / models.dev.

## Offline fallback (committed price seed)

`references/model-prices.json` is the committed per-model price seed, keyed by
Go model id — the last-resort fallback when the plan pages or models.dev cannot
be fetched. Read it directly as a dated fallback — labelled a seed with its own
date, never presented as current. A live read always wins: live → snapshot
cache → seed → "data unavailable".

Seed schema, key list and staleness identity: `references/model-snapshot.md`
§Bundled price seed / §Bundled score seed.

## Two quota layers — never mix them

Go has two different limits. Conflating them produces numbers that look precise and
are wrong:

| Layer | What it is | Where it comes from | Used for |
|---|---|---|---|
| **Per-model cap** | one model's monthly dollar allowance, with its own 5h = 20% / week = 50% / month = 100% slices | plan page table (`capUsd` in `references/model-prices.json`) | "how much of *this model* is left", headroom, observed capacity |
| **Plan pool** | the plan-level allowance the Console reports occupancy against | Console reading, reverse-solved per `references/quota-math.md` §Reverse-solving | "how much of *the plan* is left", month-end projection |

Rules:

- The per-model cap is **published**; the plan pool is **reverse-solved** and always
  `provisional` until a second reading confirms it.
- Every percentage states which layer it belongs to. A "share of pool %" computed
  against a model cap (or the reverse) is a defect, not a rounding error.
- The three windows are independent budgets at both layers: 5h / week / month are
  never added together.

## Estimated request counts (throughput) — official vs observed

A monthly dollar limit alone does not tell you how much work a model can do: two
models with the same $ limit can serve very different numbers of requests, because
each model burns a different number of tokens per request.

- `https://opencode.ai/go` shows the featured usage table (estimated requests per 5h
  and the monthly cap), and is the **more timely** source — read it first.
- `https://opencode.ai/docs/go/` has an "Estimated requests" section stating the
  per-request token assumptions (input / cached / output) and listing requests per
  5h / week / month. That is the **official** estimate: the published assumption
  structure, priced at the model's own rates. Its per-request cost follows from the
  cap itself — `c_req_official = capUsd / estReqMonth` — so the official capacity is
  just the published `estReqMonth` (`references/quota-math.md` §Derived quantities);
  never derive it from a different token mix than the one the page published.
- The **observed** count comes from the Console bill: `c_req_observed = cost$ ÷
  requests` over the same window. It reflects real traffic, which is usually heavier
  in cached input than the official assumption.
- Write both into the snapshot / report: `est req/5h` (official, with source + date)
  and, when a bill exists, `observed $/request` plus the request count
  (`models.<id>.billing`, `references/model-snapshot.md` §Schema v3).
- For a tie on price and capability, prefer the higher **official** estimate per 5h
  and say which number that is; never compare an official count against an observed
  count as if they shared a denominator.

## Snapshot file

Persist fetched data in `~/.cache/opencode/opencode-go-model-picker/snapshot.json`
and refresh it cheaply each run — see `references/model-snapshot.md`.

## Snapshot shape

`model id (opencode-go/<id>) | input $/1M | output $/1M | cached read $/1M | cached
write $/1M | cap $ | est. req/5h | est. req/week | est. req/month | observed
$/request | context | reasoning | vision | status | source+date`

## Failure handling

- **Go catalog endpoints unreachable** (`https://opencode.ai/go`,
  `https://opencode.ai/docs/go/`, `https://opencode.ai/zen/go/v1/models`) → use
  the snapshot cache, labelled with `sources.catalog.fetchedAt`; with no
  snapshot either, fall back to the committed price seed
  (`references/model-prices.json`), labelled with its own date; only when that
  is impossible too, report "data unavailable" and give no numeric
  recommendations.
- **A non-Go fallback id** (`opencode/*` or another provider) that cannot be
  confirmed in the Go catalog → verify it against the local registry
  `~/.cache/opencode/models.json` using its `status` field before recommending
  it. An explicit `status` of deprecated/removed → never put it in a chain. An
  absent `status` field is the registry's default-active convention and does not
  disqualify (say you checked). An id missing from the registry entirely → do
  not lead a chain with it; use a verified alternative or mark that slot for
  manual verification.
- **Network fully down** → stop and report that no data source is reachable;
  never improvise numbers. Offline, a dated seed may still be labelled and used
  (`references/quota-math.md` §Degradation); with no seed either, drop to relative
  selection only and leave the money columns empty.

## Rules

- Config uses `opencode-go/<modelID>` (e.g. `opencode-go/kimi-k3`).
- Limits are **per-model monthly dollar amounts**, each with 5h = 20% of that
  model's monthly cap, weekly = 50%, monthly = 100%. The plan-level pool is a
  separate, reverse-solved number (§Two quota layers). Caps change between runs —
  re-read them, never hardcode one.
- Prices are tiered by context length on some models and doubled during peak hours
  on others; both live in `references/model-prices.json` and are applied by
  `scripts/quota-math.mjs`. Never price a request from the headline $/1M alone.
- If a number is not in a fetched source, mark it for manual verification; do not infer it.
- The endpoint catalog ≠ what the user's key can use. Tell the user to run
  `/models` (or `opencode models --refresh`) to see their actual entitlement.

## Parse notes

- `/go` and `/docs/go/` are rendered pages; use the markdown extraction. The usage
  table on `/go` is a **featured subset** — take the full list from `/docs/go/`.
- `/zen/go/v1/models` returns `{ "object": "list", "data": [{ "id": "...", ... }] }`.
- Prices live on models.dev (input / output / cached read / cached write, plus
  context-length tiers under `cost.tiers`). Merge by model id.
- The plan page, not models.dev, owns the monthly cap, the estimated requests and
  the peak-hours rule; those are carried in `references/model-prices.json` as
  `capUsd`, `estReq*` and `peak`.
- If a lab's official page is JS-rendered and `webfetch` returns empty content
  (zero word count or a high boilerplate ratio), retry with a web search scoped
  to the official domain instead of treating the empty page as "no evidence".

## Capability verification (esp. vision)

Model names are NOT evidence. Before assigning a vision lane (`observer`) or any
capability-sensitive agent, confirm modalities from the model's own lab docs:
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/ (look for a `Vision` row; also FIM/JSON/Tool calls)
- models.dev model page `https://models.dev/models/<lab>/<model>` (Input / Output types / Capabilities)
- OpenCode Go docs image-billing note — names only *some* vision models, so do not treat it as the full list

Verified 2026-09-10: **`mimo-v2.5`** (Xiaomi — native image/video/audio; see
https://mimo.mi.com/models/mimo-v2.5 and the image-understanding docs),
**`deepseek-flash` (DeepSeek V4.1 Flash)** and **`deepseek-v4-flash-vision-exp`**
support image input. **Caution:** models.dev's capability flags omit modality, so
a missing "vision" flag there is NOT evidence of text-only — always use the lab's
own docs.

> Superseded 2026-10-30: that entry also recorded a limited-time 4× usage promo on
> DeepSeek V4.1 Flash ($15 → $60 monthly). Re-reading the plan page on 2026-10-30
> showed **no 4× promo** and an **$80** monthly cap for V4.1 Flash, with peak/off-peak
> pricing instead. Plan-page facts age fast; take them from this run's fetch, not
> from this paragraph.

Verified 2026-10-03 (incremental — the vision facts above still stand):

- `mimo-v2.6-flash`, `mimo-v2.6-pro` (Xiaomi MiMo) support image input. Source:
  https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding
  (lists "mimo-v2.6-flash, mimo-v2.6-pro, mimo-v2.6-pro-ultraspeed and mimo-v2.5
  models are supported") and the Hugging Face model card's multimodal tag.
- `deepseek-v4.1-flash` supports image input. Source:
  https://api-docs.deepseek.com/guides/vision ("The deepseek-flash model accepts
  images alongside text") and DeepSeek's official announcement of native
  multimodal support; confirming source:
  https://api-docs.deepseek.com/quick_start/pricing (marks `deepseek-flash`
  Vision ✓, `deepseek-v4-pro` Vision: Not supported). Three distinct names —
  record the mapping explicitly:
  - Go catalog id: `deepseek-v4.1-flash`
  - lab model version name: `DeepSeek-V4.1-Flash`
  - API request model id: `deepseek-flash` — the docs say "Use `deepseek-flash`
    as the model name"; `deepseek-v4.1-flash` is a version name, NOT a
    documented API id (its acceptance is unverified).
- `deepseek-v4-pro` is not vision-capable itself. (DeepSeek's 2026-09-10
  announcement also said v4-pro requests route to V4.1-Flash at V4.1-Flash rates;
  that routing was **not** re-verified on 2026-10-30, when the plan page listed
  V4 Pro with its own prices again — treat the routing as unverified.)

## Capability and compliance table (geo, training, retention)

Compliance facts age as fast as prices, so they are recorded here **with the date
they were read**, and every run re-reads the plan page's Privacy table. This is the
record from the 2026-10-30 fetch; a value not in this table is unknown, not "safe".

| Model | Image input (lab docs) | Trains on your data | Retention | Availability |
|---|---|---|---|---|
| `deepseek-v4.1-flash` | yes (2026-10-03, lab docs) | no | 0 days, ZDR renewed monthly (agreement through 2026-10-31 at fetch time) | Global region must be selected in Settings › Privacy for requests from China |
| `deepseek-v4-pro` | no | no | as above | as above |
| `mimo-v2.6-flash` | yes (2026-10-03, lab docs) | no | 0 days | — |
| `mimo-v2.6-pro` | yes (2026-10-03, lab docs) | no | 0 days | — |
| `grok-4.7` | unverified | no | 30 days (ZDR disables the stateful Responses API) | — |
| `gpt-6-luna` / `gpt-5.6-luna` | unverified | no | 30 days abuse-monitoring logs | — |
| `claude-haiku-5-5` | unverified | no | 30 days | — |
| `gemini-4-argon` | unverified | no | 0 days | price promo: 50% off through 2026-11-30 |
| `muse-spark-1.2-contributor` | unverified | **yes** — paid-for-discount Contributor tier | not ZDR | needs "allow paid endpoints that train on request data" in Settings › Privacy; region policy applies |
| `muse-spark-1.3-contributor` | unverified | **yes** | not ZDR | as above |
| `iceman-contributor-free` | unverified | **yes** | not ZDR | free for a limited time |
| `beam-free` | unverified | no | 30 days | free for a limited time; not available in a long list of excluded regions (read it from the plan page) |
| every other Go model | unverified this run | no | 0 days | — |

"unverified" means this skill has not confirmed it from the model's own lab docs —
it is **not** a claim that the model is text-only. A vision lane needs the lab's
confirmation, never this table's silence.

**Peak pricing (DeepSeek).** The plan page publishes 01:00–04:00 and 06:00–10:00
UTC, Monday–Friday, at 2× the off-peak rates, and `references/model-prices.json`
carries that as `peak`. Measured 2026-10-29: a 30-day sample of messages inside
those hours was billed at the **off-peak** rate exactly (n = 1016, per-message
ratio 1.000), so the surcharge may have started after the sample or may not apply
to Go routing at all. Keep the multiplier in the formula (it is the published
price) and read the `recomputed` vs `actual` columns of
`scripts/calibrate-usage.mjs` each run instead of assuming either way —
`references/quota-math.md` §Formula v2.

## Limited-time usage multipliers

A promo can multiply a model's allowance (e.g. "4× usage", `$15 → $60` monthly).
Never present a promo number as the permanent limit:

- Read the current multiplier and the **base** limit it falls back to from
  `https://opencode.ai/go` (most timely), and cross-check `/docs/go/`.
- Any recommendation that depends on a promo must say so explicitly and state the
  base limit it drops to when the promo ends. `references/output-format.md`
  requires promo-dependent picks to be flagged.
- Re-check on every run: a promo can end between runs.

## Geo restrictions and privacy-for-discount models

Some Go models carry non-price caveats that must be surfaced before recommending
them. Check the `/docs/go/` privacy and availability notes each run — the set
changes.

- **Geo-restricted.** Some models (e.g. `Muse Spark 1.2/1.3 Contributor`) are only
  available in regions permitted by the provider's policy — Meta's Geographic Use
  Policy, `https://ai.developer.meta.com/legal/geographic-use-policy`. Say so, and
  do not recommend one whose region is not covered.
- **Privacy-for-discount.** A "Contributor" tier trades a large token discount for
  permission to train future models on the user's prompts and completions. Verbatim
  from `/docs/go/`: "Heavily discounted token pricing in exchange for permission to
  use your prompts and completions to train future Meta models." Other models are
  listed as "Not used" for training. Treat this as opt-in and **never recommend it
  silently** — flag the training clause and let the user decide.

## Ranking / ability scores (for the snapshot)

The snapshot cache (see `references/model-snapshot.md`) stores a per-model ability
score so runs do not re-derive it.

- **Primary — LMArena** (`https://lmarena.ai/`, verified 2026-09-13): Arena ELO
  from three boards — `text_style_control` (overall ability), `webdev` (Code
  Arena → `coding`), and `vision` (→ `vision`). No key, no browser: the official
  dataset `lmarena-ai/leaderboard-dataset` is served by the Hugging Face
  datasets-server (`/filter`, paginate with `offset` / `length=100`), and
  `scripts/refresh-scores.mjs` reads it. The dataset has **no cost column**, so
  `costPerSuccessfulTaskUsd` stays `null`. When a system proxy is set every
  network script re-executes itself with `NODE_USE_ENV_PROXY=1`, so the normal
  command works behind a proxy (`--no-env-proxy` opts out; the variable needs
  Node 24+ or a 22.x build that backported it).
- Seed schema, key list and staleness identity for
  `references/model-scores.json`: `references/model-snapshot.md`
  §Bundled score seed.

Only use a score that clearly maps to the model; otherwise leave it null and mark
it for manual verification.
