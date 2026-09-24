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
// Proxy: if HTTP(S)_PROXY is set, Node's fetch does not use it by default. This
// script re-executes itself with NODE_USE_ENV_PROXY=1 so the documented command
// works unchanged behind a proxy. Pass --no-env-proxy to opt out.
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// --- proxy: make `node scripts/refresh-prices.mjs` work behind a proxy --------
function maybeReexec() {
  if (process.argv.includes("--no-env-proxy")) return;
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;
  if (!proxy) return;
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  if (process.env.OGMP_PROXY_REEXEC === "1") return; // sentinel: never loop
  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", OGMP_PROXY_REEXEC: "1" },
  });
  process.exit(res.status ?? 1);
}
maybeReexec();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_URL = "https://opencode.ai/zen/go/v1/models";
const PROVIDER = "opencode-go";
const PLAN_URL = "https://opencode.ai/docs/go/";

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
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
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
    const snapshot = existsSync(snapshotPath)
      ? JSON.parse(readFileSync(snapshotPath, "utf8"))
      : { schemaVersion: 1, sources: {}, models: {} };
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
    const matched = goIds.filter((id) => hasPrice(entries[id])).length;
    snapshot.sources.prices = {
      url: MODELS_DEV_URL,
      provider: PROVIDER,
      fetchedAt: now,
      matched,
      total: goIds.length,
      seedUsed,
    };
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify(
        { out: snapshotPath, matched, total: goIds.length, seedUsed },
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
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
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
