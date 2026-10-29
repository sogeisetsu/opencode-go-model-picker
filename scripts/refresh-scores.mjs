#!/usr/bin/env node
// opencode-go-model-picker — build the LMArena score seed / merge scores into a snapshot.
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
// Ranking source: the official LMArena leaderboard dataset, served by the
// Hugging Face datasets-server (no key, no browser):
//
//   dataset: lmarena-ai/leaderboard-dataset
//   boards:  text_style_control (overall), webdev (Code Arena), vision
//   fields:  model_name, rating (Arena ELO), rank, vote_count,
//            category, leaderboard_publish_date
//
// Arena ELO is used as the ability signal; the dataset has no cost column, so
// `costPerSuccessfulTaskUsd` stays null. Overall/coding/vision are read from the
// three boards; no other category is derived.
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
//   node scripts/refresh-scores.mjs                     # write references/model-scores.json
//   node scripts/refresh-scores.mjs --out <seed.json>
//   node scripts/refresh-scores.mjs --snapshot <snap.json>
//     # user path: reuse the committed seed when its publish dates are still the
//     # latest, else fetch and merge fresh scores into the snapshot.
//   node scripts/refresh-scores.mjs --seed <seed.json>   # override the seed path
//   node scripts/refresh-scores.mjs --no-env-proxy
//
// Exit code: 1 on error, else 0.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFileAtomic } from "./lib/json-io.mjs";
import { maybeReexec } from "./lib/proxy.mjs";

maybeReexec();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://datasets-server.huggingface.co";
const DATASET = "lmarena-ai/leaderboard-dataset";
const SOURCE_PAGE = "https://lmarena.ai/";
const PAGE = 100;
const PAGE_MAX = 5000; // safety cap

// Ability signal comes from these three boards only.
const BOARDS = {
  overall: { config: "text_style_control", category: "overall" },
  coding: { config: "webdev", category: "overall" },
  vision: { config: "vision", category: "overall" },
};

