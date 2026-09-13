# Data Sources for OpenCode Go Plan Data

Fetch fresh on every run, except ranking scores, which are cached with a short TTL
(see `references/model-snapshot.md`). Every number is reported with source + fetch
date. Never guess a price, limit, or model id.

| Priority | Source | URL | Gives | Method | Notes |
|---|---|---|---|---|---|
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table | webfetch (markdown) | Most timely; surfaces limited-time multipliers (e.g. "DeepSeek V4.1 Flash 4× usage") |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model list, price table, monthly limits, overall limits | webfetch | Anchor `#usage-limits`; authoritative for prices |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog (ids) | `node scripts/fetch-go-models.mjs` or curl | Unauthenticated; includes preview/deprecated ids |
| 4 | Models.dev | https://models.opencode.ai/providers/opencode-go/ | context/output/price/capabilities | webfetch | Third party |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change log / deprecation | webfetch | Third party |
| 6 | LiveBench (rankings) | https://livebench.ai/ | Overall + per-category scores + cost per successful task | webfetch (agent step, 7-day TTL) | Apache-2.0, no key; no stable JSON API |

## Snapshot file

Persist fetched data in `~/.cache/opencode/opencode-go-model-picker/snapshot.json`
and refresh it cheaply each run — see `references/model-snapshot.md`.

## Snapshot shape

`model id (opencode-go/<id>) | input $/1M | output $/1M | monthly $ limit | est. req/5h | context | reasoning | vision | status | source+date`

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

Also watch for limited-time promos generally: the `/go` page is the most timely
signal (e.g. "N× usage for a limited time"), while `/docs/go/` shows base numbers.

## Ranking / ability scores (for the snapshot)

The snapshot cache (see `references/model-snapshot.md`) stores a per-model ability
score so runs do not re-derive it.

- **Primary — LiveBench** (`https://livebench.ai/`, verified 2026-09-13): Overall
  plus Reasoning / Coding / Agentic Coding / Math / Data Analysis / Language /
  Instruction Following, and a cost-per-successful-task column. Apache-2.0, no
  fees, **no stable machine-readable endpoint** — the agent fetches the page and
  writes scores into the snapshot. Refresh with a 7-day TTL, not every run; new or
  changed models always get a fresh lookup regardless of the TTL.
- **Optional coding cross-check — SWE-bench**:
  `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/main/data/leaderboards.json`
  (public JSON, `% Resolved` per model).

Only use a score that clearly maps to the model; otherwise leave it null and mark
it for manual verification.
