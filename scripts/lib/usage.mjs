// opencode-go-model-picker — calibrate local DB usage accounting against Console readings.
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
// Read-only accounting over the local OpenCode SQLite database, calibrated with
// the numbers a user reads off the OpenCode Console. Reports per-agent and
// per-model cost, a DB-vs-Console bias, a reverse-solved plan pool and a
// month-end forecast. The database is NEVER written (opened readOnly); the
// snapshot is only written with --write (atomic, every other key preserved).
//
// Usage:
//   node scripts/go.mjs run [--db <path>] [--snapshot <path>]
//     [--prices <path>] [--days <n>] [--cycle-start <YYYY-MM-DD>]
//     [--console-cost <usd>] [--console-requests <n>]
//     [--console-range <24h|7d|30d|all>] [--console-month-cost <usd>]
//     [--month-pct <pct>] [--week-pct <pct>] [--five-hour-pct <pct>]
//     [--write] [--text] [--top <n>] [--help]
//   Defaults: db %USERPROFILE%/.local/share/opencode/opencode.db; snapshot
//   ~/.cache/opencode/opencode-go-model-picker/snapshot.json; prices
//   references/model-prices.json (repo-relative); days 30; cycle-start the 1st
//   of the current UTC month; console-range 30d; top 10. All flags optional.
//
// Data shapes — the DB has TWO storage generations and this script picks one:
//   v2 (current builds, preferred): session_message(id, session_id, type, seq,
//     time_created, data). The kind lives in the `type` column
//     (assistant|user|synthetic|system|compaction|idle|agent-switched|
//     model-switched|location-switched|shell). For type='assistant', data is
//     { agent, model: { id, providerID, variant }, cost?, tokens: { input,
//     output, reasoning, cache: { read, write } }, time, finish }. agent /
//     model.id / cost / tokens are read with json_extract (json_valid guards
//     malformed rows). `cost` is frequently ABSENT on a message that never
//     completed: that row is UNPRICED — never observed as $0.
//   v1 (legacy): message(id, session_id, time_created, data) where the kind is
//     data.role = "assistant" and the model is data.modelID.
//   Selection: use v2 when the table exists AND has assistant rows in the
//     window; else fall back to v1. The generation used is reported as
//     storage: "v2" | "v1" (v2 rows undercount on a v1-only read ~19x here).
//   agent = json_extract('$.agent'), falling back to session_v2.agent /
//     session.agent; model = json_extract('$.model.id') (v2) / '$.modelID' (v1).
//   requests = assistant rows in the window (failed attempts included — a
//     request was made); failedRequests = no cost AND zero tokens (both
//     generations' failure mark: v2 never-completed, v1 cost-0 error rows);
//     failed and unpriced rows contribute to NO cost figure. free models carry
//     an explicit cost of 0 — a real observed 0, kept as 0.
//   sessions = distinct session_id; per-agent median/p90 run over per-session
//     SUMMED cost, skipping sessions whose rows are all unpriced (unknown
//     cost, not 0). Window = [now - days*86400000, now] on time_created
//     (INTEGER ms); billing cycle = rows with time_created >= cycle start.
//
// Calibration guard: when the local window total is below 20% of
// --console-cost, calibration reports { underCoverage: true, note } INSTEAD OF
// presenting the ratio as the bias (the DB may predate v2 storage, or the
// Console may aggregate other clients); such a bias is never written.
//
// Reverse-solving order — lib/pricing.mjs solvePool() fixes it, it is not a
// preference (it breaks the circular dependency):
//   1. --console-month-cost + --month-pct       -> exact pool, level 1;
//   2. else DB cycle cost through a known bias  -> provisional pool, level 2;
//      bias = this run's --console-cost bias when known, else the dated
//      snapshot.calibration.biasDbVsConsole of a previous run (a dated,
//      provisional estimate — never an invented value);
//   3. else no pool: level 3, every $ figure stays null.
// The 5h and week percentages are independent windows — never added to each
// other or to the monthly percentage; they only cross-check the solved pool
// (consistent = every implied pool within 20% of pool.monthlyUsd).
//
// --write reporting: plan.go is stamped ONLY by a solved pool (level <= 2);
// at level 3 an existing plan.go is left exactly as it is — its `at` is never
// refreshed, so a stale pool cannot look freshly calibrated — and the report
// says planWritten: false. models.<id>.billing.source is always "local-db":
// the per-model numbers come from the local DB. Console get_usage DOES return
// a per-model split (top 10 models with requests + cost_usd), but no CLI flag
// passes that split to this script — only the aggregate reaches it via
// --console-cost / --console-requests, and that aggregate lives in the
// top-level console block. "console" is reserved for a billing entry actually
// fed from a per-model Console split.
//
// Output: default = one compact JSON object on stdout (with `storage` and
// `planWritten`);
// --text = aligned tables ("-" for every missing value, never a guessed 0).
// Failures print a single {"ok":false,...} JSON line on stdout — never a
// stack trace.
// Exit codes: 0 success; 1 real failure (node:sqlite unavailable, unreadable
// DB / snapshot / price seed, snapshot write error); 2 bad usage.

