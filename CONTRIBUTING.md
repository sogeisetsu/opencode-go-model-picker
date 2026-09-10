# Contributing

Thanks for your interest in improving the OpenCode Go Model Picker. This is a small,
focused project, so contributions are easiest to accept when they keep its design
principles intact.

[中文版](CONTRIBUTING-ZH.md)

## Ground rules

1. **Never invent prices, limits, or model IDs.** Every figure in a recommendation
   must come from a fetched source and be reported with its source and fetch date.
   Unverifiable values are flagged for manual verification rather than guessed.
2. **Keep it read-only by default.** The skill must never edit the user's
   configuration without a preview and explicit confirmation.
3. **Match the installed plugin's schema**, not an arbitrary online document. The
   source of truth is the `oh-my-opencode-slim.schema.json` shipped with the
   installed plugin version.
4. **Verify capabilities from the model's own lab documentation**, never from its
   name. This matters most for vision input, which the `observer` agent needs.

## Repository layout

| Path | Responsibility |
|---|---|
| `SKILL.md` | The skill itself: frontmatter, iron rules, workflow, allocation policy, fallback policy, schema notes. |
| `references/data-sources.md` | Where to fetch live plan data and how to parse it. |
| `references/output-format.md` | The exact six-part report the skill must produce. |
| `scripts/fetch-go-models.mjs` | Helper that prints the live model catalog as JSON. |
| `README.md` / `README-ZH.md` | English and Chinese documentation. |

## Making a change

1. Fork the repository and create a branch.
2. Make your change. If you touch `SKILL.md`, keep `references/` and both READMEs
   consistent with it.
3. Validate (see below).
4. Open a pull request describing what changed and why.

## Validating changes

There is no build step or test suite. Validate manually:

```bash
node --check scripts/fetch-go-models.mjs   # syntax check
node scripts/fetch-go-models.mjs           # confirm the endpoint still works
```

If you changed the workflow or output structure, walk through the run mentally
against `references/output-format.md` and confirm all six sections are still
produced. If you changed model guidance, re-check the affected claims against the
sources listed in `references/data-sources.md` and update the verified-date notes.

## Reporting issues

Please include:

- The prompt you used and what you expected versus what happened.
- Your OpenCode version and your installed `oh-my-opencode-slim` version.
- Any relevant output, with secrets removed.

## License of contributions

By contributing, you agree that your contributions are licensed under the
project's license, **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)).
