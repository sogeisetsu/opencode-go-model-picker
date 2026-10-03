#!/usr/bin/env node
// opencode-go-model-picker — discover custom OpenCode agents and validate their chains.
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
// Discover CUSTOM agents (OpenCode built-ins are skipped) and print an inventory.
// Usage: node scripts/discover-agents.mjs [--config <dir>] [--snapshot <path>]
//                                          [--registry <path>] [--help]
//
// Sources (see references/agent-sources.md; a missing or unparseable source is a
// warning, never a throw — one failing source does not abort the others):
// 1. slim: <config>/oh-my-opencode-slim.json (or .jsonc). Active preset = top-level
//    `preset`; agents = presets.<preset>.<agent>. JSONC tolerance (// line comments,
//    /* */ block comments, trailing commas) is hand-rolled and string-aware (URLs
//    inside strings are safe); no dependency.
// 2. native: <config>/opencode.json (or .jsonc) under agent.<name>, plus Markdown
//    agents at <config>/agents/*.md and — default mode only — <cwd>/.opencode/agents/*.md
//    (directory is plural; the filename is the agent name). YAML frontmatter is
//    parsed minimally by hand for `description` and `model`; no YAML library.
//
// Output: compact JSON on stdout, shape { agents, warnings }. Each agent record:
// { name, source, description, model, provenance: { file, pointer } } where model
// is string | Array<{ id, variant }> | null. Warning entry: { kind, agent, message }
// with kind one of:
//   source        missing/unparseable source file or directory;
//   duplicate     the same model id repeated inside one fallback chain;
//   chain-length  an array chain shorter than 2 or longer than 4 entries;
//   registry      a non-Go id (not opencode-go/*) not confirmed in the local registry
//                 ~/.cache/opencode/models.json — explicit status deprecated/removed
//                 => warn; absent status is the registry's default-active convention
//                 and does NOT warn; id missing from the registry => warn (mark the
//                 slot for manual verification; never lead a chain with it);
//   vision-field  a vision-trait agent (known role `observer`, or a description that
//                 signals vision) whose chain contains a model without
//                 models.<id>.vision === true in the snapshot cache. This is a FIELD
//                 CHECK, NOT a capability verification: the snapshot field may
//                 simply be unverified — confirm image input from the model's own
//                 lab docs (references/data-sources.md §Capability verification).
//
// Flags (all optional; without them the real config is READ, never written):
//   --config <dir>     fixture root holding opencode.json(c), agents/, and optionally
//                      oh-my-opencode-slim.json(c); replaces the config directory AND
//                      the project .opencode path, so no real config is touched.
//   --snapshot <path>  snapshot JSON used by the vision field check
//                      (default: ~/.cache/opencode/opencode-go-model-picker/snapshot.json).
//   --registry <path>  local model registry used by the non-Go status check
//                      (default: ~/.cache/opencode/models.json).
//   --help             print this usage block and exit 0.
//
// Read-only: this script never writes a file. Exit code: 0 on success (warnings do
// not fail the run), 2 on bad usage.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

// --- CLI -------------------------------------------------------------------

const USAGE = [
  "Usage: node scripts/discover-agents.mjs [--config <dir>] [--snapshot <path>] [--registry <path>] [--help]",
  "  --config <dir>     read fixture config (opencode.json(c), agents/, slim json(c)) from <dir>",
  "  --snapshot <path>  snapshot JSON for the vision field check",
  "  --registry <path>  local model registry for the non-Go status check",
  "Read-only; compact JSON { agents, warnings } on stdout. Exit 0 (2 on bad usage).",
].join("\n");

const args = process.argv.slice(2);
let configDir = null;
let snapshotPath = null;
let registryPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (a === "--config" || a === "--snapshot" || a === "--registry") {
    const value = args[++i];
    if (!value) {
      console.error(`Missing value for ${a}\n${USAGE}`);
      process.exit(2);
    }
    if (a === "--config") configDir = resolve(value);
    else if (a === "--snapshot") snapshotPath = resolve(value);
    else registryPath = resolve(value);
  } else {
    console.error(`Unknown argument: ${a}\n${USAGE}`);
    process.exit(2);
  }
}

// --- paths -----------------------------------------------------------------

// Windows: %USERPROFILE%\.config\opencode; POSIX: ~/.config/opencode.
const home = homedir();
const configRoot = configDir ?? join(home, ".config", "opencode");
const defaultSnapshot = join(home, ".cache", "opencode", "opencode-go-model-picker", "snapshot.json");
const defaultRegistry = join(home, ".cache", "opencode", "models.json");
snapshotPath = snapshotPath ?? defaultSnapshot;
registryPath = registryPath ?? defaultRegistry;

// OpenCode built-ins are out of scope (references/agent-sources.md §Built-in agents
// are out of scope): the exact set changes between versions, so this documented
// subset is skipped and nothing else is guessed.
const BUILTIN_AGENTS = new Set([
  "build", "plan", // primary agents
  "general", "explore", "scout", // built-in subagents
  "compaction", "title", "summary", // hidden system agents
]);

