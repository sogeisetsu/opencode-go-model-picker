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
//                               Never throws. `missing` means ENOENT only: a
//                               permission or sharing failure is an `error`, so a
//                               caller that "starts fresh" on a missing file can
//                               never overwrite one it simply could not read.
//   writeJsonFileAtomic(path, v)  mkdir -p, write a sibling temp file, rename over
//                               the target. A half-written snapshot is impossible,
//                               and a concurrent writer can only lose the race, not
//                               leave truncated JSON behind.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // Only ENOENT means "no file". Any other read failure (EACCES, EPERM, EISDIR,
    // a Windows sharing violation) must not be reported as missing: callers treat
    // missing as "start fresh" and would then overwrite a file that is still
    // there. Reading first also closes the exists-then-read window.
    if (err && err.code === "ENOENT") return { missing: true };
    return { error: err && err.message ? err.message : String(err) };
  }
  try {
    return { value: JSON.parse(stripBom(text)) };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

const removeQuietly = (path) => {
  try {
    rmSync(path, { force: true });
  } catch {
    // best effort: the temp file is a sibling of the target, never the target
  }
};

export function writeJsonFileAtomic(path, value, { indent = 2 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, indent) + "\n");
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    // Windows replaces an existing target fine (MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING), but a program holding the file open without
    // FILE_SHARE_DELETE (antivirus, editor, indexer) makes this fail with
    // EPERM/EACCES. The previous file is intact and the temp file is gone, so say
    // what happened instead of surfacing a bare system error.
    removeQuietly(tmp);
    throw new Error(
      `cannot replace ${path}: ${err.message} — is the file open in another program? ` +
        "The previous file was left unchanged.",
    );
  }
}