import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-io.mjs";
import { FailError, HelpRequested, UsageError, makeIo } from "./io.mjs";
import {
  DEFAULT_PRICE_SEED,
  biasDrift,
  biasOf,
  costOfUsage,
  entryFor,
  forecastMonthEnd,
  loadPriceTable,
  median,
  p90,
  seedFreshness,
  solvePool,
} from "./pricing.mjs";

const DAY_MS = 86400000;
const DEFAULT_DB = join(homedir(), ".local", "share", "opencode", "opencode.db");
const DEFAULT_SNAPSHOT = join(
  homedir(),
  ".cache",
  "opencode",
  "opencode-go-model-picker",
  "snapshot.json",
);
// Mirrors go.mjs run / go.mjs run — seeds a snapshot this
// script creates from scratch. references/plan-facts.md: "schemaVersion is
// only bumped by a writer that actually adds a v3 key": --write raises an
// existing value to 3 only when it writes at least one v3 key (plan / billing /
// usage / calibration), and NEVER lowers an existing value (a future 4 stays 4).
const SNAPSHOT_SCHEMA_VERSION = 3;
const CONSOLE_RANGES = new Set(["24h", "7d", "30d", "all"]);
// A local total below this fraction of the Console window cost is a coverage
// problem, not a bias: the ratio must not be presented (or written) as one.
const UNDER_COVERAGE_RATIO = 0.2;

// --- small helpers ----------------------------------------------------------

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Every failure becomes a thrown FailError; `usageCli` turns it into the same
// one-line JSON the old CLI printed.
function fail(message, code = 1, extra = {}) {
  throw new FailError(message, code, extra);
}

function badUsage(message) {
  throw new UsageError(message);
}

const USAGE_TEXT = [
  "Usage: go.mjs run [--db <path>] [--snapshot <path>] [--prices <path>] [--days <n>]",
  "                [--cycle-start <YYYY-MM-DD>] [--console-cost <usd>] [--console-requests <n>]",
  "                [--console-range <24h|7d|30d|all>] [--console-month-cost <usd>]",
  "                [--month-pct <pct>] [--week-pct <pct>] [--five-hour-pct <pct>] [--write]",
  "Reads the local OpenCode DB read-only (v2 session_message, else v1 message) and",
  "calibrates it against Console readings. Exit 0 success, 1 failure, 2 bad usage.",
].join("\n") + "\n";

function utcMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseUtcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) return null;
  return day;
}

