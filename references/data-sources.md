# Data Sources for OpenCode Go Plan Data

Fetch fresh on every run, except ranking scores, which are cached with a short TTL
(1 day — see `references/model-snapshot.md`). Every number is reported with source
+ fetch date. Never guess a price, limit, or model id.

| Priority | Source | URL | Gives | Method | Notes |
|---|---|---|---|---|---|
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table with estimated requests per 5h | webfetch (markdown) | **Most timely**; surfaces limited-time multipliers (e.g. "DeepSeek V4.1 Flash 4× usage") and estimated request counts |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model list, price table, monthly limits, overall limits, estimated requests (assumptions + req/5h/week/month) | webfetch | Anchor `#usage-limits`; authoritative for prices; also the "Estimated requests" and privacy/geo sections |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog (ids) | `node scripts/fetch-go-models.mjs` or curl | Unauthenticated; includes preview/deprecated ids |
| 4 | Models.dev | https://models.opencode.ai/providers/opencode-go/ | context/output/price/capabilities | webfetch | Third party |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change log / deprecation | webfetch | Third party |
| 6 | LMArena (rankings) | https://lmarena.ai/ — dataset [lmarena-ai/leaderboard-dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) via the HF datasets-server | Arena ELO: overall / coding / vision | `node scripts/refresh-scores.mjs` (no key, no browser) | Official LMArena dataset; cost absent (stays null); proxy auto-enabled; seed at `references/model-scores.json` |

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
- The committed seed `references/model-scores.json` is reused when its
  `source.publishDates` still match the live boards (and it covers the current
  catalog); otherwise the script fetches fresh. See "Bundled score seed" in
  `references/model-snapshot.md`.

Only use a score that clearly maps to the model; otherwise leave it null and mark
it for manual verification.
