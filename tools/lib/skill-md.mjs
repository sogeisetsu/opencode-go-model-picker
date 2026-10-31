// opencode-go-model-picker — read the skill's own version from SKILL.md.
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
// SKILL.md's `metadata.version` is the single source of truth for the version:
// generate-assets.mjs stamps it into the badge and check-docs.mjs verifies the
// badge and the changelogs against it. Both read it through this one parser so
// they can never disagree about the same file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Nested key under `metadata:` in the SKILL.md frontmatter, e.g.
//     metadata:
//       version: "1.3.0"
export function skillVersion(root) {
  const text = stripBom(readFileSync(join(root, "SKILL.md"), "utf8"));
  const lines = text.split(/\r?\n/);
  const close = lines.indexOf("---", 1);
  for (let i = 0; close > 0 && i < close; i++) {
    const m = lines[i].match(/^\s+version:\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  throw new Error("SKILL.md: no metadata.version found in the frontmatter");
}
