// opencode-go-model-picker — shared CLI plumbing for the single entry point.
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
// Every module under lib/ takes (argv, io) and RETURNS an exit code; none of them
// calls process.exit, so a degraded step inside `run` can be reported instead of
// killing the whole command.

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export class FailError extends Error {
  constructor(message, code = 1, extra = {}) {
    super(message);
    this.name = "FailError";
    this.code = code;
    this.extra = extra;
  }
}

export class HelpRequested extends Error {
  constructor(text) {
    super("help");
    this.name = "HelpRequested";
    this.text = text;
  }
}

export function makeIo(io = {}) {
  return { stdout: io.stdout ?? process.stdout, stderr: io.stderr ?? process.stderr };
}

export function writeJson(io, value) {
  io.stdout.write(JSON.stringify(value) + "\n");
}

// Read `--name value` and `--name=value` alike; the first occurrence wins.
export function argValue(argv, name) {
  const eq = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (eq < 0) return undefined;
  const hit = argv[eq];
  if (hit === name) return argv[eq + 1];
  return hit.slice(name.length + 1);
}

export function hasFlag(argv, name) {
  return argv.includes(name) || argv.some((a) => a.startsWith(`${name}=`));
}
