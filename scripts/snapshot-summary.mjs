#!/usr/bin/env node
// opencode-go-model-picker — print a compact digest of the model snapshot.
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
// Print a compact digest of snapshot.json instead of reading the whole
// (~1500-line) file. Every value is read from the snapshot only — see
// references/model-snapshot.md "Schema (v2)" for the field paths — and anything
// missing prints as "-" (JSON: null), never guessed.
//
// Usage:
//   node scripts/snapshot-summary.mjs [--snapshot <path>] [--ids <id1,id2,...>]
//     [--trait <orchestration|reasoning|cheap-high-volume|coding|frontend|vision|diversity>] [--json]
//
// 1. Text output (default): a one-line header with the snapshot's sources and
//    fetchedAt dates, then one line per model with stable columns:
//    id | in$/1M | out$/1M | monthly$ | estReq5h | context | reasoning |
//    vision | codingELO | overallELO | status
// 2. --ids keeps only those Go model ids (with or without the opencode-go/
//    prefix) in the order given; unknown ids get a row of dashes and are listed
//    in the header.
// 3. --trait keeps ALL models but sorts by that trait's capability-relevant
//    fields and marks the emphasized columns with "*"; it never drops rows.
// 4. --json prints the same digest as one compact JSON object on stdout.
// 5. A missing / unreadable / malformed snapshot or a usage error prints
//    {"error": "..."} on stdout and exits non-zero — never a stack trace.
// Exit code: 0 on success, 1 on any error.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COLUMNS = [
  ["id", "id"],
  ["in$/1M", "inputPer1M"],
  ["out$/1M", "outputPer1M"],
  ["monthly$", "monthlyLimitUsd"],
  ["estReq5h", "estReq5h"],
  ["context", "context"],
  ["reasoning", "reasoning"],
  ["vision", "vision"],
  ["codingELO", "codingELO"],
  ["overallELO", "overallELO"],
  ["status", "status"],
];

// sort: [row field, direction] in priority order; "truthy" = true > false > null.
// emphasize: column labels marked with "*" in the header when --trait is given.
// All models stay in the output — the trait only reorders and annotates.
const TRAITS = {
  orchestration: {
    sort: [["monthlyLimitUsd", "desc"], ["estReq5h", "desc"], ["overallELO", "desc"]],
    emphasize: ["monthly$", "estReq5h", "in$/1M"],
  },
  reasoning: {
    sort: [["overallELO", "desc"], ["codingELO", "desc"]],
    emphasize: ["reasoning", "overallELO"],
  },
  "cheap-high-volume": {
    sort: [["inputPer1M", "asc"], ["monthlyLimitUsd", "desc"], ["estReq5h", "desc"]],
    emphasize: ["in$/1M", "out$/1M", "monthly$", "estReq5h"],
  },
  coding: {
    sort: [["codingELO", "desc"], ["overallELO", "desc"]],
    emphasize: ["codingELO", "reasoning"],
  },
  frontend: {
    sort: [["codingELO", "desc"], ["vision", "truthy"], ["overallELO", "desc"]],
    emphasize: ["codingELO", "vision", "context"],
  },
  vision: {
    sort: [["vision", "truthy"], ["overallELO", "desc"]],
    emphasize: ["vision", "overallELO", "context"],
  },
  diversity: {
    sort: [["provider", "asc"], ["overallELO", "desc"]],
    emphasize: ["id", "overallELO", "codingELO"],
  },
};

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }) + "\n");
  process.exit(1);
}

// --- CLI -------------------------------------------------------------------

let snapshotPath = join(
  homedir(),
  ".cache",
  "opencode",
  "opencode-go-model-picker",
  "snapshot.json",
);
let idsArg;
let trait;
let json = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  let name = arg;
  let inline;
  const eq = arg.indexOf("=");
  if (arg.startsWith("--") && eq > 2) {
    name = arg.slice(0, eq);
    inline = arg.slice(eq + 1);
  }
  if (name === "--json") {
    json = true;
    continue;
  }
  if (name === "--snapshot" || name === "--ids" || name === "--trait") {
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined || value === "") fail(`missing value for ${name}`);
    if (name === "--snapshot") snapshotPath = value;
    else if (name === "--ids") idsArg = value;
    else trait = value;
    continue;
  }
  fail(`unknown argument: ${arg}`);
}

if (trait !== undefined && !Object.hasOwn(TRAITS, trait)) {
  fail(`unknown trait: ${trait} (expected one of ${Object.keys(TRAITS).join(", ")})`);
}

let wantedIds;
if (idsArg !== undefined) {
  wantedIds = idsArg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith("opencode-go/") ? s : `opencode-go/${s}`));
  if (wantedIds.length === 0) fail("--ids received no ids");
}

// --- load ------------------------------------------------------------------

let raw;
try {
  raw = readFileSync(snapshotPath, "utf8");
} catch (err) {
  if (err && err.code === "ENOENT") {
    fail(`snapshot not found: ${snapshotPath} (run: node scripts/refresh-snapshot.mjs)`);
  }
  fail(`cannot read snapshot ${snapshotPath}: ${err && err.message ? err.message : err}`);
}

let snapshot;
try {
  // Tolerate a UTF-8 BOM (Windows editors / PowerShell Set-Content add one).
  snapshot = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
} catch (err) {
  fail(`malformed snapshot ${snapshotPath}: ${err && err.message ? err.message : err}`);
}
if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
  fail(`malformed snapshot ${snapshotPath}: root value is not a JSON object`);
}
if (typeof snapshot.models !== "object" || snapshot.models === null || Array.isArray(snapshot.models)) {
  fail(`malformed snapshot ${snapshotPath}: no "models" object`);
}

// --- digest ----------------------------------------------------------------

