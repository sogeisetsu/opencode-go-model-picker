// opencode-go-model-picker — report rendering and the machine-checkable gate.
// Copyright (C) 2026 sogeisetsu
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version.
//
// Rendering lives here instead of in prose: the money columns, the Basis line
// and the config blocks are produced from the run's own numbers, so a report
// cannot quietly use a second denominator.

import { readFileSync } from "node:fs";
import { FailError, UsageError } from "./io.mjs";
import { stripBom } from "./json-io.mjs";
import { costOfUsage, entryFor, loadPriceTable, DEFAULT_PRICE_SEED, planWindows, shareOfCap } from "./pricing.mjs";
import { chainRange, validateChain } from "./agents.mjs";
import { readSnapshot } from "./snapshot.mjs";

const usd = (v, digits = 4) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(digits)}` : "-");
const pct = (v, digits = 1) => (typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "-");
const int = (v) => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "-");
const firstDefined = (...values) => {
  for (const value of values) if (value !== undefined && value !== null) return value;
  return null;
};

export function readJsonArg(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new FailError(`cannot read ${label} ${path}: ${err && err.message ? err.message : err}`);
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new FailError(`malformed ${label} ${path}: ${err && err.message ? err.message : err}`);
  }
}

// The pick file is the model's judgement; this validates its shape so a typo
// cannot reach the table as if it were a decision — and, more importantly, that
// every Go id actually exists in this run's catalog. A chain of one is legal
// where the source cannot express a chain; a chain of two is not legal where it
// can only hold one id.
export function validatePicks(picks, run) {
  if (!picks || typeof picks !== "object" || Array.isArray(picks)) {
    throw new UsageError("picks must be an object: { picks: { <agent>: { chain: [...] } } }");
  }
  const byName = new Map((run.agents ?? []).map((a) => [a.name, a]));
  // A run from before the menu existed carries no candidateIds: `null` means
  // "cannot check", so it is tolerated. An empty list is a real answer — nothing
  // could be priced — and every Go id is refused.
  const menu = Array.isArray(run.data?.candidateIds) ? new Set(run.data.candidateIds) : null;
  const out = {};
  for (const [name, pick] of Object.entries(picks.picks ?? picks)) {
    if (name === "mode") continue;
    const agent = byName.get(name);
    if (!agent) throw new UsageError(`picks names an unknown agent: ${name}`);
    const chain = Array.isArray(pick) ? pick : pick && pick.chain;
    if (!chain) throw new UsageError(`pick for ${name} has no chain`);
    const ids = chain.map((e) => (typeof e === "string" ? e : e && e.id)).filter(Boolean);
    const shape = validateChain(ids, chainRange(agent));
    if (!shape.ok) throw new UsageError(`${name}: ${shape.problems.join("; ")}`);
    const unknown = menu === null ? [] : ids.filter((id) => id.startsWith("opencode-go/") && !menu.has(id));
    if (unknown.length) {
      throw new UsageError(
        `${name}: not in this run's Go catalog: ${unknown.join(", ")} — pick ids from run.data.candidates`,
      );
    }
    out[name] = { chain: ids, why: (pick && pick.why) || null };
  }
  for (const agent of run.agents ?? []) {
    if (!out[agent.name]) throw new UsageError(`picks is missing agent ${agent.name}`);
  }
  return out;
}

const isFrontmatter = (agent) => String(agent?.provenance?.pointer ?? "") === "#frontmatter";

