#!/usr/bin/env node
// opencode-go-model-picker — the only entry point.
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
//   go.mjs run     [--json] [--out <file>] [--offline] [--write]
//                  [--config <dir>] [--snapshot <path>] [--db <path>] [--prices <path>]
//                  [--tool-status <state>] [--tool-cost-usd <usd>]
//                  [--console-cost <usd>] [--console-requests <n>] [--month-pct <pct>]
//                  [--mode budget|balanced|quality] [--answers <a,b>]
//   go.mjs report  --run <file> --picks <file> [--out <file>] [--json]
//   go.mjs check   <report.md> [--run <file>] [--json]
//   go.mjs apply   --run <file> --picks <file> --target <file> [--write] [--json]
//
// Exit codes: 0 done, 1 a real failure, 2 bad usage.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { maybeReexec } from "./lib/proxy.mjs";
import { FailError, HelpRequested, UsageError, argValue, hasFlag, makeIo, writeJson } from "./lib/io.mjs";
import { discoverAgents } from "./lib/agents.mjs";
import { probeConsole } from "./lib/console.mjs";
import { usageReport } from "./lib/usage.mjs";
import { defaultSnapshotPath, diffSnapshots, readSnapshot, refreshCatalog } from "./lib/snapshot.mjs";
import { refreshPrices } from "./lib/prices.mjs";
import { refreshScores } from "./lib/scores.mjs";
import { DEFAULT_PRICE_SEED, loadPriceTable, seedFreshness } from "./lib/pricing.mjs";
import { checkReport, readJsonArg, renderChecks, renderReport } from "./lib/report.mjs";
import { applyToFile } from "./lib/apply.mjs";

maybeReexec();

const USAGE = `Usage: go.mjs <verb> [options]

  run      discover agents, probe Console, calibrate usage, refresh data, diff the
           plan, pick the basis; writes run.json (stdout or --out)
  report   render the report from a run + a picks file
  check    machine-check a finished report (the gate before delivery)
  apply    print an exact diff for one target file; --write only after confirmation

Options: --help for the full list. Exit 0 done, 1 failure, 2 bad usage.
`;

const MODES = new Set(["budget", "balanced", "quality"]);

function resolveMode({ named, remembered, answers }) {
  if (named) {
    if (!MODES.has(named)) throw new UsageError(`--mode must be budget|balanced|quality`);
    return { chosen: named, source: "request" };
  }
  if (remembered && MODES.has(remembered.mode)) {
    return { chosen: remembered.mode, source: "remembered" };
  }
  if (answers) {
    const [goal = "", task = ""] = String(answers).split(",").map((s) => s.trim().toLowerCase());
    const chosen =
      /quality|能力|质量/.test(goal) ? "quality" : /budget|省|便宜/.test(goal) || /cheap/.test(task) ? "budget" : "balanced";
    return { chosen, source: "answers" };
  }
  return { chosen: "balanced", source: "default", needsQuestion: true };
}

function basisOf({ consoleState, usage, today }) {
  if (consoleState === "authorized" && usage?.ok) {
    const pool = usage.pool?.monthlyUsd;
    return {
      kind: "console",
      line: `Basis: Console bill (authoritative) | ${today} | pool ${pool === null || pool === undefined ? "-" : `$${pool}`}/mo (provisional)`,
      denominatorUsd: usage.console?.costUsd ?? null,
    };
  }
  if (usage?.ok) {
    const bias = usage.calibration?.current;
    const factor = typeof bias === "number" && bias > 0 ? ` high by about ${(1 / bias).toFixed(1)}x` : ", deviation unknown";
    return {
      kind: "estimate",
      line: `Basis: Estimate (official unit price x median tokens${factor}) | ${today}`,
      denominatorUsd: usage.totals?.costUsd ?? null,
    };
  }
  return {
    kind: "uncalibrated",
    line: `Basis: Uncalibrated (no Console, no snapshot) | ${today}`,
    denominatorUsd: null,
  };
}

