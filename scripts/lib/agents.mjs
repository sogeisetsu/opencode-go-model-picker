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
// Usage: node scripts/go.mjs run [--config <dir>] [--snapshot <path>]
//                                          [--registry <path>] [--builtin <a,b,c>]
//                                          [--extra-builtin <a,b,c>]
//                                          [--include-builtin-names] [--help]
//
// Sources (see references/plan-facts.md; a missing or unparseable source is a
// warning, never a throw — one failing source does not abort the others):
// 1. slim: <config>/oh-my-opencode-slim.json (or .jsonc). Active preset = top-level
//    `preset`; agents = presets.<preset>.<agent>. JSONC tolerance (// line comments,
//    /* */ block comments, trailing commas) is hand-rolled and string-aware (URLs
//    inside strings are safe); no dependency.
// 2. native: <config>/opencode.json (or .jsonc) under agent.<name>, plus Markdown
//    agents at <config>/agents/*.md and — default mode only — <cwd>/.opencode/agents/*.md
//    (directory is plural; the filename is the agent name). YAML frontmatter is
//    parsed minimally by hand for `description`, `model`, `mode` and `hidden`; no
//    YAML library.
//
// Output: compact JSON on stdout, shape { agents, warnings, skippedBuiltins,
// deadChainIds }. Each agent record matches references/plan-facts.md §Inventory
// record:
// { name, source, mode, description, model, hidden, traits,
//   provenance: { file, pointer, fetchedAt } } — model is
// string | Array<{ id, variant }> | null, traits are derived from description +
// name + mode (references/plan-facts.md §Role-trait mapping), and mode is
// "primary" | "subagent" | "all" (null when a source states an unrecognized
// value). Warning entry: { kind, agent, message } with kind one of:
//   source        missing/unparseable source file or directory;
//   duplicate     the same model id repeated inside one fallback chain;
//   chain-length  an array chain shorter than 2 or longer than 4 entries;
//   registry      a non-Go id (not opencode-go/*) not confirmed in the local registry
//                 ~/.cache/opencode/models.json — explicit status deprecated/removed
//                 => warn; absent status is the registry's default-active convention
//                 and does NOT warn; id missing from the registry => warn (mark the
//                 slot for manual verification; never lead a chain with it);
//   catalog       a Go id (opencode-go/*) whose snapshot entry status is
//                 deprecated/removed/retired (entry.status or entry.price.status,
//                 case-insensitive) — never put a retired id in a chain. Merely
//                 absent from the snapshot does NOT warn (see deadChainIds);
//   contention    two or more agents share the same chain-head id (chain[0],
//                 the primary pick) — the Go monthly cap is per model, so those
//                 agents draw from the same allowance; spread them or accept the
//                 shared budget. A shared fallback slot is normal and does NOT warn;
//   vision-field  a vision-trait agent (known role `observer`, or a description that
//                 signals vision) whose chain contains a model without
//                 models.<id>.vision === true in the snapshot cache. This is a FIELD
//                 CHECK, NOT a capability verification: the snapshot field may
//                 simply be unverified — confirm image input from the model's own
//                 lab docs (references/plan-facts.md §Capability verification);
//   mode          a source states a `mode` outside primary/subagent/all — recorded
//                 as null instead of guessed;
//   builtin-name  only with --include-builtin-names: a kept agent whose name is on
//                 the built-in denylist (verify it is really custom).
// deadChainIds is the run-level summary of chain ids that can never work:
// { id, agents: [<agent names>], reason } with reason "missing-from-catalog",
// "retired" (Go ids; skipped entirely when the snapshot is unavailable), or
// "registry-missing" / "registry-deprecated" (non-Go ids). Each dead id keeps
// its per-agent warning too — the summary adds, never replaces.
//
// Flags (all optional; without them the real config is READ, never written):
//   --config <dir>     fixture root holding opencode.json(c), agents/, and optionally
//                      oh-my-opencode-slim.json(c); replaces the config directory AND
//                      the project .opencode path, so no real config is touched.
//   --snapshot <path>  snapshot JSON used by the vision field check
//                      (default: ~/.cache/opencode/opencode-go-model-picker/snapshot.json).
//   --registry <path>  local model registry used for the non-Go status check
//                      (default: ~/.cache/opencode/models.json).
//   --builtin <a,b,c>  replace the built-in name denylist (see below).
//   --extra-builtin <a,b,c>
//                      add names to the built-in name denylist.
//   --include-builtin-names
//                      keep agents whose name is on the denylist instead of skipping
//                      them; use only when the user really customized a built-in.
//   --help             print this usage block and exit 0.
//
// Built-ins: the rule is "anything OpenCode ships is skipped" (references/
// agent-sources.md §Built-in agents are out of scope) — a set no script can
// enumerate from config files. KNOWN_BUILTIN_AGENTS is therefore a NAME DENYLIST
// for the built-ins documented at that page, not the definition of the rule: a
// skipped agent is still reported under `skippedBuiltins` (with its file) so a
// collision with a genuinely custom agent is visible instead of silently dropped,
// and the flags above let the caller adjust or disable the filter.
//
// Read-only: this script never writes a file. Exit code: 0 on success (warnings do
// not fail the run), 2 on bad usage.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stripBom } from "./json-io.mjs";
import { UsageError, makeIo } from "./io.mjs";

