#!/usr/bin/env node
// opencode-go-model-picker — priced accounting: tokens + model price constants -> $, window %, capacity.
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
// The ONE pricing implementation. references/quota-math.md documents the same
// formula; no other file may restate a constant. Price, cap, context tiers and
// peak hours live in references/model-prices.json only.
//
// Formula (v2, per assistant message):
//
//   cost = (T_in*p_in + T_out*p_out + T_cr*p_cr + T_cw*p_cw) / 1e6 * k_peak
//
//   - p_* comes from the context tier the REQUEST's prompt length falls into
//     (prompt length = input + cacheRead + cacheWrite, i.e. everything that was
//     sent; output is never part of the tier decision).
//   - k_peak applies only to models that declare `peak` (DeepSeek today); for
//     every other model it is 1. It is decided per message, from that message's
//     own timestamp — never from the session start.
//   - a field the seed does not carry is NOT guessed: cacheWrite stays 0 and is
//     reported as `assumed`, peak stays 1 and is reported as `unverified`.
//
// Window fractions are fixed by the plan page and are never summed:
// 5h = 20% of the monthly pool, week = 50%, month = 100%. `sessionsPerWindow`
// returns the three independently; there is deliberately no "combined windows"
// helper (references/quota-math.md §Gaps, gap 4).
//
// Usage:
//   import { costOfUsage, planWindows, ... } from "./quota-math.mjs"
//   node scripts/quota-math.mjs --model deepseek-v4.1-flash \
//     --input 410 --cache-read 71300 --output 310 [--at <ISO>] [--count 10] \
//     [--pool <usd>] [--prices <path>] [--json]
//   node scripts/quota-math.mjs --self-check        # verify the published examples
//
// CLI output: one compact JSON object on stdout. Exit 0 on success, 2 on bad usage.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "./lib/json-io.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PRICE_SEED = join(root, "references", "model-prices.json");

// Fixed by https://opencode.ai/docs/go/ §Usage limits — not tunable per run.
export const PLAN_WINDOW_FRACTION = Object.freeze({ fiveHour: 0.2, week: 0.5, month: 1 });

// Provisional plan pool until a Console reading replaces it (calibrate-usage.mjs).
export const DEFAULT_POOL_MONTHLY_USD = 60;

// A calibration constant (bias, pool) is only trusted once re-measured; a drift
// wider than this between two measurements is reported, never averaged.
export const DRIFT_WARN_RATIO = 0.1;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// --- price table -------------------------------------------------------------

export function loadPriceTable(path = DEFAULT_PRICE_SEED) {
  const loaded = readJsonFile(path);
  if (loaded.error) return { error: `cannot read ${path}: ${loaded.error}`, models: {} };
  if (loaded.missing) return { error: `price seed not found: ${path}`, models: {} };
  const models = loaded.value && typeof loaded.value.models === "object" ? loaded.value.models : null;
  if (!models) return { error: `${path} has no "models" object`, models: {} };
  return {
    path,
    models,
    generatedAt: loaded.value.generatedAt ?? null,
    source: loaded.value.source ?? null,
  };
}

// A seed is a dated fallback, so the run must be able to say how old it is. The
// timestamp is the newest verification any entry carries (price or plan), because
// that is the last time a human or a script confirmed the table against upstream.
// Staleness is a report, never a silent refusal: an old seed is still better than
// no numbers, as long as the report says "expired" and shows the date.
export const SEED_STALE_AFTER_DAYS = 7;

export function seedFreshness(table, { now = new Date(), maxAgeDays = SEED_STALE_AFTER_DAYS } = {}) {
  const when = now instanceof Date ? now : new Date(now);
  let newest = null;
  for (const entry of Object.values(table?.models ?? {})) {
    for (const field of ["planVerifiedAt", "priceVerifiedAt"]) {
      const value = entry?.[field];
      if (typeof value !== "string") continue;
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
    }
  }
  if (newest === null) {
    return { verifiedAt: null, ageDays: null, stale: true, maxAgeDays, reason: "no verification date in the seed" };
  }
  const ageDays = (when.getTime() - newest) / 86400000;
  return {
    verifiedAt: new Date(newest).toISOString(),
    ageDays,
    stale: ageDays > maxAgeDays,
    maxAgeDays,
    reason: ageDays > maxAgeDays ? `older than ${maxAgeDays} days` : null,
  };
}

