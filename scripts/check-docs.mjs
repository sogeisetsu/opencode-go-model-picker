#!/usr/bin/env node
// opencode-go-model-picker — verify relative doc links and English/Chinese doc pairs.
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
// Documentation checks for this repo.
// Usage: node scripts/check-docs.mjs
//
// 1. Every relative Markdown link, <a href>, and <img src> must resolve.
// 2. The English/Chinese documentation pairs must both exist.
// 3. If only one side of a pair changed, warn to sync it: git status for
//    tracked pairs, mtime for local-only (gitignored) copies.
// 4. Frontmatter is well-formed: delimiters present, top-level lines are keys,
//    and an unquoted top-level value does not contain ": " (which silently
//    breaks YAML).
// 5. English docs contain no CJK characters (Chinese docs live under zh/ or
//    carry a -ZH filename; the local AGENTS.md is exempt).
// 6. The version badge and the changelogs agree with SKILL.md's
//    `metadata.version` (committed drift, not just uncommitted edits).
//
// External URLs (http/https/mailto/...) and pure anchors are skipped.
// Exit code: 1 if any error, else 0. Warnings do not fail the run.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".openchamber", ".opencode"]);
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

// --- 4. frontmatter validity ----------------------------------------------
// Dependency-free: no YAML library required. Catches the failure that silently
// invalidated SKILL.md's description until the value was quoted.
function checkFrontmatter(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines[0] !== "---") return;
  const close = lines.indexOf("---", 1);
  if (close < 0) {
    errors++;
    console.log(`ERROR frontmatter not closed: ${rel(file)}`);
    return;
  }
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s/.test(line)) continue; // nested value under a key
    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) {
      errors++;
      console.log(`ERROR malformed frontmatter line ${i + 1}: ${rel(file)} -> ${line}`);
      continue;
    }
    const value = m[2].trim();
    if (value && !/^["'|>]/.test(value) && value.includes(": ")) {
      warnings++;
      console.log(`WARN  frontmatter value contains ': ' unquoted (line ${i + 1}): ${rel(file)} -> quote it`);
    }
  }
}
for (const file of files) checkFrontmatter(file);

// --- 5. English docs must stay English -------------------------------------
// Chinese docs live under zh/ or carry a -ZH filename; AGENTS.md is a local
// (gitignored) Chinese file. Everything else must contain no CJK characters.
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const isChineseDoc = (p) => {
  const r = rel(p);
  return r.startsWith("zh/") || /-zh\.md$/i.test(r) || r === "AGENTS.md";
};
for (const file of files) {
  if (isChineseDoc(file)) continue;
  const hit = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .findIndex((l) => CJK.test(l));
  if (hit >= 0) {
    errors++;
    console.log(`ERROR CJK in English doc (line ${hit + 1}): ${rel(file)}`);
  }
}

// --- 6. version consistency -------------------------------------------------
// The badge is generated from SKILL.md's `metadata.version`, and the changelog
// must have a matching released heading. This catches committed drift, which the
// git-status check above cannot see (both sides changed in different commits, or
// neither side changed while the values diverged).
function skillVersion() {
  const text = readFileSync(join(root, "SKILL.md"), "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const close = lines.indexOf("---", 1);
  for (let i = 0; close > 0 && i < close; i++) {
    const m = lines[i].match(/^\s+version:\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  return null;
}

const version = skillVersion();
if (!version) {
  errors++;
  console.log("ERROR no metadata.version in SKILL.md frontmatter");
} else {
  const badgePath = join(root, "assets", "badges", "version.svg");
  const badge = existsSync(badgePath) ? readFileSync(badgePath, "utf8") : null;
  if (badge === null) {
    errors++;
    console.log(`MISSING ${rel(badgePath)} — regenerate with node scripts/generate-assets.mjs`);
  } else if (!badge.includes(`>${version}<`)) {
    errors++;
    console.log(
      `ERROR stale version badge: SKILL.md says ${version}, ${rel(badgePath)} says something else ` +
        "-> regenerate with node scripts/generate-assets.mjs",
    );
  }
  for (const changelog of ["CHANGELOG.md", "zh/CHANGELOG-ZH.md"]) {
    const path = join(root, changelog);
    if (!existsSync(path)) continue; // pair existence is checked above
    const released = readFileSync(path, "utf8").match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (!released) {
      warnings++;
      console.log(`WARN  no released heading found in ${changelog}`);
    } else if (released[1] !== version) {
      warnings++;
      console.log(
        `WARN  ${changelog} latest release is ${released[1]}, SKILL.md is ${version} -> add the release entry or bump one side`,
      );
    }
  }
}

console.log(`\n${files.length} markdown files scanned; ${errors} error(s), ${warnings} warning(s).`);
process.exit(errors ? 1 : 0);
