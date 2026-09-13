# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[Chinese version](zh/CHANGELOG-ZH.md)

## [Unreleased]

### Added

- Generalized agent discovery beyond `oh-my-opencode-slim`: the skill now reads
  native OpenCode agents (the `agent` key in `opencode.json`/`opencode.jsonc`,
  and Markdown files under `~/.config/opencode/agents/` or `.opencode/agents/`)
  and other plugins that inject agents, through source adapters described in the
  new `references/agent-sources.md`. The allocation policy now works on role
  traits, with known-role overrides preserving the previous per-agent behavior.
- Added three recommendation modes trading performance against price: `budget`
  (cheapest acceptable), `balanced` (default), and `quality` (strongest
  capability). The chosen mode is stated in the report, with a reason when it is
  not the default.
- Added a persistent model snapshot cache
  (`~/.cache/opencode/opencode-go-model-picker/snapshot.json`) and
  `scripts/refresh-snapshot.mjs`, which diffs the live catalog and prints a
  compact added / removed diff so runs only re-verify what changed. Ranking
  scores (LiveBench, Apache-2.0) are cached with a 7-day TTL. Documented in
  `references/model-snapshot.md`.
- Restricted recommendations to **custom** agents: OpenCode's built-in agents
  (`build`, `plan`, and the built-in subagents) are intentionally skipped.
- Broadened the READMEs, banners, and references from `oh-my-opencode-slim`-only
  wording to all agent sources, and softened the fallback-chain note to a
  suggestion rather than a requirement.
- Initial public scaffolding of the `opencode-go-model-picker` skill.
- Skill instructions in `SKILL.md`, with the plan data-source reference
  (`references/data-sources.md`) and the output-format reference
  (`references/output-format.md`).
- Catalog fetcher script `scripts/fetch-go-models.mjs`.
- Bilingual documentation: English (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`)
  and Chinese (`README-ZH.md`, `CONTRIBUTING-ZH.md`, `CHANGELOG-ZH.md`).
- Visual assets under `assets/` (SVG icon, dot-matrix English and Chinese banners,
  and local SVG badges) with a centered README header — no external image or badge
  services, so the docs render offline.
- Banners restyled: `Go` in Xiaomi orange, `Model Picker` in the project green,
  and an old typewriter monospace face (Courier) for every word except the
  dot-matrix `OpenCode`, whose glyphs now share one baseline and an integer grid.
- Added a git-ignored Chinese repository-init preferences guide at
  `zh/repo-init-guide-zh.md`.
- Documented in the READMEs that `AGENTS.md` is intentionally not committed (for
  privacy), with shareable conventions living in `CONTRIBUTING.md`.
- Expanded the Installation section in both READMEs: a minimal-install note
  (`SKILL.md` + `references/` + `scripts/` only) and a copy-paste prompt for
  letting an AI agent install the skill.
- Fixed the `oh-my-opencode-slim` links in both READMEs; they pointed to
  `code-yeongyu/oh-my-openagent` instead of `alvinunreal/oh-my-opencode-slim`.
- Added `scripts/check-docs.mjs` to verify relative links and English/Chinese
  doc-pair sync, and documented it in `CONTRIBUTING` (both languages) and the
  local `AGENTS.md`.
- Moved the Chinese `CONTRIBUTING` and `CHANGELOG` into `zh/`, and added a
  git-ignored Chinese reading copy of `SKILL.md` at `zh/skill-zh.md`.
- Repository files: `LICENSE` (GPL-3.0-or-later), `.gitignore`,
  `.gitattributes`, and `CONTRIBUTING.md`.

### Changed

- Rewrote both READMEs in a plainer, more readable style, regrouping them so the
  project is easy to understand at a glance.

[Unreleased]: https://github.com/sogeisetsu/opencode-go-model-picker/commits/main