// First defined, non-null value wins — top-level model fields per Schema (v2),
// falling back to models.<id>.price.*. Never substitutes a guessed number.
const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
};

function makeRow(key) {
  const model = snapshot.models[key] ?? {};
  const price = typeof model.price === "object" && model.price !== null ? model.price : {};
  const score = typeof model.score === "object" && model.score !== null ? model.score : {};
  return {
    id: `opencode-go/${key}`,
    provider: String(key).split("-")[0],
    inputPer1M: pick(model.inputPer1M, price.inputPer1M),
    outputPer1M: pick(model.outputPer1M, price.outputPer1M),
    monthlyLimitUsd: pick(model.monthlyLimitUsd, price.monthlyLimitUsd),
    estReq5h: pick(model.estReq5h, price.estReq5h),
    context: pick(model.context, price.context),
    reasoning: pick(model.reasoning),
    vision: pick(model.vision),
    codingELO: pick(score.coding),
    overallELO: pick(score.overall),
    status: pick(model.status, price.status),
  };
}

const missing = [];
let rows;
if (wantedIds !== undefined) {
  rows = wantedIds.map((id) => {
    const key = id.slice("opencode-go/".length);
    if (!Object.hasOwn(snapshot.models, key)) missing.push(id);
    return makeRow(key);
  });
} else {
  rows = Object.keys(snapshot.models).map(makeRow);
}

const emphasize = new Set();
if (trait !== undefined) {
  const spec = TRAITS[trait];
  for (const label of spec.emphasize) emphasize.add(label);
  const cmpValue = (a, b, dir) => {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull || bNull) return aNull && bNull ? 0 : aNull ? 1 : -1; // nulls last
    let c;
    if (typeof a === "number" && typeof b === "number") c = a - b;
    else if (typeof a === "boolean" || typeof b === "boolean") c = (a ? 1 : 0) - (b ? 1 : 0);
    else c = String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    return dir === "asc" ? c : -c;
  };
  rows.sort((r1, r2) => {
    for (const [field, dir] of spec.sort) {
      const c = cmpValue(r1[field], r2[field], dir);
      if (c !== 0) return c;
    }
    return 0;
  });
}

const day = (value) => (typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "-");
const sources = snapshot.sources ?? {};
const catalog = sources.catalog ?? {};
const rankings = sources.rankings ?? {};
const prices = sources.prices ?? {};
const dates = {
  catalog: typeof catalog.fetchedAt === "string" ? catalog.fetchedAt : null,
  rankings: typeof rankings.fetchedAt === "string" ? rankings.fetchedAt : null,
  prices: typeof prices.fetchedAt === "string" ? prices.fetchedAt : null,
  publishDates:
    typeof rankings.publishDates === "object" && rankings.publishDates !== null
      ? rankings.publishDates
      : null,
};

if (json) {
  const digest = {
    snapshot: snapshotPath,
    schemaVersion: pick(snapshot.schemaVersion),
    trait: trait ?? null,
    sources: {
      catalog: pick(dates.catalog) !== null ? { fetchedAt: dates.catalog, count: pick(catalog.count) } : null,
      rankings:
        pick(dates.rankings) !== null
          ? { fetchedAt: dates.rankings, publishDates: dates.publishDates }
          : null,
      prices:
        pick(dates.prices) !== null
          ? { fetchedAt: dates.prices, priced: pick(prices.priced), total: pick(prices.total) }
          : null,
    },
    count: rows.length,
    missing,
    models: rows.map((row) => {
      const out = {};
      for (const [, field] of COLUMNS) out[field] = row[field];
      return out;
    }),
  };
  process.stdout.write(JSON.stringify(digest) + "\n");
  process.exit(0);
}

// text output: header, optional trait annotation, column header, one row per model
let header = `# snapshot ${snapshotPath} | schema v${pick(snapshot.schemaVersion) ?? "?"}`;
header += ` | catalog ${day(dates.catalog)}${pick(catalog.count) !== null ? ` (${catalog.count} ids)` : ""}`;
header +=
  pick(dates.prices) !== null
    ? ` | prices ${day(dates.prices)} (${pick(prices.priced) ?? "-"}/${pick(prices.total) ?? "-"} priced)`
    : " | prices -";
header +=
  pick(dates.rankings) !== null
    ? ` | rankings ${day(dates.rankings)} (boards overall ${day(dates.publishDates?.overall)}, coding ${day(dates.publishDates?.coding)}, vision ${day(dates.publishDates?.vision)})`
    : " | rankings -";
header += ` | ${rows.length} models`;
if (missing.length > 0) header += ` | missing from snapshot: ${missing.join(", ")}`;
const lines = [header];

if (trait !== undefined) {
  const spec = TRAITS[trait];
  const sortText = spec.sort.map(([f, d]) => `${f} ${d}`).join(", ");
  lines.push(`# trait=${trait} sort: ${sortText} | * emphasized: ${spec.emphasize.join(", ")}`);
}

const headerCells = COLUMNS.map(([label]) => (emphasize.has(label) ? `${label}*` : label));
const bodyCells = rows.map((row) =>
  COLUMNS.map(([, field]) => {
    const value = row[field];
    return value === null || value === undefined ? "-" : String(value);
  }),
);

const widths = headerCells.map((label, col) =>
  Math.max(label.length, ...bodyCells.map((cells) => cells[col].length)),
);
const pad = (text, width) => text + " ".repeat(width - text.length);
const render = (cells) => cells.map((cell, col) => pad(cell, widths[col])).join(" | ").trimEnd();

lines.push(render(headerCells));
for (const cells of bodyCells) lines.push(render(cells));
process.stdout.write(lines.join("\n") + "\n");
process.exit(0);
