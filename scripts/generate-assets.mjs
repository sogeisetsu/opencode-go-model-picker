#!/usr/bin/env node
// opencode-go-model-picker — generate the repository's SVG icon, banners and badges.
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
// Generate the repository's SVG assets: icon, banners and local badges.
// Usage: node scripts/generate-assets.mjs
//
// Everything is emitted as plain SVG (no external fonts or images), so the
// assets render identically offline and on GitHub.
//
// Typography in the banners:
//   - "OpenCode" is drawn with a hand-built 5x8 dot-matrix font (1 = lit cell).
//     Every glyph shares one baseline (row 6) and every dot lands on an integer
//     grid, so the letters line up exactly.
//   - every other word uses an old typewriter monospace face (Courier), giving a
//     vintage typewritten look.
//   - "Go" is Xiaomi orange (#FF6900); "Model Picker" is the project green
//     (#03B000).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const badgesDir = join(assets, "badges");

const C = {
  ink: "#F1ECEC",
  mid: "#B7B1B1",
  dim: "#8E8B8B",
  dark: "#4B4646",
  darker: "#2B2725",
  deep: "#1B1918",
  green: "#03B000",
  greenInk: "#07240B",
  xiaomi: "#FF6900",
  tile: "#0F0E0E",
};

// Old typewriter monospace for Latin text.
const MONO_TYPEWRITER = "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";
// Closest Chinese equivalent to an old typewriter/print face.
const CJK_OLD = "'FangSong', 'STFangsong', 'FangSong_GB2312', KaiTi, SimSun, 'Songti SC', serif";

// 5x8 dot-matrix glyphs (1 = lit pixel). Baseline is row 6; row 7 is descender.
// Only the characters used by the word "OpenCode" are defined.
const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110", "00000"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110", "00000"],
  p: ["00000", "00000", "11110", "10001", "10001", "11110", "10000", "10000"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110", "00000"],
  n: ["00000", "00000", "10110", "11001", "10001", "10001", "10001", "00000"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110", "00000"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111", "00000"],
};

const ROWS = 8;
const BASELINE_ROW = 6;

function pixelText(text, x, y, cell, color, { gap = 1, dotRatio = 0.75 } = {}) {
  const dot = Math.round(cell * dotRatio);
  const off = (cell - dot) / 2;
  const rx = Math.max(1, dot * 0.18);
  let out = "";
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch] || FONT[" "];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          out += `<rect x="${cx + col * cell + off}" y="${y + row * cell + off}" width="${dot}" height="${dot}" rx="${rx.toFixed(1)}" fill="${color}"/>`;
        }
      }
    }
    cx += 5 * cell + gap * cell;
  }
  return out;
}

function pixelWidth(text, cell, gap = 1) {
  return text.length * (5 * cell + gap * cell) - gap * cell;
}

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="OpenCode Go Model Picker">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2B2725"/>
      <stop offset="1" stop-color="#4B4646"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bg)"/>
  <rect x="26" y="38" width="58" height="13" rx="6.5" fill="#F1ECEC"/>
  <rect x="26" y="57.5" width="58" height="13" rx="6.5" fill="#B7B1B1"/>
  <rect x="26" y="77" width="58" height="13" rx="6.5" fill="#8E8B8B"/>
  <circle cx="100" cy="44.5" r="7" fill="#03B000"/>
  <circle cx="100" cy="44.5" r="2.6" fill="#2B2725"/>
</svg>
`;
}

const bannerIcon = (x, y) => `  <g transform="translate(${x},${y})">
    <rect x="0" y="0" width="128" height="128" rx="28" fill="${C.tile}" fill-opacity="0.5"/>
    <rect x="22" y="34" width="58" height="13" rx="6.5" fill="#F1ECEC"/>
    <rect x="22" y="53.5" width="58" height="13" rx="6.5" fill="#B7B1B1"/>
    <rect x="22" y="73" width="58" height="13" rx="6.5" fill="#8E8B8B"/>
    <circle cx="96" cy="40.5" r="7" fill="#03B000"/>
    <circle cx="96" cy="40.5" r="2.6" fill="${C.tile}"/>
  </g>`;

function bannerSvg({ subtitle, footer, subtitleFont, subtitleSize, footerSize, aria }) {
  const defs = `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1B1918"/>
      <stop offset="1" stop-color="#2E2A28"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#F1ECEC" stroke-opacity="0.05"/>
    </pattern>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#03B000"/>
      <stop offset="1" stop-color="#03B000" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

  const cell = 8;
  const titleTop = 92;
  const lineGap = 72;
  const baseline = titleTop + BASELINE_ROW * cell + (cell - Math.round(cell * 0.75)) / 2 + Math.round(cell * 0.75); // 147
  const titleSize = 90; // Courier, sized to match the 55px dot-matrix cap height

  const openCode = pixelText("OpenCode", 248, titleTop, cell, C.ink);
  const goX = 248 + pixelWidth("OpenCode", cell) + 24;

  const title =
    `  ${openCode}\n` +
    `  <text x="${goX}" y="${baseline}" font-family="${MONO_TYPEWRITER}" font-size="${titleSize}" fill="${C.xiaomi}">Go</text>\n` +
    `  <text x="248" y="${baseline + lineGap}" font-family="${MONO_TYPEWRITER}" font-size="${titleSize}" fill="${C.green}">Model Picker</text>\n`;

  const subtitleY = baseline + lineGap + 31; // 250

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320" role="img" aria-label="${escapeXml(aria)}">
${defs}
  <rect width="1280" height="320" fill="url(#bg)"/>
  <rect width="1280" height="320" fill="url(#grid)"/>
