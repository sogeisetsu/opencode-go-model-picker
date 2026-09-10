# AGENTS.md

Guidance for OpenCode agents working in this repository. This file is loaded
automatically for sessions in this project, so it describes both what the project
is and the conventions to follow.

## What this project is

`opencode-go-model-picker` is an **OpenCode Agent Skill**. When loaded, it picks or
rebalances which OpenCode Go model each `oh-my-opencode-slim` agent uses, based on
the **latest** Go plan, and returns recommendations with fallback chains.

It is **read-only by default**: it must never edit a user's config without a
preview and explicit confirmation. It never invents prices, limits, or model IDs —
every figure carries a source and fetch date, and anything unverifiable is flagged
for manual verification.

The skill is `SKILL.md`. Supporting specs live in `references/`; the live catalog
fetcher is `scripts/fetch-go-models.mjs`.

## Repository layout

| Path | Responsibility |
|---|---|
| `SKILL.md` | The skill: frontmatter, iron rules, workflow, allocation and fallback policies, schema notes. |
| `references/data-sources.md` | Where to fetch live Go plan data and how to parse it. |
| `references/output-format.md` | The exact six-part report the skill produces. |
| `scripts/fetch-go-models.mjs` | Prints the live Go model catalog as JSON. |
| `scripts/generate-assets.mjs` | Regenerates the SVG icon, banners and local badges. |
| `assets/` | Generated SVG icon, banners, and `assets/badges/`. |
| `README.md` / `README-ZH.md` | English / Chinese README — **both stay in the repo root**. |
| `zh/` | Chinese docs other than README (`CONTRIBUTING-ZH.md`, `CHANGELOG-ZH.md`; local-only files are gitignored). |
| `CONTRIBUTING.md` / `CHANGELOG.md` | English docs (root). |
| `LICENSE` | GPL-3.0-or-later. |

## Commands

```bash
node scripts/fetch-go-models.mjs     # print the live catalog (needs network)
node scripts/generate-assets.mjs     # regenerate assets/ from scratch
node --check scripts/*.mjs           # syntax check
```

There is no build step or test suite. Validate docs and links manually.

## Conventions

- **Language:** respond to the user in Chinese. Keep English where it is natural
  or required (technical terms, commands, paths, identifiers, the project name).
  Do not force-translate English terms.
- **Docs layout:** English docs at the root; `README-ZH.md` stays at the root;
  every other Chinese doc goes under `zh/`. When moving files, fix **all** links
  and `<img src>` targets, and verify they resolve.
- **Project name stays English**, even inside Chinese documents.
- **Assets:** edit `scripts/generate-assets.mjs` and re-run it; do not hand-edit
  the generated SVGs. Assets are local (no external badge/image services).
- **Skill facts:** never invent prices/limits/model IDs. Verify capabilities from
  each model's own lab documentation, especially vision for the `observer` agent.
- **Commits:** English, concise, semantic prefix (`docs:`, `feat:`, `fix:`,
  `chore:`). Use the repository-local git identity (do not touch global config):
  `sogeisetsu` / `sogeisetsu@users.noreply.github.com`.
- Do not push or create a remote unless asked.

## Current state

- Local git repository, branch `main`, **no remote configured yet**.
- License: **GPL-3.0-or-later**.
- The repo URL in docs uses `https://github.com/sogeisetsu/opencode-go-model-picker`.

## Local-only files (gitignored, may exist on this machine)

- `zh/skill-zh.md` — Chinese reading copy of `SKILL.md`.
- `zh/repo-init-guide-zh.md` — the user's general repository-init preferences.
- `.openchamber/` — browser screenshots/artifacts.

These are intentionally absent from a fresh clone.
