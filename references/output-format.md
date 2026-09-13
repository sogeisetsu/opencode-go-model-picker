# Output Format

Follow this structure exactly. Keep it scannable. **Render the section titles in
the user's language**; the labels below are the reference English wording.

## 1. Plan Snapshot
- Sources used + fetch timestamp.
- Diff vs the cached snapshot (added / removed ids, plus any price or score
  changes), if available (`references/model-snapshot.md`).
- Table of only the models relevant to this user:
  `model | input$/1M | output$/1M | monthly $ limit | est req/5h | context | reasoning | vision | status`.

## 2. What Changed
New/removed models, changed limits/prices, active limited-time promos vs. the last
snapshot. On the first run, state that there is no history to compare.

## 3. Current
The discovered **custom** agents across all sources (read-only), one row per agent:
`source | agent | mode | current model/chain`. Do not list OpenCode's built-in
agents — including but not limited to Build, Plan, and the built-in subagents
(see `references/agent-sources.md`). Include adapter warnings (missing source,
missing description, duplicate names).

## 4. Recommendation
State the selected recommendation mode (`budget` / `balanced` / `quality`; default
`balanced`) and, if not the default, why.

`| source | agent | traits | recommended model/chain | cost tier | why |`
Explain the cost signal (monthly limit + $/1M) and capability fit per agent.

## 5. Paste-ready
Produce a block for **each** source the user wants to update:

- **oh-my-opencode-slim** — a JSONC preset block:
  - `$schema`
  - `"preset": "<name>"`
  - `"presets": { "<name>": { ...agents... } }`
- **native OpenCode custom agents** — a JSONC `agent` block for `opencode.jsonc`:
  - `"agent": { "<name>": { "model": "opencode-go/<id>" } }`
  - (if a Markdown agent is used, show the frontmatter `model:` line instead)

Keep model ids exact (`opencode-go/<id>`). Do not include unrelated keys. If a
source cannot express a fallback chain, say so instead of inventing an array.

## 6. Verify / Manual verification
- List every item that needs manual verification.
- Commands to verify: `opencode models --refresh`, `/models`, `opencode debug config`.
- State that changes apply on the next OpenCode run/restart.

## Apply gate
End by asking the user (via the `question` tool) **which target to apply to** —
the oh-my-opencode-slim preset file (`~/.config/opencode/oh-my-opencode-slim.json`)
or a native config (`~/.config/opencode/opencode.jsonc` / an agent Markdown file).
Do NOT edit any config before confirmation.
