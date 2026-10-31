// opencode-go-model-picker — detect the OpenCode Console MCP state (read-only, no tokens printed).
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
// Five states, decided from the cheapest evidence first (references/plan-facts.md
// is the authoritative copy table; this script only names the state):
//
//   authorized      the in-run tool returned a non-empty cost_usd (real bill)
//   gated           403 "The Console MCP is not enabled for this workspace."
//   unauthenticated 401, or `opencode mcp list` says needs authentication
//   absent          no console server in the config and no tool in this run
//   unknown         timeout, DNS/proxy failure, 5xx, or a reachable endpoint whose
//                   authorization no evidence in this run has proven — never
//                   reported as absent, because "network broke" is not "not set up"
//
// Order (cost ascends): evidence the caller already holds -> config file -> one
// initialize request. Never probe the network before reading the config, and never
// probe at all when `--no-probe` is passed.
//
// Nothing secret is ever printed: a config entry is reduced to {url, hasAuth}, and
// response bodies are cut to a short, header-free snippet.
//
// Usage:
//   node scripts/go.mjs run [--tool-status <authorized|gated|unauthorized|absent|unknown>]
//                                  [--tool-cost-usd <usd>] [--config <file>] [--url <url>]
//                                  [--no-probe] [--no-mcp-list] [--json] [--help]
//   --tool-status / --tool-cost-usd  what the console.get_usage call in THIS run
//                                    returned; the strongest evidence there is.
//   --config <file>                  OpenCode config to scan (default: the user's
//                                    opencode.json, then opencode.jsonc).
//   --mcp-list is on by default and only reads `opencode mcp list` (local, no
//   network); --no-mcp-list skips it when the CLI is slow or absent.
//
// Output: one compact JSON object on stdout:
//   { state, guidanceKey, evidence: [...], server: {name, url, source, hasAuth},
//     probe: {...}, mcpList: {...}, checkedAt }
// Exit codes: 0 (a state was determined), 2 (bad usage).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { stripBom } from "./json-io.mjs";
import { UsageError, makeIo } from "./io.mjs";

const DEFAULT_URL = "https://opencode.ai/console/mcp";
const CONSOLE_NAMES = new Set(["console", "opencode_console", "opencode-console", "opencode go"]);
const PROBE_TIMEOUT_MS = 8000;
const SNIPPET_MAX = 240;

const USAGE = [
  "Usage: node scripts/go.mjs run [--tool-status <state>] [--tool-cost-usd <usd>]",
  "                                       [--config <file>] [--url <url>] [--no-probe]",
  "                                       [--mcp-list <file>] [--no-mcp-list] [--json] [--help]",
  "  --mcp-list <file>  read a saved `opencode mcp list` output instead of running the CLI (fixtures)",
  "Detects the Console MCP state (authorized|gated|unauthenticated|absent|unknown).",
  "Read-only; one compact JSON object on stdout; never prints a token. Exit 0 (2 on bad usage).",
].join("\n");

const STATES = ["authorized", "gated", "unauthenticated", "absent", "unknown"];

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const has = (argv, name) => argv.includes(name);

// --- config ------------------------------------------------------------------

function parseJsonc(text) {
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
  return JSON.parse(out.replace(/,\s*([}\]])/g, "$1"));
}

function readConfigEntry(file) {
  let text;
  try {
    text = stripBom(readFileSync(file, "utf8"));
  } catch {
    return { error: "unreadable" };
  }
  let cfg;
  try {
    cfg = parseJsonc(text);
  } catch {
    return { error: "unparseable" };
  }
  const mcp = cfg && typeof cfg.mcp === "object" && cfg.mcp !== null ? cfg.mcp : null;
  if (!mcp) return { console: null };
  for (const [name, entry] of Object.entries(mcp)) {
    if (!entry || typeof entry !== "object") continue;
    const key = name.trim().toLowerCase();
    if (!CONSOLE_NAMES.has(key) && !key.includes("console")) continue;
    // Reduce to facts only: a headers/token value must never reach stdout.
    return {
      console: {
        name,
        url: typeof entry.url === "string" ? entry.url : null,
        type: typeof entry.type === "string" ? entry.type : null,
        enabled: entry.enabled !== false,
        hasAuth: Boolean(entry.headers && Object.keys(entry.headers).length) || Boolean(entry.token),
      },
    };
  }
  return { console: null };
}