${bannerIcon(80, 96)}
${title}  <text x="250" y="${subtitleY}" font-family="${subtitleFont}" font-size="${subtitleSize}" fill="${C.mid}">${escapeXml(subtitle)}</text>
  <rect x="250" y="${subtitleY + 16}" width="360" height="3" rx="1.5" fill="url(#accent)"/>
  <text x="250" y="${subtitleY + 48}" font-family="${subtitleFont}" font-size="${footerSize}" fill="${C.dim}">${escapeXml(footer)}</text>
  <g opacity="0.55">
    <rect x="1060" y="102" width="150" height="14" rx="7" fill="#4B4646"/>
    <rect x="1060" y="132" width="150" height="14" rx="7" fill="#3A3634"/>
    <rect x="1060" y="162" width="150" height="14" rx="7" fill="#2E2A28"/>
    <circle cx="1196" cy="109" r="7" fill="#03B000"/>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function badgeSvg(label, value, valueColor, valueTextColor) {
  const fs = 11;
  const pad = 8;
  const labelW = Math.round(label.length * 6.2) + pad * 2;
  const valueW = Math.round(value.length * 6.2) + pad * 2;
  const w = labelW + valueW;
  const h = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <rect width="${w}" height="${h}" rx="3" fill="${C.darker}"/>
  <path d="M${labelW} 0h${valueW - 3}a3 3 0 0 1 3 3v${h - 6}a3 3 0 0 1-3 3h-${valueW - 3}z" fill="${valueColor}"/>
  <g font-family="${MONO_TYPEWRITER}" font-size="${fs}" font-weight="700" text-anchor="middle">
    <text x="${labelW / 2}" y="14" fill="${C.ink}" textLength="${labelW - pad * 2}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text>
    <text x="${labelW + valueW / 2}" y="14" fill="${valueTextColor}" textLength="${valueW - pad * 2}" lengthAdjust="spacingAndGlyphs">${escapeXml(value)}</text>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

mkdirSync(badgesDir, { recursive: true });

const files = {
  [join(assets, "icon.svg")]: iconSvg(),
  [join(assets, "banner.svg")]: bannerSvg({
    subtitle: "Plan-aware model selection for OpenCode agents",
    footer: "read-only . source-cited . fallback-ready",
    subtitleFont: MONO_TYPEWRITER,
    subtitleSize: 22,
    footerSize: 18,
    aria: "OpenCode Go Model Picker banner",
  }),
  [join(assets, "banner-zh.svg")]: bannerSvg({
    subtitle: "为 OpenCode 智能体做感知套餐的模型选择",
    footer: "只读 · 有来源 · 可回退",
    subtitleFont: CJK_OLD,
    subtitleSize: 22,
    footerSize: 18,
    aria: "OpenCode Go Model Picker banner",
  }),
  [join(badgesDir, "license.svg")]: badgeSvg("license", "GPL-3.0-or-later", C.dark, C.ink),
  [join(badgesDir, "version.svg")]: badgeSvg("version", "0.1.0", C.green, C.greenInk),
  [join(badgesDir, "node.svg")]: badgeSvg("node", ">=18", C.dark, C.ink),
  [join(badgesDir, "agent-skill.svg")]: badgeSvg("OpenCode", "Agent Skill", C.dark, C.ink),
  [join(badgesDir, "prs-welcome.svg")]: badgeSvg("PRs", "welcome", C.green, C.greenInk),
};

for (const [path, content] of Object.entries(files)) {
  writeFileSync(path, content, "utf8");
  console.log("wrote", path.replace(root + "\\", "").replace(root + "/", ""));
}
