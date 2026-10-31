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
// scripts/go.mjs run (LMArena), which writes them into the snapshot (see
// references/plan-facts.md). This script preserves any existing per-model
// fields, including `score`.
//
// The snapshot holds user state (`preferences`) next to the cache, so an
// unreadable snapshot is a hard error (exit 1) — the file is left untouched
// rather than silently rebuilt. Pass --rebuild to discard it on purpose.
// Writes are atomic (write sibling temp file, rename over the target), so a
// concurrent refresh can lose the race but never leave truncated JSON.
//
// Proxy: like every network script, this one re-executes itself with
// NODE_USE_ENV_PROXY=1 when a system proxy is set.
//
// Usage:
//   node scripts/go.mjs run [--snapshot <path>] [--prune] [--rebuild]
//                                        [--no-env-proxy]

import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-io.mjs";
import { maybeReexec } from "./proxy.mjs";
import { FailError, makeIo } from "./io.mjs";


const CATALOG_URL = "https://opencode.ai/zen/go/v1/models";

// Keep in sync with the "Schema (v2)" section of references/plan-facts.md.
const SCHEMA_VERSION = 2;

export function defaultSnapshotPath() {
  return join(homedir(), ".cache", "opencode", "opencode-go-model-picker", "snapshot.json");
}

function loadSnapshot(path, rebuild, stderr) {
  const fresh = () => ({ schemaVersion: SCHEMA_VERSION, sources: {}, models: {} });
  const loaded = readJsonFile(path);
  if (loaded.missing) return fresh();
  if (loaded.error) {
    if (rebuild) {
      stderr.write(`Warning: --rebuild discards the unreadable ${path} (${loaded.error}).\n`);
      return fresh();
    }
    throw new FailError(
      `cannot read ${path}: ${loaded.error}\n` +
        "The snapshot also stores user state (preferences.mode and cached scores/prices), " +
        "so it is not overwritten automatically. Fix the JSON, or pass rebuild to discard it.",
    );
  }
  const parsed = loaded.value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    if (rebuild) return fresh();
    throw new FailError(`${path} root value is not a JSON object. Fix the file, or pass rebuild to discard it.`);
  }
  // Spread the parsed file first so every other top-level key (`preferences`
  // and anything else the skill stores) is preserved on write-back; only
  // schemaVersion / sources / models are owned and refreshed here.
  return {
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    sources: parsed.sources ?? {},
    models: parsed.models ?? {},
  };
}

// Refreshes the cached catalog and returns the diff. A failed fetch is a
// reported degradation (`diff.catalog.error`), never a thrown run.
export async function refreshCatalog({ snapshotPath = defaultSnapshotPath(), prune = false, rebuild = false } = {}, io = {}) {
  const { stderr } = makeIo(io);
  const now = new Date().toISOString();
  const snapshot = loadSnapshot(snapshotPath, rebuild, stderr);

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
    stderr.write(`Warning: catalog fetch failed: ${diff.catalog.error}\n`);
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
    // when a model temporarily disappears; `prune` drops them.
    if (prune) {
      for (const id of diff.catalog.removed) delete snapshot.models[id];
    }
  }

  writeJsonFileAtomic(snapshotPath, snapshot);
  return diff;
}

// --- reading a snapshot ------------------------------------------------------

export function readSnapshot(path = defaultSnapshotPath()) {
  const loaded = readJsonFile(path);
  if (loaded.missing) return { path, snapshot: null, error: null };
  if (loaded.error) return { path, snapshot: null, error: loaded.error };
  if (typeof loaded.value !== "object" || loaded.value === null || Array.isArray(loaded.value)) {
    return { path, snapshot: null, error: "root value is not a JSON object" };
  }
  return { path, snapshot: loaded.value, error: null };
}

const firstOf = (...values) => {
  for (const value of values) if (value !== undefined && value !== null) return value;
  return null;
};

const PRICE_FIELDS = [
  "inputPer1M",
  "outputPer1M",
  "cacheReadPer1M",
  "cacheWritePer1M",
  "monthlyLimitUsd",
  "capUsd",
  "context",
  "estReq5h",
  "estReqWeek",
  "estReqMonth",
  "status",
  "vision",
  "reasoning",
];

function factsOf(entry) {
  const price = entry && typeof entry.price === "object" && entry.price !== null ? entry.price : {};
  const out = {};
  for (const field of PRICE_FIELDS) {
    const value = firstOf(entry?.[field], price[field]);
    if (value !== null) out[field] = value;
  }
  return out;
}

// Plan changes between two snapshots, field by field. Anything the snapshots do
// not carry is absent from the comparison, never assumed unchanged.
export function diffSnapshots(before, after) {
  const a = before?.models ?? {};
  const b = after?.models ?? {};
  const added = Object.keys(b).filter((id) => !(id in a)).sort();
  const removed = Object.keys(a).filter((id) => !(id in b)).sort();
  const changed = [];
  for (const id of Object.keys(b)) {
    if (!(id in a)) continue;
    const oldFacts = factsOf(a[id]);
    const newFacts = factsOf(b[id]);
    const fields = {};
    for (const field of new Set([...Object.keys(oldFacts), ...Object.keys(newFacts)])) {
      if (oldFacts[field] !== newFacts[field]) {
        fields[field] = { before: oldFacts[field] ?? null, after: newFacts[field] ?? null };
      }
    }
    if (Object.keys(fields).length) changed.push({ id, fields });
  }
  const beforeCount = Object.keys(a).length;
  const afterCount = Object.keys(b).length;
  return { added, removed, changed, beforeCount, afterCount };
}
