---
name: opencode-go-model-picker
description: "Choose or rebalance which OpenCode Go model each **custom** OpenCode agent/subagent uses, against the LATEST Go plan (models, usage limits, limited-time promos), optimizing cost-effectiveness and resilience. Supports multiple agent sources - native agents (the `agent` key in opencode.json/opencode.jsonc and Markdown files under ~/.config/opencode/agents/ or .opencode/agents/), oh-my-opencode-slim presets, and other plugins that inject agents. OpenCode's own built-in agents (including but not limited to build, plan, and the built-in subagents) are left alone. Use when the user asks to pick/tune/optimize agent models for OpenCode Go, asks whether the current agent model config still fits the current Go plan, or wants a paste-ready preset or agent model block. Read-only by default: it fetches the plan, produces recommendations with fallback chains, and never edits config without a preview and explicit confirmation."
license: GPL-3.0-or-later
compatibility: opencode
metadata:
  version: "0.1.0"
  requires: "OpenCode with agent config support; oh-my-opencode-slim 2.2.x supported but optional (one source among several); Node.js 18+ for the optional catalog fetcher"
  homepage: "https://github.com/sogeisetsu/opencode-go-model-picker"
---

# OpenCode Go Model Picker

Assign the most cost-effective **OpenCode Go** model to each **custom** agent in
your OpenCode setup — native agents, oh-my-opencode-slim presets, or other plugins
that inject agents — with sensible fallback chains, based on the **current** Go
plan. OpenCode's own built-in agents (including but not limited to `build`,
`plan`, and the built-in subagents) are not tuned; which agents ship with OpenCode
can change between versions, so the rule is "anything OpenCode ships is skipped",
not a fixed list. The Go plan changes often
(per-model monthly limits, limited-time usage multipliers, new/retired models), so
always fetch fresh data before recommending.

## Iron Rules

1. **Never invent prices, limits, or model IDs.** Every number must come from a
   fetched source (see `references/data-sources.md`) and be reported with its
   **fetch date**. Anything unverifiable is marked for manual verification. A cached value
   (see `references/model-snapshot.md`) counts only while it carries its source
   and fetch date, and is re-fetched when stale. If the plan pages cannot be
   fetched at all, the committed price seed (`references/model-prices.json`) may
   be used as a dated fallback — it must be labelled a seed rather than a live
   fetch, and its numbers must never be presented as current.
2. **Read-only by default.** Do NOT edit any agent config — `opencode.jsonc`,
   `opencode.json`, `oh-my-opencode-slim.json`, or files under
   `~/.config/opencode/agents/` / `.opencode/agents/`. Produce a preview; apply
   only after the user confirms (use the `question` tool), then show the exact
   change.
3. **Schema-accurate per source.** Match the schema of the source you are reading
   (see `references/agent-sources.md`), not a random online doc. For
   oh-my-opencode-slim use the *installed* `oh-my-opencode-slim.schema.json`; for
   custom native agents use the official OpenCode config/agent docs.
4. **Explain cost vs. capability per agent**, not just model names — and compare
   **throughput**, not price alone. Two models with the same monthly $ limit can
   serve very different numbers of requests, so report the estimated requests per
   5h (see `references/data-sources.md`) and prefer the higher one when price and
   capability tie.
5. **Verify capabilities from the lab, not the name.** Especially **vision/image
   input** (needed by `observer`, or any `vision`-trait agent): confirm
   modalities in the model's own official docs (e.g. DeepSeek
   `https://api-docs.deepseek.com/quick_start/pricing/`) and models.dev. The Go
   docs' image note names only some vision models. Never infer vision — or
   reasoning/long-context — from a model id. Re-check capability each run: new
   models add modalities.
6. **Surface caveats, never bury them.** Flag, per pick: (a) any **limited-time
   multiplier** it depends on, with the base limit it falls back to; (b)
   **geo-restricted** models, and whether the user's region is covered; (c)
   **privacy-for-discount / Contributor** tiers that train on the user's prompts
   and completions — opt-in only, never recommended silently.

## Agent Sources (discover read-only every run)

The skill is source-agnostic. Read `references/agent-sources.md` for the adapter
interface, the uniform inventory record, the role-trait mapping, and fallback
when a source is missing. Only **custom** agents are in scope: skip OpenCode's
built-in agents (including but not limited to `build`, `plan`, `general`,
`explore`, `scout`, and the hidden `compaction`/`title`/`summary`; the exact set
can change between OpenCode versions). Minimum set of sources to try:

- **native** — `opencode.json` / `opencode.jsonc` `agent.<name>`;
  `~/.config/opencode/agents/*.md`; `.opencode/agents/*.md` (note: plural
  `agents/`).
- **slim** — `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc`),
  `presets.<preset>.<agent>`, validated against the installed schema.
- **plugin** — any other plugin that injects `config.agent`; only when declared
  or discovered, never assumed.

## Snapshot Cache (token saving)

A persistent, normalized snapshot of the Go catalog and model scores lives at
`~/.cache/opencode/opencode-go-model-picker/snapshot.json` (see
`references/model-snapshot.md`). Refresh strategy:

- Run `node scripts/refresh-snapshot.mjs` — it fetches the live catalog, diffs the
  ids (`added` / `removed`), and prints a compact JSON diff.
- Refresh **LMArena** scores only when `sources.rankings.fetchedAt` is missing or
  older than 1 day, using `node scripts/refresh-scores.mjs --snapshot <path>` (no
  key, no browser). It reuses the committed `references/model-scores.json` seed
  when its `source.publishDates` still match the live boards, and otherwise
  fetches them. `costPerSuccessfulTaskUsd` is always `null` (LMArena has no cost
  column). The script auto-enables the system proxy when one is configured.
- Refresh prices with `node scripts/refresh-prices.mjs --snapshot <path>`; the
  committed `references/model-prices.json` is the offline fallback, read
  directly when the plan pages or models.dev are unreachable. Live prices and
  limits always win over cached or seed values.
- The TTL only throttles re-checking models whose score is already cached: a
  newly added or changed model always gets a fresh score lookup, and a major plan
  change (many added/removed models) or an explicit user request forces a full
  refresh. Catalog and prices refresh every run, so plan changes are caught
  immediately.
- Prices and limits are read each run, but only the added or changed models get a
  deeper capability check — that is what keeps runs cheap. Every cached value
  keeps its source and fetch date; stale values are re-fetched rather than
  trusted.

## Data Sources (fetch fresh every run)

Full list, endpoints and parsing notes: `references/data-sources.md`.

Minimum set:
- `https://opencode.ai/go` — most timely (promos, "4× usage", featured usage table **with estimated requests per 5h**).
- `https://opencode.ai/docs/go/` (anchor `#usage-limits`) — full model + price + monthly-limit table, plus the "Estimated requests" assumptions and per-model req/5h / week / month.
- `https://opencode.ai/zen/go/v1/models` — live catalog (unauthenticated); run `node scripts/fetch-go-models.mjs`.
- Ranking scores: `node scripts/refresh-scores.mjs` (LMArena via the HF datasets-server; committed seed at `references/model-scores.json`) — no key, no browser.
- Machine-readable prices: `node scripts/refresh-prices.mjs` (models.dev provider `opencode-go`) — reuses the committed seed `references/model-prices.json` while each model's `upstreamUpdatedAt` still matches models.dev.
- Cross-check: `https://models.opencode.ai/providers/opencode-go/`, `https://julien.cloud/opencode-go-models/`.

## Workflow

1. **Discover agents (read-only).** Run the source adapters from
   `references/agent-sources.md` and build the inventory:
   `name | source | mode | description | model | hidden | traits | provenance`.
   Report warnings (missing source, missing description, duplicate names) rather
   than dropping records.
2. **Read the snapshot cache and refresh it cheaply.** Read
   `~/.cache/opencode/opencode-go-model-picker/snapshot.json`, run
   `node scripts/refresh-snapshot.mjs`, and read the compact diff (see
   `references/model-snapshot.md`). The script reports `added` / `removed`
   catalog ids; prices and limits come from the plan pages and are compared with
   the cached values. Prices and limits can additionally be refreshed with
   `scripts/refresh-prices.mjs`, and the committed seed
   (`references/model-prices.json`) is the offline fallback when the pages are
   unreachable. If `sources.rankings.fetchedAt` is missing or older than 1
   day, run `node scripts/refresh-scores.mjs --snapshot <path>` (reuses the
   committed seed when current; no key, no browser). Deep-verify capabilities (especially
   vision) only for the added or changed models. Build this run's snapshot:
   `model id | input $/1M | output $/1M | monthly $ limit | est. req/5h | est. req/week | est. req/month | context | reasoning | vision | status | source+date`.
3. **Detect plan changes** vs. the last snapshot (if any): new/removed models,
   changed limits/prices/estimated request counts, limited-time promos. Call these
   out first.