// Tokens that may trail a base model name in LMArena (effort/variant/date).
const NOISE = new Set([
  "thinking",
  "high",
  "xhigh",
  "xxhigh",
  "medium",
  "low",
  "auto",
  "effort",
  "preview",
  "instant",
  "instruct",
  "it",
  "chat",
  "max",
  "mini",
  "nano",
  "code",
  "reasoning",
  "non",
  "16k",
  "32k",
  "64k",
  "128k",
]);

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const snapshotArg = argValue("--snapshot");
const outArg = argValue("--out");
const seedPath = argValue("--seed") ?? join(root, "references", "model-scores.json");
const defaultSnapshot = join(
  homedir(),
  ".cache",
  "opencode",
  "opencode-go-model-picker",
  "snapshot.json"
);

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Conservative matcher: exact normalized match, or a prefix whose remaining
// tokens are all known suffixes / numeric date stamps AND the candidate is
// unique. Ambiguity (e.g. glm-5.3 vs glm-5.3-max / glm-5.3-flash) yields null.
function matchName(goId, names) {
  const g = normalize(goId);
  if (!g) return null;
  const exact = names.find((n) => normalize(n) === g);
  if (exact) return exact;
  const candidates = new Set();
  for (const n of names) {
    const nn = normalize(n);
    if (!nn.startsWith(g + " ")) continue;
    const extra = nn
      .slice(g.length + 1)
      .split(" ")
      .filter(Boolean);
    if (extra.every((t) => NOISE.has(t) || /^\d{3,}$/.test(t))) candidates.add(n);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

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

function filterUrl(board, offset, length) {
  const where = `"category"='${board.category}'`;
  return (
    `${BASE}/filter?dataset=${DATASET}&config=${encodeURIComponent(board.config)}` +
    `&split=latest&where=${encodeURIComponent(where)}&offset=${offset}&length=${length}`
  );
}

// Cheap freshness probe: one row per board, to read leaderboard_publish_date.
async function fetchPublishDates() {
  const entries = await Promise.all(
    Object.entries(BOARDS).map(async ([name, board]) => {
      const j = await fetchJson(filterUrl(board, 0, 1));
      const first = (j.rows ?? [])[0]?.row;
      return [name, first?.leaderboard_publish_date ?? null];
    })
  );
  return Object.fromEntries(entries);
}

// Fetch one board (paginated) -> { byName: Map, publishDate }
async function fetchBoard(board) {
  const byName = new Map();
  let publishDate = null;
  for (let offset = 0; offset < PAGE_MAX; offset += PAGE) {
    const j = await fetchJson(filterUrl(board, offset, PAGE));
    const rows = (j.rows ?? []).map((r) => r.row);
    if (offset === 0 && rows[0]) publishDate = rows[0].leaderboard_publish_date ?? null;
    for (const row of rows) {
      if (!row?.model_name) continue;
      byName.set(row.model_name, {
        rating: typeof row.rating === "number" ? row.rating : null,
        rank: typeof row.rank === "number" ? row.rank : null,
        votes: typeof row.vote_count === "number" ? row.vote_count : null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return { byName, publishDate };
}

async function fetchBoards() {
  const entries = await Promise.all(
    Object.entries(BOARDS).map(async ([name, board]) => {
      const { byName, publishDate } = await fetchBoard(board);
      return [name, byName, publishDate];
    })
  );
  const data = {};
  const publishDates = {};
  for (const [name, byName, publishDate] of entries) {
    data[name] = byName;
    publishDates[name] = publishDate;
  }
  return { data, publishDates };
}

function blankEntry() {
  return {
    matchedNames: { overall: null, coding: null, vision: null },
    overall: null,
    coding: null,
    vision: null,
    rankOverall: null,
    rankCoding: null,
    rankVision: null,
    voteCount: null,
    costPerSuccessfulTaskUsd: null,
    fetchedAt: null,
  };
}

const round2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);

// Build one score entry for a Go id from fetched board data.
function buildEntry(goId, boardData, fetchedAt) {
  const entry = blankEntry();
  const boardNames = {
    overall: [...boardData.overall.keys()],
    coding: [...boardData.coding.keys()],
    vision: [...boardData.vision.keys()],
  };
  let any = false;
  for (const board of ["overall", "coding", "vision"]) {
    const matched = matchName(goId, boardNames[board]);
    if (!matched) continue;
    entry.matchedNames[board] = matched;
    const row = boardData[board].get(matched);
    entry[board] = round2(row?.rating ?? null);
    const rankKey = `rank${board[0].toUpperCase()}${board.slice(1)}`;
    entry[rankKey] = row?.rank ?? null;
    if (board === "overall") entry.voteCount = row?.votes ?? null;
    any = true;
  }
  if (any) entry.fetchedAt = fetchedAt;
  return entry;
}

const now = new Date().toISOString();

async function fetchCatalog() {
  const url = "https://opencode.ai/zen/go/v1/models";
  const catalog = await fetchJson(url);
  return (catalog.data ?? []).map((m) => m && m.id).filter(Boolean).sort();
}

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
      ? { schemaVersion: 2, sources: {}, models: {} }
      : loaded.value;
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
      console.error(`Error: ${snapshotPath} root value is not a JSON object.`);
      process.exit(1);
    }
    snapshot.models ??= {};
    snapshot.sources ??= {};

    let scores = null;
    let publishDates = null;
    let seedUsed = false;

    // Try the committed seed first, but only if it is still current.
    const seedLoaded = readJsonFile(seedPath);
    if (seedLoaded.error) {
      console.error(`Warning: ignoring the committed seed ${seedPath}: ${seedLoaded.error}`);
    }
    if (seedLoaded.value && typeof seedLoaded.value === "object") {
      const seed = seedLoaded.value;
      const seedCoversAll = goIds.every((id) => id in (seed.models ?? {}));
      if (seedCoversAll && seed.source?.publishDates) {
        const liveDates = await fetchPublishDates();
        const sameDates = Object.keys(BOARDS).every(
          (b) => seed.source.publishDates[b] === liveDates[b]
        );
        if (sameDates) {
          scores = seed.models;
          publishDates = liveDates;
          seedUsed = true;
        }
      }
    }

    if (!scores) {
      console.error("LMArena boards are not covered by the current seed; fetching…");
      const live = await fetchBoards();
      publishDates = live.publishDates;
      scores = {};
      for (const id of goIds) scores[id] = buildEntry(id, live.data, now);
    }

    for (const id of goIds) {
      snapshot.models[id] ??= {};
      snapshot.models[id].score = scores[id] ?? blankEntry();
    }
    snapshot.sources.rankings = {
      url: SOURCE_PAGE,
      fetchedAt: now,
      boards: Object.fromEntries(
        Object.entries(BOARDS).map(([k, v]) => [k, v.config])
      ),
      publishDates,
      matched: Object.values(scores).filter((s) => s.fetchedAt).length,
      seedUsed,
    };
    writeJsonFileAtomic(snapshotPath, snapshot);
    process.stdout.write(
      JSON.stringify(
        {
          publishDates,
          out: snapshotPath,
          matched: snapshot.sources.rankings.matched,
          total: goIds.length,
          seedUsed,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  // Maintainer path: always fetch and write the committed seed.
  const live = await fetchBoards();
  const models = {};
  const matched = [];
  for (const id of goIds) {
    const entry = buildEntry(id, live.data, now);
    models[id] = entry;
    if (entry.fetchedAt) matched.push(id);
  }
  const seed = {
    schemaVersion: 2,
    generatedAt: now,
    source: {
      name: "LMArena",
      url: SOURCE_PAGE,
      dataset: DATASET,
      endpoint: BASE,
      boards: Object.fromEntries(Object.entries(BOARDS).map(([k, v]) => [k, v.config])),
      publishDates: live.publishDates,
    },
    models,
  };
  const outPath = outArg ?? seedPath;
  writeJsonFileAtomic(outPath, seed);
  process.stdout.write(
    JSON.stringify(
      { publishDates: live.publishDates, out: outPath, matched: matched.length, total: goIds.length, ids: matched },
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
