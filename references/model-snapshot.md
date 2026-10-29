# Model Snapshot (token-saving cache)

The skill keeps a small, normalized snapshot of the OpenCode Go model catalog and
model ability scores, so each run does not re-derive everything from long pages.
It is a **cache, not a source of truth**: every value keeps its source URL and
fetch date, and anything stale or missing is re-fetched or marked for manual
verification.

Sections:

- Location
- Schema (v3)
- Backward compatibility (v2 files)
- Refresh policy
- Failure handling
- Bundled price seed
- Bundled score seed
- Ranking source
- Name matching

## Location

`~/.cache/opencode/opencode-go-model-picker/snapshot.json`

On Windows: `%USERPROFILE%\.cache\opencode\opencode-go-model-picker\snapshot.json`.

Override the path with `--snapshot <path>` when running the refresh script.

To read it without loading the whole file, run `node scripts/snapshot-summary.mjs` — a compact digest with `--ids <id,...>`, `--trait <trait>`, and `--json`.

## Schema (v3)

```json
{
  "schemaVersion": 3,
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
  "plan": {
    "go": {
      "fiveHourUsd": null, "weeklyUsd": null, "monthlyUsd": null,
      "provisional": true, "source": null, "at": null
    }
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
        "cacheWritePer1M": null,
        "context": null,
        "outputLimit": null,
        "ctxTiers": [],
        "capUsd": null,
        "peak": null,
        "monthlyLimitUsd": null,
        "estReq5h": null,
        "estReqWeek": null,
        "estReqMonth": null,
        "promo": null,
        "promoUntil": null,
        "status": null,
        "priceSource": null,
        "planSource": null,
        "upstreamUpdatedAt": null,
        "priceVerifiedAt": null,
        "planVerifiedAt": null
      },
      "billing": {
        "observedCostUsdPerRequest": null,
        "requests": null,
        "costUsd": null,
        "window": null,
        "source": null,
        "at": null
      },
      "availability": {
        "geoExcluded": [],
        "trainsOnData": null,
        "needsRegionSetting": null
      },
      "capabilities": {
        "imageInput": { "supported": null, "source": null, "verifiedAt": null }
      },
      "provenance": "https://opencode.ai/docs/go/",
      "verifiedAt": null
    }
  },
  "usage": {
    "agentSplit": {}
  },
  "calibration": {
    "biasDbVsConsole": null,
    "at": null,
    "note": "recompute each run; warn on >10% drift"
  }
}
```

The v3 additions, in words:

- **`plan.go`** — the reverse-solved plan pool (`fiveHourUsd`, `weeklyUsd`,
  `monthlyUsd`) with `provisional`, its `source`, and `at`. Written by
  `scripts/calibrate-usage.mjs --write` **only when the pool could actually be
  solved** (`pool.level` 1 or 2); when no percentage is available it leaves an
  existing `plan.go` untouched rather than restamping a stale number as fresh.
- **`models.<id>.billing`** — observed cost per request plus the request and cost
  totals it came from, with the `window` they cover (`last-30d`,
  `billing-month`). `source: "local-db"` for the per-model split (the local
  database is what carries per-model cost); `"console"` only when a per-model
  Console split was actually provided. This is what makes "official vs observed
  requests" printable (`references/data-sources.md` §Estimated request counts).
- **`models.<id>.availability`** — `geoExcluded` (region codes), `trainsOnData`,
  `needsRegionSetting` when a model only works after a privacy setting is changed.
  `null` = not verified, never "safe".
- **`models.<id>.capabilities`** — one object per capability, each with its own
  `source` and `verifiedAt`, so a lab-doc verification is auditable. A `null`
  `supported` is "unverified", not "text-only" (Iron Rule 5).
- **`usage.agentSplit`** — each agent's share of spend (a fraction), used for the
  report's per-agent occupancy and the main-agent share line.
- **`calibration`** — the DB-vs-Console bias, its date, and the >10% drift rule
  (`references/quota-math.md` §Calibration constants).

The `score` numbers are **Arena ELO ratings** (roughly 1100–1800), not 0–100
scores. `overall` comes from the text arena, `coding` from the Code Arena
(`webdev`), `vision` from the vision arena.

