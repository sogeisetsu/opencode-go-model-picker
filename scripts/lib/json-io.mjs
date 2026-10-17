// opencode-go-model-picker — shared JSON file helpers for the bundled scripts.
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
// Zero-dependency helpers shared by the bundled scripts so every reader accepts
// the same encodings and every writer replaces a file the same way:
//
//   stripBom(text)              drop a leading UTF-8 BOM (Windows editors and
//                               PowerShell Set-Content add one) — a BOM must never
//                               make a readable file look corrupt.
//   readJsonFile(path)          { value } | { missing: true } | { error }.
//                               Never throws, so callers decide whether a bad file
//                               is fatal (snapshot state) or a warning (a source).
//   writeJsonFileAtomic(path, v)  mkdir -p, write a sibling temp file, rename over
//                               the target. A half-written snapshot is impossible,
//                               and a concurrent writer can only lose the race, not
//                               leave truncated JSON behind.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonFile(path) {
  if (!existsSync(path)) return { missing: true };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
  try {
    return { value: JSON.parse(stripBom(text)) };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

export function writeJsonFileAtomic(path, value, { indent = 2 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, indent) + "\n");
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort: the temp file is a sibling of the target, never the target
    }
    throw err;
  }
}