function daysInUtcMonth(day) {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    db: DEFAULT_DB,
    snapshot: DEFAULT_SNAPSHOT,
    prices: DEFAULT_PRICE_SEED,
    days: 30,
    cycleStart: utcMonthStart(),
    consoleCost: null,
    consoleRequests: null,
    consoleRange: "30d",
    consoleMonthCost: null,
    monthPct: null,
    weekPct: null,
    fiveHourPct: null,
    write: false,
    text: false,
    top: 10,
  };
  const valueFlags = new Set([
    "--db", "--snapshot", "--prices", "--days", "--cycle-start", "--console-cost",
    "--console-requests", "--console-range", "--console-month-cost", "--month-pct",
    "--week-pct", "--five-hour-pct", "--top",
  ]);
  const number = (name, value, { integer = false, min = 0, max = Infinity } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      const bound = max === Infinity ? `>= ${min}` : `${min}..${max}`;
      badUsage(`${name} must be a number ${integer ? "integer " : ""}${bound}`);
    }
    return n;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    throw new HelpRequested(USAGE_TEXT);
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let name = arg;
    let inline;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 2) {
      name = arg.slice(0, eq);
      inline = arg.slice(eq + 1);
    }
    if (name === "--write" || name === "--text") {
      if (inline !== undefined) badUsage(`${name} takes no value`);
      opts[name === "--write" ? "write" : "text"] = true;
      continue;
    }
    if (!valueFlags.has(name)) badUsage(`unknown argument: ${arg}`);
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined || value === "") badUsage(`missing value for ${name}`);
    switch (name) {
      case "--db": opts.db = value; break;
      case "--snapshot": opts.snapshot = value; break;
      case "--prices": opts.prices = value; break;
      case "--days": opts.days = number(name, value, { integer: true, min: 1 }); break;
      case "--top": opts.top = number(name, value, { integer: true, min: 1 }); break;
      case "--console-cost": opts.consoleCost = number(name, value); break;
      case "--console-month-cost": opts.consoleMonthCost = number(name, value); break;
      case "--console-requests":
        opts.consoleRequests = number(name, value, { integer: true, min: 1 });
        break;
      case "--month-pct": opts.monthPct = number(name, value, { max: 100 }); break;
      case "--week-pct": opts.weekPct = number(name, value, { max: 100 }); break;
      case "--five-hour-pct": opts.fiveHourPct = number(name, value, { max: 100 }); break;
      case "--console-range":
        if (!CONSOLE_RANGES.has(value)) badUsage("--console-range must be 24h|7d|30d|all");
        opts.consoleRange = value;
        break;
      case "--cycle-start": {
        const day = parseUtcDay(value);
        if (!day) badUsage("--cycle-start must be a valid YYYY-MM-DD date");
        opts.cycleStart = day;
        break;
      }
      default: badUsage(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// node:sqlite is experimental on Node 22 and absent on Node 18: degrade with
// the documented JSON instead of an import crash (no stack trace).
async function loadSqlite() {
  try {
    const mod = await import("node:sqlite");
    if (typeof mod.DatabaseSync !== "function") throw new Error("no DatabaseSync export");
    return mod.DatabaseSync;
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    fail(`node:sqlite unavailable on Node ${process.version}: ${detail}`, 1, {
      degrade: "level-2",
    });
    return null;
  }
}

// An unreadable snapshot is a hard error (go.mjs run wording): it also
// holds user state (preferences.mode), so it is never rebuilt silently. A
// MISSING snapshot is fine and only matters to --write (which then creates it).
function loadSnapshot(path) {
  const loaded = readJsonFile(path);
  if (loaded.error) {
    fail(
      `cannot read ${path}: ${loaded.error} — the snapshot also stores user state ` +
        "(preferences.mode), so it is not overwritten automatically. Fix the JSON, " +
        "or run node scripts/go.mjs run --rebuild to start over.",
    );
  }
  if (loaded.missing) return null;
  if (typeof loaded.value !== "object" || loaded.value === null || Array.isArray(loaded.value)) {
    fail(`malformed snapshot ${path}: root value is not a JSON object`);
  }
  return loaded.value;
}

// --- DB accounting ----------------------------------------------------------

// Reads the window (and anything newer the cycle may need) in ONE query of the
// chosen storage generation; the DB is opened readOnly by the caller and
// closed right after this returns. Agent/model/cost/tokens come straight from
// json_extract, so rows with malformed JSON are dropped by json_valid instead
// of crashing the query, and an absent cost stays NULL (unpriced, not 0).
function readMessages(db, queryFromMs) {
  const present = (name) =>
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name).n > 0;
  const sessionAgents = new Map();
  const tokenCols = `
    json_extract(data, '$.tokens.input') AS t_in,
    json_extract(data, '$.tokens.output') AS t_out,
    json_extract(data, '$.tokens.reasoning') AS t_reason,
    json_extract(data, '$.tokens.cache.read') AS t_cr,
    json_extract(data, '$.tokens.cache.write') AS t_cw`;
  const queryV2 = () =>
    db
      .prepare(
        `SELECT session_id, time_created,
           json_extract(data, '$.agent') AS agent,
           json_extract(data, '$.model.id') AS model,
           json_extract(data, '$.cost') AS cost, ${tokenCols}
         FROM session_message
         WHERE type = 'assistant' AND time_created >= ? AND json_valid(data)`,
      )
      .all(queryFromMs);
  const queryV1 = () =>
    db
      .prepare(
        `SELECT session_id, time_created,
           json_extract(data, '$.agent') AS agent,
           json_extract(data, '$.modelID') AS model,
           json_extract(data, '$.cost') AS cost, ${tokenCols}
         FROM message
         WHERE time_created >= ?
           AND CASE WHEN json_valid(data) THEN json_extract(data, '$.role') END = 'assistant'`,
      )
      .all(queryFromMs);

  try {
    for (const table of ["session", "session_v2"]) {
      if (!present(table)) continue;
      for (const row of db.prepare(`SELECT id, agent FROM ${table}`).all()) {
        if (row.id && !sessionAgents.has(row.id)) sessionAgents.set(row.id, row.agent ?? null);
      }
    }
  } catch (err) {
    fail(`cannot read database: ${err && err.message ? err.message : err}`);
  }

  const hasV2 = present("session_message");
  const hasV1 = present("message");
  let storage = null;
  let rows = [];
  try {
    if (hasV2) {
      rows = queryV2();
      if (rows.length > 0) storage = "v2";
    }
    if (storage === null && hasV1) {
      rows = queryV1();
      storage = "v1";
    }
  } catch (err) {
    fail(`cannot read database: ${err && err.message ? err.message : err}`);
  }
  if (storage === null) {
    if (!hasV2 && !hasV1) {
      fail("cannot read database: neither a message nor a session_message table exists");
    }
    storage = hasV2 ? "v2" : "v1"; // the available store has no rows in the window
  }
  return { rows, sessionAgents, storage };
}

// Window/cycle membership plus the two distributions. Rows arrive normalized
// (agent, model, cost, tokens already extracted). Cost semantics: cost is a
// number (0 = observed free) or null (unpriced — contributes to NO cost sum);
// failed = zero tokens and no positive cost, counted in failedRequests and in
// requests but never in any cost figure.
function accumulate(rows, sessionAgents, opts, nowMs, windowFromMs, cycleStartMs, priceTable) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let requests = 0;
  let failedRequests = 0;
  let windowCostSum = 0;
  let windowPricedRows = 0;
  let recomputedSum = 0;
  let recomputedPriced = 0;
  let dbMonthCostUsd = 0;
  const windowSessions = new Map(); // session_id -> { cost, priced }
  const cycleSessions = new Set();
  const byModel = new Map();
  const byAgent = new Map();
  const int0 = (v) => (num(v) === null ? 0 : v); // json NULL token -> 0

  for (const row of rows) {
    const at = num(row.time_created);
    if (at === null) continue;
    const inWindow = at >= windowFromMs && at <= nowMs;
    const inCycle = at >= cycleStartMs;
    if (!inWindow && !inCycle) continue;
    const usage = {
      input: int0(row.t_in),
      output: int0(row.t_out),
      // Reasoning is billed at the output rate; quota-math adds it to the priced
      // output, so it must be passed here or every priced message comes out low.
      reasoning: int0(row.t_reason),
      cacheRead: int0(row.t_cr),
      cacheWrite: int0(row.t_cw),
    };
    const zeroTokens =
      usage.input === 0 &&
      usage.output === 0 &&
      usage.reasoning === 0 &&
      usage.cacheRead === 0 &&
      usage.cacheWrite === 0;
    const cost = num(row.cost); // null = unpriced (never completed), NOT 0
    const failed = zeroTokens && !(cost > 0);

    if (inCycle) {
      if (cost !== null) dbMonthCostUsd += cost;
      cycleSessions.add(row.session_id);
    }
    if (!inWindow) continue;
    tokens.input += usage.input;
    tokens.output += usage.output;
    tokens.cacheRead += usage.cacheRead;
    tokens.cacheWrite += usage.cacheWrite;
    requests++;
    if (failed) failedRequests++;

    let session = windowSessions.get(row.session_id);
    if (!session) {
      session = { cost: 0, priced: false };
      windowSessions.set(row.session_id, session);
    }
    if (cost !== null) {
      session.cost += cost;
      session.priced = true;
      windowCostSum += cost;
      windowPricedRows++;
    }

    const agent = row.agent || sessionAgents.get(row.session_id) || "unknown";
    const model = row.model || "unknown";

    let modelRow = byModel.get(model);
    if (!modelRow) {
      modelRow = { requests: 0, costSum: 0, priced: 0, recSum: 0, recPriced: 0 };
      byModel.set(model, modelRow);
    }
    modelRow.requests++;
    if (cost !== null) {
      modelRow.costSum += cost;
      modelRow.priced++;
    }
    const priced = costOfUsage(entryFor(priceTable, model), usage, new Date(at));
    if (priced.priced) {
      modelRow.recPriced++;
      modelRow.recSum += priced.usd;
      recomputedSum += priced.usd;
      recomputedPriced++;
    }

    let agentRow = byAgent.get(agent);
    if (!agentRow) {
      agentRow = {
        requests: 0, sessions: new Set(), costSum: 0, priced: 0,
        models: new Map(), costs: new Map(),
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      };
      byAgent.set(agent, agentRow);
    }
    agentRow.requests++;
    for (const key of Object.keys(agentRow.tokens)) agentRow.tokens[key] += usage[key];
    agentRow.sessions.add(row.session_id);
    if (cost !== null) {
      agentRow.costSum += cost;
      agentRow.priced++;
    }
    let agentModel = agentRow.models.get(model);
    if (!agentModel) {
      agentModel = { requests: 0, costSum: 0, priced: 0 };
      agentRow.models.set(model, agentModel);
    }
    agentModel.requests++;
    if (cost !== null) {
      agentModel.costSum += cost;
      agentModel.priced++;
    }
    let agentSession = agentRow.costs.get(row.session_id);
    if (!agentSession) {
      agentSession = { cost: 0, priced: false };
      agentRow.costs.set(row.session_id, agentSession);
    }
    if (cost !== null) {
      agentSession.cost += cost;
      agentSession.priced = true;
    }
  }

  const totals = {
    // No priced row at all -> the window cost is unknown (null), never a 0.
    costUsd: windowPricedRows > 0 ? windowCostSum : null,
    requests,
    sessions: windowSessions.size,
    tokens,
    failedRequests,
    recomputedCostUsd: recomputedPriced > 0 ? recomputedSum : null,
  };
  // Sessions whose rows are all unpriced have an unknown cost, not $0: they
  // stay in totals.sessions but are excluded from the distribution below.
  const sessionDist = [...windowSessions.values()].filter((s) => s.priced).map((s) => s.cost);
  return { totals, byModel, byAgent, sessionDist, cycleSessions, dbMonthCostUsd };
}

