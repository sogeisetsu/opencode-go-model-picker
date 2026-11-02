// opencode-go-model-picker — end-to-end CLI tests for the single entry point.
// Copyright (C) 2026 sogeisetsu
//
// These run the real binary (node scripts/go.mjs) because the contract is the
// CLI surface itself: one entry, four verbs, degraded runs still produce a
// usable run.json, and apply never writes without --write.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "../scripts/lib/apply.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const go = join(root, "scripts", "go.mjs");
const fixtures = (...p) => join(root, "tests", "fixtures", ...p);

function runGo(args, { expect = 0 } = {}) {
  try {
    const out = execFileSync(process.execPath, [go, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(0, expect, `expected exit ${expect}`);
    return out;
  } catch (err) {
    assert.equal(err.status, expect, `unexpected exit ${err.status}: ${err.stderr}`);
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

test("run --offline produces a dated seed-labelled run and never touches the network", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-run-"));
  try {
    const out = join(dir, "run.json");
    runGo([
      "run", "--offline",
      "--config", fixtures("config"),
      "--snapshot", fixtures("snapshot.json"),
      "--db", fixtures("missing.db"),
      "--prices", join(root, "references", "model-prices.json"),
      "--out", out,
    ]);
    const run = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(run.kind, "run");
    assert.equal(run.data.quality, "seed");
    assert.match(run.data.prices.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(run.agents.length, 7);
    assert.equal(run.usage.ok, false, "a missing DB degrades instead of aborting the run");
    assert.match(run.basis.line, /^Basis: /);
    assert.equal(run.needs.applyGate, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report renders the documented columns and passes its own gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-report-"));
  try {
    const runPath = join(dir, "run.json");
    runGo([
      "run", "--offline",
      "--config", fixtures("config"),
      "--snapshot", fixtures("snapshot.json"),
      "--db", fixtures("missing.db"),
      "--out", runPath,
    ]);
    const md = runGo(["report", "--run", runPath, "--picks", fixtures("picks.json")]);
    assert.match(md, /^Basis: /m);
    assert.match(md, /\| agent \| recommended chain \| headroom/);
    assert.match(md, /Month-end occupancy/);
    assert.match(md, /Dead chain ids this run/);
    assert.match(md, /No configuration has been written/);

    const reportPath = join(dir, "report.md");
    writeFileSync(reportPath, md, "utf8");
    const checks = runGo(["check", reportPath, "--run", runPath]);
    assert.match(checks, /all checks passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check refuses a report that mixes or drops the basis line", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-check-"));
  try {
    const reportPath = join(dir, "bad.md");
    writeFileSync(
      reportPath,
      "| agent | recommended chain |\n|---|---|\n| fixer | opencode-go/kimi-k2.7-code |\n",
      "utf8",
    );
    const out = runGo(["check", reportPath], { expect: 1 });
    assert.match(out, /FAIL\s+basis/);
    assert.match(out, /report is not ready/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply prints a diff, writes nothing without --write, and rewrites only the named file", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-apply-"));
  try {
    for (const name of ["opencode.jsonc", "oh-my-opencode-slim.json"]) {
      copyFileSync(fixtures("config", name), join(dir, name));
    }
    copyFileSync(fixtures("config", "agents", "designer.md"), join(dir, "designer.md"));
    const runPath = join(dir, "run.json");
    runGo(["run", "--offline", "--config", dir, "--snapshot", fixtures("snapshot.json"), "--db", fixtures("missing.db"), "--out", runPath]);
    const run = JSON.parse(readFileSync(runPath, "utf8"));

    const target = join(dir, "opencode.jsonc");
    const original = readFileSync(target, "utf8");
    const dry = runGo(["apply", "--run", runPath, "--picks", fixtures("picks.json"), "--target", target]);
    assert.match(dry, /^--- /m);
    assert.equal(readFileSync(target, "utf8"), original, "dry run must not write");
    assert.equal(run.agents.some((a) => a.provenance.file === target), true);

    runGo(["apply", "--run", runPath, "--picks", fixtures("picks.json"), "--target", target, "--write"]);
    const written = parseJsonc(readFileSync(target, "utf8"));
    assert.deepEqual(written.agent.orchestrator.model, [
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/qwen3.8-flash",
    ]);
    assert.equal(written.agent.build.model, "opencode-go/hy3", "untouched agent keeps its model");

    // A dead id in a chain is refused before anything is written.
    const badPicks = join(dir, "bad-picks.json");
    writeFileSync(
      badPicks,
      JSON.stringify({ picks: { observer: { chain: ["opencode-go/retired-model", "opencode-go/hy3"] } } }),
      "utf8",
    );
    const out = runGo(["apply", "--run", runPath, "--picks", badPicks, "--target", target], { expect: 1 });
    assert.match(out + "|", /refusing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown verb is a usage error (exit 2)", () => {
  runGo(["nope"], { expect: 2 });
});

test("run publishes the candidate menu, and an id outside it is refused everywhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-menu-"));
  try {
    for (const name of ["opencode.jsonc", "oh-my-opencode-slim.json"]) {
      copyFileSync(fixtures("config", name), join(dir, name));
    }
    mkdirSync(join(dir, "agents"), { recursive: true });
    copyFileSync(fixtures("config", "agents", "designer.md"), join(dir, "agents", "designer.md"));
    const runPath = join(dir, "run.json");
    runGo(["run", "--offline", "--config", dir, "--snapshot", fixtures("snapshot.json"), "--db", fixtures("missing.db"), "--out", runPath]);
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    assert.ok(Array.isArray(run.data.candidates) && run.data.candidates.length > 0);
    assert.deepEqual(run.data.candidateIds, run.data.candidates.map((c) => c.id));
    assert.ok(run.data.candidates.every((c) => typeof c.id === "string" && c.id.startsWith("opencode-go/")));

    const fake = join(dir, "fake.json");
    const picks = { picks: {} };
    for (const agent of run.agents) picks.picks[agent.name] = { chain: ["opencode-go/invented-model", "opencode-go/hy3"] };
    writeFileSync(fake, JSON.stringify(picks), "utf8");
    const reportOut = runGo(["report", "--run", runPath, "--picks", fake], { expect: 2 });
    assert.match(reportOut, /not in this run's Go catalog/);

    const applyOut = runGo(["apply", "--run", runPath, "--picks", fake, "--target", join(dir, "opencode.jsonc")], { expect: 1 });
    assert.match(applyOut, /refusing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single-id chain is accepted where the source holds one model", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-single-"));
  try {
    const runPath = join(dir, "run.json");
    runGo(["run", "--offline", "--config", fixtures("config"), "--snapshot", fixtures("snapshot.json"), "--db", fixtures("missing.db"), "--out", runPath]);
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    const picks = { picks: {} };
    for (const agent of run.agents) {
      // Chain-capable means the source already holds a list, or is a preset.
      const canChain = Array.isArray(agent.model) || String(agent.provenance.pointer).startsWith("presets.");
      picks.picks[agent.name] = {
        chain: canChain ? ["opencode-go/hy3", "opencode-go/qwen3.8-flash"] : ["opencode-go/hy3"],
        why: "x",
      };
    }
    const picksPath = join(dir, "picks.json");
    writeFileSync(picksPath, JSON.stringify(picks), "utf8");
    const md = runGo(["report", "--run", runPath, "--picks", picksPath]);
    // The Markdown agent gets a YAML block, not a JSONC one.
    assert.match(md, /```yaml\n# .*designer\.md → frontmatter\nmodel: opencode-go\/hy3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check --picks refuses a report whose numbers were edited after rendering", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-tamper-"));
  try {
    const runPath = join(dir, "run.json");
    runGo(["run", "--offline", "--config", fixtures("config"), "--snapshot", fixtures("snapshot.json"), "--db", fixtures("missing.db"), "--out", runPath]);
    const picksPath = fixtures("picks.json");
    const md = runGo(["report", "--run", runPath, "--picks", picksPath]);
    const good = join(dir, "good.md");
    writeFileSync(good, md, "utf8");
    assert.match(runGo(["check", good, "--run", runPath, "--picks", picksPath]), /all checks passed/);

    const bad = join(dir, "bad.md");
    writeFileSync(bad, md.replace(/- Mode: [^\n]*/, "- Mode: quality (request)."), "utf8");
    const out = runGo(["check", bad, "--run", runPath, "--picks", picksPath], { expect: 1 });
    assert.match(out, /machine-lines/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a named mode is remembered, so the next run does not ask again", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-mode-"));
  try {
    const snapshot = join(dir, "snapshot.json");
    copyFileSync(fixtures("snapshot.json"), snapshot);
    const args = ["run", "--offline", "--config", fixtures("config"), "--snapshot", snapshot, "--db", fixtures("missing.db"), "--json"];
    const first = JSON.parse(runGo([...args, "--mode", "quality"]));
    assert.equal(first.mode.chosen, "quality");
    assert.equal(first.mode.source, "request");
    const second = JSON.parse(runGo(args));
    assert.equal(second.mode.chosen, "quality");
    assert.equal(second.mode.source, "remembered");
    assert.equal(second.needs.modeQuestion, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no custom agents is a stop, not an empty report that passes the gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-empty-"));
  try {
    const empty = join(dir, "config");
    mkdirSync(empty, { recursive: true });
    const runPath = join(dir, "run.json");
    runGo(["run", "--offline", "--config", empty, "--snapshot", join(dir, "snap.json"), "--db", join(dir, "missing.db"), "--out", runPath]);
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    assert.equal(run.agents.length, 0);
    assert.equal(run.needs.noAgents, true);

    const picksPath = join(dir, "picks.json");
    writeFileSync(picksPath, JSON.stringify({ picks: {} }), "utf8");
    const reportPath = join(dir, "report.md");
    runGo(["report", "--run", runPath, "--picks", picksPath, "--out", reportPath]);
    const out = runGo(["check", reportPath, "--run", runPath, "--picks", picksPath], { expect: 1 });
    assert.match(out, /has-agents/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
