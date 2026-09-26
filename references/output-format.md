# Output Format

Follow this structure exactly. Keep it scannable. **Render the section titles in
the user's language**; the labels below are the reference English wording. The
body has three parts — `Recommendation table`, `Paste-ready config`,
`Highlights` — followed by one `Data appendix`, in exactly this order.

## 1. Recommendation table

One row per discovered **custom** agent (the same set as always — never list
OpenCode's built-in agents: build, plan, general, explore, scout, compaction,
title, summary, or anything else OpenCode ships). Columns exactly:

`| agent | capability focus | current model | recommended model | why |`

- **capability focus** — the agent's trait: orchestration / reasoning /
  cheap-high-volume / coding / frontend / vision / diversity.
- **current model** — the discovered current model or chain from the inventory;
  if none is configured, write `not configured`.
- **recommended model** — the exact id `opencode-go/<id>`, or the fallback chain
  as an ordered list (e.g. `1. opencode-go/<a> 2. opencode-go/<b> 3. opencode/*`).
- **why** — one or two sentences, scannable, covering:
  - **cost signal**: monthly $ limit + $/1M;
  - **throughput**: estimated requests per 5h;
  - **capability fit** from LMArena Arena ELO (`overall` / `coding` / `vision`).

**Flags (Iron Rule 6: never bury).** Put a marker in the recommended-model cell
itself:

- `⚠ limited-time`
- `⚠ geo-restricted`
- `⚠ trains on your data`

Every marker gets its full explanation in section 3 (Highlights): base limit
after the promo ends, region coverage, and the opt-in nature respectively.

Adapter warnings (missing source, missing description, duplicate names) are
noted **below** the table — never dropped.

## 2. Paste-ready config

A complete, copy-pasteable JSONC block per **detected** source (auto-selected;
one block per source):

- **slim detected** → a JSONC preset block:
  - `$schema`
  - `"preset": "<name>"`
  - `"presets": { "<name>": { ...agents... } }`

  Label the paste target `~/.config/opencode/oh-my-opencode-slim.json`. This
  preserves fallback chains (2–4 entries).
- **native detected** → a JSONC `agent` block for `opencode.jsonc`:

  `"agent": { "<name>": { "model": "opencode-go/<id>" } }`

  A Markdown agent gets the frontmatter `model:` line instead. Native
  `agent.<name>.model` is a **single value** — one model, plus an explicit note
  that this source cannot express a chain (never invent an array).
- **both detected** → give both blocks, each labeled with its own target file.

Keep model ids exact (`opencode-go/<id>`); no unrelated keys; nothing the user
didn't ask for.

## 3. Highlights

A single paragraph (bullets only if genuinely needed) in the user's language,
covering, in this order:

1. Which recommendation mode was used (`budget` / `balanced` / `quality`) and
   where it came from: named in the request, remembered from a previous run,
   first-run diagnostic, or the default. When it is not the default, why.
2. Whether the balanced price ceiling was respected or exceeded (the
   capability-critical rare lane), and why.
3. Full text of every `⚠` flag from the table: the promo plus its base limit,
   the geo policy plus the user's region, and the training/privacy opt-in.
4. What changed in the plan since the last snapshot: added/removed models,
   changed limits/prices/estimated request counts, active promos. On the first
   run, say there is no history to compare.
5. Any pick that needs a human decision before applying.

## 4. Data appendix

Auditability section (Iron Rule 1 lives here):

- **Sources used + fetch timestamp.** State the price source — when a price
  came from the committed seed (`references/model-prices.json`) rather than a
  live read, say so explicitly and give the seed's date; never present seed
  numbers as current.
- **Diff vs. the cached snapshot** (`references/model-snapshot.md`):
  added/removed ids plus any price or score changes.
- **Table of only the models relevant to this user**:
  `model | input$/1M | output$/1M | monthly $ limit | est req/5h | est req/week | est req/month | context | reasoning | vision | status`.
- If the first-run diagnostic was used, the auditable decision-factors table:

  `| factor | answer | weight | effect |`

  with rows for **main goal** (0.7) and **main task** (0.3).
- **Manual-verification list**: for each promo-dependent pick restate the promo,
  its base limit, and its limited-time nature; for geo or training picks
  restate the caveat and that it needs the user's decision.
- **Verify commands**: `opencode models --refresh`, `/models`,
  `opencode debug config`; state that changes apply on the next OpenCode
  run/restart.

## Apply gate

End by asking the user (via the `question` tool) **which target to apply to** —
the slim preset file (`~/.config/opencode/oh-my-opencode-slim.json`) or a native
config (`~/.config/opencode/opencode.jsonc` / an agent Markdown file).
Do NOT edit any config before confirmation.
