---
name: opencode-go-model-picker
description: "Choose or rebalance which OpenCode Go model each **custom** OpenCode agent/subagent uses, against the LATEST Go plan (models, limits, promos), optimizing cost and resilience. Use when the user asks to pick/tune/optimize agent models for OpenCode Go, asks whether the current agent model config still fits the Go plan, or wants a paste-ready preset or agent model block. Custom agents only — native, oh-my-opencode-slim, or plugin-injected; OpenCode's built-ins are skipped. Read-only by default: never edits config without preview and explicit confirmation."
license: GPL-3.0-or-later
compatibility: opencode
metadata:
  version: "1.3.0"
  requires: "OpenCode with agent config support; oh-my-opencode-slim supported but optional (one source among several); Node.js 18+ for the optional catalog fetcher"
  homepage: "https://github.com/sogeisetsu/opencode-go-model-picker"
  source: "https://github.com/sogeisetsu/opencode-go-model-picker"
---

# OpenCode Go Model Picker

Assign the most cost-effective **OpenCode Go** model to each **custom** agent — native, oh-my-opencode-slim, or plugin-injected — with fallback chains, based
on the **current** Go plan (which changes often: fetch fresh every run). OpenCode's own built-ins are skipped and that set changes between
versions, so the rule is "anything OpenCode ships is skipped", not a fixed list.

## Iron Rules

1. **Never invent prices, limits, or model IDs.** Every number: a fetched source (`references/data-sources.md`) + its **fetch date**; unverifiable → mark
   for manual verification. A cached value (`references/model-snapshot.md`) counts only with source + fetch date; re-fetch when stale. If plan pages or
   rankings cannot be fetched, the committed seeds (`references/model-prices.json`, `references/model-scores.json`)
   are the dated offline fallback — label them a seed, never present them as current.
2. **Read-only by default.** Do NOT edit any agent config — `opencode.jsonc`, `opencode.json`, `oh-my-opencode-slim.json`, or files under
   `~/.config/opencode/agents/` / `.opencode/agents/`. Preview; apply only after the user confirms via the `question` tool, then show the exact change.
3. **Schema-accurate per source.** Match the schema of the source you are reading: slim → the *installed* `oh-my-opencode-slim.schema.json`; native agents →
   the official OpenCode config/agent docs.
4. **Explain cost vs. capability per agent** — and compare **throughput**, not price alone: equal monthly $ limits serve very different
   request counts, so report estimated requests per 5h (`references/data-sources.md` §Estimated request counts (throughput)); prefer the higher one on a tie.
5. **Verify capabilities from the lab, not the name.** Especially **vision/image input** (`observer`, `vision` traits): confirm modalities in the model's own
   official docs — the Go image note is partial. Never infer vision/reasoning/long context from a model id; re-check every run (new models add modalities).
   Procedure: `references/data-sources.md` §Capability verification (esp. vision).
6. **Surface caveats, never bury them.** Per pick flag: (a) a **limited-time multiplier** and its fallback base limit; (b) **geo-restricted** models and
   whether the user's region is covered; (c) **privacy-for-discount / Contributor** tiers that train on prompts/completions — opt-in only, never
   recommended silently.

## Scope & Sources

Only **custom** agents are in scope — skip OpenCode's built-ins; that set changes between versions. Sources to try:

- **native** — `opencode.json` / `opencode.jsonc` `agent.<name>`; `~/.config/opencode/agents/*.md`; `.opencode/agents/*.md` (plural `agents/`).
- **slim** — `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc`), `presets.<preset>.<agent>`, validated against the installed schema.
- **plugin** — any other plugin that injects `config.agent`; only when declared or discovered, never assumed.

Adapters, inventory record, trait derivation, missing-source fallback, per-source schema notes: `references/agent-sources.md`.

All `scripts/…` and `references/…` paths in this skill are relative to **this skill's own directory** (e.g.
`~/.config/opencode/skills/opencode-go-model-picker/`), not the user's project cwd.

## Run Workflow

1. **Discover agents (read-only).** Run the adapters in `references/agent-sources.md`, build the inventory, report warnings (missing source/description,
   duplicate names) instead of dropping records. `node scripts/discover-agents.mjs` prints that inventory and its chain-validation warnings as compact JSON — run it instead of hand-reading the config files.
