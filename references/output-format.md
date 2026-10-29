# Output Format

Follow this structure exactly. Keep it scannable. **Render the section titles and
the labels in the user's language**; the wording below is the reference English.

The report is, in this order: the `Basis:` line, the `Recommendation table`, the
`Usage evidence` block, the `Paste-ready config`, `Highlights`, `Data appendix`,
then — only when the Console MCP is not `authorized` — one guidance block, and
finally the apply gate.

Sections:

- 1. Basis line (mandatory)
- 2. Recommendation table
- 3. Usage evidence
- 4. Paste-ready config
- 5. Highlights
- 6. Data appendix
- 7. Console guidance block (conditional)
- 8. Apply gate

## 1. Basis line (mandatory)

One line **above the table**, always, exactly one of three shapes. Every money
figure and every percentage in the whole report uses this same denominator — a
report that mixes two bases is wrong, not merely less precise.

```text
Basis: Console bill (authoritative) | 2026-10-30 | pool $60/mo (provisional)
Basis: Estimate (official unit price x median tokens, high by about 1.46x) | 2026-10-30
Basis: Uncalibrated (no Console, no snapshot) | 2026-10-30
```

- **Console bill (authoritative)** — a real `cost_usd` was read this run. Add the
  pool with its `provisional` marker until a second reading confirms it
  (`references/quota-math.md` §Calibration constants).
- **Estimate** — local DB/price-seed arithmetic, no bill. The `about N×` factor is
  the dated bias, printed as a multiplier; omit the number when no bias is known
  and write `Estimate (official unit price x median tokens, deviation unknown)`.
- **Uncalibrated** — neither a bill nor a dated seed. Every amount and percentage
  column prints `-`; the table still ranks models.

Never print a dollar amount in an `Uncalibrated` report, and never mix an
`Estimate` percentage into an `authoritative` table.

## 2. Recommendation table

One row per discovered **custom** agent — never OpenCode's built-ins (`build`,
`plan`, `general`, `explore`, `scout`, `compaction`, `title`, `summary`, or
anything else OpenCode ships). Columns exactly:

`| agent | recommended chain | headroom ($ cap / official req / observed req) | accounted $/session (median · P90) | share of model cap % | 10 runs as % of 5h · week · month | actual monthly occupancy % | why |`

- **agent** — the exact callable name.
- **recommended chain** — the ordered chain (`1. opencode-go/<a> 2. opencode-go/<b>
  3. opencode/*`), or one model for a source that cannot express a chain, plus the
  flag markers below.
- **headroom** — the chain head's monthly cap in dollars, then the official request
  count and the observed one, e.g. `$80 / 173,330 / 12,085`. Official comes from
  the plan page's estimate, observed from the Console bill or the local DB. Both
  appear or the cell is `-`: one alone is a half-truth
  (`references/quota-math.md` §Derived quantities).
- **accounted $/session** — the session cost from the shared formula, median first,
  P90 second (`0.0123 · 0.0456`). The P90 is there because the median hides the
  long tail; never print only one of them.
- **share of model cap %** — `C ÷ cap` for the same session.
- **10 runs as % of 5h · week · month** — three **independent** window shares of
  the plan pool, e.g. `3.1 · 1.2 · 0.6`. Never sum them, never print a combined
  number, and never imply that a 5h overspend eats the week.
- **actual monthly occupancy %** — what this agent has really used this billing
  cycle, from the Console agent split or the local proxy for it. This is a fact
  about the past, not a scenario; `-` at level 3.
- **why** — one or two scannable sentences: cost signal (cap + $/1M), throughput
  (est req/5h, observed req where available), capability fit (Arena ELO board).
  When the pick is dominated but kept (cross-provider quota fallback), say why.

**Flags (never bury).** Put the marker in the recommended-chain cell:

- `⚠ limited-time` — promo or free tier with an end date
- `⚠ geo-restricted` — region policy limits where it works
- `⚠ trains on your data` — the Contributor/privacy-for-discount tier

Each marker gets its full text in §5 Highlights: the base limit after the promo,
the region policy versus the user's region, and the opt-in nature respectively.

Adapter warnings (missing source, missing description, duplicate names) go
**below** the table, never dropped.

## 3. Usage evidence

Fixed block directly after the table, format fixed, numbers from this run:

```text
Usage evidence (last 30 days): $19.84 / 12,391 requests / 32.5% of the monthly pool
Last 7 days: $4.12 (6.9%) -> at this pace the month ends around 87%
Candidates without an ELO: 2/31 (opencode-go/<id>, opencode-go/<id>)
Dead chain ids: opencode-go/<id> (alias agents), <provider>/<id> ...
Main agents (not changed, share only): build 74% / plan 19% / ...
```

