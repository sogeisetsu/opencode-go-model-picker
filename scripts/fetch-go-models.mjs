#!/usr/bin/env node
// opencode-go-model-picker — fetch the live OpenCode Go model catalog.
// Copyright (C) 2026 sogeisetsu
//
// This file is part of opencode-go-model-picker, a skill that picks
// cost-effective OpenCode Go models for each oh-my-opencode-slim agent.
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
// Fetch the live OpenCode Go model catalog (unauthenticated metadata endpoint).
// Usage: node scripts/fetch-go-models.mjs
// Output: JSON { fetchedAt, source, count, ids } on stdout.

const URL = "https://opencode.ai/zen/go/v1/models";

const res = await fetch(URL, {
  headers: { "user-agent": "opencode-go-model-picker/1.0" },
});

if (!res.ok) {
  console.error(`Fetch failed: HTTP ${res.status} for ${URL}`);
  process.exit(1);
}

const json = await res.json();
const ids = (json.data ?? [])
  .map((m) => m && m.id)
  .filter(Boolean)
  .sort();

process.stdout.write(
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      source: URL,
      count: ids.length,
      ids,
    },
    null,
    2,
  ) + "\n",
);
