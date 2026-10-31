// opencode-go-model-picker — the apply gate: exact diff first, one named file only.
// Copyright (C) 2026 sogeisetsu
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version.
//
// Writing is deliberately narrow: the target file must be named explicitly, the
// agent must already exist in it, and only that agent's `model` value is
// replaced. The result is re-parsed before it is written; a parse failure
// aborts without touching the file.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { existsSync } from "node:fs";
import { FailError, UsageError } from "./io.mjs";
import { validateChain } from "./agents.mjs";

// Comments and trailing commas stripped; strings are copied verbatim so a URL
// with `//` inside is not damaged.
export function stripJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text.replace(/^\uFEFF/, "")));
}

function matchBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchValueEnd(text, start) {
  const c = text[start];
  if (c === '"') {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') return i;
    }
    return -1;
  }
  if (c === "[") {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  throw new FailError("model value is neither a string nor an array");
}

// Locate the agent's object inside the file, using the pointer the inventory
// recorded (`agent.<name>` or `presets.<preset>.<name>`).
export function locateAgent(text, agent) {
  const pointer = agent.provenance?.pointer ?? "";
  let from = 0;
  const parentKey = pointer.startsWith("presets.")
    ? pointer.split(".").slice(0, 2).join(".")
    : "agent";
  const parentMatch = new RegExp(`"${parentKey.split(".").pop()}"\\s*:\\s*\\{`).exec(text);
  if (parentMatch) from = parentMatch.index;
  const re = new RegExp(`"${agent.name}"\\s*:\\s*\\{`, "g");
  re.lastIndex = from;
  const hit = re.exec(text);
  if (!hit) throw new FailError(`agent "${agent.name}" not found in the target file (pointer ${pointer})`);
  const open = text.indexOf("{", hit.index);
  const close = matchBrace(text, open);
  if (close < 0) throw new FailError(`cannot find the end of agent "${agent.name}"`);
  return { objectStart: open, objectEnd: close };
}

export function planApply({ text, agent, chain }) {
  const shape = validateChain(chain);
  if (!shape.ok) throw new UsageError(`${agent.name}: ${shape.problems.join("; ")}`);
  const { objectStart, objectEnd } = locateAgent(text, agent);
  const section = text.slice(objectStart, objectEnd + 1);
  const modelMatch = /"model"\s*:\s*/.exec(section);
  if (!modelMatch) throw new FailError(`agent "${agent.name}" has no "model" key to replace`);
  const valueStart = objectStart + modelMatch.index + modelMatch[0].length;
  const valueEnd = matchValueEnd(text, valueStart);
  if (valueEnd < 0) throw new FailError(`cannot read the current model value of "${agent.name}"`);

  const indentMatch = /\n([ \t]+)"model"/.exec(section);
  const indent = indentMatch ? indentMatch[1] : "  ";
  const value =
    chain.length === 1
      ? JSON.stringify(chain[0])
      : `[\n${chain.map((id) => `${indent}  ${JSON.stringify(id)}`).join(",\n")}\n${indent}]`;

  const before = text.slice(valueStart, valueEnd + 1);
  const after = text;
  const next = after.slice(0, valueStart) + value + after.slice(valueEnd + 1);
  return { before, after: value, next, valueStart, valueEnd };
}

export function renderDiff(file, plan) {
  const beforeLines = plan.before.split("\n");
  const afterLines = plan.after.split("\n");
  return [
    `--- ${file}`,
    `+++ ${file}`,
    ...beforeLines.map((l) => `-${l}`),
    ...afterLines.map((l) => `+${l}`),
  ].join("\n") + "\n";
}

export function applyToFile({ file, agent, chain, write = false }) {
  if (!existsSync(file)) throw new FailError(`target file does not exist: ${file}`);
  const text = readFileSync(file, "utf8");
  const plan = planApply({ text, agent, chain });
  const diff = renderDiff(file, plan);

  // Re-parse before writing: a silent syntax break is worse than a refusal.
  let parsed;
  try {
    parsed = parseJsonc(plan.next);
  } catch (err) {
    throw new FailError(`refusing to write: the result would not parse (${err.message})`);
  }
  const pointer = agent.provenance?.pointer ?? "";
  const slots = pointer.startsWith("presets.")
    ? pointer.split(".").slice(1).reduce((node, key) => node && node[key], parsed?.presets)
    : parsed?.agent?.[agent.name];
  const value = slots && slots.model;
  const written = Array.isArray(value) ? value : value ? [value] : [];
  if (JSON.stringify(written) !== JSON.stringify(chain)) {
    throw new FailError("refusing to write: the re-parsed model does not match the requested chain");
  }

  if (!write) return { wrote: false, diff, file };
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, plan.next, "utf8");
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort
    }
    throw new FailError(`cannot write ${file}: ${err.message}`);
  }
  return { wrote: true, diff, file };
}