2. **Refresh the snapshot.** At run start run `node scripts/refresh-snapshot.mjs`; refresh scores only when `sources.rankings.fetchedAt` is missing or older
   than 1 day (`node scripts/refresh-scores.mjs --snapshot <path>`); refresh prices every run (`node scripts/refresh-prices.mjs --snapshot <path>`). Flags,
   TTL rationale, key-ownership and offline fallbacks: `references/model-snapshot.md`. Fetch fresh from `https://opencode.ai/go` (most timely: promos + est.
   requests/5h) and `https://opencode.ai/docs/go/` (authoritative model/price/limit table); full endpoint list, priorities and parsing notes:
   `references/data-sources.md`. Build this run's snapshot per `references/data-sources.md` §Snapshot shape. To consume the snapshot, run
   `node scripts/snapshot-summary.mjs` (compact digest; `--ids`, `--trait`, `--json`) instead of reading `snapshot.json` whole.
3. **Detect plan changes** vs. the last snapshot: new/removed models, changed limits/prices/req counts, promos — call these out first;
   deep-verify only added/changed models.
4. **Allocate models per agent** by **trait** (policy below) **under the selected recommendation mode** (default `balanced`), applying the known-role overrides.
   - **Dominance check (closing action of this step).** For every slot of every proposed chain, using this run's snapshot on one consistent metric set:
     - price — the same source's monthly $ limit and $/1M; a promo-only advantage is promo-dependent and must not be compared against a base price;
     - throughput — est req/5h;
     - capability — the ELO board matching the agent's trait (coding → coding, vision → vision, otherwise overall); a missing value means "not
       comparable", so dominance cannot be claimed.
     Model A dominates model B when A is no worse than B on every axis and strictly better on at least one. If a dominated model is kept in a
     recommended chain, the `why` column must state the reason (e.g. cross-provider quota fallback); otherwise replace it with the dominator. This
     does not change the Iron Rules.
5. **Build fallback chains** where the source supports them (policy below).
6. **Output** exactly per `references/output-format.md`: `Recommendation table`, `Paste-ready config`, `Highlights`, then a `Data appendix`.
7. **STOP** — 🛑 no configuration writes before the user confirms (see "Applying Changes" below).

## Recommendation Modes

Pick exactly one mode; default `balanced`. Modes trade off **performance vs. price only**.

| Mode | Tradeoff | Per-trait selection rule | Fallback shape |
|---|---|---|---|
| `budget` | cheapest acceptable | lowest-cost model clearing the trait's capability floor, favoring a large monthly limit | cheapest Go → next-cheapest Go → free/different provider |
| `balanced` (default) | best cost-effectiveness | match monthly $ limit to expected volume; balance price vs. capability; apply the **balanced price ceiling** below | best fit → cheaper Go → different provider |
| `quality` | maximum capability | strongest reasoning/capability model on Go for the trait; cost is secondary | strongest → next-strongest → different provider |

Capability floors in **every** mode: `vision` needs image input **verified in the lab's docs**, never a cheap text-only model;
`reasoning`/`orchestration` under `budget` must still be reasoning-capable; chains keep the 2–4 entry rule.

### Balanced price ceiling

Baseline = the current cheap-but-capable Go model — **re-check it each run; never hardcode an id**. The priciest pick for a normal, high-volume agent should
sit only slightly above that baseline and be clearly more capable; if none qualifies, recommend the baseline itself. Capability-critical but **rarely used**
agents may exceed it — say so and justify the extra price. `balanced`-only: `budget` goes cheaper, `quality` ignores it.

### Choosing a mode on first run

Resolution order — stop at the first answer:

1. Request names a mode → use it.
2. `snapshot.preferences.mode` is set → reuse it silently.
3. Otherwise ask **two** questions with the `question` tool — main goal (weighted **0.7**) and main task (**0.3**, only refines the goal) — each offering a
   "you decide / just use balanced" escape; resolve with the table in `references/output-format.md`.
4. Diagnostic skipped or refused → default `balanced`.

Persist to `snapshot.preferences` (`mode`, `answers`, `chosenAt`); never re-ask once remembered — a later named mode overrides it, and the user can reset.
State the chosen mode in the report and, when not the default, why.