// Accepts "opencode-go/<id>" or the bare id.
export function entryFor(table, id) {
  if (!table || !table.models) return null;
  const bare = typeof id === "string" && id.startsWith("opencode-go/") ? id.slice("opencode-go/".length) : id;
  return table.models[bare] ?? null;
}

// capUsd is the canonical cap. monthlyLimitUsd is the same plan-page number under
// its v2 name; both are written together, and a mismatch is a data defect worth
// reporting rather than silently preferring one.
export function capOf(entry) {
  const cap = num(entry?.capUsd);
  const legacy = num(entry?.monthlyLimitUsd);
  return { capUsd: cap ?? legacy, mismatch: cap !== null && legacy !== null && cap !== legacy };
}

// --- token structure ---------------------------------------------------------

// Everything the request sent. A context tier is chosen by prompt length, so it
// includes cached and cache-write tokens, not just the uncached input. Reasoning
// tokens are never prompt: they are generated output.
export function promptTokens(usage = {}) {
  return (num(usage.input) ?? 0) + (num(usage.cacheRead) ?? 0) + (num(usage.cacheWrite) ?? 0);
}

// Billed output = visible output + reasoning. OpenCode reports them as separate
// counters and the provider charges both at the output rate (verified against the
// per-message cost the provider returned: the reasoning term closes the gap
// exactly on every sampled message, so double counting is not a concern).
export function billedOutputTokens(usage = {}) {
  return (num(usage.output) ?? 0) + (num(usage.reasoning) ?? 0);
}

export function selectTier(entry, promptLength) {
  const tiers = Array.isArray(entry?.ctxTiers) ? entry.ctxTiers.filter((t) => num(t?.overK) !== null) : [];
  const base = {
    input: num(entry?.inputPer1M),
    output: num(entry?.outputPer1M),
    cacheRead: num(entry?.cacheReadPer1M),
    cacheWrite: num(entry?.cacheWritePer1M),
  };
  if (!tiers.length) return { ...base, overK: null };
  const sorted = [...tiers].sort((a, b) => a.overK - b.overK);
  let chosen = null;
  for (const tier of sorted) {
    if (promptLength > tier.overK) chosen = tier;
  }
  if (!chosen) return { ...base, overK: null };
  return {
    input: num(chosen.input) ?? base.input,
    output: num(chosen.output) ?? base.output,
    cacheRead: num(chosen.cacheRead) ?? base.cacheRead,
    cacheWrite: num(chosen.cacheWrite) ?? base.cacheWrite,
    overK: chosen.overK,
  };
}

// --- peak / off-peak ---------------------------------------------------------

// utcHours is a list of [startHour, endHour) ranges in UTC; weekdaysOnly means
// Monday–Friday. A model without `peak` is priced flat (k = 1) and says so.
export function peakState(entry, at = new Date()) {
  const peak = entry?.peak;
  const when = at instanceof Date ? at : new Date(at);
  if (!peak || num(peak.multiplier) === null || !Array.isArray(peak.utcHours)) {
    return { multiplier: 1, peak: false, verified: false };
  }
  const day = when.getUTCDay(); // 0 = Sunday
  const weekday = day >= 1 && day <= 5;
  const hour = when.getUTCHours();
  const inRange = peak.utcHours.some(
    ([start, end]) => num(start) !== null && num(end) !== null && hour >= start && hour < end,
  );
  const active = inRange && (peak.weekdaysOnly === false || weekday);
  return { multiplier: active ? peak.multiplier : 1, peak: active, verified: true };
}

// --- per-request and per-session cost ---------------------------------------

