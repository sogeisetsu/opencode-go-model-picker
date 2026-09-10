---
name: opencode-go-model-picker
description: Choose or rebalance which models each oh-my-opencode-slim agent/subagent uses against the LATEST OpenCode Go plan (models, usage limits, limited-time promos), optimizing cost-effectiveness and resilience. Use when the user asks to pick/tune/optimize agent models for OpenCode Go, asks whether the current agent model config still fits the current Go plan, or wants a paste-ready oh-my-opencode-slim preset block. Read-only by default: it fetches the plan, produces recommendations with fallback chains, and never edits config without a preview and explicit confirmation.
---

# OpenCode Go Model Picker

Assign the most cost-effective **OpenCode Go** model to each oh-my-opencode-slim
agent, with sensible fallback chains, based on the **current** Go plan. The Go
plan changes often (per-model monthly limits, limited-time usage multipliers,
new/retired models), so always fetch fresh data before recommending.

## Iron Rules

1. **Never invent prices, limits, or model IDs.** Every number must come from a
   fetched source (see `references/data-sources.md`) and be reported with its
   **fetch date**. Anything unverifiable is written `需人工核实`.
2. **Read-only by default.** Do NOT edit `oh-my-opencode-slim.json`,
   `opencode.jsonc`, or any config. Produce a preview; apply only after the user
   confirms (use the `question` tool), then show the exact change.
3. **Schema-accurate.** Match the *installed* plugin version's schema (see
   "Schema" below), not a random online doc.
4. **Explain cost vs. capability per agent**, not just model names.
5. **Verify capabilities from the lab, not the name.** Especially **vision/image
   input** (needed by `observer`): confirm modalities in the model's own official
   docs (e.g. DeepSeek `https://api-docs.deepseek.com/quick_start/pricing/`) and
   models.dev. The Go docs' image note names only some vision models. Never infer
   vision — or reasoning/long-context — from a model id. Re-check capability each
   run: new models add modalities.

## Data Sources (fetch fresh every run)

Full list, endpoints and parsing notes: `references/data-sources.md`.

Minimum set:
- `https://opencode.ai/go` — most timely (promos, "4× usage", featured usage table).
- `https://opencode.ai/docs/go/` (anchor `#usage-limits`) — full model + price + monthly-limit table.
- `https://opencode.ai/zen/go/v1/models` — live catalog (unauthenticated); run `node scripts/fetch-go-models.mjs`.
- Cross-check: `https://models.opencode.ai/providers/opencode-go/`, `https://julien.cloud/opencode-go-models/`.

## Workflow

1. **Read current setup (read-only).**
   - Preset + agent blocks: `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc` if present).
   - Providers: `~/.config/opencode/opencode.jsonc`.
   - Installed plugin schema: `~/.cache/opencode/packages/oh-my-opencode-slim@*/node_modules/oh-my-opencode-slim/oh-my-opencode-slim.schema.json`.
2. **Fetch the plan** and build a snapshot:
   `model id | input $/1M | output $/1M | monthly $ limit | est. req/5h | context | reasoning | vision | status | source+date`.
3. **Detect plan changes** vs. the last snapshot (if any): new/removed models,
   changed limits/prices, limited-time promos. Call these out first.
4. **Allocate models per agent** (policy below).
5. **Build fallback chains** (policy below).
6. **Output** exactly per `references/output-format.md`, then **stop and ask**
   before applying anything.

## Allocation Policy (role → traits)

| Agent | Needs | Prefer |
|---|---|---|
| orchestrator | planning + judgment, runs every turn | strong-but-affordable, large monthly limit, `variant: high`/`thinking` |
| oracle | top reasoning / hard debug / review | strongest reasoning model |
| explorer | cheap + fast, high volume | cheapest with large limit |
| librarian | cheap + fast research | cheapest with large limit |
| fixer | reliable scoped coding | mid coding model |
| designer | UI/UX + visual polish | model strong at frontend |
| observer | **vision-capable** | only models whose **image input is verified in the lab's docs**. Verified 2026-09-10: **`mimo-v2.5` (preferred — cheapest output, real $60 limit, native image/video/audio)**, `deepseek-flash`, `deepseek-v4-flash-vision-exp` |
| council / councillor | diverse judgments | distinct strong models across providers |

Cost tiers (recompute from fetched prices): *cheap* = low $/1M + large monthly
limit; *premium* = high reasoning, small monthly limit. Prefer models whose
**monthly $ limit** matches the agent's expected volume.

## Fallback Chain Policy

An array `model: [a, b, c]` is an **ordered failover chain** (verified against
oh-my-opencode-slim 2.2.x source: `ForegroundFallbackManager`). Rules:
- `[0]` = best fit for the role.
- `[1]` = a **cheaper/faster** Go model (cost buffer). Go limits are per-model, so
  a different Go model is still usable when the primary is capped.
- `[2]` = a **different provider** fallback (e.g. a free `opencode/*` model) for
  quota resilience.
- 2–4 entries; never exceed 4. Do not duplicate a model id.
- If **all** entries fail the session is aborted — so always end on a model the
  user can actually rely on.

## Schema Notes

- 2.2.x: `presets.<preset>.<agent>.model` accepts `string | (string | {id, variant})[]`;
  `fallback.enabled` (default true) + `fallback.maxRetries` (default 3).
- Other/newer builds may add `fallback.chains.<agent>`. Always read the installed
  `oh-my-opencode-slim.schema.json` and mirror it.

## Applying Changes (only after confirmation)

1. Show the exact preset block and which keys change.
2. Preserve every other agent, preset, and top-level key; keep JSON/JSONC valid.
3. Confirm with the `question` tool, then write only the intended block.
4. Tell the user: applies on the next OpenCode run/restart; verify with
   `opencode models --refresh`, `/models`, and `opencode debug config`.

## Provenance

Built after surveying existing options (2026-09): no official or well-known skill
does plan-aware OpenCode Go agent model selection. Closest analogs: the dashboard
generator `itsmylife44/cliproxyapi-dashboard`
(`oh-my-opencode-slim-config-generator.tsx`, MIT) and the cost-profile request in
`code-yeongyu/oh-my-openagent#1768`. Official Go data sources plus
oh-my-opencode-slim's static per-agent role guidance are reused here.