## Allocation Policy (trait → model traits)

Traits are derived per `references/agent-sources.md`; the overrides below are explicit and win over inferred traits.

| Trait | Needs | Prefer |
|---|---|---|
| orchestration | planning + judgment, runs every turn | strong-but-affordable, large monthly limit, `variant: high`/`thinking` |
| reasoning | top reasoning / hard debug / review | strongest reasoning model |
| cheap-high-volume | cheap + fast, high volume | cheapest with large limit |
| coding | reliable scoped coding | mid coding model |
| frontend | UI/UX + visual polish | model strong at frontend |
| vision | **vision-capable** | only models whose **image input is verified in the lab's docs this run** (Iron Rule 5) |
| diversity | diverse judgments | distinct strong models across providers |

Explicit overrides (win over inferred traits): `orchestrator`→orchestration, `oracle`→reasoning, `explorer`/`librarian`→cheap-high-volume, `fixer`→coding,
`designer`→frontend, `observer`→vision, `council`/`councillor`/`councillor-*`→diversity. Unknown agents → inferred traits → conservative balanced chain.

Cost tiers (recompute from fetched prices): *cheap* = low $/1M + large monthly limit; *premium* = high reasoning, smaller monthly limit. Match **monthly $
limit** to expected volume; tie-break on **throughput**: equal dollar limits → the higher estimated requests per 5h wins.

## Fallback Chain Policy

Where the source supports an ordered array — `model: [a, b, c]` — it is a **failover chain**:

- `[0]` = best fit for the role.
- `[1]` = a **cheaper/faster** Go model (cost buffer; Go limits are per-model, so another Go model still works when the primary is capped).
- `[2]` = a **different provider** fallback (e.g. free `opencode/*`) for quota resilience.
- 2–4 entries; never exceed 4. Do not duplicate a model id.
- If **all** entries fail the session aborts — always end on a model the user can rely on.

Sources whose `model` is a single value (native `agent.<name>.model`) get one model plus an explicit note instead of an invented array. Emit a chain whenever
the tool supports one; suggesting `oh-my-opencode-slim` is only a suggestion, not a requirement.

## Failure Handling

On any failure: never improvise numbers (Iron Rule 1); use the dated seed/cache fallbacks with their own dates; if a symptom is not covered in the references'
§Failure handling, report it to the user before improvising. Per-symptom branches live in `references/model-snapshot.md` §Failure handling and
`references/data-sources.md` §Failure handling — read the relevant one when a fetch or refresh fails.

## Applying Changes (only after confirmation)

🛑 **STOP — no configuration writes before the user confirms.**

1. Show the exact block (a slim preset entry, or a native `agent.<name>` entry) and which keys change.
2. Preserve every other agent, preset, and top-level key; keep JSON/JSONC valid.
3. Confirm with the `question` tool **and** let the user pick the target — a slim preset file or a native `opencode.jsonc` / agent Markdown file — then write
   only the intended block.
4. Tell the user: applies on the next OpenCode run/restart; verify with `opencode models --refresh`, `/models`, and `opencode debug config`.

## References — read when

| File | Open it when | What you get |
|---|---|---|
| `references/agent-sources.md` | discovering agents / deriving traits | adapters, inventory, trait derivation, overrides, missing-source fallback, schema notes |
| `references/data-sources.md` | fetching/verifying plan data | endpoints + parsing notes, §Snapshot shape, §Estimated request counts (throughput), §Capability verification (esp. vision), §Failure handling |
| `references/model-snapshot.md` | refreshing/reading the cache | schema/location, refresh flags + TTL rationale, seed ownership, offline fallbacks, §Failure handling |
| `references/output-format.md` | writing the report / resolving first-run mode | report body + `Data appendix`, the apply gate, the mode-resolution table |
| `references/model-prices.json` | live price fetch fails | dated offline price seed — label it a seed, never current |
| `references/model-scores.json` | ranking fetch fails (seed reused while dates match) | dated LMArena score seed |
| `scripts/` | refreshing run data, or maintaining the repo | run-time: `fetch-go-models.mjs`, `refresh-snapshot/scores/prices.mjs`, `discover-agents.mjs`, `snapshot-summary.mjs` · maintainer-only: `generate-assets.mjs`, `check-docs.mjs` |