async function runVerb(argv, io) {
  const { stdout, stderr } = makeIo(io);
  const snapshotPath = argValue(argv, "--snapshot") ?? defaultSnapshotPath();
  const pricesPath = argValue(argv, "--prices") ?? DEFAULT_PRICE_SEED;
  const offline = hasFlag(argv, "--offline");
  const today = new Date().toISOString().slice(0, 10);

  // Baseline before any refresh, so "plan changed" is a real comparison.
  const baseline = readSnapshot(snapshotPath).snapshot;

  const inventory = discoverAgents(
    [
      ...(argValue(argv, "--config") ? ["--config", argValue(argv, "--config")] : []),
      "--snapshot", snapshotPath,
      ...(argValue(argv, "--registry") ? ["--registry", argValue(argv, "--registry")] : []),
      ...(hasFlag(argv, "--include-builtin-names") ? ["--include-builtin-names"] : []),
    ],
  );

  let consoleState;
  try {
    const probeArgs = ["--no-probe"];
    if (argValue(argv, "--tool-status")) probeArgs.push("--tool-status", argValue(argv, "--tool-status"));
    if (argValue(argv, "--tool-cost-usd")) probeArgs.push("--tool-cost-usd", argValue(argv, "--tool-cost-usd"));
    if (hasFlag(argv, "--no-mcp-list")) probeArgs.push("--no-mcp-list");
    if (argValue(argv, "--config")) probeArgs.push("--config", argValue(argv, "--config"));
    consoleState = (await probeConsole(probeArgs)).output;
  } catch (err) {
    consoleState = { state: "unknown", evidence: [String(err.message ?? err)], guidanceKey: "plan-facts#console-unknown" };
  }

  let usage;
  try {
    const usageArgs = ["--snapshot", snapshotPath, "--prices", pricesPath];
    if (argValue(argv, "--db")) usageArgs.push("--db", argValue(argv, "--db"));
    if (argValue(argv, "--console-cost")) usageArgs.push("--console-cost", argValue(argv, "--console-cost"));
    if (argValue(argv, "--console-requests")) usageArgs.push("--console-requests", argValue(argv, "--console-requests"));
    if (argValue(argv, "--month-pct")) usageArgs.push("--month-pct", argValue(argv, "--month-pct"));
    if (argValue(argv, "--cycle-start")) usageArgs.push("--cycle-start", argValue(argv, "--cycle-start"));
    if (hasFlag(argv, "--write")) usageArgs.push("--write");
    usage = { ok: true, ...(await usageReport(usageArgs)).report };
  } catch (err) {
    usage = { ok: false, error: String(err.message ?? err), ...(err.extra ?? {}) };
  }

  // Refresh one step at a time, in this order: catalog, prices, scores. They all
  // write the same snapshot file, which is why this is one command and not three.
  const refresh = { catalog: null, prices: null, scores: null, offline };
  if (!offline) {
    try {
      refresh.catalog = await refreshCatalog({ snapshotPath }, io);
    } catch (err) {
      refresh.catalog = { error: String(err.message ?? err) };
    }
    try {
      refresh.prices = await refreshPrices(["--snapshot", snapshotPath, "--seed", pricesPath], io);
    } catch (err) {
      refresh.prices = { error: String(err.message ?? err) };
    }
    const scoresStale = (() => {
      const fetchedAt = baseline?.sources?.rankings?.fetchedAt;
      if (!fetchedAt) return true;
      return Date.now() - Date.parse(fetchedAt) > 86400000;
    })();
    if (scoresStale) {
      try {
        refresh.scores = await refreshScores(["--snapshot", snapshotPath], io);
      } catch (err) {
        refresh.scores = { error: String(err.message ?? err) };
      }
    }
  }

  const after = readSnapshot(snapshotPath);
  const plan = baseline && after.snapshot ? diffSnapshots(baseline, after.snapshot) : { added: [], removed: [], changed: [], beforeCount: 0, afterCount: 0 };

  const table = loadPriceTable(pricesPath);
  const freshness = table.error ? { error: table.error } : seedFreshness(table);
  const live = Boolean(refresh.catalog && !refresh.catalog.error && refresh.prices && !refresh.prices.error);
  const quality = live ? "live" : table.error ? "none" : "seed";

  const mode = resolveMode({
    named: argValue(argv, "--mode"),
    remembered: after.snapshot?.preferences,
    answers: argValue(argv, "--answers"),
  });
  const basis = basisOf({ consoleState: consoleState?.state, usage, today });

  const run = {
    schemaVersion: "1",
    kind: "run",
    generatedAt: new Date().toISOString(),
    data: {
      quality,
      snapshotPath,
      catalog: refresh.catalog ?? { fetchedAt: baseline?.sources?.catalog?.fetchedAt ?? null, count: baseline?.sources?.catalog?.count ?? null, error: offline ? "offline run" : null },
      prices: { path: pricesPath, ...freshness },
      scores: refresh.scores ?? {
        fetchedAt: baseline?.sources?.rankings?.fetchedAt ?? null,
        publishDates: baseline?.sources?.rankings?.publishDates ?? null,
        error: offline ? "offline run" : null,
      },
    },
    agents: inventory.agents,
    warnings: inventory.warnings,
    skippedBuiltins: inventory.skippedBuiltins,
    deadChainIds: inventory.deadChainIds,
    console: { state: consoleState?.state ?? "unknown", guidanceKey: consoleState?.guidanceKey, evidence: consoleState?.evidence ?? [] },
    usage,
    plan,
    mode,
    basis,
    caveats: [...(freshness.stale ? [`price seed expired: ${freshness.reason}`] : [])],
    needs: {
      modeQuestion: Boolean(mode.needsQuestion),
      consoleGuidance: (consoleState?.state ?? "unknown") !== "authorized",
      picks: true,
      applyGate: true,
    },
  };

  if (argValue(argv, "--out")) {
    const out = argValue(argv, "--out");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(run, null, 2) + "\n", "utf8");
    stdout.write(`run written: ${out}\n`);
  } else if (hasFlag(argv, "--json")) {
    writeJson({ stdout }, run);
  } else {
    stdout.write(
      [
        `agents ${run.agents.length} | console ${run.console.state} | data ${run.data.quality}` +
          ` | prices ${run.data.prices.verifiedAt ?? "-"}${run.data.prices.stale ? " (EXPIRED)" : ""}`,
        `plan +${plan.added.length} / -${plan.removed.length} / ~${plan.changed.length} | mode ${run.mode.chosen} (${run.mode.source})`,
        run.basis.line,
        run.needs.modeQuestion ? "needs: ask the two mode questions" : "needs: picks",
      ].join("\n") + "\n",
    );
    if (run.needs.modeQuestion) stderr.write("");
  }
  return 0;
}

