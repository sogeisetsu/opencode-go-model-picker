# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[Chinese version](zh/CHANGELOG-ZH.md)

## [3.0.0] - 2026-11-01

### The size of the simplification

3.0.0 is not a feature release: it is the same job described with **an order of
magnitude less text**. Measured against the 2.0.0 tag:

| What the model must read | 2.0.0 | 3.0.0 | Change |
|---|---|---|---|
| Markdown files | 7 (`SKILL.md` + 6 references) | 2 (`SKILL.md` + `plan-facts.md`) | −5 files |
| Characters | 104,181 | 8,291 | **12.6× smaller** (−92%) |
| Lines | 1,776 | 168 | **10.6× fewer** (−91%) |
| Estimated tokens | ≈27,400 | ≈2,200 | **≈25,200 saved per full read** |
| `SKILL.md` alone | 18,804 chars ≈4,900 tok | 4,221 chars ≈1,100 tok | −78% |
| Runnable entry points | 9 scripts | 1 (`go.mjs`) | −8 |
| Minimal install zip | 128,802 B | 89,203 B | −31% |

A typical 2.0.0 run loaded `SKILL.md` plus two or three references (≈11–15k
tokens); the same run now loads 8.3k characters, about 2.2k tokens — roughly
**80–85% less context** before any work starts. Token figures are estimates at
3.8 characters/token (no tokenizer ships with the repo); character and line counts
are exact: `git show v2.0.0:SKILL.md | wc -c` and the same for each reference.

Code did not shrink — it moved: ~4,700 lines of scripts became ~5,300 lines of
modules plus tests, because the rules that used to be prose (refresh order, basis
selection, priced columns, chain shape, apply diff) are now enforced by code.

### Breaking

- **One entry point.** `scripts/go.mjs` replaces nine scripts — `discover-agents`,
  `probe-console`, `calibrate-usage`, `quota-math`, `refresh-snapshot`,
  `refresh-prices`, `refresh-scores`, `snapshot-summary` and `fetch-go-models` are
  gone. Four verbs: `run` (agents → Console → usage → refresh → plan diff → basis,
  one serial pass, one `run.json`), `report` (table, money columns, config blocks),
  `check` (the gate before delivery), `apply` (exact diff; writes only with
  `--write`, only the named file, only that agent's `model` value).
- **One reference.** `references/plan-facts.md` replaces `quota-math.md`,
  `model-snapshot.md`, `data-sources.md`, `agent-sources.md`, `console-mcp.md` and
  `output-format.md`. `SKILL.md` drops from ~19k to ~4k characters and is
  model-facing only; teaching moved to the READMEs.
- **Code over prose.** The refresh order (three writers, one snapshot file), the
  `Basis:` line and its denominator, the priced `$/session` column, chain-shape
  rules, seed staleness, mode resolution and the apply diff are computed, not
  described. The nine self-checks became `go.mjs check`.
- `apply` refuses a chain containing a dead id and refuses to write a result that
  does not re-parse.

### Added

- `node --test tests/*.test.mjs` (built-in `node:test`, no dependencies):
  `tests/golden/` holds outputs captured from the 2.0.0 scripts and covers pricing,
  discovery and the five Console states; CLI tests cover offline degradation, the
  report gate, and dry-run versus `--write`.
- `run --offline` always produces a dated, seed-labelled `run.json`; `data.quality`
  says `live` / `seed` / `none` instead of leaving the reader to infer it.

### Changed

- `scripts/check-docs.mjs` and `scripts/generate-assets.mjs` moved to `tools/`:
  they maintain the repository, not the skill, and are not part of the minimal
  install.
- Moved `test-prompts.json` to `tests/prompts.json` and documented it in the
  repository layout: it is an evaluation fixture (a request paired with the
  behaviour the skill must exhibit), not a runtime asset — nothing loads it.

## [2.0.0] - 2026-10-30

### Added

- `references/quota-math.md` and `scripts/quota-math.mjs`: the one priced-accounting
  implementation. Formula v2 prices each assistant message on its own timestamp,
  picks the price by the request's prompt length when a model has context-length
  tiers, applies the peak-hour multiplier only to models that declare one, and
  bills cache writes on the models that charge for them. Reasoning tokens are
  billed at the output rate, checked message-by-message against the provider's own
  per-message cost — omitting them under-prices a message by 4–34%. Derived quantities
  (share of cap, the three independent pool windows, sessions per window, official
  and observed capacity), the pool reverse-solve order, the eight known gaps, and
  the degradation rules for every missing field.
- `references/console-mcp.md` and `scripts/probe-console.mjs`: the five Console MCP
  states (`authorized` / `gated` / `unauthenticated` / `absent` / `unknown`),
  decided cheapest-first (in-run tool result → `opencode mcp list` → config → one
  `initialize` request), with the fixed per-state guidance copy, the three-level
  fallback, and the enabling steps for the OpenCode CLI and OpenChamber. The probe
  never prints a token and never classifies a network failure as "not set up".
- `scripts/calibrate-usage.mjs`: sums the local OpenCode SQLite database per agent
  and model, compares it with the Console's own cost to measure the bias (warning
  when it drifts more than 10%), reverse-solves the plan pool in the documented
  order, projects month-end occupancy from the billing cycle, and — with `--write`
  — stores `plan`, `models.<id>.billing`, `usage.agentSplit` and `calibration` in
  the snapshot.
