# Output Format

Follow this structure exactly. Keep it scannable. **Render the section titles in
the user's language**; the labels below are the reference English wording.

## 1. Plan Snapshot
- Sources used + fetch timestamp.
- Diff vs the cached snapshot (added / removed ids, plus any price or score
  changes), if available (`references/model-snapshot.md`).
- Table of only the models relevant to this user:
  `model | input$/1M | output$/1M | monthly $ limit | est req/5h | est req/week | est req/month | context | reasoning | vision | status`.

## 2. What Changed
New/removed models, changed limits/prices/estimated request counts, and active
limited-time promos vs. the last snapshot. On the first run, state that there is
no history to compare.

## 3. Current
The discovered **custom** agents across all sources (read-only), one row per agent:
`source | agent | mode | current model/chain`. Do not list OpenCode's built-in
agents — including but not limited to Build, Plan, and the built-in subagents
(see `references/agent-sources.md`). Include adapter warnings (missing source,
missing description, duplicate names).

## 4. Recommendation
State the selected recommendation mode (`budget` / `balanced` / `quality`) and
where it came from: named in the request, remembered from a previous run
(`snapshot.preferences.mode`), chosen by the first-run diagnostic, or the default
`balanced`. When it is not the default, say why.

`| source | agent | traits | recommended model/chain | cost tier | why |`
Explain the cost signal (monthly limit + $/1M), the estimated requests per 5h
(throughput), and the capability fit per agent — where capability comes from the
LMArena Arena ELO scores (`overall` / `coding` / `vision`).

Add a **"Flags"** note for any pick that needs one — never hide these in the
"why" cell:

- **⚠ limited-time** — the pick relies on a promo multiplier; state the base limit
  it falls back to when the promo ends.
- **geo-restricted** — available only in certain regions (name the policy); say
  whether the user's region is covered.
- **trains on your data** — a privacy-for-discount / Contributor tier that uses
  prompts and completions to train future models; opt-in, ask before recommending.

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
- For any promo-dependent pick, restate the promo, its base limit, and that it is
  limited-time.
- For any geo-restricted or privacy/training pick, restate the caveat and whether
  it needs the user's decision.
- Commands to verify: `opencode models --refresh`, `/models`, `opencode debug config`.
- State that changes apply on the next OpenCode run/restart.

## Apply gate
End by asking the user (via the `question` tool) **which target to apply to** —
the oh-my-opencode-slim preset file (`~/.config/opencode/oh-my-opencode-slim.json`)
or a native config (`~/.config/opencode/opencode.jsonc` / an agent Markdown file).
Do NOT edit any config before confirmation.