4. **Allocate models per agent** by **trait** (policy below) **under the selected
   recommendation mode** (see "Choosing a mode on first run" below; default
   `balanced`), using the known-role overrides for backward compatibility.
5. **Build fallback chains** where the source supports them (policy below).
6. **Output** exactly per `references/output-format.md`, then **stop and ask**
   before applying anything.

## Recommendation Modes

Pick exactly one mode from the user's request; default `balanced`. The modes trade
off **performance vs. price only** — no other dimensions.

| Mode | Tradeoff | Per-trait selection rule | Fallback shape |
|---|---|---|---|
| `budget` | cheapest acceptable | the lowest-cost model that still clears the trait's capability floor, favoring a large monthly limit | cheapest Go → next-cheapest Go → free/different provider |
| `balanced` (default) | best cost-effectiveness | match the model's monthly $ limit to the agent's expected volume; balance price vs. capability; apply the **balanced price ceiling** below | best fit → cheaper Go → different provider |
| `quality` | maximum capability | the strongest reasoning/capability model on Go for the trait; cost is secondary (limits still apply) | strongest → next-strongest → different provider |

Capability floors apply in **every** mode:

- `vision` always requires image input **verified in the lab's docs** — a cheap
  text-only model is never acceptable here.
- `reasoning` / `orchestration` under `budget` must still be reasoning-capable;
  the absolute cheapest text model is not acceptable.
- Chains keep the 2–4 entry rule from the Fallback Chain Policy below.

### Balanced price ceiling

In `balanced`, use the current cheap-but-capable Go model — **DeepSeek V4.1 Flash**
at the time of writing; re-check each run, the id may change — as the baseline:

- For a normal, high-volume agent, the **most expensive model you recommend should
  be only slightly pricier than that baseline and clearly more capable**. "Clearly"
  means a real capability gain, not a marginal one.
- If no model is "slightly pricier and clearly more capable", recommend the
  baseline itself.
- Capability-critical but **rarely used** agents (for example a hard debug/review
  lane) may go above the ceiling, but you must say so and justify the extra price.
  Price still matters in `balanced` — that is the mode's whole point.
- This ceiling is `balanced`-only: `budget` goes cheaper, and `quality`
  deliberately ignores it.

### Choosing a mode on first run

Resolve the mode in this order; do not ask when an earlier step answers it:

1. **Request names a mode** → use it.
2. **Remembered** → if `snapshot.preferences.mode` is set, reuse it silently.
3. **First run, no mode** → run a short diagnostic of **two** questions with the
   `question` tool, each offering a "you decide / just use balanced" escape.
   - **Q1 — Main goal** (the primary signal, weight 0.7): save money → `budget`;
     best value → `balanced`; strongest capability → `quality`.
   - **Q2 — Main task** (weight 0.3, only refines Q1): simple / mechanical or
     high-volume → lean cheaper; coding, hard reasoning & review, vision, or a
     mixed load → lean toward capability.
   Resolve the two answers with this table; an answer of "you decide" counts as
   skipped:

   | Q1 goal (0.7) | Q2 task (0.3) | Mode |
   |---|---|---|
   | save money | any | `budget` |
   | best value | simple / high-volume | `balanced` |
   | best value | coding / hard reasoning / vision / mixed | `balanced` (the balanced price ceiling may be exceeded for a capability-critical, rarely used lane — say why) |
   | strongest capability | any | `quality` |
   | skipped | simple / high-volume | `budget` |
   | skipped | any other / skipped | `balanced` |

   Persist the result to `snapshot.preferences` (`mode`, `answers`, `chosenAt`).
4. **Diagnostic skipped or refused** → `balanced`.

Never ask again once a mode is remembered; a mode named in a later request always
overrides it, and the user can ask to reset the remembered choice.

State the chosen mode in the report (see `references/output-format.md`), and when
it was not the default, say why.

## Allocation Policy (trait → model traits)

Traits are derived per `references/agent-sources.md`; known-role overrides win.

| Trait | Needs | Prefer |
|---|---|---|
| orchestration | planning + judgment, runs every turn | strong-but-affordable, large monthly limit, `variant: high`/`thinking` |
| reasoning | top reasoning / hard debug / review | strongest reasoning model |
| cheap-high-volume | cheap + fast, high volume | cheapest with large limit |
| coding | reliable scoped coding | mid coding model |
| frontend | UI/UX + visual polish | model strong at frontend |
| vision | **vision-capable** | only models whose **image input is verified in the lab's docs**. Verified 2026-09-10: **`mimo-v2.5` (preferred — cheapest output, real $60 limit, native image/video/audio)**, `deepseek-flash`, `deepseek-v4-flash-vision-exp` |
| diversity | diverse judgments | distinct strong models across providers |

