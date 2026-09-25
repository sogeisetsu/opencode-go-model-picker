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

## Schema (v2)

```json
{
  "schemaVersion": 2,
  "sources": {
    "catalog":  { "url": "https://opencode.ai/zen/go/v1/models", "fetchedAt": "ISO-8601", "count": 0 },
    "rankings": {
      "url": "https://lmarena.ai/", "fetchedAt": null, "matched": 0, "seedUsed": false,
      "boards": { "overall": "text_style_control", "coding": "webdev", "vision": "vision" },
      "publishDates": { "overall": null, "coding": null, "vision": null }
    },
    "prices": {
      "url": "https://models.dev/api.json", "provider": "opencode-go",
      "fetchedAt": null, "total": 0, "priced": 0, "nullUpstream": [], "seedUsed": false
    }
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
        "matchedNames": { "overall": null, "coding": null, "vision": null },
        "overall": null,
        "coding": null,
        "vision": null,
        "rankOverall": null,
        "rankCoding": null,
        "rankVision": null,
        "voteCount": null,
        "costPerSuccessfulTaskUsd": null,
        "fetchedAt": null
      },
      "price": {
        "inputPer1M": null,
        "outputPer1M": null,
        "cacheReadPer1M": null,
        "context": null,
        "outputLimit": null,
        "monthlyLimitUsd": null,
        "estReq5h": null,
        "estReqWeek": null,
        "estReqMonth": null,
        "promo": null,
        "status": null,
        "priceSource": null,
        "planSource": null,
        "upstreamUpdatedAt": null,
        "priceVerifiedAt": null,
        "planVerifiedAt": null
      },
      "provenance": "https://opencode.ai/docs/go/",
      "verifiedAt": null
    }
  }
}
```

The `score` numbers are **Arena ELO ratings** (roughly 1100–1800), not 0–100
scores. `overall` comes from the text arena, `coding` from the Code Arena
(`webdev`), `vision` from the vision arena.

`models.<id>.price` is the committed price-seed entry copied verbatim (16 keys —
see "Bundled price seed"). The seed flags (`seedUsed`, `priced`, `nullUpstream`,
`total`, `fetchedAt`) live in `sources.prices`, not in the per-model entry.
`seedUsed: true` means the seed covered **every** catalog id (full coverage);
`priced` / `total` counts how many of those ids actually carry an upstream price,
and `nullUpstream` lists the ids models.dev does not price at all — `null`
upstream, not a gap in the seed. So `seedUsed: true` with `priced: 40` of
`total: 42` is consistent, not a partial seed.

Rules:

- `null` means "not yet verified" — never a guessed number.
- `sources.*.fetchedAt` is the ISO timestamp of the last successful fetch.
- A cached value must never outlive its usefulness: re-fetch prices/limits each
  run, and refresh ranking scores when `sources.rankings.fetchedAt` is missing or
  older than **1 day** (LMArena publishes often, and the freshness check is one
  cheap request per board). Show the fetch date wherever a cached number is
  reported.
- Ranking scores are refreshed by `scripts/refresh-scores.mjs`, never by a
  browser — see "Bundled score seed" and "Ranking source" below. The ability
  scale is **Arena ELO**, not 0–100.
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

On write-back the script owns exactly three top-level keys — `schemaVersion`,
`sources`, `models` — and preserves every other top-level key as-is, including
`preferences`. That is what lets the remembered mode (`preferences.mode`)
survive a refresh (2-space indent, key order unchanged).

Then:

1. If `sources.rankings.fetchedAt` is missing or older than 1 day, refresh the
   scores with the bundled helper (no browser, no key):

   ```bash
   node scripts/refresh-scores.mjs --snapshot ~/.cache/opencode/opencode-go-model-picker/snapshot.json
   ```

   It reuses the committed [`model-scores.json`](model-scores.json) seed when the
   three LMArena boards still publish the same dates, and only fetches the live
   boards when they do not (see "Bundled score seed"). It writes
   `models.<id>.score` and updates `sources.rankings`. A **newly added or changed
   model** always gets a fresh lookup, and a **major plan change** (many ids
   added/removed) or an **explicit user request** forces a refresh.
2. Refresh prices with the bundled helper:

   ```bash
   node scripts/refresh-prices.mjs --snapshot ~/.cache/opencode/opencode-go-model-picker/snapshot.json
   ```

   It reads the committed [`model-prices.json`](model-prices.json) seed when it
   covers the catalog and every `upstreamUpdatedAt` still equals models.dev's
   live `last_updated`, and otherwise fetches live; it writes
   `models.<id>.price` and `sources.prices` (see "Bundled price seed"). Live
   prices and limits always win over cached or seed values; the seed is read
   directly from disk only when the plan pages or models.dev are unreachable.
