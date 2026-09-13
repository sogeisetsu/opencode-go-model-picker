# Agent Sources

How this skill discovers agents across sources and normalizes them into one
inventory. The skill is **not tied to a single plugin**: any **custom** agent
OpenCode can address by name is in scope.

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

**A note on fallback chains (a suggestion, not a requirement).** A source that
supports an ordered chain — for example `oh-my-opencode-slim`'s
`model: [a, b, c]`, or any other tool/plugin that does the same — lets the skill
output a fallback chain. Native OpenCode's `agent.<name>.model` takes a single
model, so there the skill outputs one model. If the user already uses a
chain-capable tool, nothing needs to change; recommending
`oh-my-opencode-slim` is only a suggestion for users who want chains and have no
equally good option.

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

Chain support is **not** a requirement for scope. A custom agent configured only
directly in OpenCode — with a single `model`, not registered in
`oh-my-opencode-slim` or any other chain-capable tool — is still in scope; the
skill just recommends one model for it instead of a chain.

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

## Role-trait mapping

Derive traits from `description` + `name` + `mode`. This replaces the old
hardcoded list of slim role names, so even an unknown agent can be placed.

| Trait | Signals (description / name / mode) | Model preference |
|---|---|---|
| `orchestration` | "orchestrat", "plan", "delegate"; or `mode: primary` | strong but affordable, large monthly limit |
| `reasoning` | "reason", "debug", "review", "audit", "architect" | strongest reasoning model |
| `cheap-high-volume` | "search", "explore", "research", "docs", "librarian" | cheapest with a large limit |
| `coding` | "fix", "implement", "refactor", "code" | mid coding model |
| `frontend` | "ui", "design", "frontend", "css" | model strong at frontend |
| `vision` | description mentions image/vision, or a known vision model | only models with **verified** image input |
| `diversity` | "council", "adversar", "panel", multiple reviewers | distinct strong models across providers |

Preference details (cost tiers, monthly limits, `variant`) live in the
"Allocation Policy" section of `SKILL.md`, and are applied under the selected
recommendation mode (`budget` / `balanced` / `quality`).

## Known-role overrides (backward compatibility)

A fixed table preserves the original behavior for the agents this skill started
with. An override wins over inferred traits.

| Agent name | Traits |
|---|---|
| `orchestrator` | `orchestration` |
| `oracle` | `reasoning` |
| `explorer` | `cheap-high-volume` |
| `librarian` | `cheap-high-volume` |
| `fixer` | `coding` |
| `designer` | `frontend` |
| `observer` | `vision` |
| `council`, `councillor`, `councillor-*` | `diversity` |

## Precedence and duplicates

OpenCode resolves exactly one agent per name, but the effective definition when
several sources collide depends on the host's merge order. Do **not** assume a
winner: keep every record, mark the duplicate name as a conflict, and tell the
user to verify which definition is active (e.g. `opencode debug config`).
Never silently drop a record.

## Missing or unreadable source — fallback

- Source file absent → skip the adapter, add a warning `source <id> not found`.
  Do not treat it as an error.
- Agent without `description` → try the known-role override. If still unknown,
  assign a conservative balanced chain and flag it for manual verification.
- Schema or config unreadable → use only documented fields, never invent, and add
  the item to the verify list.
- No source yields any agent → report that clearly and stop. Do not fabricate a
  recommendation.

## Provenance

Every record carries `provenance.file`, a pointer (key path or frontmatter
location), and `fetchedAt`, so the report can cite where each agent was seen and
when. This mirrors the source+date rule the skill applies to Go plan data.