// --- CLI -------------------------------------------------------------------

const USAGE = [
  "Usage: node scripts/go.mjs run [--config <dir>] [--snapshot <path>] [--registry <path>]",
  "                                          [--builtin <a,b,c>] [--extra-builtin <a,b,c>] [--include-builtin-names] [--help]",
  "  --config <dir>     read fixture config (opencode.json(c), agents/, slim json(c)) from <dir>",
  "  --snapshot <path>  snapshot JSON for the vision field check",
  "  --registry <path>  local model registry for the non-Go status check",
  "  --builtin <a,b,c>  replace the built-in name denylist (skipped agents are reported)",
  "  --extra-builtin <a,b,c>",
  "                     add names to the built-in name denylist",
  "  --include-builtin-names",
  "                     keep agents whose name is on the denylist instead of skipping them",
  "Read-only; compact JSON { agents, warnings, skippedBuiltins, deadChainIds } on stdout. Exit 0 (2 on bad usage).",
].join("\n");

// Read-only inventory. Returns the records plus every warning the run has to
// report; `discoverCli` is the thin printer.
export function discoverAgents(argv = []) {
const args = argv;
let configDir = null;
let snapshotPath = null;
let registryPath = null;
let builtinOverride = null;
let builtinExtra = [];
let includeBuiltinNames = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") {
    return { exitCode: 0, help: USAGE };
  } else if (
    a === "--config" ||
    a === "--snapshot" ||
    a === "--registry" ||
    a === "--builtin" ||
    a === "--extra-builtin"
  ) {
    const value = args[++i];
    if (!value) {
      throw new UsageError(`Missing value for ${a}`);
    }
    if (a === "--config") configDir = resolve(value);
    else if (a === "--snapshot") snapshotPath = resolve(value);
    else if (a === "--registry") registryPath = resolve(value);
    else {
      const names = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (a === "--builtin") builtinOverride = names;
      else builtinExtra = builtinExtra.concat(names);
    }
  } else if (a === "--include-builtin-names") {
    includeBuiltinNames = true;
  } else {
    throw new UsageError(`Unknown argument: ${a}`);
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

// OpenCode built-ins are out of scope (references/plan-facts.md §Built-in agents
// are out of scope). The rule there is "anything OpenCode ships is skipped", and
// the exact set changes between versions — a script cannot enumerate it from config
// files, so this is a NAME DENYLIST for the built-ins that page documents, not the
// definition of the rule. Adjust it with --builtin / --extra-builtin, or keep the
// names with --include-builtin-names; every skip is reported under `skippedBuiltins`.
const DEFAULT_BUILTIN_AGENTS = [
  "build", "plan", // primary agents
  "general", "explore", "scout", // built-in subagents
  "compaction", "title", "summary", // hidden system agents
];
const KNOWN_BUILTIN_AGENTS = new Set(
  (builtinOverride ?? DEFAULT_BUILTIN_AGENTS).concat(builtinExtra),
);

const warnings = [];
const agents = [];
const skippedBuiltins = [];
const deadChainIds = [];
const warn = (kind, agent, message) => warnings.push({ kind, agent, message });

// deadChainIds is the run-level summary of chain ids that can never work,
// deduped by id. Every dead id ALSO keeps its per-agent warning below — this
// summary adds a top-level view, it never replaces a warning.
function recordDeadChainId(id, agentName, reason) {
  const existing = deadChainIds.find((e) => e.id === id);
  if (existing) {
    if (!existing.agents.includes(agentName)) existing.agents.push(agentName);
    return;
  }
  deadChainIds.push({ id, agents: [agentName], reason });
}

// True when the caller should skip this name, recording what was dropped so a
// custom agent that merely shares a built-in name stays visible.
function skipBuiltin(name, source, file) {
  if (!KNOWN_BUILTIN_AGENTS.has(name)) return false;
  if (!includeBuiltinNames) {
    skippedBuiltins.push({ name, source, file });
    return true;
  }
  warn(
    "builtin-name",
    name,
    `name is on the OpenCode built-in denylist but was kept because --include-builtin-names was passed — verify it is really a custom agent`,
  );
  return false;
}

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
  return parseJsonc(stripBom(text));
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
  const lines = stripBom(text).split(/\r?\n/);
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

// --- inventory fields: mode / hidden / traits (agent-sources.md) --------------

const MODES = new Set(["primary", "subagent", "all"]);

// Unknown or absent mode normalizes to "all" — the OpenCode default — unless the
// source states something unrecognized, which stays null rather than being guessed.
function normalizeMode(raw, name, file) {
  if (raw == null || raw === "") return "all";
  const value = String(raw).trim().toLowerCase();
  if (MODES.has(value)) return value;
  warn("mode", name, `unrecognized mode "${raw}" in ${file} — recorded as null`);
  return null;
}

function normalizeHidden(raw) {
  if (raw === true) return true;
  if (typeof raw === "string") return raw.trim().toLowerCase() === "true";
  return false;
}

// Known-role overrides win over inferred traits; the authoritative map is
// SKILL.md §Allocation Policy (mirrored here verbatim).
const KNOWN_ROLE_TRAITS = [
  [/^orchestrator$/, "orchestration"],
  [/^oracle$/, "reasoning"],
  [/^(explorer|librarian)$/, "cheap-high-volume"],
  [/^fixer$/, "coding"],
  [/^designer$/, "frontend"],
  [/^observer$/, "vision"],
  [/^council/, "diversity"], // council / councillor / councillor-*
];

// Signals per references/plan-facts.md §Role-trait mapping. Order is the output
// order; short tokens are word-bounded so "build" is not read as "ui" and
// "codebase" is not read as a coding lane.
const TRAIT_SIGNALS = [
  [/\borchestrat|\bplan|delegat/, "orchestration"],
  [/\breason|\bdebug|\breview|\baudit|architect/, "reasoning"],
  [/\bsearch|\bexplore|\bresearch|\bdocs?\b|\blibrarian/, "cheap-high-volume"],
  [/\bfix|\bimplement|\brefactor|\bcode\b|\bcoding|\bcoder/, "coding"],
  [/\bui\b|\bcss\b|\bdesign|\bfrontend/, "frontend"],
  [/vision|image|screenshot|\bocr\b|photo|multimodal/, "vision"],
  [/\bcouncil|adversar|\bpanel\b|multiple reviewers/, "diversity"],
];

// A known role resolves to its override alone — "overrides win over inferred
// traits" (SKILL.md §Allocation Policy), so `observer` is a vision lane and not
// also a reasoning one because its description says "review". Names are matched
// case-insensitively: the name is a JSON key or a filename, so `Observer.md` is
// the same role as `observer.md`.
function deriveTraits({ name, description, mode }) {
  const knownName = name.toLowerCase();
  const overrides = KNOWN_ROLE_TRAITS.filter(([pattern]) => pattern.test(knownName)).map(
    ([, trait]) => trait,
  );
  if (overrides.length) return [...new Set(overrides)];
  const text = `${description ?? ""} ${name}`.toLowerCase();
  const traits = TRAIT_SIGNALS.filter(([pattern]) => pattern.test(text)).map(
    ([, trait]) => trait,
  );
  if (mode === "primary") traits.push("orchestration");
  return [...new Set(traits)];
}

// One timestamp per run: provenance.fetchedAt answers "when did this run see the
// agent", the same source+date rule the skill applies to Go plan data.
const fetchedAt = new Date().toISOString();

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
    if (!def || typeof def !== "object") continue;
    if (skipBuiltin(name, "slim", file)) continue;
    const mode = normalizeMode(def.mode, name, file);
    const description = typeof def.description === "string" ? def.description : null;
    agents.push({
      name,
      source: "slim",
      mode,
      description,
      model: normalizeModel(def.model),
      hidden: normalizeHidden(def.hidden),
      traits: deriveTraits({ name, description, mode }),
      provenance: { file, pointer: `presets.${preset}.${name}`, fetchedAt },
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
    if (!def || typeof def !== "object") continue;
    if (skipBuiltin(name, "native", file)) continue;
    const mode = normalizeMode(def.mode, name, file);
    const description = typeof def.description === "string" ? def.description : null;
    agents.push({
      name,
      source: "native",
      mode,
      description,
      model: normalizeModel(def.model),
      hidden: normalizeHidden(def.hidden),
      traits: deriveTraits({ name, description, mode }),
      provenance: { file, pointer: `agent.${name}`, fetchedAt },
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
    const path = join(dir, file);
    if (skipBuiltin(name, "native", path)) continue;
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
    const description = fm && typeof fm.description === "string" ? unquote(fm.description) : null;
    const mode = normalizeMode(fm?.mode == null ? null : unquote(String(fm.mode)), name, path);
    agents.push({
      name,
      source: "native",
      mode,
      description,
      model: fm ? normalizeModel(fm.model != null ? parseFlowValue(String(fm.model)) : null) : null,
      hidden: normalizeHidden(fm?.hidden == null ? null : unquote(String(fm.hidden))),
      traits: deriveTraits({ name, description, mode }),
      provenance: { file: path, pointer: "#frontmatter", fetchedAt },
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
    recordDeadChainId(id, agentName, "registry-missing");
    return;
  }
  const status = typeof entry.status === "string" ? entry.status.toLowerCase() : null;
  if (status === "deprecated" || status === "removed") {
    warn("registry", agentName, `model ${id} has explicit registry status "${entry.status}" — never put it in a chain`);
    recordDeadChainId(id, agentName, "registry-deprecated");
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

// The snapshot's models catalog is the only catalog this script can see, so a Go
// id without a snapshot entry is dead — but only check that when a snapshot
// loaded at all; otherwise every Go id would be flagged by its mere absence.
// entry.status and entry.price.status both count, case-insensitively.
function checkGoCatalog(id, agentName) {
  if (!snapshot || !snapshot.models) return; // snapshot unavailable: check skipped entirely
  const bare = id.slice("opencode-go/".length);
  const entry = snapshot.models[bare];
  if (!entry || typeof entry !== "object") {
    recordDeadChainId(id, agentName, "missing-from-catalog");
    return; // absence is not a per-agent warning — only the summary records it
  }
  const statuses = [entry.status, entry.price && entry.price.status].filter(
    (s) => typeof s === "string",
  );
  const retired = statuses.find((s) =>
    ["deprecated", "removed", "retired"].includes(s.toLowerCase()),
  );
  if (retired !== undefined) {
    warn(
      "catalog",
      agentName,
      `model ${id} has snapshot status "${retired}" — never put a retired id in a chain`,
    );
    recordDeadChainId(id, agentName, "retired");
  }
}

// Two or more agents sharing the same chain-head id (the primary pick) draw from
// ONE Go monthly allowance — the cap is per model, not per agent. Only chain[0]
// counts: a shared fallback slot is normal and expected. One warning per shared
// id, not per agent.
function reportContention() {
  const headOwners = new Map(); // chain-head id -> agent names
  for (const record of agents) {
    const chain = chainOf(record.model);
    if (!chain.length) continue;
    const head = chain[0].id;
    const owners = headOwners.get(head) ?? [];
    owners.push(record.name);
    headOwners.set(head, owners);
  }
  for (const [id, owners] of headOwners) {
    if (owners.length < 2) continue;
    warn(
      "contention",
      null,
      `model ${id} is the chain head for ${owners.length} agents (${owners.join(", ")}) — the Go monthly cap is per model, so these agents draw from the same allowance; spread them over different primary picks or accept the shared budget`,
    );
  }
}

// Vision is a derived trait (KNOWN_ROLE_TRAITS has `observer`; the description
// signals cover image/screenshot/multimodal), so the field check below and the
// inventory never disagree about which agents are vision lanes.
const hasVisionTrait = (record) => record.traits.includes("vision");

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
  for (const { id } of chain) {
    checkRegistryEntry(id, record.name);
    if (id.startsWith("opencode-go/")) checkGoCatalog(id, record.name);
  }
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
reportContention();

return { exitCode: 0, agents, warnings, skippedBuiltins, deadChainIds };
}

export function discoverCli(argv = [], io = {}) {
  const streams = makeIo(io);
  try {
    const result = discoverAgents(argv);
    if (result.help) {
      streams.stdout.write(`${result.help}\n`);
      return 0;
    }
    streams.stdout.write(
      JSON.stringify({
        agents: result.agents,
        warnings: result.warnings,
        skippedBuiltins: result.skippedBuiltins,
        deadChainIds: result.deadChainIds,
      }) + "\n",
    );
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      streams.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

// Chain shape rules, in one place: 2–4 entries, no duplicate id, every id
// non-empty. Used where a chain comes from a model pick rather than a config
// file, so the rule is enforced instead of described.
export function validateChain(ids, { min = 2, max = 4 } = {}) {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const problems = [];
  const seen = new Map();
  for (const entry of list) {
    const key = typeof entry === "string" ? entry : entry && entry.id;
    if (!key) problems.push("empty model id");
    else seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) problems.push(`duplicate model id ${id} (${n}x)`);
  if (list.length < min || list.length > max) {
    problems.push(`chain has ${list.length} entries — the rule is ${min}–${max}`);
  }
  return { ok: problems.length === 0, problems, length: list.length };
}
