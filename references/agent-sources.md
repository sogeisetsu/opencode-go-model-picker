# Agent Sources

How this skill discovers agents across sources and normalizes them into one
inventory. The skill is **not tied to a single plugin**: any **custom** agent
OpenCode can address by name is in scope.

Sections:

- Why this exists
- Sources
- Built-in agents are out of scope
- Adapter interface, inventory record, and per-source schema fields
- Role-trait mapping and known-role overrides
- Precedence and duplicates
- Missing or unreadable source — fallback
- Provenance

## Why this exists

OpenCode merges **all** agent definitions — built-in, native (JSON and Markdown),
and plugin-injected — into a single `agent` registry. `oh-my-opencode-slim` is
just one writer into that registry: at load time it does
`opencodeConfig.agent = { ...agents }`. So instead of hardcoding one plugin's
role names, this skill discovers agents through **source adapters** and maps
every agent onto a uniform record.

Agent mechanics below are verified against the official OpenCode docs
(`https://opencode.ai/docs/agents/`, page updated 2026-09-11) and the installed
`oh-my-opencode-slim@2.2.18` package, both read 2026-09-13.

## Sources

| Source id | Where agent definitions live | Notes |
|---|---|---|
| `native` | `opencode.json` / `opencode.jsonc` under the `agent.<name>` key; global Markdown at `~/.config/opencode/agents/*.md`; project Markdown at `.opencode/agents/*.md` | The Markdown filename is the agent name. The directory is **plural** (`agents/`). |
| `slim` | `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc`) → `presets.<preset>.<agent>` | One preset is active via the top-level `preset` key. Validate against the installed `oh-my-opencode-slim.schema.json`. |
| `plugin:<name>` | Any other plugin that injects `config.agent` | Not auto-enumerated. The user declares it, or the skill reports that such a source may exist but was not read. |

`slim` (and any other chain-capable plugin source) supports an ordered chain
(`model: [a, b, c]`); native `agent.<name>.model` takes one model — the chain
policy itself is in `SKILL.md` §Fallback Chain Policy. A custom agent configured
only with a single model, not registered in any chain-capable tool, is still in
scope.

## Built-in agents are out of scope

Only suggest models for **custom** agents. Skip anything OpenCode ships, even
though it appears in the same registry. Examples include but are not limited to:

- primary agents: `build`, `plan`
- built-in subagents: `general`, `explore`, `scout`
- hidden system agents: `compaction`, `title`, `summary`

The exact set changes between OpenCode versions, so treat this as "OpenCode's own
agents are skipped", not a fixed list — re-check the official Agents docs when in
doubt (verified 2026-09-11). Everything else is in scope: custom native agents
(any name you define) and plugin agents (such as `oh-my-opencode-slim`'s).

## Adapter interface

```text
AgentSource {
  id:        "native" | "slim" | "plugin:<name>",
  detect(root)   -> boolean,
  discover(root) -> { records: AgentInventoryRecord[], warnings: string[] }
}
```

Rules:

- `detect` never throws. A missing or unparseable source returns `false` plus a
  warning; it is not a fatal error.
- `discover` is **read-only**. It never edits the source.
- Adapters are independent: one failing source must not abort the others.

## Inventory record

```text
AgentInventoryRecord {
  name:        string,      // exact callable name (Task subagent_type / @mention)
  source:      "native" | "slim" | "plugin:<name>",
  mode:        "primary" | "subagent" | "all",
  description: string | null,               // the delegation signal
  model:       string | Array<{ id, variant }> | null,
  hidden:      boolean,
  traits:      Trait[],
  provenance:  { file: string, pointer: string, fetchedAt: string }
}

Trait = "orchestration" | "reasoning" | "cheap-high-volume"
      | "coding" | "frontend" | "vision" | "diversity"
```

`description` is the **only** semantic capability field OpenCode exposes: a
primary agent chooses which subagent to delegate to based on it. There is no
performance or capability-rating field. If an agent has no `description`, record
`null` — never invent one — and flag it for manual verification.

## Per-source schema fields

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

## Role-trait mapping

Derive traits from `description` + `name` + `mode`. This replaces the old
hardcoded list of slim role names, so even an unknown agent can be placed.

| Trait | Signals (description / name / mode) |
|---|---|
| `orchestration` | "orchestrat", "plan", "delegate"; or `mode: primary` |
| `reasoning` | "reason", "debug", "review", "audit", "architect" |
| `cheap-high-volume` | "search", "explore", "research", "docs", "librarian" |
| `coding` | "fix", "implement", "refactor", "code" |
| `frontend` | "ui", "design", "frontend", "css" |
| `vision` | description mentions image/vision, or a known vision model |
| `diversity` | "council", "adversar", "panel", multiple reviewers |

Per-trait model preferences live in `SKILL.md` §Allocation Policy — this file
only derives traits.

## Known-role overrides

Explicit known-role overrides (`orchestrator`→orchestration, `oracle`→reasoning,
`explorer`/`librarian`→cheap-high-volume, `fixer`→coding, `designer`→frontend,
`observer`→vision, `council`/`councillor`/`councillor-*`→diversity) win over
inferred traits; the authoritative map is `SKILL.md` §Allocation Policy. An agent
with no `description` still falls back to the override here before the
conservative balanced chain.

## Precedence and duplicates

OpenCode resolves exactly one agent per name, but the effective definition when
several sources collide depends on the host's merge order. Do **not** assume a
winner: keep every record, mark the duplicate name as a conflict, and tell the
user to verify which definition is active (e.g. `opencode debug config`).
Never silently drop a record.

## Missing or unreadable source — fallback

- Source file absent → skip the adapter, add a warning `source <id> not found`.
  Do not treat it as an error.
- Agent without `description` → resolve it with the override map in `SKILL.md`
  §Allocation Policy (e.g. `oracle`→reasoning); if still unknown, assign a
  conservative balanced chain and flag it for manual verification.
- Schema or config unreadable → use only documented fields, never invent, and add
  the item to the verify list.
- No source yields any agent → report that clearly and stop. Do not fabricate a
  recommendation.

## Provenance

Every record carries `provenance.file`, a pointer (key path or frontmatter
location), and `fetchedAt`, so the report can cite where each agent was seen and
when. This mirrors the source+date rule the skill applies to Go plan data.
