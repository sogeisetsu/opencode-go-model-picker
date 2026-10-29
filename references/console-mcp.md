# Console MCP (authoritative billing)

Console MCP turns "my local DB thinks I spent X" into "the bill says Y". Everything
downstream — the `Basis:` line, the occupancy percentages, the pool reverse-solve —
is only authoritative when this server answers with a real `cost_usd`.

Sections:

- What it gives you
- The five states
- Detection order
- When to show the guidance
- Fixed guidance copy (per state)
- Three-level fallback when the user will not enable it
- Offline: what actually still works
- Enabling it, per host
- After enabling

## What it gives you

- `cost_usd`, `requests`, and the token totals for a period (`24h` / `7d` / `30d` /
  `all`), plus the models that cost the most — the **authoritative bill**.
- The per-model split, so a model's observed cost per request is measured rather
  than estimated.
- Budget policies with `limitDollars`, `spentDollars` and `resetsAt` when the
  workspace defines them — the closest thing to the real 5h / week / month
  occupancy.
- The pool percentage the Console UI shows, which is what makes the pool
  reverse-solve (see `references/quota-math.md` §Reverse-solving) possible.
  `get_usage` returns an empty `budgets` array on workspaces without a budget
  policy — that is not an error, it just means the percentage is only visible in
  the Console UI, so ask the user for it (and for the cycle spend) instead of
  inventing one.

Read-only in this skill: the skill never writes Console state, never changes a
budget, never enables a model.

## The five states

| State | Criteria | What may be claimed |
|---|---|---|
| `authorized` | an in-run call returned a non-empty `cost_usd` | full authority: bill, per-model split, calibrated pool |
| `gated` | HTTP 403 `The Console MCP is not enabled for this workspace.` | nothing; needs a workspace switch |
| `unauthenticated` | HTTP 401, or `opencode mcp list` reports the server as needing authentication | nothing; needs OAuth |
| `absent` | no console/opencode_console server in the config **and** none in `opencode mcp list` | nothing; needs the server added |
| `unknown` | timeout, DNS/proxy failure, 5xx, a disabled entry, or a reachable endpoint whose authorization no evidence in this run proved | nothing; **never** reclassified as `absent` — a broken network is not a missing setup |

The distinction between `absent` and `unknown` matters: telling a user to "add the
server" when their proxy merely dropped the request wastes their time and hides
the real problem.

A connected host with no bill in the run is `unknown`, not `authorized`: a working
MCP server is not evidence of what you spent.

## Detection order

`scripts/probe-console.mjs` decides in ascending cost, and stops as soon as a
state is settled:

1. **Evidence already in this run** — pass what the Console tool returned:
   `--tool-status authorized --tool-cost-usd <n>`, or `--tool-status gated` etc.
   A claimed `authorized` without a non-empty `cost_usd` is downgraded to `unknown`.
2. **The host's own view** — `opencode mcp list` (local, no network). A console
   entry that reads `connected`, `disabled`, or "needs authentication" settles the
   state without touching the network. This is the only way to see a server that
   OpenChamber injected at runtime and that therefore appears in no config file.
3. **Config file** — `~/.config/opencode/opencode.json` / `.jsonc`, top-level
   `mcp`: a server named `console` / `opencode_console` (or containing "console").
   Only `url`, the entry's type, and whether it carries auth are reported; header
   and token values never reach the output.
4. **One `initialize` request** — only when 1–3 left the state open, and never with
   `--no-probe`. `401` → `unauthenticated`; `403` with the workspace message →
   `gated`; `2xx` → `unknown` (reachable, authorization unproven); timeout / DNS /
   proxy / `5xx` → `unknown`.

The script prints one compact JSON object (`state`, `guidanceKey`, `evidence`,
`server`, `probe`, `mcpList`) and exits 0. `guidanceKey` is
`console-mcp#<state>` — the section below owns the wording, so the copy and the
detector can never drift apart.

## When to show the guidance

- **Never as a precondition.** Probe at step 1 of a run, deliver the table first.
- **Authorized** → no guidance block at all. The `Basis:` line already says
  `Console bill (authoritative)`; adding a sales pitch would be noise.
- **Any other state** → a single block after the table (and after the usage
  evidence), showing the state, the risk, the cost of not enabling it, the benefit,
  and the concrete steps.
- The user's answer decides the fallback level; a refusal is a valid answer and
  must not be re-argued in a later run. Ask again only if they ask why the numbers
  are estimates.

## Fixed guidance copy (per state)

Fill the placeholders at run time — `{state}`, `{db_cost}`, `{console_cost}`,
`{ratio}`, `{pct}` — and drop any sentence whose numbers are unknown. Never print
a placeholder literally and never reuse last run's numbers.

Shared skeleton (states `absent` / `unauthenticated` / `gated` / `unknown`).
Reference English wording — render it in the user's language:

> There is no usable Console MCP right now ({state}). This run can only reconstruct
> spend from the local SQLite database plus official unit prices, which differs from
> the real bill by about {ratio}× (same 30 days: local {db_cost} / billed
> {console_cost}), so every "share of pool %" in the table is an estimate and can be
> off by about {pct}.
> What not enabling it costs you: (1) the absolute percentages cannot be trusted;
> (2) the 5h / week / month windows cannot be separated, so you cannot see which one
> runs out first; (3) off-peak double pricing can only be approximated from each
> message's timestamp.
> What enabling it gives you: the authoritative bill, an exact per-model split, and
> real occupancy for all three windows — the error drops from about {ratio}× to
> nearly zero, and you never have to screenshot the Console again.
> How to enable it: {how}