function scanConfig(explicitPath) {
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : ["opencode.json", "opencode.jsonc"].map((n) => join(homedir(), ".config", "opencode", n));
  const found = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = readConfigEntry(file);
    if (parsed.console) found.push({ file, ...parsed.console });
  }
  return { files: candidates.filter((f) => existsSync(f)), found };
}

// --- opencode mcp list -------------------------------------------------------

// The host's own view beats a raw request: OpenChamber injects the console server
// at runtime, so the config file often lists nothing while the CLI reports the
// server connected. Only names and the status word are kept — a token never
// reaches stdout, and the status word decides whether a probe is worth making.
// `--mcp-list <path>` reads a saved listing instead of running the CLI, which is
// how a fixture (or a CI machine without OpenCode) reproduces a state.
function parseMcpList(out) {
  const lines = String(out).split(/\r?\n/);
  const hit = lines.find((l) => /console/i.test(l));
  const status = hit ? hit.replace(/^[^\w]*/, "").replace(/^\S+\s+/, "").trim().toLowerCase() : null;
  return {
    ran: true,
    hasConsole: Boolean(hit),
    name: hit ? hit.trim().slice(0, 80) : null,
    status,
    connected: status ? status.includes("connected") || status.includes("ready") : false,
    needsAuth: status
      ? /needs authentication|not authenticated|unauthenticated|pending/.test(status)
      : false,
    disabled: status ? status.includes("disabled") : false,
  };
}

