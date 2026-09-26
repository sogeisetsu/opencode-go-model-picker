# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[Chinese version](zh/CHANGELOG-ZH.md)

## [Unreleased]

## [1.1.0] - 2026-09-26

### Changed

- Reworked the output format from a six-part report into a three-part body plus
  a data appendix: a **recommendation table** (one row per custom agent — agent
  name, capability focus (trait), current model, recommended model, and the
  cost/throughput/capability reason, with ⚠ markers for limited-time, geo, or
  training caveats), **paste-ready config** (a complete copy-pasteable JSONC
  block per detected source — `oh-my-opencode-slim.json` for the slim preset,
  `opencode.jsonc` for a native `agent` block, both when both are detected, with
  fallback chains preserved where the source supports them), and **highlights**
  (one paragraph covering mode + rationale, price ceiling, full caveat text, and
  plan changes vs the last snapshot), followed by a **data appendix** (sources
  and fetch dates with seed labeling, the snapshot diff, the relevant-models
  price table, the first-run decision-factors table, the manual-verification
  list, and the verify commands). The apply gate is unchanged: the skill still
  stops and asks before touching any config. Synced across `README.md` /
  `README-ZH.md`, `CONTRIBUTING` (EN/ZH), `docs/index.html`, and
  `test-prompts.json`.

## [1.0.0] - 2026-09-25

### Added

- Added a committed price seed (`references/model-prices.json`) and
  `scripts/refresh-prices.mjs`, which reads the models.dev `opencode-go`
  provider into per-model `inputPer1M` / `outputPer1M` / `cacheReadPer1M` /
  `context` / `outputLimit`, plus maintainer-verified monthly limit, estimated
  request, promo, and status fields. `null` means not verified and is never
  guessed. The seed is reused only while every entry's `upstreamUpdatedAt` still
  equals the live models.dev `last_updated` and it covers the catalog; when the
  plan pages cannot be fetched the skill reads the seed directly as a dated
  offline fallback, and a live read always wins.
- Added a first-run mode diagnostic: when the request names no mode and none is
  remembered, the skill asks two short weighted questions (main goal 0.7, main
  task 0.3), resolves them through a table, stores the answer in
  `snapshot.preferences` (`mode`, `answers`, `chosenAt`), and reuses it on later
  runs. An explicitly named mode always overrides it, and skipping the questions
  falls back to `balanced`.
- Added an auditable decision-factors table to the report: each of the two
  first-run diagnostic questions is listed with its answer and its weight, so
  the chosen mode can be traced back to the inputs rather than taken on faith.
- Declared the never-commit-to-`main` rule in `CONTRIBUTING` (EN/ZH) as Ground
  rule 6: every change starts on a topic branch cut from `main` (`feat/…`,
  `fix/…`, `docs/…`, `chore/…`) and merges back to `main` only after the checks
  pass. The rule applies to maintainers too, so `main` stays green and
  reviewable; "Making a change" step 1 now points at it.
- Added a committed LMArena score seed (`references/model-scores.json`) and
  `scripts/refresh-scores.mjs`, which reads the official LMArena leaderboard
  dataset through the Hugging Face datasets-server (no key, no browser) and uses
  Arena ELO from three boards (overall / coding / vision). The seed is reused only
  while its `source.publishDates` match the live boards and it covers the current
  catalog; otherwise the script fetches fresh. Cost stays `null` because the
  dataset has no cost column, and the script auto-enables a configured system
  proxy.
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
- Added **estimated request counts** (per 5h / week / month) as a first-class
  signal: equal monthly dollar limits do not mean equal throughput, so the skill
  now reads the counts from the plan pages (the landing page is the more timely
  one) and prefers the higher count when price and capability tie. The snapshot
  schema and report gained `est req/week` and `est req/month`.
- Added mandatory **caveat flags** for picks that depend on a limited-time
  multiplier (with the base limit it falls back to), for geo-restricted models,
  and for privacy-for-discount "Contributor" tiers that train on the user's
  prompts and completions (opt-in, never recommended silently).
- Added a **balanced price ceiling**: the priciest pick for a normal high-volume
  agent should be only slightly above the current cheap-but-capable baseline
  (DeepSeek V4.1 Flash at the time of writing) and clearly stronger; otherwise
  the baseline itself is the pick.
- Updated the banner subtitles to say plainly "the right OpenCode Go model for
  every custom agent".
- Extended `scripts/check-docs.mjs` into a one-stop documentation check: it now
  also validates frontmatter (including the unquoted `: ` case that silently broke
  `SKILL.md`) and verifies English docs contain no CJK characters. Added a
  terminology section to `CONTRIBUTING` (EN/ZH) that pins "custom agent" vs
  "built-in agent" and warns against "native OpenCode" as a synonym for custom.
- Added a persistent model snapshot cache
  (`~/.cache/opencode/opencode-go-model-picker/snapshot.json`) and
  `scripts/refresh-snapshot.mjs`, which diffs the live catalog and prints a
  compact added / removed diff so runs only re-verify what changed. Ranking
  scores (LMArena, Arena ELO) are cached with a 1-day TTL. Documented in
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
- Added an explicit `## Failure Modes (if → then → still failing)` table
  covering serial refresh on snapshot write races, dated seed/cache fallbacks,
  local-registry `status` verification for non-Go fallback ids, and the
  zero-agent stop branch.
- Added visible 🛑/🔴 checkpoint markers at the output gate, the first-run mode
  diagnostic, and the apply gate.

### Changed

- Rewrote both READMEs in a plainer, more readable style, regrouping them so the
  project is easy to understand at a glance.
- Clarified scope: the skill recommends models only for custom agents, and a
  custom agent stays in scope even without fallback-chain support. Built-ins are
  skipped "including but not limited to" the known list, since OpenCode's set can
  change between versions. Added an explicit, optional suggestion to use a
  chain-capable tool, and fixed snapshot wording that described the diff as
  `changed` even though the script reports only `added` / `removed`.
- Corrected the `budget` fallback sequence (cheapest Go → next-cheapest Go) and
  made the per-source schema rule say "custom native agents".
- Deduplicated the refresh strategy to a single source of truth (the
  `Snapshot Cache` section), and disambiguated Failure Modes row 5 (explicit
  `deprecated` / `removed` blocks; an absent `status` field means
  default-active).
- README (EN/ZH) now document the explicit failure-path handling.

### Fixed

- `scripts/refresh-snapshot.mjs` no longer drops top-level keys such as
  `preferences` on write, so the remembered recommendation mode actually
  persists; snapshot `schemaVersion` now writes `2` to match
  `references/model-snapshot.md`.
- `scripts/refresh-prices.mjs` output now separates seed coverage
  (`seedUsed`), priced count (`priced 40/42`), and null-upstream ids instead of
  a misleading `matched` number.

[Unreleased]: https://github.com/sogeisetsu/opencode-go-model-picker/commits/main
[1.1.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.1.0
[1.0.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.0.0
