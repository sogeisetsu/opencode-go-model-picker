<p align="center">
  <img src="assets/icon.svg" width="112" height="112" alt="OpenCode Go Model Picker icon">
</p>

<h1 align="center">OpenCode Go Model Picker</h1>

<p align="center">
  <em>Plan-aware model selection for oh-my-opencode-slim agents — read-only, source-cited, fallback-ready.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="assets/badges/license.svg" alt="License: GPL-3.0-or-later"></a>
  <img src="assets/badges/version.svg" alt="Version 0.1.0">
  <img src="assets/badges/node.svg" alt="Node.js 18 or later">
  <img src="assets/badges/agent-skill.svg" alt="OpenCode Agent Skill">
  <img src="assets/badges/prs-welcome.svg" alt="PRs welcome">
</p>

<p align="center">
  <a href="README-ZH.md">Chinese documentation</a>
</p>

<p align="center">
  <img src="assets/banner.svg" alt="OpenCode Go Model Picker banner">
</p>

An [OpenCode](https://opencode.ai/) **Agent Skill** that picks cost-effective OpenCode Go models for every [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim) agent, with fallback chains, based on the **current** Go plan — read-only, and only ever applies changes after you confirm.

---

## What it is

OpenCode Go's plan changes constantly — per-model monthly dollar limits, limited-time usage multipliers, and models that appear or get retired. Any hardcoded model list goes stale. This skill makes the agent **fetch the plan fresh on every run**, compare it with your current config, and recommend a model (plus an ordered fallback chain) per agent, always reported with its **source and fetch date**.

It is deliberately conservative:

- **Never invents prices, limits, or model IDs.** Anything unverifiable is flagged as pending manual verification.
- **Read-only by default.** It produces a preview and applies changes only after you confirm via OpenCode's `question` tool.
- **Matches the installed plugin's schema**, not a random online doc.

## Requirements

- OpenCode with skills support (skills load from `~/.config/opencode/skills/`).
- [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim) **2.2.x** (the schema in that build is the source of truth).
- Node.js **18+** only if you run the optional catalog fetcher (tested on Node 22).

## Installation

Clone the repo directly into your OpenCode skills directory, so the folder name matches the skill's `name`:

**Linux / macOS**
```bash
git clone https://github.com/sogeisetsu/opencode-go-model-picker.git \
  ~/.config/opencode/skills/opencode-go-model-picker
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/sogeisetsu/opencode-go-model-picker.git `
  "$env:USERPROFILE\.config\opencode\skills\opencode-go-model-picker"
```

**Minimal install.** You don't need the whole repository — only `SKILL.md`,
`references/`, and `scripts/` are used at runtime. Copying just those three into
`~/.config/opencode/skills/opencode-go-model-picker/` is enough and saves space;
the rest (README, LICENSE, `assets/`, `zh/`, ...) is documentation only.

Verify the script runs:

```bash
node scripts/fetch-go-models.mjs   # prints { fetchedAt, source, count, ids }
```

### Let an AI agent install it

Copy the block below and paste it to your AI agent:

```text
Install the "OpenCode Go Model Picker" skill for me.

1. Get the repository: https://github.com/sogeisetsu/opencode-go-model-picker
2. Copy only these into my global OpenCode skills directory
   (~/.config/opencode/skills/opencode-go-model-picker/):
   - SKILL.md
   - references/
   - scripts/
3. Do not copy the rest of the repo (README, LICENSE, assets, ...).
4. Verify by running "node scripts/fetch-go-models.mjs" inside the installed
   folder and confirming it prints JSON.
5. Tell me the install path and whether it worked.
```

## Usage

Just ask, in natural language. Example prompts:

- "Pick the best OpenCode Go models for each of my oh-my-opencode-slim agents."
- "Is my current agent model config still a good fit for the current Go plan?"
- "Give me a paste-ready preset block for OpenCode Go, with fallbacks."

The agent then reads your config, fetches the plan, and returns a six-part report:

1. **Plan snapshot** — the models relevant to you, with source + fetch date.
2. **What changed** — new/removed models, changed limits/prices, active promos.
3. **Current** — the active preset and each agent's current chain (read-only).
4. **Recommendation** — per-agent chain, cost tier, and why.
5. **Paste-ready** — a JSONC preset block.
6. **Verify** — every unverified item, plus verification commands.

It then **stops and asks** before applying anything.

## How it works

The skill is a set of instructions (`SKILL.md`) plus lazily-loaded references. On a run, the agent:

1. **Reads current setup** (read-only): `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc`), `opencode.jsonc`, and the installed plugin's `oh-my-opencode-slim.schema.json`.
2. **Fetches the plan** from the sources below and builds a snapshot.
3. **Detects changes** versus the last snapshot, if any.
4. **Allocates a model per agent** using the role-to-traits policy in `SKILL.md`.
5. **Builds fallback chains** — an ordered `model: [a, b, c]` failover list (2-4 entries).
6. **Outputs** the six-part report and **asks for confirmation** before writing.

Background on the mechanics:

- Go limits are **per-model monthly dollar amounts**; the overall window is 5h = 20%, weekly = 50%, monthly = 100%. Because limits are per-model, a different Go model is still usable when one is capped — which is why the first fallback is often another Go model.
- An array like `model: ["a", "b", "c"]` is an ordered failover chain (verified against `oh-my-opencode-slim` 2.2.x `ForegroundFallbackManager`). If **all** entries fail, the session aborts — so a chain should always end on a model you can actually rely on.
- Capabilities are verified from each model's **own lab documentation**, never inferred from its name — this matters especially for **vision** input, which the `observer` agent needs.

## Data sources

Fetched fresh every run; full details and parsing notes in [`references/data-sources.md`](references/data-sources.md).

| Priority | Source | URL | Gives |
|---|---|---|---|
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model / price / monthly-limit table |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog ids (via `scripts/fetch-go-models.mjs`) |
| 4 | models.dev | https://models.opencode.ai/providers/opencode-go/ | context / output / price / capabilities |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change / deprecation log |

## Safety and privacy

- **Read-only by default.** The skill does not edit `oh-my-opencode-slim.json`, `opencode.jsonc`, or any config until you confirm, after which it shows the exact change.
- **Local reads:** your OpenCode config files under `~/.config/opencode/` and the installed plugin's schema.
- **Network access:** it fetches the public pages above and calls the unauthenticated `opencode.ai` models endpoint via the local Node script. It sends no credentials and no personal data.
- **No invented numbers:** every figure carries a source and fetch date; unverifiable values are flagged for manual verification.
- **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by OpenCode, SST, or any model vendor. Model names and prices belong to their respective owners.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) (English) or
[`CONTRIBUTING-ZH.md`](zh/CONTRIBUTING-ZH.md) (Chinese).

Note: for personal privacy, this project intentionally does **not** commit a
project `AGENTS.md`, contrary to the usual convention. Shareable project
conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) (English) or [`CHANGELOG-ZH.md`](zh/CHANGELOG-ZH.md) (Chinese).

## License

Copyright (C) 2026 sogeisetsu

Licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`).

This project is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

See [`LICENSE`](LICENSE) for the full text (the authoritative English version), or
[`zh/LICENSE-ZH.md`](zh/LICENSE-ZH.md) for an unofficial Chinese reference translation.

## Provenance

Built after surveying existing options (September 2026): no official or well-known skill does plan-aware OpenCode Go agent model selection. Closest analogs are the dashboard generator [`itsmylife44/cliproxyapi-dashboard`](https://github.com/itsmylife44/cliproxyapi-dashboard) (`oh-my-opencode-slim-config-generator.tsx`, MIT) and the cost-profile request [`code-yeongyu/oh-my-openagent#1768`](https://github.com/code-yeongyu/oh-my-openagent/issues/1768). Official Go data sources plus `oh-my-opencode-slim`'s static per-agent role guidance are reused here.