function buildByModel(byModel) {
  const out = {};
  const entries = [...byModel.entries()].sort((a, b) => b[1].costSum - a[1].costSum);
  for (const [id, m] of entries) {
    const costUsd = m.priced > 0 ? m.costSum : null;
    const recomputed = m.recPriced > 0 ? m.recSum : null;
    out[id] = {
      requests: m.requests,
      costUsd,
      costPerRequestUsd: costUsd !== null && m.requests > 0 ? costUsd / m.requests : null,
      recomputedCostUsd: recomputed,
      recomputedCostPerRequestUsd:
        recomputed !== null && m.requests > 0 ? m.recSum / m.requests : null,
    };
  }
  return out;
}

function buildByAgent(byAgent, windowCostUsd) {
  const out = {};
  const entries = [...byAgent.entries()].sort((a, b) => b[1].costSum - a[1].costSum);
  for (const [agent, a] of entries) {
    const costUsd = a.priced > 0 ? a.costSum : null;
    const dist = [...a.costs.values()].filter((s) => s.priced).map((s) => s.cost);
    const models = {};
    for (const [id, m] of [...a.models.entries()].sort((x, y) => y[1].costSum - x[1].costSum)) {
      models[id] = { requests: m.requests, costUsd: m.priced > 0 ? m.costSum : null };
    }
    out[agent] = {
      requests: a.requests,
      sessions: a.sessions.size,
      tokens: a.tokens,
      tokensPerSession:
        a.sessions.size > 0
          ? Object.fromEntries(Object.entries(a.tokens).map(([k, v]) => [k, v / a.sessions.size]))
          : null,
      costUsd,
      share:
        costUsd !== null && num(windowCostUsd) !== null && windowCostUsd > 0
          ? costUsd / windowCostUsd
          : null,
      medianUsd: median(dist),
      p90Usd: p90(dist),
      models,
    };
  }
  return out;
}