export function renderReport(run, picks, { prices = DEFAULT_PRICE_SEED } = {}) {
  const checked = validatePicks(picks, run);
  const table = loadPriceTable(prices);
  if (table.error) throw new FailError(table.error);
  const lines = [];

  // 1. Basis line — the one denominator every amount below uses.
  lines.push(run.basis?.line ?? "Basis: Uncalibrated (no bill and no local usage) | -");
  lines.push("");

  // 2. Recommendation table — columns fixed by references/plan-facts.md.
  lines.push(
    "| agent | recommended chain | headroom ($ cap / official req / observed req) | accounted $/session (median · P90) | share of model cap % | 10 runs as % of 5h · week · month | actual monthly occupancy % | why |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  const bias = run.basis?.kind === "console" ? run.usage?.calibration?.current ?? null : null;
  const convert = (localUsd) =>
    typeof localUsd === "number" && typeof bias === "number" && bias > 0 ? localUsd / bias : localUsd;
  const pool = run.usage?.pool?.monthlyUsd ?? null;
  const windows = pool ? planWindows(pool) : null;
  for (const agent of run.agents ?? []) {
    const pick = checked[agent.name];
    const head = entryFor(table, pick.chain[0]);
    const bare = pick.chain[0].startsWith("opencode-go/")
      ? pick.chain[0].slice("opencode-go/".length)
      : pick.chain[0];
    const capUsd = head ? firstDefined(head.capUsd, head.monthlyLimitUsd) : null;
    const observed = run.usage?.byModel?.[bare]?.requests;
    const profile = run.usage?.byAgent?.[agent.name]?.tokensPerSession ?? null;
    let sessionUsd = null;
    if (head && profile) {
      const priced = costOfUsage(head, profile, run.generatedAt ?? new Date().toISOString());
      sessionUsd = priced.usd === null ? null : convert(priced.usd);
    }
    const agentCost = convert(run.usage?.byAgent?.[agent.name]?.costUsd ?? null);
    const capShare = capUsd ? shareOfCap(agentCost, capUsd) : null;
    const tenRuns = windows && sessionUsd !== null
      ? ["fiveHour", "week", "month"]
          .map((k) => pct(shareOfCap(sessionUsd * 10, windows[k])))
          .join(" · ")
      : "-";
    const occupancy = run.usage?.forecast?.projectedMonthEndPct;
    lines.push(
      `| ${agent.name} | ${pick.chain.map((id, i) => `${i + 1}. ${id}`).join(" ")} | ` +
        `${capUsd === null ? "-" : `$${capUsd}`} / ${head?.estReq5h ?? "-"} / ${observed === undefined ? "-" : int(observed)} | ` +
        `${sessionUsd === null ? "-" : usd(sessionUsd)} | ` +
        `${pct(capShare)} | ${tenRuns} | ${pct(occupancy)} | ${pick.why ?? "-"} |`,
    );
  }
  lines.push("");

  // 3. Usage evidence.
  lines.push("### Usage evidence");
  if (run.usage?.ok) {
    const w = run.usage.window ?? {};
    lines.push(
      `- Window: ${w.days ?? "-"}d (${String(w.from ?? "-").slice(0, 10)} → ${String(w.to ?? "-").slice(0, 10)}), ` +
        `requests ${int(run.usage.totals?.requests)}, local cost ${usd(run.usage.totals?.costUsd)}.`,
    );
    const agents = Object.entries(run.usage.byAgent ?? {}).slice(0, 8);
    for (const [name, row] of agents) {
      lines.push(`- ${name}: ${int(row.requests)} req, ${usd(row.costUsd)}, share ${pct(row.share)}.`);
    }
    const cal = run.usage.calibration ?? {};
    lines.push(
      `- Calibration: bias ${cal.current === null || cal.current === undefined ? "-" : cal.current.toFixed(3)}` +
        ` (previous ${cal.previous === null || cal.previous === undefined ? "-" : cal.previous.toFixed(3)}), ` +
        `drift warn ${cal.warn ? "yes" : "no"}.`,
    );
    const pool = run.usage.pool ?? {};
    lines.push(
      `- Plan pool: ${usd(pool.monthlyUsd)} monthly → 5h ${usd(pool.fiveHour)} / week ${usd(pool.week)} / month ${usd(pool.month)}.`,
    );
    const f = run.usage.forecast ?? {};
    lines.push(
      f.projectedMonthEndUsd === undefined || f.projectedMonthEndUsd === null
        ? "- Month-end occupancy: - (not enough of the cycle elapsed)."
        : `- Month-end occupancy: ${pct(f.projectedMonthEndPct)} of the pool (${usd(f.projectedMonthEndUsd)}).`,
    );
  } else {
    lines.push(`- Local DB unreadable: ${run.usage?.error ?? "-"}; no per-agent evidence this run.`);
    lines.push("- Month-end occupancy: - (no local usage this run).");
  }
  lines.push("");

  // 4. Paste-ready config.
  lines.push("### Paste-ready config");
  for (const agent of run.agents ?? []) {
    const chain = checked[agent.name].chain;
    const pointer = agent.provenance?.pointer ?? "";
    if (isFrontmatter(agent)) {
      // A Markdown agent carries `model:` in its YAML frontmatter, not a JSONC
      // object — a JSONC block there is the wrong artifact for the file.
      lines.push("```yaml");
      lines.push(`# ${agent.provenance?.file ?? "agent.md"} → frontmatter`);
      lines.push(`model: ${chain[0]}`);
      lines.push("```");
    } else if (pointer.startsWith("presets.")) {
      lines.push(`\`\`\`jsonc`);
      lines.push(`// ${agent.provenance.file} → ${pointer}`);
      lines.push(`"${agent.name}": { "model": ${JSON.stringify(chain, null, 2).replace(/\n/g, "\n  ")} }`);
      lines.push("```");
    } else {
      lines.push(`\`\`\`jsonc`);
      lines.push(`// ${agent.provenance?.file ?? "opencode.jsonc"} → agent.${agent.name}`);
      lines.push(`"${agent.name}": { "model": ${JSON.stringify(chain, null, 2).replace(/\n/g, "\n  ")} }`);
      lines.push("```");
    }
  }
  lines.push("");

  // 5. Highlights — the model writes these; the renderer states the facts it must cover.
  lines.push("### Highlights");
  lines.push(`- Mode: ${run.mode?.chosen ?? "-"} (${run.mode?.source ?? "-"}).`);
  const changes = run.plan ?? { added: [], removed: [], changed: [] };
  lines.push(
    `- Plan changes: +${changes.added?.length ?? 0} / -${changes.removed?.length ?? 0} / ~${changes.changed?.length ?? 0}` +
      ((changes.added?.length ?? 0) + (changes.removed?.length ?? 0) > 0
        ? ` (${[...(changes.added ?? []), ...(changes.removed ?? [])].join(", ")})`
        : ""),
  );
  const snap = run.data?.snapshotPath ? readSnapshot(run.data.snapshotPath).snapshot : null;
  const boardOf = (trait) =>
    trait === "coding" || trait === "cheap-high-volume" ? "coding" : trait === "vision" ? "vision" : "overall";
  const noElo = (run.agents ?? []).filter((a) => {
    const head = checked[a.name].chain[0];
    const bare = head.startsWith("opencode-go/") ? head.slice("opencode-go/".length) : head;
    const score = snap?.models?.[bare]?.score?.[boardOf(a.traits?.[0])];
    return score === undefined || score === null;
  });
  lines.push(
    `- Candidates without an ELO for their trait: ${noElo.length}/${(run.agents ?? []).length}` +
      (noElo.length ? ` (${noElo.map((a) => checked[a.name].chain[0]).join(", ")})` : ""),
  );
  lines.push(`- Dead chain ids this run: ${(run.deadChainIds ?? []).length === 0 ? "none" : run.deadChainIds.map((d) => d.id).join(", ")}.`);
  lines.push("");

  // 6. Caveats the data owes. A picked model carrying a promo, an end date or a
  // peak window must be named; the model may rewrite these lines in the user's
  // words, but it may not drop them. When nothing is owed, nothing is printed.
  const owed = caveatNotes(run, checked);
  if (owed.length) {
    lines.push("### Caveats");
    for (const note of owed) lines.push(`- ${note.bare}: ${note.reason}`);
    lines.push("");
  }

  // 7. Data appendix.
  lines.push("### Data appendix");
  lines.push(`- Data quality: ${run.data?.quality ?? "none"}; catalog ${run.data?.catalog?.fetchedAt ?? "-"} (${run.data?.catalog?.count ?? "-"} ids).`);
  lines.push(`- Prices: ${run.data?.prices?.path ?? "-"} verified ${run.data?.prices?.verifiedAt ?? "-"} (${run.data?.prices?.ageDays ?? "-"} days old${run.data?.prices?.stale ? ", EXPIRED" : ""}).`);
  lines.push(`- Rankings: ${run.data?.scores?.fetchedAt ?? "-"} (boards ${JSON.stringify(run.data?.scores?.publishDates ?? {})}).`);
  lines.push(`- Console MCP: ${run.console?.state ?? "unknown"}.`);
  lines.push("");
  lines.push("🛑 No configuration has been written. Confirm with the question tool, then apply to one named file.");
  return lines.join("\n") + "\n";
}

// --- the gate ----------------------------------------------------------------

const CHECKS = [
  {
    id: "basis",
    rule: "exactly one Basis: line",
    test: (text) => (text.match(/^Basis:/gm) ?? []).length === 1,
  },
  {
    id: "table",
    rule: "a recommendation table exists",
    test: (text) => /\|\s*agent\s*\|/i.test(text),
  },
  {
    id: "est-observed",
    rule: "every table row keeps all eight columns",
    test: (text) =>
      text
        .split("\n")
        .filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/\|\s*agent\s*\|/i.test(l))
        .every((l) => l.split("|").length >= 10),
  },
  {
    id: "elo",
    rule: "candidates without an ELO are counted",
    test: (text) => /ELO/i.test(text),
  },
  {
    id: "dead-chains",
    rule: "the dead chain ids of this run are named (or none)",
    test: (text, run) => {
      const dead = (run?.deadChainIds ?? []).map((d) => d.id);
      if (!run) return /Dead chain ids/i.test(text);
      return dead.length === 0
        ? /Dead chain ids this run:\s*none/i.test(text)
        : dead.every((id) => text.includes(id));
    },
  },
  {
    id: "occupancy",
    rule: "month-end occupancy is projected or explained",
    test: (text) => /Month-end occupancy/i.test(text),
  },
  {
    id: "console-state",
    rule: "the Console MCP state is this run's state",
    test: (text, run) => {
      const state = run?.console?.state;
      if (!state) return /Console MCP:\s*(authorized|gated|unauthenticated|absent|unknown)/i.test(text);
      return new RegExp(`Console MCP:\\s*${state}\\b`, "i").test(text);
    },
  },
  {
    id: "gate",
    rule: "the report stops before writing configuration",
    test: (text) => /No configuration has been written/i.test(text),
  },
  {
    id: "no-placeholders",
    rule: "no unreplaced template placeholders",
    test: (text) => !/<[a-z][a-z0-9-]*>/i.test(text.replace(/```[\s\S]*?```/g, "")),
  },
];

