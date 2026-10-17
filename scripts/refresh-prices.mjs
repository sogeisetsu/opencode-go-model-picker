#!/usr/bin/env node
// opencode-go-model-picker — build the OpenCode Go price seed / merge prices into a snapshot.
// Copyright (C) 2026 sogeisetsu
//
// This file is part of opencode-go-model-picker, a skill that picks
// cost-effective OpenCode Go models for each OpenCode agent (native,
// oh-my-opencode-slim, or another plugin source).
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License along with
// this program. If not, see <https://www.gnu.org/licenses/>.
//
// Price source: the models.dev catalog (no key, no browser):
//
//   url:      https://models.dev/api.json
//   provider: "opencode-go" -> .models.<id>.cost / .limit / .last_updated
//   prices:   USD per 1M tokens (input, output, cache_read)
//   limits:   context / output window sizes
//
// The Go plan page fields (monthly $ limit, est req/5h/week/month, promos,
// status) live in HTML and are NOT scraped here: they are maintainer-verified
// and only carried through from a previously existing seed entry. `null` means
// "not verified" and is never guessed.
//
// Proxy: if HTTP(S)_PROXY is set, Node's fetch does not use it by default. Every
// network script re-executes itself with NODE_USE_ENV_PROXY=1 (see
// lib/proxy.mjs) so the documented command works unchanged behind a proxy. Pass
// --no-env-proxy to opt out.
//
// The snapshot is rewritten atomically and an unreadable snapshot is a hard
// error: it carries user state (`preferences`) next to the cache, so it is never
// silently rebuilt. An unreadable committed seed is only a warning — the script
// fetches live instead.
//
// Usage:
//   node scripts/refresh-prices.mjs                     # write references/model-prices.json
//   node scripts/refresh-prices.mjs --out <seed.json>
//   node scripts/refresh-prices.mjs --snapshot <snap.json>
//     # user path: reuse the committed seed when its upstream last_updated dates
//     # are still current, else fetch and merge fresh prices into the snapshot.
//   node scripts/refresh-prices.mjs --seed <seed.json>   # override the seed path
//   node scripts/refresh-prices.mjs --no-env-proxy
//
// Exit code: 1 on error, else 0.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFileAtomic } from "./lib/json-io.mjs";
import { maybeReexec } from "./lib/proxy.mjs";

maybeReexec();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_URL = "https://opencode.ai/zen/go/v1/models";
const PROVIDER = "opencode-go";
const PLAN_URL = "https://opencode.ai/docs/go/";
// Snapshot schema version — keep in sync with references/model-snapshot.md
// ("Schema (v2)"). Not to be confused with the price seed's own schemaVersion.
const SNAPSHOT_SCHEMA_VERSION = 2;

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const snapshotArg = argValue("--snapshot");
const outArg = argValue("--out");
const seedPath = argValue("--seed") ?? join(root, "references", "model-prices.json");
const defaultSnapshot = join(
  homedir(),
  ".cache",
  "opencode",
  "opencode-go-model-picker",
  "snapshot.json"
);

async function request(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "opencode-go-model-picker/1.0" },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        // 4xx is a client-side answer (retrying will not help); 5xx is worth a retry.
        if (res.status >= 400 && res.status < 500) err.noRetry = true;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err.noRetry) throw err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

const fetchJson = async (url) => (await request(url)).json();

// Only accept finite numbers from the payload; anything else stays null.
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function loadSeed(path) {
  const loaded = readJsonFile(path);
  if (loaded.error) {
    console.error(`Warning: ignoring the committed seed ${path}: ${loaded.error}`);
    return null;
  }
  if (loaded.missing) return null;
  return typeof loaded.value === "object" && loaded.value !== null ? loaded.value : null;
}

async function fetchCatalog() {
  const catalog = await fetchJson(CATALOG_URL);
  return (catalog.data ?? []).map((m) => m && m.id).filter(Boolean).sort();
}

async function fetchModelsDev() {
  const md = await fetchJson(MODELS_DEV_URL);
  const provider = md && typeof md[PROVIDER] === "object" ? md[PROVIDER] : null;
  if (!provider || typeof provider.models !== "object" || !provider.models) {
    throw new Error(`models.dev payload has no "${PROVIDER}" provider with .models`);
  }
  return provider.models;
}

// Plan fields are maintainer-verified: carry them through from the previous
// seed entry when present, else keep null (planSource still the plan URL).
function planFieldsOf(prev) {
  return {
    monthlyLimitUsd: prev?.monthlyLimitUsd ?? null,
    estReq5h: prev?.estReq5h ?? null,
    estReqWeek: prev?.estReqWeek ?? null,
    estReqMonth: prev?.estReqMonth ?? null,
    promo: prev?.promo ?? null,
    status: prev?.status ?? null,
    planSource: typeof prev?.planSource === "string" ? prev.planSource : PLAN_URL,
    planVerifiedAt: prev?.planVerifiedAt ?? null,
  };
}

// Build one price entry for a Go id from models.dev data. A catalog id that is
// missing from models.dev simply gets null prices — never an invented number.
function buildEntry(id, models, now, prev) {
  const live = models[id];
  const cost = live && typeof live.cost === "object" ? live.cost : null;
  const limit = live && typeof live.limit === "object" ? live.limit : null;
  const plan = planFieldsOf(prev);
  return {
    inputPer1M: num(cost?.input),
    outputPer1M: num(cost?.output),
    cacheReadPer1M: num(cost?.cache_read),
    context: num(limit?.context),
    outputLimit: num(limit?.output),
    monthlyLimitUsd: plan.monthlyLimitUsd,
    estReq5h: plan.estReq5h,
    estReqWeek: plan.estReqWeek,
    estReqMonth: plan.estReqMonth,
    promo: plan.promo,
    status: plan.status,
    priceSource: MODELS_DEV_URL,
    planSource: plan.planSource,
    upstreamUpdatedAt:
      typeof live?.last_updated === "string" ? live.last_updated : null,
    priceVerifiedAt: now,
    planVerifiedAt: plan.planVerifiedAt,
  };
}

