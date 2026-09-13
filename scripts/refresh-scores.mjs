#!/usr/bin/env node
// opencode-go-model-picker — build the LiveBench score seed / merge scores into a snapshot.
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
// LiveBench publishes no machine-readable leaderboard endpoint on livebench.ai
// (it is a single-page app). Its site repository, however, serves the raw table
// as static files, so this script needs no browser:
//
//   https://github.com/LiveBench/livebench.github.io/tree/main/public
//     table_<YYYY_MM_DD>.csv        model + one column per task
//     categories_<YYYY_MM_DD>.json  task -> category map
//
// Overall and per-category scores are DERIVED here by averaging the task
// columns (LiveBench's own categories map is used), so they are marked
// `derived: true`. The static table has no cost column, so
// `costPerSuccessfulTaskUsd` stays null.
//
// Usage:
//   node scripts/refresh-scores.mjs                     # write references/model-scores.json
//   node scripts/refresh-scores.mjs --out <seed.json>
//   node scripts/refresh-scores.mjs --snapshot <snap.json>
//     # user path: reuse the committed seed when its tableDate is still the
//     # latest one, else fetch and merge fresh scores into the snapshot.
//   node scripts/refresh-scores.mjs --pinned 2026-06-25  # pin a specific table
//   node scripts/refresh-scores.mjs --seed <seed.json>   # override the seed path
//
// Exit code: 1 on error, else 0.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENTS_URL =
  "https://api.github.com/repos/LiveBench/livebench.github.io/contents/public";
const RAW_BASE =
  "https://raw.githubusercontent.com/LiveBench/livebench.github.io/main/public";
const CATALOG_URL = "https://opencode.ai/zen/go/v1/models";
const SOURCE_PAGE = "https://livebench.ai/";
const LICENSE = "Apache-2.0";

const CATEGORY_FIELDS = {
  Reasoning: "reasoning",
  Coding: "coding",
  "Agentic Coding": "agenticCoding",
  Mathematics: "math",
  "Data Analysis": "dataAnalysis",
  Language: "language",
  IF: "instructionFollowing",
};
const SCORE_FIELDS = [
  "overall",
  "reasoning",
  "coding",
  "agenticCoding",
  "math",
  "dataAnalysis",
  "language",
  "instructionFollowing",
];

// Tokens that may legitimately trail a base name in LiveBench (effort/variant
// labels). Only these are stripped when matching `kimi-k2.6` -> `kimi-k2.6-thinking`.
const NOISE = new Set([
  "thinking",
  "high",
  "xhigh",
  "medium",
  "low",
  "auto",
  "effort",
  "preview",
  "instruct",
  "it",
  "chat",
  "64k",
  "128k",
  "code",
  "mini",
  "nano",
]);

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pinned = argValue("--pinned");
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

// Match a Go model id to a LiveBench model name. Conservative: require an exact
// normalized match, or a prefix whose remaining tokens are all known suffixes
// (effort/variant labels) or numeric date stamps. Never fuzzy-guess.
function matchName(goId, lbNames) {
  const g = normalize(goId);
  if (!g) return null;
  const exact = lbNames.find((n) => normalize(n) === g);
  if (exact) return exact;
  let best = null;
  for (const n of lbNames) {
    const norm = normalize(n);
    if (!norm.startsWith(g + " ")) continue;
    const extra = norm
      .slice(g.length + 1)
      .split(" ")
      .filter(Boolean);
    const ok = extra.every((t) => NOISE.has(t) || /^\d{3,}$/.test(t));
    if (!ok) continue;
    if (!best || extra.length < best.extra) best = { name: n, extra: extra.length };
  }
  return best ? best.name : null;
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ""));
}

const mean = (nums) =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

async function request(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "opencode-go-model-picker/1.0" },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.noRetry = true; // 4xx/5xx from the server: retrying will not help here
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

async function fetchJson(url) {
  return (await request(url)).json();
}

async function fetchText(url) {
  return (await request(url)).text();
}

