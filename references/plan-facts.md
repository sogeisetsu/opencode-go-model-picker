# Plan facts and judgement calls

The model reads this file; it does not restate any procedure that lives in code.

## What the code already decided

`scripts/go.mjs` produces every number, every date label, the `Basis:` line, the
report table, the config blocks and the diff. Do not recompute, re-price or
re-format them. Your job is judgement: which model fits which agent, whether a
capability claim is true, and what risk the user must know about.

- `run` — data quality (`live` / `seed` / `none`), catalog + price + score dates,
  the candidate menu (`data.candidates` / `data.candidateIds`), agent inventory,
  Console state, local usage, plan diff, mode, basis.
- `report` — the table and blocks, from `run` + your picks.
- `check` — re-renders from `run` + `picks` and refuses any line that was altered,
  plus a dropped basis line, a missing column, or a missing gate.
- `apply` — prints the exact diff; `--write` only after the user confirms.

## The menu

`data.candidates` is the only legal source of model ids: every Go model this run
can price, with its cap, official request counts, status, promo and end date,
peak flag, context, vision field and ELO. `data.candidateIds` is the flat set
`report` and `apply` check against — an id outside it is an invented id, even if
it exists on the plan today.

A non-Go id (another provider) is allowed where a chain slot asks for provider
diversity; it is simply not priced here.

## The mode question

Ask these two, once, before picking a chain — on a first run, or when `run.json`
says `needs.modeQuestion`:

1. **Main goal** (weight 0.7): save money / balance / best quality.
2. **Main workload** (weight 0.3): coding, research, writing, review, or
   multimodal work.

Resolve them into one of `budget` / `balanced` / `quality`, then pass
`--mode <mode>`. The choice is written to the snapshot, so later runs report
`source: "remembered"` and must not ask again. A user may override with
`--mode` at any time; the new value replaces the remembered one.

## Plan facts

- The pool is **not** the per-model cap. A Go model has its own monthly cap;
  several agents led by the same model share that one allowance.
- **Chain length follows the source.** A native `agent.<name>.model` and a
  Markdown agent's frontmatter `model:` hold one id; an `oh-my-opencode-slim`
  preset (or any source already carrying an array) holds an ordered chain of
  2–4. `report` enforces this per agent, so a one-id answer where a chain is
  possible, and a two-id answer where it is not, are both refused.
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

The authoritative path needs the numbers handed back to `run`, because it cannot
call the MCP tool itself:

```bash
# after the Console tool returns cost_usd (and optionally requests / month%)
node scripts/go.mjs run --tool-status authorized --console-cost <usd> \
  --console-requests <n> --month-pct <pct> --out run.json
```

A number the user read off the Console page goes in the same flags — it is
evidence, not a claim, and only then does the basis say `Console bill`.

## Risks the report must name, where they apply

The data says which models owe a caveat: `data.candidates[].promo`,
`promoUntil` and `peak`. `report` prints those bullets, and `check` pins them
word for word because they carry the dates, the multiplier and the hour windows.
Keep them as they are — add your own sentence underneath if the user's wording
helps, but never edit or drop a rendered line. A picked model that carries one of
these facts and no bullet fails the gate. When no picked model carries one, no
caveat line is owed, and filler is worse than silence.

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
- Caveats — only wording of your own, added underneath the rendered bullets; the
  risks above, in the user's words, never in place of the rendered line.
- The two mode questions on a first run (see *The mode question*), then
  `question` before any write.
