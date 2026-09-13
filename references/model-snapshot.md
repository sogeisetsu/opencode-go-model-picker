# Model Snapshot (token-saving cache)

The skill keeps a small, normalized snapshot of the OpenCode Go model catalog and
model ability scores, so each run does not re-derive everything from long pages.
It is a **cache, not a source of truth**: every value keeps its source URL and
fetch date, and anything stale or missing is re-fetched or marked for manual
verification.

## Location

`~/.cache/opencode/opencode-go-model-picker/snapshot.json`

On Windows: `%USERPROFILE%\.cache\opencode\opencode-go-model-picker\snapshot.json`.

Override the path with `--snapshot <path>` when running the refresh script.

## Schema (v1)

```json
{
  "schemaVersion": 1,
  "sources": {
    "catalog":  { "url": "https://opencode.ai/zen/go/v1/models", "fetchedAt": "ISO-8601", "count": 0 },
    "rankings": { "url": "https://livebench.ai/", "fetchedAt": null, "matched": 0, "tableDate": null, "seedUsed": false }
  },
  "preferences": { "mode": null, "answers": null, "chosenAt": null },
  "models": {
    "<go-model-id>": {
      "inputPer1M": null,
      "outputPer1M": null,
      "monthlyLimitUsd": null,
      "estReq5h": null,
      "estReqWeek": null,
      "estReqMonth": null,
      "context": null,
      "reasoning": null,
      "vision": null,
      "status": null,
      "score": {
        "overall": null,
        "reasoning": null,
        "coding": null,
        "agenticCoding": null,
        "math": null,
        "dataAnalysis": null,
        "language": null,
        "instructionFollowing": null,
        "costPerSuccessfulTaskUsd": null,
        "source": "https://livebench.ai/",
        "modelName": null,
        "fetchedAt": null
      },
      "provenance": "https://opencode.ai/docs/go/",
      "verifiedAt": null
    }
  }
}
```

Rules:

- `null` means "not yet verified" — never a guessed number.
- `sources.*.fetchedAt` is the ISO timestamp of the last successful fetch.
- A cached value must never outlive its usefulness: re-fetch prices/limits each
  run, and refresh ranking scores when `sources.rankings.fetchedAt` is missing or
  stale (default freshness window: 7 days). Show the fetch date wherever a cached
  number is reported.
- Ranking scores are refreshed by `scripts/refresh-scores.mjs`, never by a
  browser — see "Bundled score seed" and "Ranking source" below.
- `preferences.mode` is the remembered recommendation mode (`budget` /
  `balanced` / `quality`). When it is set, use it without asking again; a mode
  named in the request always wins. `preferences.answers` keeps the diagnostic
  answers and `preferences.chosenAt` when it was chosen. This is skill state, not
  agent config — the skill still never edits the user's agent configuration.

## Refresh policy

Run this at the start of every run:

```bash
node scripts/refresh-snapshot.mjs
```

It fetches the live catalog (`https://opencode.ai/zen/go/v1/models`), diffs the
ids against the snapshot, reports `added` / `removed`, writes the snapshot back,
and prints a compact JSON diff. Removed ids are kept (so cached scores survive a
temporary disappearance); pass `--prune` to drop them.

Then:

1. If `sources.rankings.fetchedAt` is missing or older than 7 days, refresh the
   scores with the bundled helper (no browser):

   ```bash
   node scripts/refresh-scores.mjs --snapshot ~/.cache/opencode/opencode-go-model-picker/snapshot.json
   ```

   It reuses the committed [`model-scores.json`](model-scores.json) seed when that
   seed is still current, and only downloads the raw LiveBench table when it is
   not (see "Bundled score seed"). It writes `models.<id>.score` and updates
   `sources.rankings`. The TTL only avoids re-checking scores that are already
   cached: a **newly added or changed model** always gets a fresh lookup even
   inside the window, and a **major plan change** (many ids added/removed) or an
   **explicit user request** forces a refresh.
2. Read prices and limits from `https://opencode.ai/docs/go/` and compare them
   with the cached values; deep-verify capabilities (especially vision) from the
   lab's own docs only for the added or changed models.
3. Reuse the cached values for everything else.

This is what saves tokens: one compact diff instead of re-reading every page,
scores that usually come straight from the committed seed, and deep verification
limited to the models that actually changed.

## Bundled score seed

`references/model-scores.json` is a committed snapshot of LiveBench scores, so a
first run does not have to download and parse the table.

- It is keyed by Go model id and carries `source.tableDate`, `derived: true` with
  the aggregation formula, and `fetchedAt` per model.
- **Freshness rule: upstream table unchanged.** The seed is reused only when its
  `source.tableDate` equals the latest `table_*.csv` date in the LiveBench repo
  **and** it has an entry for every current Go catalog id. LiveBench updates its
  table infrequently (roughly every few months), so a wall-clock TTL would mark the
  seed stale almost always; identity with the upstream table is the honest test.
- If the seed is not current, `refresh-scores.mjs --snapshot` downloads the table
  and merges fresh scores instead — still without a browser.
- The seed is a **cache, not a source of truth**: it carries source + date, is
  ignored when stale, and `null` scores are never filled in by guessing. Overall
  and category numbers are **derived** by this project from LiveBench's task
  columns, not a field LiveBench publishes.
- Maintainers regenerate it with `node scripts/refresh-scores.mjs` and commit the
  result. If nobody does, the seed simply stops being reused (runs fetch instead);
  nothing breaks.

## Ranking source

**Primary — LiveBench** (verified 2026-09-13):

- Site: `https://livebench.ai/`. Provides Overall plus Reasoning / Coding /
  Agentic Coding / Mathematics / Data Analysis / Language / Instruction Following.
- The site is a single-page app, but its repository serves the raw table as static
  files, so **no browser is needed**:
  - `https://github.com/LiveBench/livebench.github.io/tree/main/public`
  - `table_<YYYY_MM_DD>.csv` — `model` + one column per task (23 tasks)
  - `categories_<YYYY_MM_DD>.json` — task → category map
- License: **Apache-2.0**; no fees, no key.
- `scripts/refresh-scores.mjs` reads those files with `fetch`, derives Overall and
  the per-category scores by averaging the task columns (using LiveBench's own
  category map), and writes them to the seed or the snapshot.
- The static table has **no cost column**, so `costPerSuccessfulTaskUsd` stays
  `null`. That is deliberate: `null` means "not verified", never a guessed number.
- Raw per-task data (if ever needed): Hugging Face `livebench/model_judgment`,
  split `leaderboard`, columns `question_id, task, model, score, turn, tstamp,
  category`.

**Optional coding cross-check — SWE-bench**:

- `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/main/data/leaderboards.json`
  (public JSON, `% Resolved` per model).

Never merge a score from a source that does not clearly map to the model. If no
source covers a model, leave `score` null and mark it for manual verification.

## Name matching

OpenCode Go model ids (`opencode-go/<id>`) rarely equal a ranking site's model
name. `scripts/refresh-scores.mjs` matches conservatively: an exact normalized
match, or a prefix whose remaining tokens are all known effort/variant labels
(`thinking`, `high`, `preview`, …) or numeric date stamps. It records the exact
matched name in `score.modelName` so it can be audited. It never fuzzy-matches
silently; if nothing clearly matches, the score stays `null`.
