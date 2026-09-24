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
| `SKILL.md` | The skill itself: frontmatter, iron rules, workflow, allocation policy, fallback policy, schema notes. |
| `references/data-sources.md` | Where to fetch live plan data and how to parse it. |
| `references/agent-sources.md` | Agent discovery: source adapters, the uniform inventory record, the role-trait mapping, and fallback when a source is missing. |
| `references/model-snapshot.md` | Persistent snapshot cache: schema, location, refresh policy, ranking sources, and name matching. |
| `references/output-format.md` | The exact six-part report the skill must produce. |
| `references/model-scores.json` | Committed LMArena score seed, reused while its board dates are still current. |
| `references/model-prices.json` | Committed price seed from models.dev: per-model `inputPer1M` / `outputPer1M` / `cacheReadPer1M` / `context` / `outputLimit`; `null` means unverified and is never guessed. |
| `scripts/fetch-go-models.mjs` | Helper that prints the live model catalog as JSON. |
| `scripts/refresh-snapshot.mjs` | Refreshes the snapshot cache and prints a compact added / removed diff. |
| `scripts/refresh-scores.mjs` | Fetches LMArena scores via the HF datasets-server (no key, no browser) into the seed or a snapshot. |
| `scripts/refresh-prices.mjs` | Refreshes the committed price seed from the models.dev `opencode-go` provider. |
| `scripts/generate-assets.mjs` | Regenerates the SVG icon, banners and local badges. |
| `scripts/check-docs.mjs` | One-stop doc check: relative links, EN/ZH doc pairs, frontmatter, and no CJK in English docs. |
| `README.md` / `README-ZH.md` | English and Chinese documentation. |
| `zh/` | Chinese docs (`CONTRIBUTING-ZH.md`, `CHANGELOG-ZH.md`, and a git-ignored local `skill-zh.md` reading copy). |
| `assets/` | SVG icon, banners and local badges used in the README headers. |
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

There is no build step or test suite. Validate manually:

```bash
node --check scripts/*.mjs                 # syntax check
node scripts/fetch-go-models.mjs           # confirm the endpoint still works
node scripts/check-docs.mjs                # one-stop doc check (see below)
```

`check-docs.mjs` validates relative links, English/Chinese doc pairs, frontmatter
validity, and that English docs contain no CJK characters — run it after any
documentation or `SKILL.md` edit. To regenerate the LMArena score seed after an
upstream release, run `node scripts/refresh-scores.mjs` and commit
`references/model-scores.json`. To regenerate the price seed after a models.dev
update, run `node scripts/refresh-prices.mjs` and commit
`references/model-prices.json`.

If you changed the workflow or output structure, walk through the run mentally
against `references/output-format.md` and confirm all six sections are still
produced. If you changed model guidance, re-check the affected claims against the
sources listed in `references/data-sources.md` and update the verified-date notes.
If you edited any SVG under `assets/` by hand, prefer editing
`scripts/generate-assets.mjs` and re-running `node scripts/generate-assets.mjs`
instead, so the assets stay reproducible.

## Reporting issues

Please include:

- The prompt you used and what you expected versus what happened.
- Your OpenCode version and, if relevant, your installed `oh-my-opencode-slim` version.
- Any relevant output, with secrets removed.

## License of contributions

By contributing, you agree that your contributions are licensed under the
project's license, **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)).
