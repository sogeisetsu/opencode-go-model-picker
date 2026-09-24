#!/usr/bin/env node
// opencode-go-model-picker — refresh the persistent model snapshot and print a diff.
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
// Refresh ~/.cache/opencode/opencode-go-model-picker/snapshot.json and print a
// compact catalog diff (added / removed model ids). The script only stores
// fetched ids or the existing cached values — it never invents a number.
//
// Ranking scores are NOT fetched here: they are handled by
// scripts/refresh-scores.mjs (LMArena), which writes them into the snapshot (see
// references/model-snapshot.md). This script preserves any existing per-model
// fields, including `score`.
//
// Usage:
//   node scripts/refresh-snapshot.mjs [--snapshot <path>] [--prune]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CATALOG_URL = "https://opencode.ai/zen/go/v1/models";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const snapshotPath =
  argValue("--snapshot") ??
  join(homedir(), ".cache", "opencode", "opencode-go-model-picker", "snapshot.json");
const prune = process.argv.includes("--prune");

function loadSnapshot(path) {
  if (!existsSync(path)) return { schemaVersion: 1, sources: {}, models: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      sources: parsed.sources ?? {},
      models: parsed.models ?? {},
    };
  } catch (err) {
    console.error(`Warning: could not parse ${path} (${err.message}); starting fresh.`);
    return { schemaVersion: 1, sources: {}, models: {} };
  }
}

const now = new Date().toISOString();
const snapshot = loadSnapshot(snapshotPath);

const diff = {
  fetchedAt: now,
  snapshotPath,
  catalog: { url: CATALOG_URL, count: null, added: [], removed: [], error: null },
};

let catalogIds = null;
try {
  const res = await fetch(CATALOG_URL, {
    headers: { "user-agent": "opencode-go-model-picker/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${CATALOG_URL}`);
  const catalog = await res.json();
  catalogIds = (catalog.data ?? []).map((m) => m && m.id).filter(Boolean).sort();
  snapshot.sources.catalog = { url: CATALOG_URL, fetchedAt: now, count: catalogIds.length };
} catch (err) {
  diff.catalog.error = String(err.message ?? err);
  console.error(`Warning: catalog fetch failed: ${diff.catalog.error}`);
}

if (catalogIds) {
  const known = new Set(Object.keys(snapshot.models));
  diff.catalog.count = catalogIds.length;
  diff.catalog.added = catalogIds.filter((id) => !known.has(id));
  diff.catalog.removed = Object.keys(snapshot.models).filter((id) => !catalogIds.includes(id));

  for (const id of catalogIds) {
    if (!snapshot.models[id]) snapshot.models[id] = {};
  }
  // Removed ids are reported and kept by default so cached scores are not lost
  // when a model temporarily disappears; --prune drops them.
  if (prune) {
    for (const id of diff.catalog.removed) delete snapshot.models[id];
  }
}

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