// --- calibration / pool / forecast -----------------------------------------

// Bias is only presented when the local window total reaches 20% of the
// Console window cost; below that the gap is a coverage problem (DB predates
// v2 storage / Console aggregates other clients), reported as underCoverage
// with a note instead of a ratio, and never fed to solvePool or --write.
function buildCalibration(opts, totals, previousBias) {
  const consoleCost = opts.consoleCost;
  const rawBias = consoleCost !== null ? biasOf(totals.costUsd, consoleCost) : null;
  const local = num(totals.costUsd);
  const underCoverage =
    consoleCost !== null &&
    consoleCost > 0 &&
    (local === null || local < UNDER_COVERAGE_RATIO * consoleCost);
  const currentBias = underCoverage ? null : rawBias;
  const drift = biasDrift(previousBias, currentBias);
  return {
    previous: previousBias,
    current: currentBias,
    ratio: drift.ratio,
    warn: drift.warn,
    underCoverage,
    note: underCoverage
      ? "local window cost is below 20% of the Console window cost — the DB may " +
        "predate v2 storage or the Console may aggregate other clients; not presented as bias"
      : null,
  };
}

function buildCrossCheck(opts, pool, now) {
  if (opts.consoleMonthCost === null) return null;
  if (opts.fiveHourPct === null && opts.weekPct === null) return null;
  const implied = (pct) => {
    // Percentages are independent windows: each one is solved on its own and
    // only compared to the monthly pool — never added to another window.
    const solved = solvePool({
      consoleMonthCostUsd: opts.consoleMonthCost,
      monthPct: pct === null ? null : pct / 100,
      at: now,
    });
    const usd = solved.monthlyUsd;
    const ratio = usd !== null && pool.monthlyUsd !== null ? usd / pool.monthlyUsd : null;
    return { impliedMonthlyUsd: usd, ratioToMonth: ratio };
  };
  const fiveHour = opts.fiveHourPct === null ? null : implied(opts.fiveHourPct);
  const week = opts.weekPct === null ? null : implied(opts.weekPct);
  const parts = [fiveHour, week].filter((p) => p !== null);
  const within = (p) => p.ratioToMonth !== null && Math.abs(p.ratioToMonth - 1) <= 0.2;
  return {
    fiveHour,
    week,
    consistent: pool.monthlyUsd !== null && parts.length > 0 && parts.every(within),
  };
}

