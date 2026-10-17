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
// (verified on 22.23.1: undici engages an EnvHttpProxyAgent). Below the verified
// version the variable may or may not be honored — and when it is not, the fetch
// silently bypasses the proxy and looks exactly like a network failure — so say
// so instead of letting the caller misdiagnose it
// (references/data-sources.md §Failure handling).

import { spawnSync } from "node:child_process";

export const PROXY_ENV_VARS = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"];

// Lowest runtime this repo has actually exercised the proxy path on; below it we
// warn instead of guessing. Bump when a lower version is verified.
const PROXY_VERIFIED_AT = [22, 23, 1];

function belowVerified([major, minor, patch]) {
  const mine = String(process.versions.node)
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const a = mine[i] ?? 0;
    const b = [major, minor, patch][i];
    if (a !== b) return a < b;
  }
  return false;
}

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

  if (belowVerified(PROXY_VERIFIED_AT)) {
    console.error(
      `Warning: a system proxy is set (${proxy}) and Node ${process.versions.node} is below the ` +
        `version this repo verifies NODE_USE_ENV_PROXY on (${PROXY_VERIFIED_AT.join(".")}) — fetch may ` +
        "silently bypass the proxy. Use Node 24+ (or that version or newer) for proxied runs, " +
        "or unset the proxy and re-run.",
    );
  }

  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", OGMP_PROXY_REEXEC: "1" },
  });
  process.exit(res.status ?? 1);
}
