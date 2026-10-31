# Plan facts and judgement calls

The model reads this file; it does not restate any procedure that lives in code.

## What the code already decided

`scripts/go.mjs` produces every number, every date label, the `Basis:` line, the
report table, the config blocks and the diff. Do not recompute, re-price or
re-format them. Your job is judgement: which model fits which agent, whether a
capability claim is true, and what risk the user must know about.

- `run` — data quality (`live` / `seed` / `none`), catalog + price + score dates,
  agent inventory, Console state, local usage, plan diff, mode, basis.
- `report` — the table and blocks, from `run` + your picks.
- `check` — refuses a report that drops the basis line, a column, or the gate.
- `apply` — prints the exact diff; `--write` only after the user confirms.

## Plan facts

- The pool is **not** the per-model cap. A Go model has its own monthly cap;
  several agents led by the same model share that one allowance.
- Windows are fixed fractions of the pool and never summed: 5h = 20%, week = 50%,
  month = 100%.
- Official request counts come from the plan page; observed counts come from a
  bill or the local DB. Print both, or `-` — never one alone.
- Plan pages: <https://opencode.ai/go> (promos, requests/5h) and
  <https://opencode.ai/docs/go/> (authoritative model/price/limit table).
  Prices also come from <https://models.dev/api.json> (`opencode-go`).
- A committed seed is a dated fallback, never "current". If the run says
  `stale`, say so and give the date.

## Capability comes from the lab, not the name

Never infer vision, reasoning or context length from a model id.

1. Open the model's own documentation (the lab's page, linked from the provider).
2. Find the input modalities and the context window in that page.
3. Quote the source and the date in the report when the pick depends on it.
4. If the page cannot be read, mark the slot "needs manual verification" and do
   not put an unverified model in a vision lane.

## Console MCP states

| state | evidence | what it proves |
|---|---|---|
| `authorized` | an in-run call returned a non-empty `cost_usd` | the bill; per-model split |
| `gated` | HTTP 403 "not enabled for this workspace" | nothing |
| `unauthenticated` | HTTP 401, or `opencode mcp list` needs auth | nothing |
| `absent` | no console server in config **and** in `opencode mcp list` | nothing |
| `unknown` | timeout, DNS/proxy, 5xx, disabled entry, no bill in this run | nothing |

`unknown` is never "not set up": a broken network is not a missing setup.

Guidance, only when the state is not `authorized`, at the end of the report:

- `absent` — add a remote MCP server at `https://opencode.ai/console/mcp`
  (OpenCode: `opencode mcp`; OpenChamber: MCP page), then authorize.
- `unauthenticated` — `opencode mcp auth <name from opencode mcp list>`.
- `gated` — enable the Console MCP for the workspace in the Console web app.
- `unknown` — say what failed; retry once; do not guess a state.

Fallback when the user will not enable it: (1) they read the Console numbers to
you (5h / week / month %, cycle spend) — those are as authoritative as the API;
(2) local DB only, labelled an estimate; (3) neither — `Basis: Uncalibrated`,
amount columns `-`, rank models only.

## Risks the report must name, where they apply

- A **limited-time multiplier**: give the base limit and the end date.
- A **geo-restricted** model: say which regions, and whether the user's is covered.
- A **privacy-for-discount / Contributor** tier: trains on prompts and
  completions; opt-in only, never silently recommended.
- **Peak pricing**: only models that declare peak hours; the code applies it.

## What you still write yourself

- `why` per pick — cost, throughput and capability in one sentence; name the
  reason when a dominated model is kept.
- Highlights — mode, plan changes since the last snapshot, and the one thing the
  user should act on.
- Caveats — the risks above, in the user's words.
- The two mode questions on a first run, then `question` before any write.