// --write rules: only touch a target key when this run has at least one
// non-null value for it; an incoming null NEVER nulls out an existing value;
// plan.go only on a SOLVED pool (level <= 2), else left exactly as it is and
// reported as planWritten: false; billing.source is always "local-db" (no
// per-model Console split is passed to this script); sources /
// models.<id>.price|score / preferences stay intact, and schemaVersion is
// raised to 3 by the
// caller only when a v3 key was actually written (never lowered — see
// model-snapshot.md "Backward compatibility"). Returns { touched, planWritten }.
function applySnapshotWrites(snap, opts, ctx) {
  const { pool, byModel, byAgent, currentBias, nowIso, dateStamp } = ctx;
  let touched = false;
  let planWritten = false;

  // plan.go is stamped ONLY when this run actually solved the pool
  // (pool.level <= 2, i.e. monthlyUsd is a number — solvePool spells the
  // window figures fiveHour/week on levels 1-2 but fiveHourUsd/weeklyUsd on
  // level 3). At level 3 an existing plan.go is left byte-for-byte as it is:
  // restamping `at` would make a stale, unverifiable pool look fresh.
  const solved = pool.level <= 2 && num(pool.monthlyUsd) !== null;
  if (solved) {
    const monthlyUsd = num(pool.monthlyUsd);
    const weeklyUsd = num(pool.week ?? pool.weeklyUsd);
    const fiveHourUsd = num(pool.fiveHour ?? pool.fiveHourUsd);
    const prev = typeof snap.plan?.go === "object" && snap.plan.go !== null ? snap.plan.go : {};
    snap.plan = typeof snap.plan === "object" && snap.plan !== null ? snap.plan : {};
    snap.plan.go = {
      fiveHourUsd: fiveHourUsd ?? prev.fiveHourUsd ?? null,
      weeklyUsd: weeklyUsd ?? prev.weeklyUsd ?? null,
      monthlyUsd: monthlyUsd ?? prev.monthlyUsd ?? null,
      provisional: true,
      source: "calibrated",
      at: nowIso,
    };
    touched = true;
    planWritten = true;
  }

  // Per-model billing comes from the local DB. Console get_usage can return a
  // per-model split, but no flag of this CLI passes that split in — only the
  // aggregate (--console-cost / --console-requests), and it stays in the
  // top-level console block (the bias already uses it). "console" stays
  // reserved for an entry actually fed from a per-model Console split.
  for (const [id, m] of Object.entries(byModel)) {
    const observed = m.costPerRequestUsd; // per model, from the DB; null when unpriced
    if (observed === null && m.requests === null && m.costUsd === null) continue;
    snap.models ??= {};
    snap.models[id] ??= {};
    const prev = typeof snap.models[id].billing === "object" ? snap.models[id].billing ?? {} : {};
    const merged = { ...prev };
    if (observed !== null) merged.observedCostUsdPerRequest = observed;
    if (m.requests !== null) merged.requests = m.requests;
    if (m.costUsd !== null) merged.costUsd = m.costUsd;
    merged.window = `last-${opts.days}d`;
    merged.source = "local-db";
    merged.at = nowIso;
    snap.models[id].billing = merged;
    touched = true;
  }

  const shares = {};
  for (const [agent, a] of Object.entries(byAgent)) {
    if (a.share === null) continue;
    shares[agent] = Math.round(a.share * 1000) / 1000; // fractions, 3 decimals
  }
  if (Object.keys(shares).length > 0) {
    snap.usage = typeof snap.usage === "object" && snap.usage !== null ? snap.usage : {};
    snap.usage.agentSplit = { ...(snap.usage.agentSplit ?? {}), ...shares };
    touched = true;
  }

  // A calibration constant is only as good as its date: write it when THIS run
  // measured it. With no Console bill this run, a previous bias may still be used
  // for the pool solve, but it must not be re-stamped with today's date — that
  // would present an old measurement as a fresh one.
  if (currentBias !== null) {
    snap.calibration = { ...(snap.calibration ?? {}), biasDbVsConsole: currentBias };
    snap.calibration.at = dateStamp;
    snap.calibration.note = "recompute each run; warn on >10% drift";
    touched = true;
  }
  return { touched, planWritten };
}

// --- text output ------------------------------------------------------------

const fmtUsd = (v) => (num(v) === null ? "-" : `$${v.toFixed(4)}`);
const fmtInt = (v) => (num(v) === null ? "-" : String(Math.round(v)));
const fmtNum = (v, digits = 4) => (num(v) === null ? "-" : v.toFixed(digits));
const fmtPct = (v, digits = 1) => (num(v) === null ? "-" : `${(v * 100).toFixed(digits)}%`);
const pctArg = (v) => (num(v) === null ? "-" : `${v}%`);

function renderTable(headers, rows) {
  const widths = headers.map((label, col) =>
    Math.max(label.length, ...rows.map((row) => row[col].length)),
  );
  const pad = (text, width) => text + " ".repeat(width - text.length);
  const render = (cells) => cells.map((cell, col) => pad(cell, widths[col])).join("  ").trimEnd();
  return [render(headers), ...rows.map(render)];
}

