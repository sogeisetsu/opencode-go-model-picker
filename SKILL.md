---
name: opencode-go-model-picker
description: "Pick or rebalance which OpenCode Go model each **custom** OpenCode agent/subagent uses, against the LATEST Go plan, optimizing cost and resilience. Use when the user asks to pick/tune/optimize agent models for OpenCode Go, whether their current agent config still fits the plan, or wants a paste-ready preset or agent block. Custom agents only — native, oh-my-opencode-slim, or plugin-injected; OpenCode's built-ins are skipped. Read-only by default: never writes a config without an explicit confirmation."
license: GPL-3.0-or-later
compatibility: opencode
metadata:
  version: "3.0.0"
  requires: "OpenCode with agent config support; Node.js 22+ for the single entry point (Node 18+ for everything except the local DB read)"
  homepage: "https://github.com/sogeisetsu/opencode-go-model-picker"
  source: "https://github.com/sogeisetsu/opencode-go-model-picker"
---

# OpenCode Go Model Picker

One script does the arithmetic; you do the judgement. Every path below is
relative to **this skill's own directory**.

## Run it

```bash
node scripts/go.mjs run --out run.json
```

That single command discovers the custom agents, probes the Console, reads the
local usage DB, refreshes catalog/prices/scores (serially, one file), diffs the
plan and picks the `Basis:` line. It degrades instead of failing: `--offline`
skips the network, a missing DB or Console is reported, a stale seed is labelled.

Read `run.json`. If `needs.modeQuestion` is true, ask the two questions
(`budget` / `balanced` / `quality`) with the `question` tool and pass
`--mode <mode>`; otherwise the remembered mode is already applied.

## Decide

For every agent in `agents`, choose a chain of 2–4 ids and a one-sentence `why`:

- chain `[0]` best fit for the trait, `[1]` a cheaper Go buffer, `[2]` another
  provider; never duplicate an id; never lead with a dead id from `deadChainIds`.
- traits are already derived; known-role names win (`orchestrator`, `oracle`,
  `explorer`, `fixer`, `designer`, `observer`, `council*`). For an unknown agent,
  read its description and pick conservatively.
- **verify capability from the lab's own docs**, never from the model id
  (vision for `observer`/`designer` above all). Unverifiable → say so and do not
  put it in a vision lane.
- keep the cap separate from the pool; several agents may share one model cap
  (`warnings[].kind === "contention"`), which is a reason to spread chain heads.

Write the picks beside `run.json`, then:

```bash
node scripts/go.mjs report --run run.json --picks picks.json --out report.md
node scripts/go.mjs check report.md --run run.json
```

`report` renders the table, the money columns, the config blocks and the
appendix. Add only the highlights and caveats it marks as yours (mode, plan
changes, peak/geo/training risks). **`check` must pass before you deliver** — it
fails a report with a missing column, a second basis, or no stop-before-writing
line.

## Apply, only after the user says yes

Show the diff, ask with the `question` tool, and name the one target file.

```bash
node scripts/go.mjs apply --run run.json --picks picks.json --target <file>          # diff only
node scripts/go.mjs apply --run run.json --picks picks.json --target <file> --write  # only after confirmation
```

It refuses to write outside that file, refuses dead ids, and re-parses the result
before writing. Tell the user the change applies on the next OpenCode run and is
verified with `/models` and `opencode debug config`.

## Hard rules

1. **Never invent a price, a limit or a model id.** The run carries a source and
   a date for every number; `data.quality` says whether it is `live`, a dated
   `seed`, or `none` — present it as such.
2. **Read-only until confirmed.** No config edit before the user answers the
   apply question, and then only the file they named.
3. **Capability is evidence.** Vision, reasoning and long context come from the
   model's own docs this run, not from its name.
4. **Caveats surface, never disappear.** Limited-time multipliers, geo limits and
   privacy-for-discount tiers are stated in the report where they apply.

Plan facts, Console states and the fallbacks: `references/plan-facts.md`.