`models.<id>.price` is the committed price-seed entry copied verbatim (21 keys —
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
- **Key ownership.** `refresh-snapshot.mjs` owns `schemaVersion` and
  `sources.catalog`; `refresh-scores.mjs` owns `sources.rankings` and
  `models.<id>.score`; `refresh-prices.mjs` owns `sources.prices` and
  `models.<id>.price`; `calibrate-usage.mjs --write` owns `plan`,
  `models.<id>.billing`, `usage.agentSplit` and `calibration`. Each writer
  preserves every other key, so running one never erases another's work.

## Backward compatibility (v2 files)

A v2 snapshot stays readable and needs no rebuild:

- Every v3 key is optional: missing → `null` (or `{}` / `[]` for the containers),
  and every reader treats that as "unverified" instead of failing.
- `schemaVersion` is only bumped by a writer that actually adds a v3 key; reading a
  v2 file never rewrites it.
- When `models.<id>.price` disagrees with `references/model-prices.json`, the seed
  wins: the snapshot only caches what this run resolved.
- A missing or broken snapshot is never silently rebuilt (it holds
  `preferences.mode`); `refresh-snapshot.mjs --rebuild` is the deliberate reset.

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
5. When a Console bill exists, calibrate once with
   `node scripts/calibrate-usage.mjs --console-cost <usd> --console-requests <n> --month-pct <pct> --write`
   (add `--console-month-cost <usd>` when the Console shows a cycle spend). It
   writes `plan`, `models.<id>.billing`, `usage.agentSplit` and `calibration`;
   without `--write` it only reports.

This is what saves tokens: one compact diff instead of re-reading every page,
scores that usually come straight from the committed seed, and deep verification
limited to the models that actually changed.

## Failure handling

- **Windows + system proxy.** Every network script re-executes itself with
  `NODE_USE_ENV_PROXY=1` when a system proxy is set, so the documented commands
  work unchanged behind a proxy (`--no-env-proxy` opts out). `NODE_USE_ENV_PROXY`
  needs Node 24+ or a 22.x build that backported it (verified on 22.23.1); on an
  older runtime the variable does nothing and a script warns on stderr — the fetch
  then looks like a plain network failure, so check the warning before falling
  back. Setting `$env:NODE_USE_ENV_PROXY=1` (PowerShell syntax) yourself is still
  harmless and skips one process spawn. Decide success from the script's stdout
  JSON (`catalog.error: null` or a valid summary) — stderr warnings and a
  PowerShell exit code of 1 are NOT failures; that exit code comes from the outer
  shell/tool treating stderr output as failure, not from PowerShell itself. A
  genuine failure is stdout `catalog.error: "fetch failed"`; then follow the
  existing cache → seed → data-unavailable fallback.
- **The snapshot cannot be read (broken JSON, half-written file).** The refresh
  scripts exit 1 with `cannot read …` and leave the file untouched: it also holds
  user state (`preferences.mode`), so it is never rebuilt silently. Run the three
  refreshes **serially** — `refresh-snapshot.mjs` → `refresh-scores.mjs` →
  `refresh-prices.mjs` — and never as parallel tool calls; writes are atomic
  (temp file + rename), so two concurrent refreshes lose a race instead of
  clobbering each other, and the loser's result is simply re-run. If the file is
  genuinely beyond repair, `node scripts/refresh-snapshot.mjs --rebuild` discards
  it (the seeded scores/prices are re-fetched, and the mode is re-asked once).
- **`refresh-scores.mjs` / `refresh-prices.mjs` cannot reach HF / models.dev** →
  use the committed seeds (`references/model-scores.json`,
  `references/model-prices.json`) and label every number with the seed's own
  date. If the seed is stale (board `publishDates` / `upstreamUpdatedAt` no
  longer match live) → report the value as `null` and mark it
  manual-verification-required; never guess.
- **Node.js missing or a script exiting non-zero** → state that the script path
  degraded and include the script's error text; fall back to direct fetch plus
  the seeds.
- **Discovery finding zero custom agents** → report the inventory with its
  adapter warnings and stop before allocating; if the user insists sources
  exist, re-run the adapters and ask which source file to read.

## Bundled price seed

`references/model-prices.json` is a committed per-model price seed, keyed by Go
model id, so an offline or first run does not have to guess numbers.

- It holds, per model: `inputPer1M`, `outputPer1M`, `cacheReadPer1M`,
  `cacheWritePer1M`, `context`, `outputLimit`, `ctxTiers`, `capUsd`, `peak`,
  `monthlyLimitUsd`, `estReq5h`, `estReqWeek`, `estReqMonth`, `promo`,
  `promoUntil`, `status`, `priceSource`, `planSource`, `upstreamUpdatedAt`,
  `priceVerifiedAt`, `planVerifiedAt`. `null` means "not verified" and is never
  filled by guessing.
- **Freshness rule: upstream identity plus full coverage.** The seed is reused
  only while it covers every current Go catalog id **and** each entry's
  `upstreamUpdatedAt` equals that model's live models.dev `last_updated`;
  otherwise `refresh-prices.mjs --snapshot` fetches live.
- Price-side fields (`inputPer1M`, `outputPer1M`, `cacheReadPer1M`,
  `cacheWritePer1M`, `ctxTiers`, `context`, `outputLimit`) come from models.dev.
  Plan-side fields (`capUsd` / `monthlyLimitUsd`, `estReq*`, `peak`, `promo`,
  `promoUntil`, `status`) come from the plan page and are maintainer-verified; the
  script preserves them, never invents them. `capUsd` and `monthlyLimitUsd` are one
  fact under two names and are written together
  (`references/quota-math.md` §Where the constants live).
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