async function latestTableDate() {
  if (pinned) return pinned;
  const listing = await fetchJson(CONTENTS_URL);
  const dates = [];
  for (const entry of Array.isArray(listing) ? listing : []) {
    const m = /^table_(\d{4})_(\d{2})_(\d{2})\.csv$/.exec(entry.name ?? "");
    if (m) dates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  if (!dates.length) throw new Error("No table_*.csv found in LiveBench public/");
  dates.sort();
  return dates[dates.length - 1];
}

// Fetch the table + category map and compute per-model scores.
async function computeScores(tableDate) {
  const stamp = tableDate.replace(/-/g, "_");
  const tableUrl = `${RAW_BASE}/table_${stamp}.csv`;
  const categoriesUrl = `${RAW_BASE}/categories_${stamp}.json`;
  const [csv, categoriesJson] = await Promise.all([
    fetchText(tableUrl),
    fetchJson(categoriesUrl),
  ]);

  const rows = parseCsv(csv);
  const header = rows[0];
  const taskCols = header.slice(1).map((name, i) => ({ name, i: i + 1 }));
  const byTask = new Map(taskCols.map((c) => [c.name, c.i]));

  const catMap = Object.entries(categoriesJson)
    .filter(([cat]) => CATEGORY_FIELDS[cat])
    .map(([cat, tasks]) => ({ field: CATEGORY_FIELDS[cat], tasks }));

  const scores = new Map();
  for (const row of rows.slice(1)) {
    const lbName = row[0];
    if (!lbName) continue;
    const cell = (i) => {
      const n = Number(row[i]);
      return Number.isFinite(n) ? n : null;
    };
    const score = { modelName: lbName };
    for (const { field, tasks } of catMap) {
      score[field] = round2(mean(tasks.map((t) => cell(byTask.get(t))).filter((n) => n !== null)));
    }
    score.overall = round2(mean(taskCols.map((c) => cell(c.i)).filter((n) => n !== null)));
    scores.set(lbName, score);
  }
  return { scores, tableUrl, categoriesUrl, lbNames: [...scores.keys()] };
}

function blankScore() {
  const s = { modelName: null };
  for (const f of SCORE_FIELDS) s[f] = null;
  s.costPerSuccessfulTaskUsd = null;
  s.fetchedAt = null;
  return s;
}

const now = new Date().toISOString();

async function main() {
  const tableDate = await latestTableDate();
  const catalog = await fetchJson(CATALOG_URL);
  const goIds = (catalog.data ?? []).map((m) => m && m.id).filter(Boolean).sort();

  // User path: try the committed seed first when it is still current.
  if (snapshotArg) {
    const snapshotPath = snapshotArg === "true" ? defaultSnapshot : snapshotArg;
    const snapshot = existsSync(snapshotPath)
      ? JSON.parse(readFileSync(snapshotPath, "utf8"))
      : { schemaVersion: 1, sources: {}, models: {} };
    snapshot.models ??= {};
    snapshot.sources ??= {};

    let source = null;
    let scores = null;
    if (existsSync(seedPath)) {
      const seed = JSON.parse(readFileSync(seedPath, "utf8"));
      const seedCoversAll = goIds.every((id) => id in (seed.models ?? {}));
      if (seed.source?.tableDate === tableDate && seedCoversAll) {
        source = seed;
        scores = new Map(Object.entries(seed.models ?? {}));
      }
    }

    let seedUsed = Boolean(scores);
    if (!scores) {
      const computed = await computeScores(tableDate);
      source = {
        url: SOURCE_PAGE,
        tableDate,
        tableUrl: computed.tableUrl,
        categoriesUrl: computed.categoriesUrl,
      };
      // Remap via the same matcher the seed generator uses.
      scores = new Map();
      for (const id of goIds) {
        const lb = matchName(id, computed.lbNames);
        const raw = lb ? computed.scores.get(lb) : null;
        const entry = blankScore();
        if (raw) {
          for (const f of SCORE_FIELDS) entry[f] = raw[f];
          entry.modelName = lb;
          entry.fetchedAt = now;
        }
        scores.set(id, entry);
      }
    }

    for (const id of goIds) {
      snapshot.models[id] ??= {};
      const entry = scores.get(id) ?? blankScore();
      snapshot.models[id].score = entry;
    }
    snapshot.sources.rankings = {
      url: SOURCE_PAGE,
      fetchedAt: now,
      tableDate,
      matched: [...scores.values()].filter((s) => s.modelName).length,
      seedUsed,
    };
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify(
        {
          tableDate,
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
  const computed = await computeScores(tableDate);
  const models = {};
  const matched = [];
  for (const id of goIds) {
    const lb = matchName(id, computed.lbNames);
    const raw = lb ? computed.scores.get(lb) : null;
    const entry = blankScore();
    if (raw) {
      for (const f of SCORE_FIELDS) entry[f] = raw[f];
      entry.modelName = lb;
      entry.fetchedAt = now;
      matched.push(id);
    }
    models[id] = entry;
  }
  const seed = {
    schemaVersion: 1,
    generatedAt: now,
    derived: true,
    derivation:
      "overall = mean of all task columns; each category = mean of its tasks per categories_<date>.json (LiveBench's own map)",
    source: {
      name: "LiveBench",
      url: SOURCE_PAGE,
      repo: "https://github.com/LiveBench/livebench.github.io",
      license: LICENSE,
      tableDate,
      tableUrl: computed.tableUrl,
      categoriesUrl: computed.categoriesUrl,
    },
    models,
  };
  const outPath = outArg ?? seedPath;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
  process.stdout.write(
    JSON.stringify(
      { tableDate, out: outPath, matched: matched.length, total: goIds.length, ids: matched },
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
