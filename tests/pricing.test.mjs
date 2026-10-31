// opencode-go-model-picker — pricing and chain-shape regression tests.
// Copyright (C) 2026 sogeisetsu
//
// The goldens under tests/golden/ were captured from the pre-refactor scripts
// (quota-math.mjs / probe-console.mjs / discover-agents.mjs). A difference is a
// regression, never a number to refresh by hand.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pricingCli,
  costOfUsage,
  entryFor,
  loadPriceTable,
  planWindows,
  shareOfCap,
  sessionsPerWindow,
  seedFreshness,
  DEFAULT_PRICE_SEED,
} from "../scripts/lib/pricing.mjs";
import { validateChain } from "../scripts/lib/agents.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const golden = (name) => JSON.parse(readFileSync(join(root, "tests", "golden", name), "utf8"));

function capture(argv) {
  let out = "";
  let err = "";
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } };
  const code = pricingCli(argv, io);
  return { code, out, err, json: out.trim().startsWith("{") ? JSON.parse(out) : null };
}

const dropVolatile = (value) => {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.seed;
  if (copy.path) copy.path = copy.path.replace(/\\/g, "/");
  return copy;
};

test("self-check still passes the published arithmetic", () => {
  const { code, json } = capture(["--self-check"]);
  assert.equal(code, 0);
  assert.ok(json.ok, "selfCheck().ok");
  assert.deepEqual(json, golden("pricing-self-check.json"));
});

test("case 1: cache read/write + reasoning + peak, ten requests", () => {
  const { code, json } = capture([
    "--model", "deepseek-v4.1-flash",
    "--input", "12000",
    "--cache-read", "30000",
    "--cache-write", "2000",
    "--output", "800",
    "--reasoning", "1500",
    "--at", "2026-10-30T20:00:00Z",
    "--count", "10",
    "--pool", "200",
    "--prices", "references/model-prices.json",
    "--json",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(dropVolatile(json), dropVolatile(golden("pricing-case-1.json")));
});

test("case 2: context tier chosen by prompt length", () => {
  const { code, json } = capture([
    "--model", "qwen3.7-plus",
    "--input", "300000",
    "--output", "1000",
    "--at", "2026-10-30T02:00:00Z",
    "--json",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(dropVolatile(json), dropVolatile(golden("pricing-case-2.json")));
  assert.equal(json.tierOverK, 256000);
});

test("missing --model is a usage error (exit 2), not a crash", () => {
  const { code, err } = capture(["--json"]);
  assert.equal(code, 2);
  assert.match(err, /--model/);
});

test("unknown model is a reported error (exit 1)", () => {
  const { code, json } = capture(["--model", "no-such-model", "--json"]);
  assert.equal(code, 1);
  assert.match(json.error, /not in/);
});

test("price table constants: cap, windows and capacity stay consistent", () => {
  const table = loadPriceTable(DEFAULT_PRICE_SEED);
  assert.equal(table.error, undefined);
  const entry = entryFor(table, "deepseek-v4.1-flash");
  const windows = planWindows(80);
  assert.deepEqual(windows, { fiveHour: 16, week: 40, month: 80 });
  assert.equal(shareOfCap(8, 80), 0.1);
  assert.equal(sessionsPerWindow(80, 0.0327).month, 80 / 0.0327);
  const usage = { input: 1000, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  const cost = costOfUsage(entry, usage, "2026-10-30T02:00:00Z");
  const expected = ((1000 * 0.15 + 100 * 0.6) / 1e6) * cost.multiplier;
  assert.equal(cost.usd, expected);
});

test("an old seed is labelled stale, never silently current", () => {
  const table = loadPriceTable(DEFAULT_PRICE_SEED);
  const fresh = seedFreshness(table, { now: new Date(table.generatedAt) });
  assert.ok(fresh.ageDays < 0.01, `ageDays ${fresh.ageDays}`);
  const late = seedFreshness(table, { now: new Date(Date.parse(table.generatedAt) + 30 * 86400000) });
  assert.equal(late.stale, true);
  assert.match(late.reason, /days/);
});

test("chain shape: 2-4 entries, no duplicates", () => {
  assert.equal(validateChain(["a", "b"]).ok, true);
  assert.equal(validateChain(["a", "b", "c", "d"]).ok, true);
  assert.equal(validateChain(["a"]).ok, false, "a single entry is not a chain");
  assert.equal(validateChain(["a", "b", "c", "d", "e"]).ok, false, "five is too many");
  const dup = validateChain(["a", "b", "a"]);
  assert.equal(dup.ok, false);
  assert.match(dup.problems.join(" "), /duplicate/);
  assert.equal(validateChain([]).ok, false);
});