// A caveat is owed by the data, not by the age of the seed: every picked model
// that carries a promo, an end date or a peak window needs a line of its own.
// When nothing is owed, nothing is required — the old rule fired on a stale seed
// and could only be satisfied with filler.
//
// `checked` is the normalised pick map (validatePicks output), not the raw file:
// the raw file wraps everything in `{ picks: ... }`, so reading it here looked up
// `picks[agent.name]`, found nothing, and never fired.
const peakLabel = (peak) => {
  if (!peak || typeof peak !== "object") return "applies";
  const parts = [];
  if (peak.multiplier) parts.push(`${peak.multiplier}x`);
  const hours = (Array.isArray(peak.utcHours) ? peak.utcHours : [])
    .map((h) => (Array.isArray(h) ? `${h[0]}–${h[1]}` : String(h)))
    .filter((h) => h && h !== "undefined–undefined");
  if (hours.length) parts.push(`UTC ${hours.join(", ")}`);
  if (peak.weekdaysOnly) parts.push("weekdays only");
  return parts.length ? `(${parts.join(" · ")})` : "applies";
};

function caveatNotes(run, checked) {
  if (!checked || !run?.data?.candidates) return [];
  const byId = new Map(run.data.candidates.map((c) => [c.id, c]));
  const notes = [];
  const seen = new Set();
  for (const agent of run.agents ?? []) {
    for (const id of checked[agent.name]?.chain ?? []) {
      if (seen.has(id)) continue;
      const c = byId.get(id);
      if (!c || !(c.promo || c.promoUntil || c.peak)) continue;
      seen.add(id);
      const reasons = [];
      if (c.promo) {
        const until = c.promoUntil && !String(c.promo).includes(c.promoUntil) ? ` (until ${c.promoUntil})` : "";
        reasons.push(`limited-time promo — ${c.promo}${until}`);
      } else if (c.promoUntil) reasons.push(`limited-time promo until ${c.promoUntil}`);
      if (c.peak) reasons.push(`peak pricing ${peakLabel(c.peak)}`);
      notes.push({ bare: id.split("/").pop(), reason: reasons.join("; ") });
    }
  }
  return notes;
}