- **Window label is mandatory** on every line (`last 30 days`, `last 7 days`,
  `billing cycle`) — a rolling window and a billing cycle are different
  denominators (`references/quota-math.md` §Windows).
- **Month-end projection** uses the cycle's elapsed days and
  `0.7·median + 0.3·P90`, never a rolling average. Print it only when the pool is
  known; otherwise print the spend and `-` for the projection.
- **Candidates without an ELO: n/m** — always both numbers, then the ids. LMArena
  does not cover every model, and a missing score is "not comparable", not "bad".
- **Dead chain ids** — the `deadChainIds` list from `scripts/discover-agents.mjs`
  for this run, with the agents that use each id. Never paste a previous run's
  list, and write `none` explicitly when empty.
- **Main agents (not changed, share only)** — the built-in agents are out of scope
  for recommendations, but their share of spend is the context that makes every
  custom agent's number interpretable. Report share only; never recommend a model
  for them.

## 4. Paste-ready config

A complete, copy-pasteable JSONC block per **detected** source:

- **slim detected** → a preset block with `$schema`, `"preset": "<name>"`, and
  `"presets": { "<name>": { ...agents... } }`; label the target
  `~/.config/opencode/oh-my-opencode-slim.json`.
- **native detected** → an `agent` block for `opencode.jsonc`
  (`"model": "opencode-go/<id>"`), or the `model:` frontmatter line for a Markdown
  agent. Native `agent.<name>.model` is a **single value**: one model plus an
  explicit note that this source cannot express a chain, and a pointer to
  `references/agent-sources.md` for moving the agent into a chain-capable source if
  the user wants failover.
- **both detected** → both blocks, each labeled with its own target file.

Exact model ids, no unrelated keys, nothing the user did not ask for.

## 5. Highlights

One paragraph (bullets only if genuinely needed), in this order:

1. The recommendation mode (`budget` / `balanced` / `quality`) and where it came
   from: named in the request, remembered, first-run diagnostic, or the default.
2. Whether the balanced price ceiling was respected or exceeded, and why.
3. Full text of every `⚠` flag from the table.
4. Plan changes since the last snapshot: added/removed models, changed
   caps/prices/estimated requests, promos that started or ended. First run → say
   there is no history.
5. What the basis line means for trust: which numbers are authoritative, which are
   estimates, and which columns are blank because a source is missing.
6. Any pick that needs a human decision before applying.

## 6. Data appendix

Auditability (Iron Rule 1 lives here):

- **Sources + fetch timestamps** — plan page, models.dev, LMArena, and the Console
  MCP state (`references/console-mcp.md` §The five states). A value read from a
  committed seed says so explicitly with the seed's date.
- **Diff vs. the cached snapshot** — added/removed ids, price or score changes.
- **Table of only the models relevant to this user**:
  `model | input$/1M | output$/1M | cached read$/1M | cached write$/1M | cap | est req/5h | observed req/$ | context | reasoning | vision | status`.
- **Calibration line** — bias, its date, and whether it drifted more than 10% from
  the stored one; the pool with its `provisional` marker and which path produced it
  (`console-dollar-percent`, `local-cost-through-bias`, or none).
- **First-run diagnostic**, when used: `| factor | answer | weight | effect |` with
  the main goal (0.7) and main task (0.3) rows, resolved with the table below. An
  answer of "you decide" counts as skipped.

  | Q1 goal (0.7) | Q2 task (0.3) | Mode |
  |---|---|---|
  | save money | any | `budget` |
  | best value | simple / high-volume | `balanced` |
  | best value | coding / hard reasoning / vision / mixed | `balanced` (the ceiling may be exceeded for a capability-critical, rarely used lane — say why) |
  | strongest capability | any | `quality` |
  | skipped | simple / high-volume | `budget` |
  | skipped | any other / skipped | `balanced` |

- **Manual-verification list** — every promo-dependent pick with its base limit,
  every geo/training caveat, every model that could not be priced, and every field
  the calculator had to assume (`assumed`).
- **Verify commands** — `opencode models --refresh`, `/models`,
  `opencode debug config`; changes apply on the next OpenCode run/restart.

## 7. Console guidance block (conditional)

Include it **only** when the detected state is not `authorized`, and place it after
§6 so it never interrupts delivery. The copy, the per-state differences, and the
three fallback levels are fixed in `references/console-mcp.md` §Fixed guidance
copy; fill its placeholders with this run's numbers and drop any sentence whose
numbers are unknown.

When the state is `authorized`, this block does not exist at all: the basis line is
the whole story.

## 8. Apply gate

End by asking (via the `question` tool) **which target to apply to** — the slim
preset file or a native config / agent Markdown file — and show the exact block
first. Do not edit any config before confirmation (`SKILL.md` §Applying Changes).