Per-state differences — only the first sentence and `{how}` change:

| State | First sentence emphasis | `{how}` |
|---|---|---|
| `absent` | no server configured | OpenCode: add a remote MCP server at `https://opencode.ai/console/mcp`, then authorize it. OpenChamber: add the same remote server on its MCP page and finish authorization in the browser |
| `unauthenticated` | server present, not authorized yet | `opencode mcp auth <name from opencode mcp list>`; or authorize it from OpenChamber's MCP page |
| `gated` | authorized, but the workspace switch is off | Enable the Console MCP for that workspace in the Console web app (Settings). If authorization succeeds and the endpoint still answers `not enabled for this workspace`, this is the step that was missed |
| `unknown` | detection failed (network / proxy / disabled / pending) | Retry later; or compute at level 2 (local only) now and come back to level 1 once the reading is available |

When `ratio`/`pct` are unknown (no stored bias, no Console bill), keep the sentence
about the DB being an estimate but omit the number — "unknown deviation, label it an estimate" is honest;
"about 1.46x" invented from an old run is not.

## Three-level fallback when the user will not enable it

Every level is usable on its own; say which one produced the numbers.

1. **Read-outs (best without the MCP).** Ask only for what the Console UI shows:
   the 5h / week / month percentages, and — much better — the cycle's spend in
   dollars. Feed them to `scripts/calibrate-usage.mjs --month-pct … --console-month-cost …`.
   Result: the pool is reverse-solved per `references/quota-math.md` §Reverse-solving
   and the rest of the arithmetic is identical to `authorized`, minus the per-model
   bill split. Cross-check the reading before trusting it (a 5h percentage and a
   cycle spend that imply wildly different pools means one of them was misread).
2. **Pure local.** Local SQLite cost × the dated bias, or the price seed times
   measured tokens. Agents are ranked and split correctly; the `Basis:` line reads
   `Estimate (official unit price x median tokens, high by about {ratio}x)`. Never print "you have X% left".
   The database has two layouts: older builds write `message` / `session`, current
   ones write `session_message` / `session_v2` (per-message `agent`, `model`, `cost`
   and `tokens` live in `session_message.data`). `calibrate-usage.mjs` reads both,
   prefers the newer one when it has rows in the window, and reports `storage` plus
   `underCoverage: true` when the local total is under 20% of the Console bill — an
   incomplete database is not a bias, and must never be presented as one.
3. **No cooperation at all.** Selection and relative ranking only. Amounts and
   percentages stay `-`, with one line: `No Console: quota occupancy cannot be computed`. Do not
   fabricate a pool to fill the columns.

## Offline: what actually still works

With no network, neither the Console nor a fresh official price exists. The honest
path is:

- read `references/model-prices.json` and label it with `priceVerifiedAt` /
  `planVerifiedAt`, plus an explicit **stale** warning once those dates are old.
  `scripts/quota-math.mjs` does this for you: its `seed` object carries
  `{ verifiedAt, ageDays, stale, reason }` and the CLI prints `⚠ EXPIRED` past seven
  days (`references/quota-math.md` §Seed freshness). `scripts/calibrate-usage.mjs`
  reports the same as `prices` / `# prices …`;
- if the seed is missing too (a partial install), there is no price at all → drop
  to level 3 (relative selection only, no money columns). The calculator does not
  invent a price for a missing seed: it exits with `price seed not found`, which is
  the signal to stop printing money.

There is no "offline level 1": a percentage the user read earlier is a stale
datum, not a reading. If they can still read the Console UI, that is a live
read-out and it counts — the point is that it comes from them, not from a cache.

## Enabling it, per host

**OpenCode CLI**

```bash
opencode mcp list                     # does a console server exist, and what is its name?
opencode mcp auth opencode_console     # authorize it (use the name the list shows)
```

**OpenChamber**

Add a remote MCP server with URL `https://opencode.ai/console/mcp`, then authorize
it in the browser when prompted. The host injects it at runtime, which is why the
config file can stay empty while `opencode mcp list` shows it.

**Workspace switch (the `gated` trap)**

Authorization and the workspace switch are different things. If OAuth succeeds and
the endpoint still answers `The Console MCP is not enabled for this workspace.`, an
owner or admin has to enable the Console MCP for that workspace in the Console web
app (Settings). Nothing in the skill can flip that switch.

## After enabling

1. Re-probe (`node scripts/probe-console.mjs --tool-status authorized --tool-cost-usd <n>`).
2. `node scripts/calibrate-usage.mjs --console-cost <usd> --console-requests <n> --month-pct <pct> [--console-month-cost <usd>] --write`
   to store the bias, the pool and the per-agent split in the snapshot
   (`references/model-snapshot.md` §Schema v3).
3. Switch the `Basis:` line to `Console bill (authoritative)` and drop the guidance block.

The per-model bill then replaces the observed-cost estimate, and the pool's
`provisional` flag stays until a second reading confirms it within 10%
(`references/quota-math.md` §Calibration constants).
