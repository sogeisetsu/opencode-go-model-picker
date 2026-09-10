# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[中文版](zh/CHANGELOG-ZH.md)

## [Unreleased]

### Added

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
- Added `AGENTS.md` so future agent sessions in this repo know the project and its
  conventions.
- Added a git-ignored Chinese repository-init preferences guide at
  `zh/repo-init-guide-zh.md`.
- Moved the Chinese `CONTRIBUTING` and `CHANGELOG` into `zh/`, and added a
  git-ignored Chinese reading copy of `SKILL.md` at `zh/skill-zh.md`.
- Repository files: `LICENSE` (GPL-3.0-or-later), `.gitignore`,
  `.gitattributes`, and `CONTRIBUTING.md`.

[Unreleased]: https://github.com/sogeisetsu/opencode-go-model-picker/commits/main
