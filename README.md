# OpenCode Go Model Picker

An [OpenCode](https://opencode.ai/) **Agent Skill** that picks cost-effective OpenCode Go models for every [`oh-my-opencode-slim`](https://github.com/code-yeongyu/oh-my-openagent) agent, with fallback chains, based on the **current** Go plan — read-only, and only ever applies changes after you confirm.

一份 **OpenCode 智能体技能（Agent Skill）**：根据**最新的** OpenCode Go 套餐，为 `oh-my-opencode-slim` 的每个 agent 挑选高性价比模型并给出回退链。默认**只读**，只有在用户确认后才会写入配置。

[English](#english) · [中文](#中文)

---

## English

### What it is

OpenCode Go's plan changes constantly — per-model monthly dollar limits, limited-time usage multipliers, and models that appear or get retired. Any hardcoded model list goes stale. This skill makes the agent **fetch the plan fresh on every run**, compare it with your current config, and recommend a model (plus an ordered fallback chain) per agent, always reported with its **source and fetch date**.

It is deliberately conservative:

- **Never invents prices, limits, or model IDs.** Anything unverifiable is marked `需人工核实` ("needs manual verification").
- **Read-only by default.** It produces a preview and applies changes only after you confirm via OpenCode's `question` tool.
- **Matches the installed plugin's schema**, not a random online doc.

### Requirements

- OpenCode with skills support (skills load from `~/.config/opencode/skills/`).
- [`oh-my-opencode-slim`](https://github.com/code-yeongyu/oh-my-openagent) **2.2.x** (the schema in that build is the source of truth).
- Node.js **18+** only if you run the optional catalog fetcher (tested on Node 22).

### Installation

Clone the repo directly into your OpenCode skills directory, so the folder name matches the skill's `name`:

**Linux / macOS**
```bash
git clone https://github.com/<your-account>/opencode-go-model-picker.git \
  ~/.config/opencode/skills/opencode-go-model-picker
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/<your-account>/opencode-go-model-picker.git `
  "$env:USERPROFILE\.config\opencode\skills\opencode-go-model-picker"
```

Alternatively, copy or symlink this directory to `~/.config/opencode/skills/opencode-go-model-picker`.

Verify the script runs:

```bash
node scripts/fetch-go-models.mjs   # prints { fetchedAt, source, count, ids }
```

### Usage

Just ask, in natural language. Example prompts:

- "Pick the best OpenCode Go models for each of my oh-my-opencode-slim agents."
- "Is my current agent model config still a good fit for the current Go plan?"
- "Give me a paste-ready preset block for OpenCode Go, with fallbacks."

The agent then reads your config, fetches the plan, and returns a six-part report:

1. **套餐快照 / Plan snapshot** — the models relevant to you, with source + fetch date.
2. **变化提示 / What changed** — new/removed models, changed limits/prices, active promos.
3. **当前配置 / Current** — the active preset and each agent's current chain (read-only).
4. **推荐 / Recommendation** — per-agent chain, cost tier, and why.
5. **可粘贴配置 / Paste-ready** — a JSONC preset block.
6. **需人工核实 / Verify** — every unverified item, plus verification commands.

It then **stops and asks** before applying anything.

### How it works

The skill is a set of instructions (`SKILL.md`) plus lazily-loaded references. On a run, the agent:

1. **Reads current setup** (read-only): `~/.config/opencode/oh-my-opencode-slim.json` (and `.jsonc`), `opencode.jsonc`, and the installed plugin's `oh-my-opencode-slim.schema.json`.
2. **Fetches the plan** from the sources below and builds a snapshot.
3. **Detects changes** versus the last snapshot, if any.
4. **Allocates a model per agent** using the role→traits policy in `SKILL.md`.
5. **Builds fallback chains** — an ordered `model: [a, b, c]` failover list (2–4 entries).
6. **Outputs** the six-part report and **asks for confirmation** before writing.

Background on the mechanics:

- Go limits are **per-model monthly dollar amounts**; the overall window is 5h = 20%, weekly = 50%, monthly = 100%. Because limits are per-model, a different Go model is still usable when one is capped — which is why the first fallback is often another Go model.
- An array like `model: ["a", "b", "c"]` is an ordered failover chain (verified against `oh-my-opencode-slim` 2.2.x `ForegroundFallbackManager`). If **all** entries fail, the session aborts — so a chain should always end on a model you can actually rely on.
- Capabilities are verified from each model's **own lab documentation**, never inferred from its name — this matters especially for **vision** input, which the `observer` agent needs.

### Data sources

Fetched fresh every run; full details and parsing notes in [`references/data-sources.md`](references/data-sources.md).

| Priority | Source | URL | Gives |
|---|---|---|---|
| 1 | Go landing page | https://opencode.ai/go | latest promos + featured usage table |
| 2 | Go docs | https://opencode.ai/docs/go/ | full model / price / monthly-limit table |
| 3 | Models endpoint | https://opencode.ai/zen/go/v1/models | live catalog ids (via `scripts/fetch-go-models.mjs`) |
| 4 | models.dev | https://models.opencode.ai/providers/opencode-go/ | context / output / price / capabilities |
| 5 | julien.cloud tracker | https://julien.cloud/opencode-go-models/ | merged view + price-change / deprecation log |

### Safety and privacy

- **Read-only by default.** The skill does not edit `oh-my-opencode-slim.json`, `opencode.jsonc`, or any config until you confirm, after which it shows the exact change.
- **Local reads:** your OpenCode config files under `~/.config/opencode/` and the installed plugin's schema.
- **Network access:** it fetches the public pages above and calls the unauthenticated `opencode.ai` models endpoint via the local Node script. It sends no credentials and no personal data.
- **No invented numbers:** every figure carries a source and fetch date; unverifiable values are written `需人工核实`.
- **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by OpenCode, SST, or any model vendor. Model names and prices belong to their respective owners.

### License

Licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`). See [`LICENSE`](LICENSE).

### Provenance

Built after surveying existing options (September 2026): no official or well-known skill does plan-aware OpenCode Go agent model selection. Closest analogs are the dashboard generator [`itsmylife44/cliproxyapi-dashboard`](https://github.com/itsmylife44/cliproxyapi-dashboard) (`oh-my-opencode-slim-config-generator.tsx`, MIT) and the cost-profile request [`code-yeongyu/oh-my-openagent#1768`](https://github.com/code-yeongyu/oh-my-openagent/issues/1768). Official Go data sources plus `oh-my-opencode-slim`'s static per-agent role guidance are reused here.

---

## 中文

### 它是什么

OpenCode Go 的套餐变动非常频繁——每个模型有独立的月度美元额度、限时用量倍数，模型也会上架或被下线。任何硬编码的模型清单都会过期。本技能让智能体**每次运行都重新抓取套餐**，与你的当前配置对比，并为每个 agent 推荐模型及有序回退链，且每个数字都附带**来源与抓取日期**。

它刻意保持保守：

- **绝不编造价格、额度或模型 ID。** 无法核实的值一律写成 `需人工核实`。
- **默认只读。** 只产出预览，必须经你通过 OpenCode 的 `question` 工具确认后才写入。
- **以已安装插件的 schema 为准**，而不是随便一份在线文档。

### 前置要求

- 支持 skills 的 OpenCode（技能从 `~/.config/opencode/skills/` 加载）。
- [`oh-my-opencode-slim`](https://github.com/code-yeongyu/oh-my-openagent) **2.2.x**（该版本的 schema 是事实来源）。
- 仅当运行可选的目录抓取脚本时需要 Node.js **18+**（已在 Node 22 上测试）。

### 安装

直接把仓库克隆进 OpenCode 的技能目录，使文件夹名与技能的 `name` 一致：

**Linux / macOS**
```bash
git clone https://github.com/<your-account>/opencode-go-model-picker.git \
  ~/.config/opencode/skills/opencode-go-model-picker
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/<your-account>/opencode-go-model-picker.git `
  "$env:USERPROFILE\.config\opencode\skills\opencode-go-model-picker"
```

也可以把本目录复制或软链到 `~/.config/opencode/skills/opencode-go-model-picker`。

验证脚本可运行：

```bash
node scripts/fetch-go-models.mjs   # 输出 { fetchedAt, source, count, ids }
```

### 用法

用自然语言提问即可。示例：

- “帮我按最新 Go 套餐给每个 oh-my-opencode-slim agent 选模型。”
- “我现在的 agent 模型配置还适合当前 Go 套餐吗？”
- “给我一份可直接粘贴的 OpenCode Go preset 配置，带回退链。”

智能体会读取你的配置、抓取套餐，并输出六段式报告：

1. **套餐快照** —— 与你相关的模型，附来源 + 抓取时间。
2. **变化提示** —— 新增/下架模型、额度或价格变化、进行中的促销。
3. **当前配置** —— 当前 preset 与各 agent 的现有链路（只读）。
4. **推荐** —— 每个 agent 的链路、成本档位与理由。
5. **可粘贴配置** —— 一份 JSONC preset 块。
6. **需人工核实** —— 所有未核实项及验证命令。

随后它会**停下并询问**，确认后才应用。

### 工作原理

技能由一份指令文件（`SKILL.md`）加若干按需加载的参考文档组成。一次运行时，智能体会：

1. **读取当前设置**（只读）：`~/.config/opencode/oh-my-opencode-slim.json`（及 `.jsonc`）、`opencode.jsonc`，以及已安装插件的 `oh-my-opencode-slim.schema.json`。
2. **抓取套餐**（见下方来源）并构建快照。
3. **检测变化**，与上一次快照对比（如有）。
4. **按角色分配模型**，依据 `SKILL.md` 中的 role→traits 策略。
5. **构建回退链** —— 有序的 `model: [a, b, c]` 故障转移列表（2–4 项）。
6. **输出**六段式报告，并在写入前**征询确认**。

机制背景：

- Go 额度是**按模型计的月度美元金额**；整体窗口为 5 小时 = 20%、每周 = 50%、每月 = 100%。因为额度按模型独立计算，某个模型被限流时另一个 Go 模型仍然可用——这正是第一层回退常常选择另一个 Go 模型的原因。
- 形如 `model: ["a", "b", "c"]` 的数组是有序故障转移链（依据 `oh-my-opencode-slim` 2.2.x 的 `ForegroundFallbackManager` 核实）。若**所有**条目都失败，会话会中止——因此链尾应当是用户真正可以依赖的模型。
- 能力必须从模型**所属实验室的官方文档**核实，绝不从名字推断——这对 `observer` agent 需要的**视觉（vision）**输入尤其重要。

### 数据来源

每次运行都重新抓取；完整清单与解析注意事项见 [`references/data-sources.md`](references/data-sources.md)。

| 优先级 | 来源 | URL | 提供内容 |
|---|---|---|---|
| 1 | Go 落地页 | https://opencode.ai/go | 最新促销 + 精选用量表 |
| 2 | Go 文档 | https://opencode.ai/docs/go/ | 完整模型 / 价格 / 月度额度表 |
| 3 | 模型端点 | https://opencode.ai/zen/go/v1/models | 实时目录 id（经 `scripts/fetch-go-models.mjs`） |
| 4 | models.dev | https://models.opencode.ai/providers/opencode-go/ | 上下文 / 输出 / 价格 / 能力 |
| 5 | julien.cloud 追踪 | https://julien.cloud/opencode-go-models/ | 合并视图 + 价格变动 / 弃用日志 |

### 安全与隐私

- **默认只读。** 在你确认之前，技能不会编辑 `oh-my-opencode-slim.json`、`opencode.jsonc` 或任何配置；确认之后会展示确切的改动。
- **本地读取：** `~/.config/opencode/` 下的 OpenCode 配置文件，以及已安装插件的 schema。
- **网络访问：** 抓取上述公开页面，并通过本地 Node 脚本调用 `opencode.ai` 的免鉴权模型端点。不发送凭据，也不发送个人数据。
- **不编造数字：** 每个数值都带来源与抓取日期；无法核实的值写成 `需人工核实`。
- **非官方。** 本项目与 OpenCode、SST 或任何模型厂商均无隶属、背书或赞助关系。模型名称与价格归各自所有者。

### 许可证

基于 **GNU 通用公共许可证第 3 版或更新版本**（`GPL-3.0-or-later`）授权。见 [`LICENSE`](LICENSE)。

### 由来

本项目源于 2026 年 9 月的一次调研：当时没有任何官方或知名技能能做“感知套餐的 OpenCode Go agent 模型选择”。最接近的同类是面板生成器 [`itsmylife44/cliproxyapi-dashboard`](https://github.com/itsmylife44/cliproxyapi-dashboard)（`oh-my-opencode-slim-config-generator.tsx`，MIT），以及成本画像需求 [`code-yeongyu/oh-my-openagent#1768`](https://github.com/code-yeongyu/oh-my-openagent/issues/1768)。这里复用了 OpenCode Go 的官方数据来源，以及 `oh-my-opencode-slim` 静态的按 agent 角色指引。