const warnings = [];
const agents = [];
const warn = (kind, agent, message) => warnings.push({ kind, agent, message });

// --- JSONC (hand-rolled, string-aware, no dependency) -----------------------

function stripJsonc(text) {
  // Pass 1: drop // line comments and /* */ block comments outside strings.
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
  // Pass 2: drop trailing commas before } or ] outside strings.
  let res = "";
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inString) {
      res += c;
      if (c === "\\") {
        res += out[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      res += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (j < out.length && (out[j] === "}" || out[j] === "]")) continue;
    }
    res += c;
  }
  return res;
}

function parseJsonc(text) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    try {
      return { value: JSON.parse(stripJsonc(text)) };
    } catch (e) {
      return { error: e.message };
    }
  }
}

function loadJson(path) {
  if (!existsSync(path)) return { missing: true };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { error: `unreadable: ${e.message}` };
  }
  return parseJsonc(text.replace(/^\uFEFF/, ""));
}

// --- minimal YAML frontmatter (description / model only, no YAML lib) -------

function unquote(v) {
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    return v.slice(1, -1);
  }
  return v;
}

function splitFlowItems(inner) {
  const items = [];
  let cur = "";
  let quote = null;
  for (const c of inner) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ",") {
      items.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

function parseFlowValue(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner ? splitFlowItems(inner).map(parseFlowValue) : [];
  }
  return unquote(v);
}

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
  if (end < 0) return null;
  const fields = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s/.test(line)) continue; // blank or nested under a key
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      // Block scalar: collect the indented lines that follow.
      const parts = [];
      let k = i + 1;
      while (k < end && (lines[k].trim() === "" || /^\s/.test(lines[k]))) {
        parts.push(lines[k].trim());
        k++;
      }
      fields[key] = parts.join(value.startsWith(">") ? " " : "\n");
      i = k - 1;
      continue;
    }
    fields[key] = value;
  }
  return fields;
}

// --- model normalization -----------------------------------------------------

function normalizeModel(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const entries = [];
    for (const item of raw) {
      if (typeof item === "string") {
        if (item) entries.push({ id: item, variant: null });
      } else if (item && typeof item === "object" && item.id) {
        entries.push({ id: String(item.id), variant: item.variant ?? null });
      }
    }
    return entries.length ? entries : null;
  }
  if (typeof raw === "object" && raw.id) {
    return [{ id: String(raw.id), variant: raw.variant ?? null }];
  }
  return null;
}

const chainOf = (model) =>
  Array.isArray(model) ? model : model ? [{ id: model, variant: null }] : [];

// --- source adapters (read-only; never throw) --------------------------------

function discoverSlim() {
  const file = ["oh-my-opencode-slim.json", "oh-my-opencode-slim.jsonc"]
    .map((n) => join(configRoot, n))
    .find((p) => existsSync(p));
  if (!file) {
    warn("source", null, `slim source not found under ${configRoot}`);
    return;
  }
  const parsed = loadJson(file);
  if (parsed.error) {
    warn("source", null, `slim source unparseable: ${file}: ${parsed.error}`);
    return;
  }
  const cfg = parsed.value ?? {};
  const preset = cfg.preset;
  const presetAgents = preset && cfg.presets ? cfg.presets[preset] : null;
  if (!presetAgents || typeof presetAgents !== "object") {
    warn("source", null, `slim source: active preset "${preset}" not found in ${file}`);
    return;
  }
  for (const [name, def] of Object.entries(presetAgents)) {
    if (BUILTIN_AGENTS.has(name)) continue;
    if (!def || typeof def !== "object") continue;
    agents.push({
      name,
      source: "slim",
      description: typeof def.description === "string" ? def.description : null,
      model: normalizeModel(def.model),
      provenance: { file, pointer: `presets.${preset}.${name}` },
    });
  }
}

function discoverNativeJson() {
  const file = ["opencode.json", "opencode.jsonc"]
    .map((n) => join(configRoot, n))
    .find((p) => existsSync(p));
  if (!file) {
    warn("source", null, `native source not found under ${configRoot}`);
    return;
  }
  const parsed = loadJson(file);
  if (parsed.error) {
    warn("source", null, `native source unparseable: ${file}: ${parsed.error}`);
    return;
  }
  const agentMap = parsed.value && parsed.value.agent;
  if (!agentMap || typeof agentMap !== "object") return; // no agent key: nothing to do
  for (const [name, def] of Object.entries(agentMap)) {
    if (BUILTIN_AGENTS.has(name)) continue;
    if (!def || typeof def !== "object") continue;
    agents.push({
      name,
      source: "native",
      description: typeof def.description === "string" ? def.description : null,
      model: normalizeModel(def.model),
      provenance: { file, pointer: `agent.${name}` },
    });
  }
}