function reportVerb(argv, io) {
  const { stdout } = makeIo(io);
  const runPath = argValue(argv, "--run");
  const picksPath = argValue(argv, "--picks");
  if (!runPath) throw new UsageError("report needs --run <run.json>");
  if (!picksPath) throw new UsageError("report needs --picks <picks.json>");
  const run = readJsonArg(runPath, "run");
  const picks = readJsonArg(picksPath, "picks");
  const markdown = renderReport(run, picks, {
    prices: argValue(argv, "--prices") ?? run.data?.prices?.path ?? DEFAULT_PRICE_SEED,
  });
  if (argValue(argv, "--out")) {
    writeFileSync(argValue(argv, "--out"), markdown, "utf8");
    stdout.write(`report written: ${argValue(argv, "--out")}\n`);
  } else {
    stdout.write(markdown);
  }
  return 0;
}

function checkVerb(argv, io) {
  const { stdout } = makeIo(io);
  const file = argv.find((a) => !a.startsWith("-") && argv[argv.indexOf(a) - 1] !== "--run");
  if (!file) throw new UsageError("check needs a report file");
  const text = readFileSync(file, "utf8");
  const run = argValue(argv, "--run") ? readJsonArg(argValue(argv, "--run"), "run") : null;
  const result = checkReport(text, run);
  if (hasFlag(argv, "--json")) writeJson({ stdout }, result);
  else stdout.write(renderChecks(result));
  return result.ok ? 0 : 1;
}

function applyVerb(argv, io) {
  const { stdout } = makeIo(io);
  const runPath = argValue(argv, "--run");
  const picksPath = argValue(argv, "--picks");
  const target = argValue(argv, "--target");
  if (!runPath || !picksPath || !target) throw new UsageError("apply needs --run, --picks and --target");
  const run = readJsonArg(runPath, "run");
  const picks = readJsonArg(picksPath, "picks");
  const entries = picks.picks ?? picks;
  const write = hasFlag(argv, "--write");
  const targetResolved = resolve(target);
  const results = [];
  for (const agent of run.agents ?? []) {
    if (resolve(agent.provenance?.file ?? "") !== targetResolved) continue;
    const pick = entries[agent.name];
    if (!pick) continue;
    const chain = Array.isArray(pick) ? pick : pick.chain;
    const ids = chain.map((e) => (typeof e === "string" ? e : e && e.id)).filter(Boolean);
    const dead = new Set((run.deadChainIds ?? []).map((d) => d.id));
    const bad = ids.filter((id) => dead.has(id));
    if (bad.length) throw new FailError(`refusing: ${agent.name} chain contains dead ids: ${bad.join(", ")}`);
    results.push(applyToFile({ file: target, agent, chain: ids, write }));
  }
  if (results.length === 0) throw new FailError(`no picked agent belongs to ${target}`);
  if (hasFlag(argv, "--json")) writeJson({ stdout }, results);
  else {
    for (const r of results) stdout.write(r.diff);
    stdout.write(write ? `written: ${target}\n` : `dry run: pass --write (after the user confirms) to write ${target}\n`);
  }
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  try {
    if (!verb || verb === "--help" || verb === "-h") {
      process.stdout.write(USAGE);
      return 0;
    }
    switch (verb) {
      case "run":
        return await runVerb(argv.slice(1), {});
      case "report":
        return reportVerb(argv.slice(1), {});
      case "check":
        return checkVerb(argv.slice(1), {});
      case "apply":
        return applyVerb(argv.slice(1), {});
      default:
        throw new UsageError(`unknown verb: ${verb}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof FailError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return err.code ?? 1;
    }
    if (err instanceof HelpRequested) {
      process.stdout.write(err.text);
      return 0;
    }
    process.stderr.write(`Error: ${err?.message ?? err}\n`);
    return 1;
  }
}

const code = await main();
process.exitCode = code;