function readMcpList(file) {
  if (file) {
    try {
      return parseMcpList(readFileSync(file, "utf8"));
    } catch (err) {
      return { ran: false, reason: `cannot read ${file}: ${err.message}` };
    }
  }
  let out;
  try {
    out = execFileSync("opencode", ["mcp", "list"], {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const text = typeof err?.stdout === "string" ? err.stdout : "";
    if (!text.trim()) return { ran: false, reason: "opencode CLI unavailable or failed" };
    out = text;
  }
  return parseMcpList(out);
}

// --- network probe -----------------------------------------------------------

function snippet(text) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

async function probeInitialize(url) {
  if (!url) return { ran: false, reason: "no url to probe" };
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencode-go-model-picker", version: "2.0.0" },
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    return { ran: true, status: res.status, body: snippet(text) };
  } catch (err) {
    const code = err?.cause?.code ?? err?.name ?? "error";
    return { ran: true, status: null, error: String(code), message: snippet(err?.message) };
  }
}

function stateFromProbe(probe) {
  if (!probe.ran) return null;
  if (probe.status === null) return "unknown"; // timeout, DNS, proxy
  const text = `${probe.body ?? ""} ${probe.message ?? ""}`.toLowerCase();
  if (probe.status === 401) return "unauthenticated";
  if (probe.status === 403) {
    if (text.includes("not enabled for this workspace")) return "gated";
    if (text.includes("enabled") || text.includes("workspace")) return "gated";
    return "unauthenticated";
  }
  if (probe.status >= 200 && probe.status < 300) return "unknown"; // reachable, authorization unproven
  return "unknown";
}

// --- decision ----------------------------------------------------------------

function decide({ toolStatus, toolCostUsd, config, mcpList, probe }) {
  const evidence = [];
  if (toolStatus) {
    evidence.push(`in-run tool status: ${toolStatus}`);
    if (toolStatus === "authorized" && typeof toolCostUsd === "number" && toolCostUsd > 0) {
      evidence.push(`in-run cost_usd = ${toolCostUsd}`);
      return { state: "authorized", evidence };
    }
    if (toolStatus === "authorized") {
      evidence.push("tool reported authorized but cost_usd was empty — treated as unproven");
      return { state: "unknown", evidence };
    }
    if (STATES.includes(toolStatus) && toolStatus !== "authorized") {
      return { state: toolStatus, evidence };
    }
  }
  const entry = config.found[0] ?? null;
  if (entry) {
    evidence.push(`console server "${entry.name}" configured in ${entry.file}${entry.enabled ? "" : " (disabled)"}`);
  } else if (config.files.length) {
    evidence.push(`no console server in ${config.files.join(", ")}`);
  } else {
    evidence.push("no OpenCode config file found");
  }
  if (mcpList.ran) {
    evidence.push(
      mcpList.hasConsole
        ? `opencode mcp list: ${mcpList.name} (${mcpList.status ?? "status unknown"})`
        : "opencode mcp list shows no console server",
    );
    if (mcpList.needsAuth) return { state: "unauthenticated", evidence };
    if (mcpList.hasConsole && mcpList.disabled) {
      evidence.push("the console server is configured but disabled in this host");
      return { state: "unknown", evidence };
    }
    if (mcpList.connected) {
      // Reachable and authenticated at the host, but this run holds no bill:
      // stop here rather than let an unauthenticated raw request decide.
      evidence.push("the host reports it connected, but this run returned no cost_usd — a bill is still unverified");
      return { state: "unknown", evidence, skipProbe: true };
    }
  }
  const fromProbe = probe ? stateFromProbe(probe) : null;
  if (fromProbe) {
    evidence.push(
      probe.status === null
        ? `initialize failed: ${probe.error}${probe.message ? ` (${probe.message})` : ""}`
        : `initialize returned HTTP ${probe.status}${probe.body ? `: ${probe.body}` : ""}`,
    );
    if (fromProbe !== "unknown") return { state: fromProbe, evidence };
  }
  if (!entry && mcpList.ran && !mcpList.hasConsole) {
    evidence.push("no console server configured and none listed by the CLI");
    return { state: "absent", evidence };
  }
  if (!probe) return { state: "unknown", evidence, needsProbe: true };
  return { state: "unknown", evidence };
}

// Detection only: returns the state object (and never writes to stdout) so the
// `run` pipeline can consume it without parsing its own output.
export async function probeConsole(argv = []) {
  if (has(argv, "--help") || has(argv, "-h")) return { exitCode: 0, help: USAGE };
  const toolStatus = argValue(argv, "--tool-status");
  if (toolStatus !== undefined && !STATES.includes(toolStatus)) {
    throw new UsageError(`Unknown --tool-status ${toolStatus} (expected ${STATES.join("|")})`);
  }
  const costRaw = argValue(argv, "--tool-cost-usd");
  const toolCostUsd = costRaw === undefined ? null : Number(costRaw);
  if (toolCostUsd !== null && !Number.isFinite(toolCostUsd)) {
    throw new UsageError("--tool-cost-usd must be a number");
  }

  const config = scanConfig(argValue(argv, "--config"));
  const mcpList = has(argv, "--no-mcp-list")
    ? { ran: false, hasConsole: false, needsAuth: false, disabled: false, connected: false }
    : readMcpList(argValue(argv, "--mcp-list"));
  const configuredUrl = config.found[0]?.url ?? null;
  const url = argValue(argv, "--url") ?? configuredUrl ?? DEFAULT_URL;

  // Cheapest evidence first: no network request until the config and the host's
  // own list have both failed to settle it.
  let probe = { ran: false, reason: "not needed" };
  let decision = decide({ toolStatus, toolCostUsd, config, mcpList, probe: null });
  if (decision.needsProbe && !has(argv, "--no-probe")) {
    probe = configuredUrl || !config.found.length ? await probeInitialize(url) : { ran: false, reason: "no url" };
    decision = decide({ toolStatus, toolCostUsd, config, mcpList, probe });
  }
  delete decision.needsProbe;
  return {
    exitCode: 0,
    output: {
      state: decision.state,
      guidanceKey: `console-mcp#${decision.state}`,
      evidence: decision.evidence,
      server: config.found[0]
        ? {
            name: config.found[0].name,
            url: configuredUrl,
            source: config.found[0].file,
            hasAuth: config.found[0].hasAuth,
            enabled: config.found[0].enabled,
          }
        : null,
      probe,
      mcpList,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function consoleCli(argv = [], io = {}) {
  const streams = makeIo(io);
  try {
    const result = await probeConsole(argv);
    if (result.help) {
      streams.stdout.write(`${result.help}\n`);
      return 0;
    }
    streams.stdout.write(`${JSON.stringify(result.output)}\n`);
    return result.exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      streams.stderr.write(`${err.message}\n`);
      return 2;
    }
    streams.stdout.write(`${JSON.stringify({ state: "unknown", error: String(err?.message ?? err) })}\n`);
    return 0;
  }
}