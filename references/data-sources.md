# Data Sources for OpenCode Go Plan Data

Fetch fresh on every run, except ranking scores, which are cached with a short TTL
(1 day — see `references/model-snapshot.md`). Every number is reported with source
+ fetch date. Never guess a price, limit, or model id.

Sections:

- Offline fallback (committed price seed)
- Estimated request counts (throughput)
- Snapshot file and snapshot shape
- Failure handling
- Rules and parse notes
- Capability verification (esp. vision)
- Limited-time usage multipliers; geo restrictions and privacy-for-discount models
- Ranking / ability scores (for the snapshot)

| Priority | Source | URL | Gives | Method | Notes |
|---|---|---|---|---|---|
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table with estimated requests per 5h | webfetch (markdown) | **Most timely**; surfaces limited-time multipliers (e.g. "DeepSeek V4.1 Flash 4× usage") and estimated request counts |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model list, price table, monthly limits, overall limits, estimated requests (assumptions + req/5h/week/month) | webfetch | Anchor `#usage-limits`; authoritative for prices; also the "Estimated requests" and privacy/geo sections |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog (ids) | `node scripts/fetch-go-models.mjs` or curl | Unauthenticated; includes preview/deprecated ids |
| 4 | Models.dev | https://models.opencode.ai/providers/opencode-go/ | context/output/price/capabilities | webfetch | Third party |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change log / deprecation | webfetch | Third party |
| 6 | LMArena (rankings) | https://lmarena.ai/ — dataset [lmarena-ai/leaderboard-dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) via the HF datasets-server | Arena ELO: overall / coding / vision | `node scripts/refresh-scores.mjs` (no key, no browser) | Official LMArena dataset; cost absent (stays null); proxy auto-enabled; seed at `references/model-scores.json` |
| 7 | models.dev (prices) | https://models.dev/api.json — provider `opencode-go` | machine-readable prices, context, output limit per model | `node scripts/refresh-prices.mjs` | Committed seed `references/model-prices.json` reused while each model's `upstreamUpdatedAt` still matches models.dev; plan-page monthly limits and est req stay manually verified |

## Offline fallback (committed price seed)

`references/model-prices.json` is the committed per-model price seed, keyed by
Go model id — the last-resort fallback when the plan pages or models.dev cannot
be fetched. Read it directly as a dated fallback — labelled a seed with its own
date, never presented as current. A live read always wins: live → snapshot
cache → seed → "data unavailable".

Seed schema, key list and staleness identity: `references/model-snapshot.md`
§Bundled price seed / §Bundled score seed.

## Estimated request counts (throughput)

A monthly dollar limit alone does not tell you how much work a model can do: two
models with the same $ limit can serve very different numbers of requests, because
each model burns a different number of tokens per request. The **estimated request
count** is therefore a primary signal, not a footnote.

- `https://opencode.ai/go` shows a usage table with estimated requests per 5 hours
  and monthly $ limits, and is the **more timely** source — read it first.
- `https://opencode.ai/docs/go/` has an "Estimated requests" section stating the
  per-request token assumptions (input / cached / output) and listing requests per
  5h / week / month per model. Use it for the assumptions and to cross-check.
- Record `est req/5h` (plus week/month when shown) in the snapshot, with source +
  date. When price and capability are close, prefer the model with the **higher
  estimated request count** for the same $ limit, and report the number.

## Snapshot file

Persist fetched data in `~/.cache/opencode/opencode-go-model-picker/snapshot.json`
and refresh it cheaply each run — see `references/model-snapshot.md`.

## Snapshot shape

`model id (opencode-go/<id>) | input $/1M | output $/1M | monthly $ limit | est. req/5h | est. req/week | est. req/month | context | reasoning | vision | status | source+date`

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
  never improvise numbers.

## Rules

- Config uses `opencode-go/<modelID>` (e.g. `opencode-go/kimi-k3`).
- Go limits are **per-model monthly dollar amounts**; overall limits are 5h = 20% of
  monthly, weekly = 50%, monthly = 100% ($12 / $30 / $60 at time of writing — re-check).
- If a number is not in a fetched source, mark it for manual verification; do not infer it.
- The endpoint catalog ≠ what the user's key can use. Tell the user to run
  `/models` (or `opencode models --refresh`) to see their actual entitlement.

## Parse notes

- `/go` and `/docs/go/` are rendered pages; use the markdown extraction. The usage
  table on `/go` is a **featured subset** — take the full list from `/docs/go/`.
- `/zen/go/v1/models` returns `{ "object": "list", "data": [{ "id": "...", ... }] }`.
- Prices live on models.dev (input/output/cached). Merge by model id.
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
own docs. DeepSeek V4.1 Flash is
currently on a **limited-time 4× usage promo** ($15 → $60 monthly, 6,500 → 26,000
req/5h per https://opencode.ai/go) — re-check on every run; when it ends the limit
falls back to $15.

Verified 2026-10-03 (incremental — the 2026-09-10 entry above still stands):

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
- Plan-level note (re-check every run; NOT a capability fact): DeepSeek now marks
  `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` as retired; requests are
  temporarily routed to V4.1-Flash, while the Go plan still lists and bills them
  separately ($30 / $15 vs the $60 monthly allowance).
- Plan-level note (re-check every run; NOT a capability fact): `deepseek-v4-pro`
  is not vision-capable itself, and DeepSeek's announcement says that from
  2026-09-14 all `deepseek-v4-pro` requests route to V4.1-Flash at V4.1-Flash
  rates. Source: https://api-docs.deepseek.com/news/news260910/.

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
  `costPerSuccessfulTaskUsd` stays `null`. When a system proxy is set the script
  re-executes itself with `NODE_USE_ENV_PROXY=1`, so the normal command works
  behind a proxy.
- Seed schema, key list and staleness identity for
  `references/model-scores.json`: `references/model-snapshot.md`
  §Bundled score seed.

Only use a score that clearly maps to the model; otherwise leave it null and mark
it for manual verification.
