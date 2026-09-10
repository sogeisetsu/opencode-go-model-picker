#!/usr/bin/env node
// opencode-go-model-picker — verify relative doc links and English/Chinese doc pairs.
// Copyright (C) 2026 sogeisetsu
//
// This file is part of opencode-go-model-picker, a skill that picks
// cost-effective OpenCode Go models for each oh-my-opencode-slim agent.
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
// Documentation checks for this repo.
// Usage: node scripts/check-docs.mjs
//
// 1. Every relative Markdown link, <a href>, and <img src> must resolve.
// 2. The English/Chinese documentation pairs must both exist.
// 3. If only one side of a pair changed, warn to sync it: git status for
//    tracked pairs, mtime for local-only (gitignored) copies.
//
// External URLs (http/https/mailto/...) and pure anchors are skipped.
// Exit code: 1 if any error, else 0. Warnings do not fail the run.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".openchamber"]);
const rel = (p) => relative(root, p).replace(/\\/g, "/");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

let errors = 0;
let warnings = 0;

// --- 1. relative links / images -------------------------------------------
const files = walk(root);
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const targets = [];
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) targets.push({ t: m[1], kind: "link" });
  for (const m of text.matchAll(/(?:href|src)=["']([^"']+)["']/g)) targets.push({ t: m[1], kind: "attr" });
  for (const { t, kind } of targets) {
    const raw = t.trim().split(/\s+/)[0];
    if (!raw || /^(https?:|mailto:|tel:|data:|#)/i.test(raw)) continue;
    const clean = decodeURIComponent(raw.split("#")[0]);
    if (!clean) continue;
    if (!existsSync(join(dirname(file), clean))) {
      errors++;
      console.log(`MISSING ${rel(file)} ${kind} -> ${raw}`);
    }
  }
}

// --- 2. English/Chinese pairs exist ---------------------------------------
// `optional: true` marks a local-only, gitignored Chinese copy.
const pairs = [
  { en: "README.md", zh: "README-ZH.md", optional: false },
  { en: "CONTRIBUTING.md", zh: "zh/CONTRIBUTING-ZH.md", optional: false },
  { en: "CHANGELOG.md", zh: "zh/CHANGELOG-ZH.md", optional: false },
  { en: "SKILL.md", zh: "zh/skill-zh.md", optional: true },
];
for (const p of pairs) {
  const enExists = existsSync(join(root, p.en));
  const zhExists = existsSync(join(root, p.zh));
  if (enExists && zhExists) continue;
  const detail = `${p.en} <-> ${p.zh} (${!enExists ? p.en + " missing" : ""}${!enExists && !zhExists ? ", " : ""}${!zhExists ? p.zh + " missing" : ""})`;
  if (p.optional) {
    warnings++;
    console.log(`WARN  pair incomplete (local-only copy): ${detail}`);
  } else {
    errors++;
    console.log(`MISSING pair incomplete: ${detail}`);
  }
}

// --- 3. one-side-changed hint ---------------------------------------------
function changedPaths() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    return out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .map((p) => {
        const arrow = p.indexOf(" -> ");
        return (arrow >= 0 ? p.slice(arrow + 4) : p).replace(/\\/g, "/").replace(/^"|"$/g, "");
      });
  } catch {
    return [];
  }
}
const changed = changedPaths();
if (changed.length) {
  for (const p of pairs) {
    if (p.optional) {
      // Local-only, gitignored copy: `git status` never lists it, so compare
      // mtimes instead (warn only when the English side is newer).
      const enPath = join(root, p.en);
      const zhPath = join(root, p.zh);
      if (
        existsSync(enPath) &&
        existsSync(zhPath) &&
        statSync(enPath).mtimeMs > statSync(zhPath).mtimeMs
      ) {
        warnings++;
        console.log(`WARN  changed one side only: ${p.en} is newer than ${p.zh} -> also update ${p.zh}`);
      }
      continue;
    }
    const enChanged = changed.includes(p.en);
    const zhChanged = changed.includes(p.zh);
    if (enChanged !== zhChanged) {
      warnings++;
      console.log(`WARN  changed one side only: ${enChanged ? p.en : p.zh} -> also update ${enChanged ? p.zh : p.en}`);
    }
  }
}

console.log(`\n${files.length} markdown files scanned; ${errors} error(s), ${warnings} warning(s).`);
process.exit(errors ? 1 : 0);