function renderText(report, opts) {
  const { window: w, totals, console: c, calibration, pool, forecast, crossCheck } = report;
  const lines = [
    `# db ${report.db} | storage ${report.storage}`,
    `# window ${w.days}d ${w.from} -> ${w.to} | cost ${fmtUsd(totals.costUsd)}` +
      ` | recomputed ${fmtUsd(totals.recomputedCostUsd)} | requests ${totals.requests}` +
      ` | failed ${totals.failedRequests} | sessions ${totals.sessions}`,
    `# console ${c.range} cost ${fmtUsd(c.costUsd)} | requests ${fmtInt(c.requests)}` +
      ` | month ${fmtUsd(c.monthCostUsd)} | pct month/week/5h ${pctArg(c.monthPct)}` +
      ` / ${pctArg(c.weekPct)} / ${pctArg(c.fiveHourPct)}`,
    `# prices ${report.prices.path} | verified ${report.prices.verifiedAt ?? "-"}` +
      ` | ${report.prices.ageDays === null ? "age -" : `${report.prices.ageDays.toFixed(1)}d old`}` +
      (report.prices.stale ? ` | WARNING expired (${report.prices.reason})` : ""),
    "",
  ];
  const agentRows = Object.entries(report.byAgent)
    .slice(0, opts.top)
    .map(([agent, a]) => [
      agent,
      String(a.sessions),
      String(a.requests),
      fmtUsd(a.costUsd),
      fmtUsd(a.medianUsd),
      fmtUsd(a.p90Usd),
      fmtPct(a.share),
    ]);
  lines.push(
    ...renderTable(["agent", "sessions", "requests", "cost$", "median$", "p90$", "share"], agentRows),
  );
  const modelRows = Object.entries(report.byModel)
    .slice(0, opts.top)
    .map(([id, m]) => [
      id,
      String(m.requests),
      fmtUsd(m.costUsd),
      fmtUsd(m.costPerRequestUsd),
      fmtUsd(m.recomputedCostUsd),
      fmtUsd(m.recomputedCostPerRequestUsd),
    ]);
  lines.push("");
  lines.push(
    ...renderTable(
      ["model", "requests", "cost$", "$/request", "recomputed$", "recomp $/req"],
      modelRows,
    ),
  );
  lines.push("");
  lines.push(
    `calibration  db/console ${fmtNum(calibration.current)} | previous ${fmtNum(calibration.previous)}` +
      ` | ratio ${fmtNum(calibration.ratio, 3)} | warn ${calibration.warn ? "yes" : "no"}` +
      (calibration.underCoverage ? " | underCoverage yes" : ""),
  );
  if (calibration.underCoverage && calibration.note) lines.push(`# note  ${calibration.note}`);
  lines.push(
    `pool         level ${pool.level} | monthly ${fmtUsd(pool.monthlyUsd)}` +
      ` | weekly ${fmtUsd(pool.week ?? pool.weeklyUsd)} | 5h ${fmtUsd(pool.fiveHour ?? pool.fiveHourUsd)}` +
      ` | ${pool.method}${pool.provisional ? " | provisional" : ""}`,
  );
  lines.push(
    `forecast     cycle sessions ${fmtInt(forecast.sessionsThisCycle)}` +
      ` | elapsed ${fmtNum(forecast.elapsedDays, 1)}d of ${fmtInt(forecast.cycleDays)}d` +
      ` | $/session ${fmtUsd(forecast.perSessionUsd)}` +
      ` | projected ${fmtNum(forecast.projectedSessions, 0)} sessions ${fmtUsd(forecast.projectedUsd)}` +
      ` | share ${fmtPct(forecast.shareOfPool)}`,
  );
  if (crossCheck) {
    lines.push(
      `crossCheck   5h ${fmtUsd(crossCheck.fiveHour?.impliedMonthlyUsd)}` +
        ` x${fmtNum(crossCheck.fiveHour?.ratioToMonth, 3)}` +
        ` | week ${fmtUsd(crossCheck.week?.impliedMonthlyUsd)}` +
        ` x${fmtNum(crossCheck.week?.ratioToMonth, 3)}` +
        ` | within 20% ${crossCheck.consistent ? "yes" : "no"}`,
    );
  }
  lines.push(
    `snapshot     ${report.snapshotPath} | written ${report.written ? "yes" : "no"}` +
      ` | plan written ${report.planWritten ? "yes" : "no"}`,
  );
  return lines.join("\n");
}

// --- main -------------------------------------------------------------------