function discoverMarkdown(dir) {
  if (!existsSync(dir)) {
    warn("source", null, `markdown agents dir not found: ${dir}`);
    return;
  }
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    warn("source", null, `markdown agents dir unreadable: ${dir}: ${e.message}`);
    return;
  }
  for (const file of names) {
    if (!/\.md$/i.test(file)) continue;
    const name = basename(file).replace(/\.md$/i, "");
    if (BUILTIN_AGENTS.has(name)) continue;
    const path = join(dir, file);
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      warn("source", null, `markdown agent unreadable: ${path}: ${e.message}`);
      continue;
    }
    const fm = parseFrontmatter(text);
    if (fm === null) {
      warn("source", null, `markdown agent has no YAML frontmatter: ${path}`);
    }
    agents.push({
      name,
      source: "native",
      description: fm && typeof fm.description === "string" ? unquote(fm.description) : null,
      model: fm ? normalizeModel(fm.model != null ? parseFlowValue(String(fm.model)) : null) : null,
      provenance: { file: path, pointer: "#frontmatter" },
    });
  }
}

// --- validation helpers -------------------------------------------------------

function loadRegistry() {
  const loaded = loadJson(registryPath);
  if (loaded.missing) {
    warn("source", null, `registry not found: ${registryPath} — non-Go status checks skipped`);
    return null;
  }
  if (loaded.error) {
    warn("source", null, `registry unparseable: ${registryPath}: ${loaded.error} — non-Go status checks skipped`);
    return null;
  }
  return loaded.value;
}

function loadSnapshot() {
  const loaded = loadJson(snapshotPath);
  if (loaded.missing) {
    warn("source", null, `snapshot not found: ${snapshotPath} — vision field checks skipped`);
    return null;
  }
  if (loaded.error) {
    warn("source", null, `snapshot unparseable: ${snapshotPath}: ${loaded.error} — vision field checks skipped`);
    return null;
  }
  return loaded.value;
}

function checkRegistryEntry(id, agentName) {
  const slash = id.indexOf("/");
  if (slash < 0) return; // no provider prefix: cannot decide, skip
  const provider = id.slice(0, slash);
  if (provider === "opencode-go") return; // Go ids are covered by the catalog checks
  const modelId = id.slice(slash + 1);
  const providerEntry = registry ? registry[provider] : null;
  const entry =
    providerEntry && typeof providerEntry === "object"
      ? providerEntry.models
        ? providerEntry.models[modelId]
        : providerEntry[modelId]
      : null;
  if (!entry || typeof entry !== "object") {
    warn(
      "registry",
      agentName,
      `model ${id} is not a Go id and is missing from the local registry ${registryPath}: ` +
        "do not lead a chain with it — mark this slot for manual verification",
    );
    return;
  }
  const status = typeof entry.status === "string" ? entry.status.toLowerCase() : null;
  if (status === "deprecated" || status === "removed") {
    warn("registry", agentName, `model ${id} has explicit registry status "${entry.status}" — never put it in a chain`);
  }
  // Absent status = the registry's default-active convention: checked, no warning.
}

function snapshotVision(id) {
  if (!snapshot) return undefined;
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  const entry = snapshot.models ? snapshot.models[bare] : null;
  if (!entry || typeof entry !== "object") return undefined; // id absent from snapshot
  return entry.vision === true || (entry.price && entry.price.vision === true);
}

const KNOWN_ROLE_VISION = new Set(["observer"]);
function hasVisionTrait(record) {
  if (KNOWN_ROLE_VISION.has(record.name)) return true;
  const d = (record.description ?? "").toLowerCase();
  return /vision|image|screenshot|ocr|photo|multimodal/.test(d);
}

function validate(record) {
  const chain = chainOf(record.model);
  if (Array.isArray(record.model)) {
    // duplicate id inside one fallback chain (one warning per finding)
    const counts = new Map();
    for (const { id } of chain) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) {
      if (n > 1) {
        warn("duplicate", record.name, `model id ${id} appears ${n} times in the fallback chain — never duplicate a model id`);
      }
    }
    // chain length: 2–4 entries (single-value sources are not chains, see SKILL.md)
    if (chain.length < 2 || chain.length > 4) {
      warn("chain-length", record.name, `fallback chain has ${chain.length} entries — the rule is 2–4`);
    }
  }
  for (const { id } of chain) checkRegistryEntry(id, record.name);
  if (hasVisionTrait(record)) {
    for (const { id } of chain) {
      if (snapshotVision(id) !== true) {
        warn(
          "vision-field",
          record.name,
          `FIELD CHECK, NOT A CAPABILITY VERIFICATION: vision-trait agent chain slot ${id} has no ` +
            `models.${id.includes("/") ? id.slice(id.indexOf("/") + 1) : id}.vision === true in ${snapshotPath} — ` +
            "the snapshot field may simply be unverified; confirm image input from the model's own lab docs",
        );
      }
    }
  }
}

// --- main ---------------------------------------------------------------------

const registry = loadRegistry();
const snapshot = loadSnapshot();

discoverSlim();
discoverNativeJson();
discoverMarkdown(join(configRoot, "agents"));
if (!configDir) discoverMarkdown(join(process.cwd(), ".opencode", "agents"));

for (const record of agents) validate(record);

process.stdout.write(JSON.stringify({ agents, warnings }) + "\n");
