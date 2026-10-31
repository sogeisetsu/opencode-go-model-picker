// opencode-go-model-picker — discovery and Console-state regression tests.
// Copyright (C) 2026 sogeisetsu

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAgents } from "../scripts/lib/agents.mjs";
import { probeConsole } from "../scripts/lib/console.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(root, "tests", "fixtures", ...parts);
const golden = (name) => JSON.parse(readFileSync(join(root, "tests", "golden", name), "utf8"));

// Timestamps and absolute fixture paths differ per machine; nothing else may.
function normalize(value) {
  const text = JSON.stringify(value)
    .replaceAll(root.replace(/\\/g, "\\\\"), "<root>")
    .replaceAll(root.replace(/\\/g, "/"), "<root>")
    .replace(/"fetchedAt":"[^"]*"/g, '"fetchedAt":"<t>"')
    .replace(/"checkedAt":"[^"]*"/g, '"checkedAt":"<t>"');
  return JSON.parse(text);
}

test("discovery inventory matches the captured golden", () => {
  const result = discoverAgents([
    "--config", fixture("config"),
    "--snapshot", fixture("snapshot.json"),
    "--registry", fixture("registry.json"),
  ]);
  assert.equal(result.exitCode, 0);
  const { exitCode, ...body } = result;
  assert.deepEqual(normalize(body), normalize(golden("agents.json")));
});

test("discovery reports the skipped built-in name instead of dropping it", () => {
  const result = discoverAgents(["--config", fixture("config"), "--snapshot", fixture("snapshot.json")]);
  assert.deepEqual(result.skippedBuiltins.map((b) => b.name), ["build"]);
  const kept = discoverAgents([
    "--config", fixture("config"),
    "--snapshot", fixture("snapshot.json"),
    "--include-builtin-names",
  ]);
  assert.ok(kept.agents.some((a) => a.name === "build"));
});

test("discovery flags every dead chain id with a reason", () => {
  const { deadChainIds } = discoverAgents([
    "--config", fixture("config"),
    "--snapshot", fixture("snapshot.json"),
    "--registry", fixture("registry.json"),
  ]);
  const byId = Object.fromEntries(deadChainIds.map((d) => [d.id, d.reason]));
  assert.equal(byId["opencode-go/retired-model"], "retired");
  assert.equal(byId["opencode-go/glm-5.3"], "missing-from-catalog");
  assert.equal(byId["opencode/glm-5.2"], "registry-missing");
});

test("console state: authorized with a bill in hand", async () => {
  const { output } = await probeConsole([
    "--tool-status", "authorized",
    "--tool-cost-usd", "12.5",
    "--no-probe",
    "--no-mcp-list",
  ]);
  assert.deepEqual(normalize(output), normalize(golden("probe-authorized.json")));
});

test("console state: unauthenticated never claims a bill", async () => {
  const { output } = await probeConsole([
    "--tool-status", "unauthenticated",
    "--no-probe",
    "--no-mcp-list",
  ]);
  assert.deepEqual(normalize(output), normalize(golden("probe-unauthenticated.json")));
});

test("console state: absent when config and mcp list agree there is none", async () => {
  const { output } = await probeConsole([
    "--no-probe",
    "--mcp-list", fixture("mcp-list-none.txt"),
    "--config", fixture("does-not-exist.json"),
  ]);
  assert.equal(output.state, "absent");
});

test("console rejects an unknown --tool-status", async () => {
  await assert.rejects(() => probeConsole(["--tool-status", "maybe"]), /--tool-status/);
});