export async function usageReport(argv = []) {
  const opts = parseArgs(argv);
  const DatabaseSync = await loadSqlite();
  const priceTable = loadPriceTable(opts.prices);
  if (priceTable.error) fail(`cannot read ${opts.prices}: ${priceTable.error}`);
  const snapshot = loadSnapshot(opts.snapshot);
  const previousBias = num(snapshot?.calibration?.biasDbVsConsole);

  const now = new Date();
  const nowMs = now.getTime();
  const windowFromMs = nowMs - opts.days * DAY_MS;
  const cycleStartMs = opts.cycleStart.getTime();
  const queryFromMs = Math.min(windowFromMs, cycleStartMs);

  let db;
  try {
    db = new DatabaseSync(opts.db, { readOnly: true });
  } catch (err) {
    fail(`cannot open ${opts.db}: ${err && err.message ? err.message : err}`);
  }
  let rows;
  let sessionAgents;
  let storage;
  try {
    ({ rows, sessionAgents, storage } = readMessages(db, queryFromMs));
  } finally {
    try {
      db.close();
    } catch {
      // best effort: readOnly handle, the OS reclaims it on exit anyway
    }
  }

  const acc = accumulate(
    rows, sessionAgents, opts, nowMs, windowFromMs, cycleStartMs, priceTable,
  );
  const { totals, byModel, byAgent, sessionDist, cycleSessions, dbMonthCostUsd } = acc;
  const byModelOut = buildByModel(byModel);
  const byAgentOut = buildByAgent(byAgent, totals.costUsd);

  const calibration = buildCalibration(opts, totals, previousBias);
  const currentBias = calibration.current;
  // Level 1 needs the Console dollar figure; otherwise the CURRENT bias when
  // known (never one suppressed by the underCoverage guard), else the previous
  // dated one — never an invented value.
  const pool = solvePool({
    consoleMonthCostUsd: opts.consoleMonthCost,
    dbMonthCostUsd,
    monthPct: opts.monthPct === null ? null : opts.monthPct / 100,
    bias: currentBias ?? previousBias,
    at: now,
  });
  const forecastInputs = {
    sessionsThisCycle: cycleSessions.size,
    elapsedDays: (nowMs - cycleStartMs) / DAY_MS,
    cycleDays: daysInUtcMonth(opts.cycleStart),
    medianUsd: median(sessionDist),
    p90Usd: p90(sessionDist),
    poolMonthlyUsd: pool.monthlyUsd,
  };
  const forecast = { ...forecastInputs, ...forecastMonthEnd(forecastInputs) };
  const crossCheck = buildCrossCheck(opts, pool, now);

  let written = false;
  let planWritten = false;
  if (opts.write) {
    // A missing snapshot is fine: this run creates it (seeded like
    // go.mjs run); an unreadable one already failed in loadSnapshot.
    const snap = snapshot ?? {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      sources: {},
      models: {},
    };
    const writes = applySnapshotWrites(snap, opts, {
      pool,
      byModel: byModelOut,
      byAgent: byAgentOut,
      currentBias,
      previousBias,
      nowIso: now.toISOString(),
      dateStamp: now.toISOString().slice(0, 10),
    });
    const touched = writes.touched;
    planWritten = writes.planWritten;
    if (touched) {
      // This run added at least one v3 key, so it is a v3 writer: raise
      // schemaVersion to 3 when it is missing or lower — never lower an
      // existing value (a future 4 stays 4; an already-3 file is unchanged).
      const existing = num(snap.schemaVersion);
      if (existing === null || existing < SNAPSHOT_SCHEMA_VERSION) {
        snap.schemaVersion = SNAPSHOT_SCHEMA_VERSION;
      }
      try {
        writeJsonFileAtomic(opts.snapshot, snap);
        written = true;
      } catch (err) {
        fail(`cannot write snapshot ${opts.snapshot}: ${err && err.message ? err.message : err}`);
      }
    }
  }

  const report = {
    ok: true,
    at: now.toISOString(),
    db: opts.db,
    storage,
    window: {
      days: opts.days,
      from: new Date(windowFromMs).toISOString(),
      to: now.toISOString(),
    },
    console: {
      range: opts.consoleRange,
      costUsd: opts.consoleCost,
      requests: opts.consoleRequests,
      monthCostUsd: opts.consoleMonthCost,
      monthPct: opts.monthPct,
      weekPct: opts.weekPct,
      fiveHourPct: opts.fiveHourPct,
    },
    prices: { path: opts.prices, ...seedFreshness(priceTable, { now }) },
    totals,
    byModel: byModelOut,
    byAgent: byAgentOut,
    calibration,
    pool,
    forecast,
    crossCheck,
    written,
    planWritten,
    snapshotPath: opts.snapshot,
  };
  return { report, opts };
}

// The only place a failure becomes output: one compact JSON line, never a stack
// trace. Exit code comes from the FailError (1 by default, 2 for usage).
export async function usageCli(argv = [], io = {}) {
  const streams = makeIo(io);
  try {
    const { report, opts } = await usageReport(argv);
    if (opts.text) streams.stdout.write(renderText(report, opts) + "\n");
    else streams.stdout.write(JSON.stringify(report) + "\n");
    return 0;
  } catch (err) {
    if (err instanceof HelpRequested) {
      streams.stdout.write(err.text);
      return 0;
    }
    if (err instanceof UsageError) {
      streams.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof FailError) {
      streams.stdout.write(JSON.stringify({ ok: false, ...err.extra, error: err.message }) + "\n");
      return err.code;
    }
    streams.stdout.write(
      JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }) + "\n",
    );
    return 1;
  }
}