3. Read prices and limits from `https://opencode.ai/docs/go/` and compare them
   with the cached values; deep-verify capabilities (especially vision) from the
   lab's own docs only for the added or changed models.
4. Reuse the cached values for everything else.

This is what saves tokens: one compact diff instead of re-reading every page,
scores that usually come straight from the committed seed, and deep verification
limited to the models that actually changed.

## Bundled price seed

`references/model-prices.json` is a committed per-model price seed, keyed by Go
model id, so an offline or first run does not have to guess numbers.

- It holds, per model: `inputPer1M`, `outputPer1M`, `cacheReadPer1M`,
  `context`, `outputLimit`, `monthlyLimitUsd`, `estReq5h`, `estReqWeek`,
  `estReqMonth`, `promo`, `status`, `priceSource`, `planSource`,
  `upstreamUpdatedAt`, `priceVerifiedAt`, `planVerifiedAt`. `null` means "not
  verified" and is never filled by guessing.
- **Freshness rule: upstream identity plus full coverage.** The seed is reused
  only while it covers every current Go catalog id **and** each entry's
  `upstreamUpdatedAt` equals that model's live models.dev `last_updated`;
  otherwise `refresh-prices.mjs --snapshot` fetches live.
- Plan-page fields (monthly limit, est req, promo, status) are maintained by
  hand; the script only preserves them and never invents them.
- The seed may be read directly from disk when the plan pages or models.dev are
  unreachable — labelled a seed with its date, never presented as current. A
  live read always wins.
- Maintainers regenerate it with `node scripts/refresh-prices.mjs` and commit
  the result. If nobody does, the seed simply stops being reused (runs fetch
  instead); nothing breaks.

## Bundled score seed

`references/model-scores.json` is a committed snapshot of LMArena scores, so a
first run does not have to fetch and match the leaderboards.

- It is keyed by Go model id and carries `source.publishDates` (one date per
  board) plus `matchedNames` / `fetchedAt` per model.
- **Freshness rule: upstream boards unchanged.** The seed is reused only when its
  `source.publishDates` match the live `leaderboard_publish_date` of all three
  boards **and** it has an entry for every current Go catalog id. LMArena updates
  its leaderboards on its own cadence; identity with the upstream boards is the
  honest test rather than a wall-clock age.
- If the seed is not current, `refresh-scores.mjs --snapshot` fetches the live
  boards and merges fresh scores instead — still without a browser.
- The seed is a **cache, not a source of truth**: it carries source + date, is
  ignored when stale, and `null` scores are never filled in by guessing.
- Maintainers regenerate it with `node scripts/refresh-scores.mjs` and commit the
  result. If nobody does, the seed simply stops being reused (runs fetch instead);
  nothing breaks.

## Ranking source

**Primary — LMArena** (verified 2026-09-13):

- Site: `https://lmarena.ai/`. Arena ELO ratings from three boards:
  `text_style_control` (overall ability), `webdev` (Code Arena → `coding`), and
  `vision` (→ `vision`).
- Machine source: the official dataset `lmarena-ai/leaderboard-dataset`, served
  by the Hugging Face datasets-server (`/filter`), **no key and no browser**. The
  fields are `model_name, organization, license, rating, rank, vote_count,
  category, leaderboard_publish_date`; paginate with `offset` / `length=100`.
- `scripts/refresh-scores.mjs` reads those boards and writes the seed or the
  snapshot.
- There is **no cost column**, so `costPerSuccessfulTaskUsd` stays `null`. That is
  deliberate: `null` means "not verified", never a guessed number.
- When a system proxy is configured, the script re-executes itself with
  `NODE_USE_ENV_PROXY=1` so the normal command works unchanged (pass
  `--no-env-proxy` to opt out). This is only needed because Node's `fetch` does
  not read `HTTP(S)_PROXY` on its own.

Never merge a score from a source that does not clearly map to the model. If no
source covers a model, leave `score` null and mark it for manual verification.

## Name matching

OpenCode Go model ids (`opencode-go/<id>`) rarely equal an LMArena model name, and
LMArena names often carry an effort/variant suffix (`-max`, `-high`, `-preview`,
numeric dates). `scripts/refresh-scores.mjs` matches conservatively, per board:

- an exact normalized match wins; otherwise
- a prefix whose remaining tokens are all known effort/variant labels or numeric
  dates matches only when the candidate is unique on that board; a genuine
  multi-line ambiguity (for example `kimi-k2.5`, with both `-thinking` and
  `-instant`) stays `null`.

Every matched name is recorded in `score.matchedNames` so it can be audited. It
never fuzzy-matches silently; if nothing clearly matches, the score stays `null`.
