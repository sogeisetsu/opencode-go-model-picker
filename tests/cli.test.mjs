// opencode-go-model-picker — end-to-end CLI tests for the single entry point.
// Copyright (C) 2026 sogeisetsu
//
// These run the real binary (node scripts/go.mjs) because the contract is the
// CLI surface itself: one entry, four verbs, degraded runs still produce a
// usable run.json, and apply never writes without --write.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
