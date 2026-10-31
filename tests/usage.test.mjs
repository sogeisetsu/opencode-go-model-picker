// opencode-go-model-picker — local DB accounting regression tests.
// Copyright (C) 2026 sogeisetsu
//
// The DB is synthetic: three assistant messages with known tokens, so every
// expected number below is arithmetic, not "whatever the script printed".

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { usageReport } from "../scripts/lib/usage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = join(root, "tests", "fixtures", "snapshot.json");
const prices = join(root, "references", "model-prices.json");

async function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), "go-picker-db-"));
  const file = join(dir, "usage.db");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, agent TEXT);
    CREATE TABLE session_message (
      id TEXT, session_id TEXT, time_created INTEGER, type TEXT, data TEXT
    );
  `);
  const day = 86400000;
  const now = Date.now();
  const insertSession = db.prepare("INSERT INTO session (id, agent) VALUES (?, ?)");
  insertSession.run("s1", "orchestrator");
  insertSession.run("s2", "fixer");
  const row = db.prepare(
    "INSERT INTO session_message (id, session_id, time_created, type, data) VALUES (?, ?, ?, 'assistant', ?)",
  );
  // Two orchestrator messages, one fixer message; the third row is a user
  // message and must be ignored by the accounting.
  const msg = (model, tokens, cost) => JSON.stringify({ agent: null, model: { id: model }, tokens, cost });
  row.run("m1", "s1", now - 2 * day, msg("deepseek-v4.1-flash", { input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, 0.001));
  row.run("m2", "s1", now - 1 * day, msg("deepseek-v4.1-flash", { input: 2000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }, 0.002));
  row.run("m3", "s2", now - day, msg("kimi-k2.7-code", { input: 3000, output: 300, reasoning: 0, cache: { read: 0, write: 0 } }, 0.003));
  db.prepare(
    "INSERT INTO session_message (id, session_id, time_created, type, data) VALUES (?, ?, ?, 'user', ?)",
  ).run("u1", "s1", now - day, JSON.stringify({ role: "user" }));
  db.close();
  return { dir, file };
}

test("local DB totals are the sum of the inserted messages", async () => {
  const { dir, file } = await makeDb();
  try {
    const { report } = await usageReport([
      "--db", file,
      "--snapshot", snapshot,
      "--prices", prices,
      "--days", "36500",
      "--cycle-start", "2026-10-01",
      "--console-cost", "0.006",
      "--console-requests", "3",
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.storage, "v2");
    assert.equal(report.totals.requests, 3);
    assert.equal(report.totals.tokens.input, 6000);
    assert.equal(report.totals.tokens.output, 600);
    const agents = Object.keys(report.byAgent).sort();
    assert.deepEqual(agents, ["fixer", "orchestrator"]);
    assert.equal(report.byAgent.orchestrator.requests, 2);
    assert.equal(report.byAgent.fixer.requests, 1);
    assert.equal(report.written, false, "no --write means no snapshot write");
    assert.ok(report.calibration && typeof report.calibration === "object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing DB is a JSON failure, not a stack trace", async () => {
  const { report } = await usageReport([
    "--db", join(root, "tests", "fixtures", "nope.db"),
    "--snapshot", snapshot,
    "--prices", prices,
  ]).then((r) => r, (err) => ({ error: err }));
  assert.ok(report === undefined || report.error, "expected a thrown failure");
});