Known-role overrides: `orchestrator`→orchestration, `oracle`→reasoning,
`explorer`/`librarian`→cheap-high-volume, `fixer`→coding, `designer`→frontend,
`observer`→vision, `council`/`councillor`/`councillor-*`→diversity. Unknown
agents fall back to inferred traits, then to a conservative balanced chain.

Cost tiers (recompute from fetched prices): *cheap* = low $/1M + large monthly
limit; *premium* = high reasoning, small monthly limit. Prefer models whose
**monthly $ limit** matches the agent's expected volume. Tie-break on
**throughput**: for the same $ limit, prefer the model with the higher estimated
requests per 5h, since equal dollar limits do not mean equal request counts.

## Fallback Chain Policy

Where the source supports an ordered array — oh-my-opencode-slim 2.2.x
`model: [a, b, c]`, verified against `ForegroundFallbackManager` — the array is a
**failover chain**. Rules:
- `[0]` = best fit for the role.
- `[1]` = a **cheaper/faster** Go model (cost buffer). Go limits are per-model, so
  a different Go model is still usable when the primary is capped.
- `[2]` = a **different provider** fallback (e.g. a free `opencode/*` model) for
  quota resilience.
- 2–4 entries; never exceed 4. Do not duplicate a model id.
- If **all** entries fail the session is aborted — so always end on a model the
  user can actually rely on.

Sources whose `model` is a single value (native OpenCode `agent.<name>.model`)
cannot express a chain: recommend one model and say so explicitly instead of
inventing an array. If the user's tool supports ordered chains —
`oh-my-opencode-slim` or any other chain-capable tool/plugin — emit a chain.
Suggesting `oh-my-opencode-slim` is only a suggestion, not a requirement.

## Schema Notes (per source)

- **native**: `agent.<name>` accepts `description` (required), `mode`
  (`primary`/`subagent`/`all`, default `all`), `model` (`provider/model-id`),
  `prompt`, `temperature`, `steps`, `top_p`, `permission` (including `task`),
  `hidden` (subagent only). Markdown agents mirror these in YAML frontmatter.
  `tools` is deprecated — prefer `permission`.
- **oh-my-opencode-slim** 2.2.x: `presets.<preset>.<agent>.model` accepts
  `string | (string | {id, variant})[]`; `fallback.enabled` (default true) +
  `fallback.maxRetries` (default 3). Other/newer builds may add
  `fallback.chains.<agent>`. Always read the installed schema and mirror it.
- Always read the relevant source before writing, and mirror its actual shape.

## Applying Changes (only after confirmation)

1. Show the exact block (a slim preset entry, or a native `agent.<name>` entry)
   and which keys change.
2. Preserve every other agent, preset, and top-level key; keep JSON/JSONC valid.
3. Confirm with the `question` tool **and** let the user pick the target — a slim
   preset file or a native `opencode.jsonc` / agent Markdown file — then write
   only the intended block.
4. Tell the user: applies on the next OpenCode run/restart; verify with
   `opencode models --refresh`, `/models`, and `opencode debug config`.

## Provenance

Built after surveying existing options (2026-09): no official or well-known skill
does plan-aware OpenCode Go agent model selection. Closest analogs: the dashboard
generator `itsmylife44/cliproxyapi-dashboard`
(`oh-my-opencode-slim-config-generator.tsx`, MIT) and the cost-profile request in
`code-yeongyu/oh-my-openagent#1768`. Official Go data sources plus
oh-my-opencode-slim's static per-agent role guidance are reused here. Agent
discovery was later generalized beyond oh-my-opencode-slim (native OpenCode
agents and other plugins) — see `references/agent-sources.md`.

## License

Copyright (C) 2026 sogeisetsu. Licensed under the **GNU General Public
License v3.0 or later** (`GPL-3.0-or-later`). This skill is free software: you may
redistribute it and/or modify it under the terms of the GPL, either version 3 or
(at your option) any later version, with NO WARRANTY. See [`LICENSE`](LICENSE) for
the authoritative text, or [`zh/LICENSE-ZH.md`](zh/LICENSE-ZH.md) for an unofficial
Chinese reference translation.