export function costOfUsage(entry, usage = {}, at = new Date()) {
  if (!entry) return { usd: null, priced: false, missing: ["model absent from the price seed"] };
  const prompt = promptTokens(usage);
  const tier = selectTier(entry, prompt);
  const peak = peakState(entry, at);
  const missing = [];
  if (tier.input === null || tier.output === null) missing.push("input/output price");
  if (tier.cacheRead === null && (num(usage.cacheRead) ?? 0) > 0) missing.push("cacheReadPer1M");
  const cacheWrite = tier.cacheWrite ?? 0;
  if (tier.cacheWrite === null && (num(usage.cacheWrite) ?? 0) > 0) missing.push("cacheWritePer1M (assumed 0)");
  if (!peak.verified) missing.push("peak hours (assumed 1x)");
  if (missing.some((m) => m === "input/output price")) {
    return { usd: null, priced: false, missing };
  }
  const input = num(usage.input) ?? 0;
  const output = billedOutputTokens(usage);
  const cacheRead = num(usage.cacheRead) ?? 0;
  const cacheWriteTokens = num(usage.cacheWrite) ?? 0;
  const base =
    (input * tier.input + output * tier.output + cacheRead * (tier.cacheRead ?? 0) + cacheWriteTokens * cacheWrite) /
    1e6;
  return {
    usd: base * peak.multiplier,
    priced: true,
    tierOverK: tier.overK,
    promptTokens: prompt,
    outputTokens: output,
    multiplier: peak.multiplier,
    peak: peak.peak,
    missing,
  };
}

// One "session" in the plan's tables = one billing session, priced per message so
// the peak multiplier follows each message's own timestamp.
export function costOfSession(entry, messages = []) {
  const parts = messages.map((m) => costOfUsage(entry, m.usage ?? m, m.at ?? m.time?.created ?? new Date()));
  const priced = parts.filter((p) => p.priced);
  if (!priced.length) return { usd: null, priced: false, messages: parts.length };
  return {
    usd: priced.reduce((sum, p) => sum + p.usd, 0),
    priced: true,
    messages: parts.length,
    unpriced: parts.length - priced.length,
  };
}

// --- distribution ------------------------------------------------------------