function buildEntries(goIds, models, now, prevModels) {
  const entries = {};
  for (const id of goIds) entries[id] = buildEntry(id, models, now, prevModels[id]);
  return entries;
}

// Freshness rule (same "identity with upstream" idea as the score seed): the
// seed is current only if it covers every catalog id AND each entry's
// upstreamUpdatedAt still equals that model's live models.dev last_updated.
function seedIsCurrent(seed, goIds, models) {
  const seedModels = seed?.models;
  if (!seedModels || typeof seedModels !== "object") return false;
  for (const id of goIds) {
    const entry = seedModels[id];
    if (!entry || typeof entry !== "object") return false;
    const liveDate =
      typeof models[id]?.last_updated === "string" ? models[id].last_updated : null;
    const seedDate =
      typeof entry.upstreamUpdatedAt === "string" ? entry.upstreamUpdatedAt : null;
    if (seedDate !== liveDate) return false;
  }
  return true;
}

const hasPrice = (entry) => typeof entry?.inputPer1M === "number";

const now = new Date().toISOString();

async function main() {
  const goIds = await fetchCatalog();

  if (snapshotArg) {
    const snapshotPath = snapshotArg === "true" ? defaultSnapshot : snapshotArg;
    const loaded = readJsonFile(snapshotPath);
    if (loaded.error) {
      console.error(
        `Error: cannot read ${snapshotPath}: ${loaded.error}\n` +
          "The snapshot also stores user state (preferences.mode), so it is not overwritten " +
          "automatically. Fix the JSON, or run refresh-snapshot.mjs --rebuild to start over.",
      );
      process.exit(1);
    }
    const snapshot = loaded.missing
      ? { schemaVersion: SNAPSHOT_SCHEMA_VERSION, sources: {}, models: {} }
      : loaded.value;
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
      console.error(`Error: ${snapshotPath} root value is not a JSON object.`);
      process.exit(1);
    }
    snapshot.models ??= {};
    snapshot.sources ??= {};

    const prevSeed = loadSeed(seedPath);
    // One models.dev fetch serves both the freshness probe and a rebuild.
    const models = await fetchModelsDev();

    let entries;
    let seedUsed = false;
    if (prevSeed && seedIsCurrent(prevSeed, goIds, models)) {
      entries = {};
      for (const id of goIds) entries[id] = prevSeed.models[id];
      seedUsed = true;
    } else {
      console.error("Committed price seed is not current; fetching live prices…");
      entries = buildEntries(goIds, models, now, prevSeed?.models ?? {});
    }

    // Only touch models.<id>.price — every other snapshot key is preserved.
    for (const id of goIds) {
      snapshot.models[id] ??= {};
      snapshot.models[id].price = entries[id];
    }
    // Two independent facts, kept apart on purpose:
    //   - seedUsed=true  → the seed covered EVERY catalog id (freshness rule);
    //   - priced/total   → how many ids actually carry an upstream price;
    //   - nullUpstream   → ids models.dev does not price at all (null upstream,
    //     not a gap in the seed — seedUsed stays true).
    const pricedIds = goIds.filter((id) => hasPrice(entries[id]));
    const nullUpstreamIds = goIds.filter((id) => !hasPrice(entries[id]));
    const priced = pricedIds.length;
    const total = goIds.length;
    snapshot.sources.prices = {
      url: MODELS_DEV_URL,
      provider: PROVIDER,
      fetchedAt: now,
      total,
      priced,
      nullUpstream: nullUpstreamIds,
      seedUsed,
    };
    writeJsonFileAtomic(snapshotPath, snapshot);
    const summary =
      `seedUsed=${seedUsed}` +
      `; priced ${priced}/${total}` +
      (nullUpstreamIds.length
        ? `; ${nullUpstreamIds.length} null upstream (${nullUpstreamIds.join(", ")})`
        : "; no null upstream");
    process.stdout.write(
      JSON.stringify(
        {
          out: snapshotPath,
          summary,
          seedUsed,
          priced,
          total,
          nullUpstream: nullUpstreamIds,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  // Maintainer path: always fetch and rewrite the committed seed, carrying
  // plan fields forward from the previous seed entry of the same id.
  const prevSeed = loadSeed(seedPath);
  const models = await fetchModelsDev();
  const entries = buildEntries(goIds, models, now, prevSeed?.models ?? {});
  const seed = {
    schemaVersion: 1,
    generatedAt: now,
    source: {
      name: "models.dev",
      url: MODELS_DEV_URL,
      provider: PROVIDER,
      catalog: CATALOG_URL,
      plan: PLAN_URL,
    },
    models: entries,
  };
  const outPath = outArg ?? seedPath;
  writeJsonFileAtomic(outPath, seed);
  const idsWith = goIds.filter((id) => hasPrice(entries[id]));
  const idsWithout = goIds.filter((id) => !hasPrice(entries[id]));
  process.stdout.write(
    JSON.stringify(
      {
        out: outPath,
        catalog: goIds.length,
        withPrices: idsWith.length,
        withoutPrices: idsWithout.length,
        idsWithoutPrices: idsWithout,
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  const cause = err.cause
    ? ` (${err.cause.code ?? err.cause.message ?? String(err.cause)})`
    : "";
  console.error(`Error: ${err.message ?? err}${cause}`);
  process.exit(1);
});
