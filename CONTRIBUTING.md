# Contributing

Thanks for your interest in improving the OpenCode Go Model Picker. This is a small,
focused project, so contributions are easiest to accept when they keep its design
principles intact.

[Chinese version](zh/CONTRIBUTING-ZH.md)

## Ground rules

1. **Never invent prices, limits, or model IDs.** Every figure in a recommendation
   must come from a fetched source and be reported with its source and fetch date.
   Unverifiable values are flagged for manual verification rather than guessed.
2. **Keep it read-only by default.** The skill must never edit the user's
   configuration without a preview and explicit confirmation.
3. **Match the schema of the source you are reading**, not an arbitrary online
   document. For `oh-my-opencode-slim`, the source of truth is its installed
   `oh-my-opencode-slim.schema.json`; for custom native OpenCode agents, the
   official config/agent docs.
4. **Verify capabilities from the model's own lab documentation**, never from its
   name. This matters most for vision input, which the `observer` agent needs.
5. **Only custom agents.** Never recommend models for OpenCode's built-in agents
   (including but not limited to `build`, `plan`, the built-in subagents, and the
   hidden system agents; the set can change between versions). A custom agent
   stays in scope even without fallback-chain support.
6. **Never commit to `main` directly.** Every change starts on a topic branch cut
   from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and merges back to `main`
   only after the checks below pass. This applies to maintainers too, so `main`
   stays green and reviewable.

## Terminology

Keep the audience distinction exact — it drives the whole skill:

- **custom agent** — any agent the user defines or installs (a native JSON or
  Markdown agent, an `oh-my-opencode-slim` preset, or an agent from another
  plugin). This is what the skill tunes.
- **built-in agent** — an agent OpenCode ships (including but not limited to
  `build`, `plan`, the built-in subagents, and the hidden system agents). Never
  tuned; the set can change between versions.

Avoid using "native OpenCode" to mean a *custom* agent: it reads as "built-in" and
has already caused real confusion. Say "an agent you define in `opencode.jsonc` or
a Markdown file" instead.

## Repository layout

| Path | Responsibility |
|---|---|
| `SKILL.md` | The skill itself: frontmatter, the four verbs, what the model decides, the hard rules. Model-facing only — teaching belongs in the READMEs. |
| `references/plan-facts.md` | The judgement reference: plan facts, Console states and fallbacks, capability verification, the risks to flag. |
| `references/model-scores.json` | Committed LMArena score seed, reused while its board dates are still current. |
| `references/model-prices.json` | Committed price seed (models.dev prices, including cache write and context tiers) plus the hand-verified plan constants (`capUsd`, `estReq*`, `peak`, `promo`); `null` means unverified and is never guessed. |
| `scripts/go.mjs` | **The only entry point**: `run`, `report`, `check`, `apply`. |
| `scripts/lib/agents.mjs` | Agent discovery (native, slim, plugin), trait derivation, chain validation. |
| `scripts/lib/pricing.mjs` | The one pricing implementation: tokens + model id + price constants → `$`, window shares, capacity. |
| `scripts/lib/usage.mjs` | Local SQLite + Console read-outs → per-agent split, bias, reverse-solved pool, month-end forecast. |
| `scripts/lib/console.mjs` | Console MCP state detection (five states), cheapest evidence first; never prints a token. |
| `scripts/lib/snapshot.mjs` | Snapshot read/write, catalog refresh, plan diff. |
| `scripts/lib/prices.mjs` / `scores.mjs` | Refresh the committed seeds or a snapshot's price/score keys. |
| `scripts/lib/report.mjs` | Renders the table, money columns and config blocks; the machine-checkable gate. |
| `scripts/lib/apply.mjs` | Exact-diff apply into one named file; refuses to write an unparseable result. |
| `scripts/lib/io.mjs` | Exit-code plumbing so no module calls `process.exit`. |
| `scripts/lib/json-io.mjs` / `proxy.mjs` | Shared helpers (BOM-tolerant JSON, atomic writes; proxy re-exec). |
| `tools/generate-assets.mjs` | Regenerates the SVG icon, banners and local badges; the version badge is read from `SKILL.md`. |
| `tools/check-docs.mjs` | One-stop doc check: relative links, EN/ZH doc pairs, frontmatter, no CJK in English docs, and version/badge/changelog agreement. |
| `tools/lib/skill-md.mjs` | Reads `SKILL.md`'s `metadata.version`; used by both the badge generator and the doc checker. |
| `README.md` / `README-ZH.md` | English and Chinese documentation. |
| `zh/` | Chinese docs (`CONTRIBUTING-ZH.md`, `CHANGELOG-ZH.md`, and a git-ignored local `skill-zh.md` reading copy). |
| `assets/` | SVG icon, banners and local badges used in the README headers. |
| `tests/*.test.mjs` | The test suite (see "Validating changes"). |
| `tests/prompts.json` | Evaluation prompts, not runtime assets: each case pairs a realistic request with the behaviour the skill must exhibit (read-only, dated fallback, apply gate). Nothing loads it; run them by hand or hand them to an agent when changing the workflow. |
| `LICENSE` | The full GPL-3.0-or-later license text. |
| `CONTRIBUTING.md` / `CHANGELOG.md` | Contribution guide and changelog (English; Chinese under `zh/`). |

## Making a change

1. Fork the repository, then create a topic branch from `main` — see Ground
   rule 6 (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make your change. If you touch `SKILL.md`, keep `references/` and both READMEs
   consistent with it.
3. Validate (see below).
4. Open a pull request describing what changed and why.

## Validating changes

There is no build step. The suite uses `node:test` (built into Node, no
dependencies):

```bash
node --test tests/*.test.mjs              # pricing, discovery, usage, CLI, report/apply
node --check scripts/go.mjs               # syntax check (repeat for every .mjs)
node --check tools/check-docs.mjs
node tools/check-docs.mjs                 # one-stop doc check (see below)
node scripts/go.mjs run --offline --json  # degrades cleanly with no network
```

`tests/golden/` holds outputs captured from the pre-refactor scripts. A difference
between a golden and the current code is a regression — refresh a golden only when
the change is intended, and say so in the commit message.

`check-docs.mjs` validates relative links, English/Chinese doc pairs, frontmatter
validity, that English docs contain no CJK characters, and that the version badge
plus both changelogs agree with `SKILL.md`'s `metadata.version` — run it after any
documentation or `SKILL.md` edit. Every script stays dependency-free: reuse
`scripts/lib/json-io.mjs` (reads, atomic writes) and `scripts/lib/proxy.mjs`
(proxy re-exec) instead of adding a package or a second copy of either helper. To
regenerate the LMArena score seed after an upstream release, run
`node scripts/go.mjs run` (or the `refreshScores` export in `scripts/lib/scores.mjs`)
and commit `references/model-scores.json`. The price seed is refreshed the same way
through `scripts/lib/prices.mjs`.

If you changed a verb's behaviour, extend `tests/cli.test.mjs` — the assertion is
the CLI surface itself: one entry, four verbs, a degraded run still producing a
usable `run.json`, and `apply` never writing without `--write`. If you changed
model guidance, re-check the affected claims against the sources listed in
`references/plan-facts.md` and update the verified-date notes. If you edited any SVG
under `assets/` by hand, prefer editing `tools/generate-assets.mjs` and re-running
it, so the assets stay reproducible.

## Reporting issues

Please include:

- The prompt you used and what you expected versus what happened.
- Your OpenCode version and, if relevant, your installed `oh-my-opencode-slim` version.
- Any relevant output, with secrets removed.

## License of contributions

By contributing, you agree that your contributions are licensed under the
project's license, **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)).