- `references/model-prices.json` gained `cacheWritePer1M`, `ctxTiers`, `capUsd`,
  `peak`, `promoUntil` and a verified `status` per model, plus current
  `planVerifiedAt` dates. It is now the single home of price, cap, context tiers
  and peak hours.
- Snapshot schema v3: `plan.go`, `models.<id>.billing`, `availability`,
  `capabilities` (per-capability source + `verifiedAt`), `usage.agentSplit` and
  `calibration`.
- `scripts/discover-agents.mjs` now reports a run-level `deadChainIds` summary
  (`missing-from-catalog`, `retired`, `registry-missing`, `registry-deprecated`),
  warns on a shared chain head (`contention`) because the per-model cap is shared,
  and warns per agent when a Go id's catalog status is retired (`catalog`).
- `references/data-sources.md` gained a Console-bill (priority 0) section, a
  two-quota-layer section, official-vs-observed request counts, and a dated
  capability/compliance table (image input, training, retention, availability).
- `quota-math.mjs` reports seed freshness — `verifiedAt` (the newest
  `planVerifiedAt` / `priceVerifiedAt` in the table), `ageDays` and `stale` — and
  marks a seed older than seven days as expired, so an offline run labels its
  numbers instead of presenting them as current. `calibrate-usage.mjs` reports the
  same under `prices`.

### Changed

- The report now opens with a mandatory `Basis:` line (`Console bill
  (authoritative)` / `Estimate` / `Uncalibrated`) and one denominator for the whole
  table, and the table columns are the priced ones: headroom, accounted
  `$/session` (median · P90), share of the model cap, 10 runs as a share of the
  three pool windows, actual monthly occupancy, and why.
- A new `Usage evidence` block is mandatory: last-30-days spend and requests, a
  last-7-days pace with a month-end projection, the count of candidates without an
  ELO, the dead chain ids for this run, and the main agents' share of spend.
- `SKILL.md`'s workflow was reordered to discover → probe Console → read the bill
  and calibrate → refresh the snapshot → detect plan changes → allocate → build
  chains → output → stop, and now ends with nine explicit self-checks.
- `scripts/refresh-prices.mjs` reads the cache-write price and the context-length
  tiers from models.dev, and carries the plan-side constants (`capUsd` /
  `monthlyLimitUsd`, `peak`, `promoUntil`, `estReq*`, `status`) through a rewrite,
  so regenerating the seed no longer deletes them.
- `calibrate-usage.mjs --write` raises `schemaVersion` to 3 when it writes v3 keys;
  an existing v2 file is read as-is (every v3 key is optional).