export function quantile(values, q) {
  const nums = (Array.isArray(values) ? values : []).filter((v) => num(v) !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const pos = (nums.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return nums[lower];
  return nums[lower] + (nums[upper] - nums[lower]) * (pos - lower);
}

export const median = (values) => quantile(values, 0.5);
export const p90 = (values) => quantile(values, 0.9);

// 0.7 / 0.3 as in the plan: the median is the typical session, P90 the long tail.
export function blendedSessionUsd({ medianUsd, p90Usd }) {
  if (num(medianUsd) === null && num(p90Usd) === null) return null;
  if (num(p90Usd) === null) return medianUsd;
  if (num(medianUsd) === null) return p90Usd;
  return 0.7 * medianUsd + 0.3 * p90Usd;
}

// --- windows -----------------------------------------------------------------

export function planWindows(monthlyUsd) {
  const m = num(monthlyUsd);
  if (m === null) return { fiveHour: null, week: null, month: null };
  return {
    fiveHour: m * PLAN_WINDOW_FRACTION.fiveHour,
    week: m * PLAN_WINDOW_FRACTION.week,
    month: m * PLAN_WINDOW_FRACTION.month,
  };
}

export function shareOfCap(usd, capUsd) {
  const u = num(usd);
  const c = num(capUsd);
  if (u === null || c === null || c <= 0) return null;
  return u / c;
}

// Independent per window: R_week = R_month / 2 and R_5h = R_month / 5 follow from
// P_week = 0.5*P_month and P_5h = 0.2*P_month. Never add these up.
export function sessionsPerWindow(poolMonthlyUsd, sessionUsd) {
  const s = num(sessionUsd);
  const windows = planWindows(poolMonthlyUsd);
  if (s === null || s <= 0) return { month: null, week: null, fiveHour: null };
  return {
    month: windows.month / s,
    week: windows.week / s,
    fiveHour: windows.fiveHour / s,
  };
}

// --- capacity ----------------------------------------------------------------

// Official capacity comes from the published estimate: the plan page lists est
// requests per month from its own token assumptions, so
//   c_req_official = cap / estReqMonth    and    N_official = cap / c_req = estReqMonth.
export function officialCapacity(entry) {
  const { capUsd } = capOf(entry);
  const est = num(entry?.estReqMonth);
  if (capUsd === null || est === null || est <= 0) return { capUsd, requests: null, costPerRequestUsd: null };
  return { capUsd, requests: est, costPerRequestUsd: capUsd / est };
}

// Observed capacity comes from the Console's own bill: $ and request count over
// the same window. Both must appear next to the official number.
export function observedCapacity(billing) {
  const cost = num(billing?.costUsd);
  const requests = num(billing?.requests);
  if (cost === null || requests === null || requests <= 0) {
    return { requests: null, costPerRequestUsd: null, capacityUsd: null };
  }
  const costPerRequestUsd = cost / requests;
  return {
    requests,
    costPerRequestUsd,
    capacityUsd: num(billing?.capUsd) === null ? null : num(billing.capUsd) / costPerRequestUsd,
  };
}

// --- calibration -------------------------------------------------------------

export function biasOf(dbCostUsd, consoleCostUsd) {
  const db = num(dbCostUsd);
  const con = num(consoleCostUsd);
  if (db === null || con === null || con <= 0) return null;
  return db / con;
}

// Ratio of the new bias to the previous one; |ratio - 1| > DRIFT_WARN_RATIO warns.
export function biasDrift(previous, next) {
  const p = num(previous);
  const n = num(next);
  if (p === null || n === null || p <= 0) return { ratio: null, warn: false };
  const ratio = n / p;
  return { ratio, warn: Math.abs(ratio - 1) > DRIFT_WARN_RATIO };
}

// Pool reverse-solve, in the order references/quota-math.md §Reverse-solving fixes
// it (the order breaks the circular dependency, it is not a preference):
//   1. a Console dollar figure for the cycle + a Console monthly %  -> exact;
//   2. else a known bias converts local DB cost into billed cost  -> provisional;
//   3. else no pool at all (caller falls back to relative ranking only).
export function solvePool({
  consoleMonthCostUsd = null,
  dbMonthCostUsd = null,
  monthPct = null,
  bias = null,
  at = new Date(),
} = {}) {
  const pct = num(monthPct);
  const when = at instanceof Date ? at : new Date(at);
  if (pct === null || pct <= 0) {
    return { level: 3, monthlyUsd: null, weeklyUsd: null, fiveHourUsd: null, provisional: true, method: "no-month-percent" };
  }
  const direct = num(consoleMonthCostUsd);
  const windows = (monthlyUsd) => {
    const w = planWindows(monthlyUsd);
    return { monthlyUsd, weeklyUsd: w.week, fiveHourUsd: w.fiveHour };
  };
  if (direct !== null) {
    return {
      level: 1,
      ...windows(direct / pct),
      provisional: true,
      method: "console-dollar-percent",
      at: when.toISOString(),
    };
  }
  const local = num(dbMonthCostUsd);
  const b = num(bias);
  if (local !== null && b !== null && b > 0) {
    return {
      level: 2,
      ...windows(local / b / pct),
      provisional: true,
      method: "local-cost-through-bias",
      at: when.toISOString(),
    };
  }
  return { level: 3, monthlyUsd: null, weeklyUsd: null, fiveHourUsd: null, provisional: true, method: "bias-unknown" };
}

// Linear extrapolation over the billing cycle's own elapsed days (never a rolling
// 30-day window, which is a different denominator).
export function forecastMonthEnd({
  sessionsThisCycle = null,
  elapsedDays = null,
  cycleDays = null,
  medianUsd = null,
  p90Usd = null,
  poolMonthlyUsd = null,
} = {}) {
  const sessions = num(sessionsThisCycle);
  const elapsed = num(elapsedDays);
  const span = num(cycleDays) ?? 30;
  const perSession = blendedSessionUsd({ medianUsd, p90Usd });
  if (sessions === null || elapsed === null || elapsed <= 0 || perSession === null) {
    return { projectedSessions: null, projectedUsd: null, shareOfPool: null, perSessionUsd: perSession };
  }
  const projectedSessions = (sessions / elapsed) * span;
  const projectedUsd = projectedSessions * perSession;
  return {
    projectedSessions,
    projectedUsd,
    shareOfPool: shareOfCap(projectedUsd, poolMonthlyUsd),
    perSessionUsd: perSession,
  };
}

// --- CLI ---------------------------------------------------------------------

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function badUsage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// Published examples used only as an arithmetic self-check (the numbers come from
// the plan page's own token assumptions, not from a model being recommended).
function selfCheck() {
  const table = loadPriceTable();
  if (table.error) return { ok: false, error: table.error };
  const deepseek = entryFor(table, "deepseek-v4.1-flash");
  const offPeak = costOfUsage(deepseek, { input: 410, cacheRead: 71300, output: 310 }, "2026-10-30T20:00:00Z");
  const peak = costOfUsage(deepseek, { input: 410, cacheRead: 71300, output: 310 }, "2026-10-30T07:00:00Z");
  const handOffPeak = (410 * 0.15 + 310 * 0.6 + 71300 * 0.003) / 1e6;
  // Reasoning is billed at the output rate (field verification, see quota-math.md).
  const withReasoning = costOfUsage(
    deepseek,
    { input: 313, cacheRead: 310016, output: 73, reasoning: 872 },
    "2026-10-30T20:00:00Z",
  );
  const handWithReasoning = (313 * 0.15 + (73 + 872) * 0.6 + 310016 * 0.003) / 1e6;
  // Qwen3.7 Plus 256K tier at a 300K prompt: 1.20 / 4.80 / 0.12.
  const qwen = entryFor(table, "qwen3.7-plus");
  const tiered = costOfUsage(qwen, { input: 200000, cacheRead: 100000, output: 1000 }, "2026-10-30T20:00:00Z");
  const expectedTiered = (200000 * 1.2 + 1000 * 4.8 + 100000 * 0.12) / 1e6;
  const within = (actual, expected) => actual !== null && Math.abs(actual - expected) / expected < 0.01;
  return {
    ok:
      within(offPeak.usd, handOffPeak) &&
      within(peak.usd, handOffPeak * 2) &&
      within(withReasoning.usd, handWithReasoning) &&
      within(tiered.usd, expectedTiered),
    offPeakUsd: offPeak.usd,
    handOffPeakUsd: handOffPeak,
    peakUsd: peak.usd,
    reasoningUsd: withReasoning.usd,
    handReasoningUsd: handWithReasoning,
    tierOverK: tiered.tierOverK,
    tieredUsd: tiered.usd,
    handTieredUsd: expectedTiered,
  };
}

function cli() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node scripts/quota-math.mjs --model <id> --input <n> [--cache-read <n>] [--cache-write <n>]",
        "                                  [--output <n>] [--reasoning <n>] [--at <ISO>] [--count <n>] [--pool <usd>]",
        "                                  [--prices <path>] [--json]",
        "       node scripts/quota-math.mjs --self-check",
        "Priced accounting (the only implementation of the formula). Exit 0, or 2 on bad usage.",
      ].join("\n") + "\n",
    );
    return;
  }
  if (argv.includes("--self-check")) {
    process.stdout.write(JSON.stringify(selfCheck()) + "\n");
    return;
  }
  const model = argValue(argv, "--model");
  if (!model) badUsage("missing --model <id>");
  const pricesPath = argValue(argv, "--prices");
  const table = loadPriceTable(pricesPath ?? DEFAULT_PRICE_SEED);
  if (table.error) {
    process.stdout.write(JSON.stringify({ error: table.error }) + "\n");
    process.exit(1);
  }
  const entry = entryFor(table, model);
  if (!entry) {
    process.stdout.write(JSON.stringify({ error: `model ${model} is not in ${pricesPath ?? DEFAULT_PRICE_SEED}` }) + "\n");
    process.exit(1);
  }
  const int = (name) => {
    const raw = argValue(argv, name);
    if (raw === undefined) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) badUsage(`${name} must be a non-negative number`);
    return n;
  };
  const usage = {
    input: int("--input"),
    output: int("--output"),
    reasoning: int("--reasoning"),
    cacheRead: int("--cache-read"),
    cacheWrite: int("--cache-write"),
  };
  const at = argValue(argv, "--at") ?? new Date().toISOString();
  const countRaw = argValue(argv, "--count");
  const count = countRaw === undefined ? 1 : Number(countRaw);
  if (!Number.isFinite(count) || count <= 0) badUsage("--count must be a positive number");
  const poolRaw = argValue(argv, "--pool");
  const pool = poolRaw === undefined ? DEFAULT_POOL_MONTHLY_USD : Number(poolRaw);
  if (!Number.isFinite(pool) || pool <= 0) badUsage("--pool must be a positive number");

  const single = costOfUsage(entry, usage, at);
  const { capUsd, mismatch } = capOf(entry);
  const total = single.usd === null ? null : single.usd * count;
  const seed = seedFreshness(table, { now: at });
  const result = {
    model: entry.id ?? model,
    at,
    count,
    usage,
    seed: { path: table.path, ...seed },
    costUsdPerRequest: single.usd,
    costUsd: total,
    tierOverK: single.tierOverK ?? null,
    peakMultiplier: single.multiplier,
    capUsd,
    capMismatch: mismatch,
    shareOfCap: shareOfCap(total, capUsd),
    pool: { monthlyUsd: pool, ...planWindows(pool) },
    shareOfPool: {
      fiveHour: shareOfCap(total, planWindows(pool).fiveHour),
      week: shareOfCap(total, planWindows(pool).week),
      month: shareOfCap(total, planWindows(pool).month),
    },
    sessionsPerWindow: sessionsPerWindow(pool, total),
    officialCapacity: officialCapacity(entry),
    assumed: single.missing,
  };
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const pct = (v) => (v === null ? "-" : `${(v * 100).toFixed(2)}%`);
  process.stdout.write(
    [
      `model ${model} @ ${at} x${count}`,
      `cost $${total === null ? "-" : total.toFixed(6)}/request ${single.usd === null ? "-" : `$${single.usd.toFixed(6)}`}` +
        ` | tier ${single.tierOverK ? `>${single.tierOverK}` : "base"} | k_peak ${single.multiplier}`,
      `cap ${capUsd === null ? "-" : `$${capUsd}`} -> ${pct(result.shareOfCap)} of the model cap`,
      `pool $${pool} -> 5h ${pct(result.shareOfPool.fiveHour)} / week ${pct(result.shareOfPool.week)} / month ${pct(result.shareOfPool.month)}`,
      `sessions in pool: 5h ${result.sessionsPerWindow.fiveHour?.toFixed(1) ?? "-"} / week ${result.sessionsPerWindow.week?.toFixed(1) ?? "-"} / month ${result.sessionsPerWindow.month?.toFixed(1) ?? "-"}`,
      `official capacity ${result.officialCapacity.requests ?? "-"} requests` +
        ` ($${result.officialCapacity.costPerRequestUsd?.toFixed(6) ?? "-"}/request)`,
      `seed ${seed.verifiedAt ?? "-"}` +
        (seed.stale ? ` ⚠ EXPIRED (${seed.reason}) — label the number a date and re-fetch` : ` (${seed.ageDays?.toFixed(1)} days old)`),
      result.assumed.length ? `assumed/unverified: ${result.assumed.join(", ")}` : "all fields verified",
    ].join("\n") + "\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cli();
