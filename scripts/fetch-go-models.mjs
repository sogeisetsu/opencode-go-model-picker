#!/usr/bin/env node
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