- `references/agent-sources.md` states that a native `agent.<name>.model` cannot
  express a chain, and points at the chain-capable source when failover is wanted.
- Stale plan facts from the 2026-09/10 verifications were corrected against the
  2026-10-30 plan page (the DeepSeek V4.1 Flash 4x promo is gone; its cap is $80;
  peak/off-peak pricing replaced it).

### Breaking

- Output format: the previous table columns (role overview, capability focus,
  current model) are replaced by the priced columns, and the `Basis:` line is
  mandatory. A v1 report shape is no longer valid.
- Snapshot schema v2 → v3. Existing files stay readable, but the new fields are
  absent (hence `null`) until `calibrate-usage.mjs --write` runs.
- `references/model-prices.json` entry shape grew from 16 to 21 keys; anything
  reading that seed directly must tolerate the new fields.
- `SKILL.md`'s workflow numbering changed, so any prompt that referred to
  "step 2 = refresh" now points at the Console probe instead.

## [1.4.0] - 2026-10-17

### Added

- `scripts/lib/json-io.mjs` and `scripts/lib/proxy.mjs`: shared, dependency-free
  helpers for the bundled scripts — BOM-tolerant JSON reads, atomic writes (temp
  file + rename over the target), and the `NODE_USE_ENV_PROXY` re-exec that
  previously existed only inside `refresh-scores.mjs`. All four network scripts
  now honor a system proxy, and a runtime that cannot says so on stderr instead of
  failing as if the network were down.
- `scripts/discover-agents.mjs` now emits the inventory record
  `references/agent-sources.md` promises: `mode`, `hidden`, `traits` (derived from
  description + name + mode, known-role overrides included) and
  `provenance.fetchedAt`. Built-in names it skips are listed under
  `skippedBuiltins` instead of vanishing.
- New flags: `--include-builtin-names`, `--builtin`, `--extra-builtin`
  (`discover-agents.mjs`) and `--rebuild` (`refresh-snapshot.mjs`).

### Changed

- `scripts/refresh-*.mjs` write the snapshot atomically and refuse to rebuild an
  unreadable one: a snapshot that cannot be parsed exits 1 with a clear message
  and leaves the file — including the `preferences.mode` and cached scores it
  carries — untouched, instead of silently starting from an empty cache.
  `refresh-snapshot.mjs --rebuild` discards it on purpose.
- The version badge is generated from `SKILL.md`'s `metadata.version`, and
  `check-docs.mjs` now checks the badge and both changelogs against it, so
  committed drift like the badge saying 1.2.0 while the skill was at 1.3.0 cannot
  come back unnoticed.
- `SKILL.md` workflow step 2 states that the three refresh commands must run
  serially, never as parallel tool calls — they write the same snapshot.
- `references/agent-sources.md` documents the built-in name denylist (and why a
  skipped name is reported rather than dropped) and the trait-precedence rule.

### Fixed

- Known-role trait overrides match case-insensitively, so `Observer.md` resolves
  to the vision lane like `observer.md` does instead of falling back to the
  inferred signals.
- `readJsonFile` (and therefore every refresh script) treats only `ENOENT` as
  "no file": a permission or sharing failure is an error, so a snapshot that
  exists but cannot be read is never replaced by a fresh one. A failed atomic
  replace (a file held open on Windows) now names the path and says the previous
  file is intact, instead of a bare system error.
- `SKILL.md` step 1 tells the run to read `discover-agents.mjs`'s
  `skippedBuiltins` list and ask about entries that could be the user's own
  agents, so that visibility is actually used.
- The proxy warning now fires for every runtime below the verified version
  (22.23.1), not only for majors below 22.

## [1.3.0] - 2026-10-04

### Added