function uncoveredCaveats(text, notes) {
  if (!notes.length) return [];
  const lines = text.split("\n").filter((l) => /^[-*]\s/.test(l.trim()));
  return notes
    .filter((n) => !lines.some((l) => l.includes(n.bare) && /promo|limited|peak|region|train|contributor|until/i.test(l)))
    .map((n) => n.bare);
}

// Every line the renderer produced must still be there, unchanged and in order.
// Extra lines are the model's own (highlights, caveats); altered ones are not,
// because a number the renderer owns may not be edited after it was computed.
// Line endings and a BOM are normalised first: a Windows editor saving the same
// content as CRLF must not read as a different report.
// The caveat section is the model's prose: `uncoveredCaveats` already guarantees
// the fact survives, so it is cut out before the verbatim comparison instead of
// being pinned word for word.
const withoutCaveats = (text) => text.replace(/^### Caveats\n(?:- .*\n)+\n?/m, "");

function firstAlteredLine(expected, submitted) {
  const want = withoutCaveats(expected).split("\n").filter((l) => l.trim());
  const have = withoutCaveats(submitted).split("\n").filter((l) => l.trim());
  let i = 0;
  for (const line of want) {
    let found = false;
    while (i < have.length) {
      const candidate = have[i++];
      if (candidate === line) {
        found = true;
        break;
      }
    }
    if (!found) return line;
  }
  return null;
}

const normaliseReport = (text) => stripBom(String(text ?? "")).replace(/\r\n/g, "\n");

export function checkReport(text, run = null, picks = null) {
  const body = normaliseReport(text);
  const results = CHECKS.map((check) => {
    let ok = false;
    try {
      ok = Boolean(check.test(body, run, picks));
    } catch {
      ok = false;
    }
    return { id: check.id, rule: check.rule, ok };
  });
  if (run?.basis?.line) {
    const matches = body.match(/^Basis:\s*(.+)$/m);
    const expected = String(run.basis.line).replace(/^Basis:\s*/, "").trim();
    results.push({
      id: "basis-matches-run",
      rule: "the Basis line matches this run's denominator",
      ok: Boolean(matches && matches[1].trim() === expected),
    });
  }
  if (run?.needs?.noAgents) {
    results.push({
      id: "has-agents",
      rule: "there is at least one custom agent to tune (stop instead of delivering an empty report)",
      ok: false,
    });
  }

  // The gate is only a gate when it can re-derive what it is checking. A half
  // invocation (`--run` without `--picks`, or the reverse) used to pass silently.
  if (Boolean(run) !== Boolean(picks)) {
    results.push({
      id: "picks",
      rule: "check takes --run and --picks together (the numbers cannot be re-derived from one alone)",
      ok: false,
    });
  } else if (run && picks) {
    let checked = null;
    let failure = null;
    try {
      checked = validatePicks(picks, run);
    } catch (err) {
      failure = err.message ?? String(err);
    }
    if (failure) {
      results.push({ id: "picks", rule: "the picks file is valid for this run", ok: false, detail: failure });
    } else {
      results.push({ id: "picks", rule: "the picks file is valid for this run", ok: true });
      let expected = null;
      try {
        expected = renderReport(run, picks, { prices: run.data?.prices?.path ?? DEFAULT_PRICE_SEED });
      } catch (err) {
        failure = err.message ?? String(err);
      }
      if (expected === null) {
        results.push({ id: "machine-lines", rule: "every rendered line is unchanged and in order", ok: false, detail: failure });
      } else {
        const altered = firstAlteredLine(normaliseReport(expected), body);
        results.push({
          id: "machine-lines",
          rule: "every rendered line is unchanged and in order",
          ok: altered === null,
          detail: altered === null ? null : `first altered or missing line: ${altered.slice(0, 120)}`,
        });
      }
      const gaps = uncoveredCaveats(body, caveatNotes(run, checked));
      results.push({
        id: "caveats",
        rule: "a picked model with a promo, peak or regional limit is caveated",
        ok: gaps.length === 0,
        detail: gaps.length ? `not caveated: ${gaps.join(", ")}` : null,
      });
    }
  }
  return {
    ok: results.every((r) => r.ok),
    checks: results,
    note: run || picks ? null : "structural only: no --run/--picks, so no number was re-derived",
  };
}

export function renderChecks(result) {
  return result.checks
    .map((c) => `${c.ok ? "ok  " : "FAIL"}  ${c.id.padEnd(18)} ${c.rule}${c.detail ? `\n        ${c.detail}` : ""}`)
    .join("\n") + `\n${result.ok ? "all checks passed" : "report is not ready"}${result.note ? `\n${result.note}` : ""}\n`;
}

export { costOfUsage, entryFor, planWindows, shareOfCap };
