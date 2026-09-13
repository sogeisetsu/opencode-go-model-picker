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
    "rankings": { "url": "https://livebench.ai/", "fetchedAt": null, "matched": 0 }
  },
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
  run, and re-fetch ranking scores when `sources.rankings.fetchedAt` is missing
  or stale (default freshness window: 7 days). Show the fetch date wherever a
  cached number is reported.

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
   LiveBench scores (agent step — see below) and write them into
   `models.<id>.score`, then set `sources.rankings.fetchedAt`. The TTL only avoids
   re-checking scores that are already cached: a **newly added or changed model
   always gets a fresh score lookup** even inside the window, and a **major plan
   change** (many ids added/removed) or an **explicit user request** forces a full
   score refresh.
2. Read prices and limits from `https://opencode.ai/docs/go/` and compare them
   with the cached values; deep-verify capabilities (especially vision) from the
   lab's own docs only for the added or changed models.
3. Reuse the cached values for everything else.

This is what saves tokens: one compact diff instead of re-reading every page,
ranking scores cached for a week, and deep verification limited to the models
that actually changed.

## Ranking source

**Primary — LiveBench** (verified 2026-09-13):

- Site: `https://livebench.ai/`. Provides Overall plus Reasoning / Coding /
  Agentic Coding / Mathematics / Data Analysis / Language / Instruction Following,
  and a cost-per-successful-task column.
- Data is **Apache-2.0** and there are no fees. There is **no stable
  machine-readable endpoint** (the site is a single-page app and the underlying
  Hugging Face dataset is per-task judgments, not the aggregated table), so the
  agent refreshes scores by reading the LiveBench page and writing them into the
  snapshot. This is deliberately a TTL step, not a per-run one.
- Raw data (if needed): Hugging Face `livebench/model_judgment`, split
  `leaderboard`, columns `question_id, task, model, score, turn, tstamp,
  category`.

**Optional coding cross-check — SWE-bench**:

- `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/main/data/leaderboards.json`
  (public JSON, `% Resolved` per model).

Never merge a score from a source that does not clearly map to the model. If no
source covers a model, leave `score` null and mark it for manual verification.

## Name matching

OpenCode Go model ids (`opencode-go/<id>`) rarely equal a ranking site's model
name. When refreshing scores, match by normalized name and record the exact
matched name in `score.modelName` so it can be audited. Never fuzzy-match
silently; if nothing clearly matches, leave the score unset.