- Added `scripts/discover-agents.mjs`, a read-only, zero-dependency CLI that
  discovers the custom agents (slim preset + native agents) and validates their
  fallback chains — duplicate ids, chain length 2–4, non-Go ids not confirmed in
  the local registry, and vision-trait agents whose snapshot `vision` field is
  not set (a field check, not capability verification — Iron Rule 5 still
  requires the lab's own docs). Prints compact `{ agents, warnings }` JSON
  instead of hand-reading every config file.
- Added `scripts/snapshot-summary.mjs`, a read-only compact digest of the
  ~1,580-line `snapshot.json` (~97% fewer lines), so runs never have to read
  the raw snapshot whole. Supports `--ids` (restrict to given model ids),
  `--trait` (re-sort and mark the trait-relevant columns without dropping any
  model), and `--json` (the same digest as compact JSON); missing values print
  as `-` / `null`, never guessed, and any file error is a one-line
  `{"error": ...}` with a non-zero exit.
- The recommendation table gained a **role overview** column: a one-line
  plain-language description of each agent, taken from its `description` or the
  known-role baseline in `references/agent-sources.md`, rendered in the user's
  language.

### Changed

- Workflow step 4 now closes with a **dominance check**: within one run's
  snapshot, a chain slot whose model is no worse on price + throughput +
  trait-matched capability (the ELO board matching the agent's trait; a missing
  value means "not comparable") and strictly better on at least one axis
  replaces the dominated model; a kept dominated model must justify itself in
  the `why` column (e.g. cross-provider quota fallback).
- Documented the Windows refresh failure path: set
  `$env:NODE_USE_ENV_PROXY=1` before any `scripts/refresh-*.mjs`, judge success
  by the script's stdout JSON rather than the exit code or stderr noise, and
  treat stdout `catalog.error: "fetch failed"` as the real failure.

### Fixed

- Updated the vision verification record in `references/data-sources.md`
  (2026-10-03): `mimo-v2.6-flash`, `mimo-v2.6-pro`, and `deepseek-v4.1-flash`
  accept image input, with the Go catalog id / lab version name / API request
  model id distinction spelled out for DeepSeek, plus a fallback parse note for
  JS-rendered lab pages.

## [1.2.0] - 2026-09-29

### Changed

- Restructured `SKILL.md` around progressive disclosure: the body is now a
  decision surface (~158 lines, down from 325) instead of a digest of
  `references/`. Everything that duplicated a reference moved to its single
  owner — snapshot refresh mechanics and seed ownership to
  `references/model-snapshot.md`, the endpoint table and snapshot shape to
  `references/data-sources.md`, trait-derivation signals to
  `references/agent-sources.md`, and the first-run mode-resolution table to
  `references/output-format.md`.
- Every long reference gained a section list, and `SKILL.md` gained a
  `## References — read when` table mapping each file to the workflow step that
  needs it. The per-symptom failure branches moved out of the body into
  `## Failure handling` sections in `references/model-snapshot.md` and
  `references/data-sources.md`; the body keeps only the rule (never improvise
  numbers, use the dated fallbacks, report what is not covered).
- Removed volatile facts from always-loaded text: hardcoded vision model ids,
  the dated vision verification, the price claim attached to it, the
  balanced-baseline model name, the `oh-my-opencode-slim 2.2.x` pin in
  frontmatter, and the fallback-manager version assertion. The READMEs no longer
  pin a version either. Dated evidence stays in the references, where it belongs.
- Restored the per-source schema field list (native `agent.<name>` fields, the
  slim `model` / `fallback` keys, `tools` deprecated) as
  `references/agent-sources.md` §"Per-source schema fields" — the section
  `SKILL.md` already pointed at, which the rewrite had left without content.
- Unchanged by design: the six Iron Rules, the 🛑 apply gate and its four steps,
  the trait table, the known-role overrides, the three modes with their
  capability floors, the balanced price ceiling, and the fallback-chain rules.
  `zh/skill-zh.md` re-synced to match.

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
  `test-prompts.json` (since moved to `tests/prompts.json`).

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
[1.4.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.4.0
[1.3.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.3.0
[1.2.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.2.0
[1.1.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.1.0
[1.0.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.0.0
