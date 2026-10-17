// opencode-go-model-picker — proxy support shared by the network scripts.
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
// Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY=1 is set in the
// environment *before* startup. Every network script therefore calls
// maybeReexec() first: when a system proxy is configured it re-executes itself
// with that variable and exits with the child's status. `--no-env-proxy` opts
// out, and OGMP_PROXY_REEXEC makes the loop impossible.
//
// NODE_USE_ENV_PROXY is a Node 24 feature, backported to later 22.x builds
// (verified on 22.23.1: undici engages an EnvHttpProxyAgent). On a runtime
// without the backport the variable is silently ineffective, which looks exactly
// like a network failure — so warn on the majors that certainly lack it instead
// of letting the caller misdiagnose it (references/data-sources.md §Failure
// handling). Runtimes in between cannot be classified from the version number,
// so no warning is printed there rather than a false alarm.

import { spawnSync } from "node:child_process";

export const PROXY_ENV_VARS = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"];

const PROXY_SUPPORT_MAJOR = 22;

export function proxyFromEnv(env = process.env) {
  for (const name of PROXY_ENV_VARS) {
    if (env[name]) return env[name];
  }
  return undefined;
}

export function maybeReexec() {
  if (process.argv.includes("--no-env-proxy")) return;
  const proxy = proxyFromEnv();
  if (!proxy) return;
  if (process.env.NODE_USE_ENV_PROXY === "1") return;
  if (process.env.OGMP_PROXY_REEXEC === "1") return; // sentinel: never loop

  const major = Number(String(process.versions.node).split(".")[0]);
  if (Number.isFinite(major) && major < PROXY_SUPPORT_MAJOR) {
    console.error(
      `Warning: a system proxy is set (${proxy}) but Node ${process.versions.node} ` +
        "does not support NODE_USE_ENV_PROXY, so fetch will bypass it. Use Node 22.23+ " +
        "or 24+ for proxied runs, or unset the proxy and re-run.",
    );
  }

  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", OGMP_PROXY_REEXEC: "1" },
  });
  process.exit(res.status ?? 1);
}
