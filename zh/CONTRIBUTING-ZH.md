# 参与贡献

感谢你有兴趣改进 OpenCode Go Model Picker。这是一个小而专注的项目，因此最容易被接纳的贡献，是那些保持其设计原则不变的改动。

[英文版](../CONTRIBUTING.md)

## 基本原则

1. **绝不编造价格、额度或模型编号。** 推荐中的每个数字都必须来自抓取到的来源，并附带来源与抓取日期。无法核实的值应标记为待人工核实，而不是猜测。
2. **默认保持只读。** 技能绝不能在没有预览和明确确认的情况下编辑用户配置。
3. **以你所读取来源的结构规范为准**，而不是随便一份在线文档。对 `oh-my-opencode-slim`，事实来源是随已安装插件版本一起提供的 `oh-my-opencode-slim.schema.json`；对**自定义的原生** OpenCode 智能体，以官方 config/agent 文档为准。
4. **从模型所属实验室的官方文档核实能力**，绝不从名字推断。这对 `observer` 智能体所需的视觉输入尤其重要。
5. **只针对自定义智能体。** 绝不为 OpenCode 自带的智能体（包括但不限于 `build`、`plan`、自带 subagent、隐藏的系统智能体；自带名单可能随版本变化）推荐模型。自定义智能体即使不支持回退链，也仍在范围内。
6. **绝不直接提交到 `main`。** 每项改动都从 `main` 切出的主题分支（`feat/…`、`fix/…`、`docs/…`、`chore/…`）开始，只有下文的检查全部通过后才合并回 `main`。这条对维护者同样适用，以保证 `main` 始终通过检查、可审查。

## 术语约定

受众的区分必须精确——它贯穿整个技能：

- **自定义智能体（custom agent）** —— 用户定义或安装的任何智能体（原生 JSON/Markdown 智能体、`oh-my-opencode-slim` 预设，或其他插件提供的智能体）。这是技能要调优的对象。
- **自带智能体（built-in agent）** —— OpenCode 自带的智能体（包括但不限于 `build`、`plan`、自带 subagent，以及隐藏的系统智能体）。永不调优；自带名单可能随版本变化。

不要用「原生 OpenCode」来指代**自定义**智能体：它会被读成「自带」，已经造成过真实歧义。请改说「你在 `opencode.jsonc` 或 Markdown 里定义的智能体」。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `SKILL.md` | 技能本体：frontmatter、四个动词、模型自行判断的部分、铁律。只面向模型——教学内容放在 README 里。 |
| `references/plan-facts.md` | 判断依据参考：套餐事实、Console 各状态与回退、能力核实方式、需要标记的风险。 |
| `references/model-scores.json` | 提交进仓库的 LMArena 评分种子；榜单日期仍为最新时复用。 |
| `references/model-prices.json` | 提交进仓库的价格种子（models.dev 价格，含缓存写入与上下文分档）加手工核实的套餐常量（`capUsd`、`estReq*`、`peak`、`promo`）；`null` 表示未核实，绝不猜测。 |
| `scripts/go.mjs` | **唯一入口**：`run`、`report`、`check`、`apply`。 |
| `scripts/lib/agents.mjs` | 智能体发现（原生、slim、插件）、特征派生、回退链校验。 |
| `scripts/lib/pricing.mjs` | 唯一的计价实现：token + 模型 id + 价格常量 → `$`、窗口占比、容量。 |
| `scripts/lib/usage.mjs` | 本地 SQLite + Console 读数 → 按智能体分摊、bias、反解池子、月末预测。 |
| `scripts/lib/console.mjs` | Console MCP 状态探测（五态），最省的证据优先；绝不打印 token。 |
| `scripts/lib/snapshot.mjs` | 快照读写、目录刷新、套餐差异。 |
| `scripts/lib/prices.mjs` / `scores.mjs` | 刷新提交进仓库的种子，或刷新快照中的价格 / 评分键。 |
| `scripts/lib/report.mjs` | 渲染表格、金额列与配置块；机器可校验的闸门。 |
| `scripts/lib/apply.mjs` | 按精确 diff 应用到指定文件；结果无法解析时拒绝写入。 |
| `scripts/lib/io.mjs` | 退出码管道，让任何模块都不直接调用 `process.exit`。 |
| `scripts/lib/json-io.mjs` / `proxy.mjs` | 共享工具（容忍 BOM 的 JSON 读取、原子写入；代理 re-exec）。 |
| `tools/generate-assets.mjs` | 重新生成 SVG 图标、横幅与本地徽章；版本徽章从 `SKILL.md` 读取。 |
| `tools/check-docs.mjs` | 一站式文档校验：相对链接、中英文档对、frontmatter、英文文档不含中文，以及版本号/徽章/CHANGELOG 是否一致。 |
| `tools/lib/skill-md.mjs` | 读取 `SKILL.md` 的 `metadata.version`；徽章生成器与文档校验器共用，保证两者不会给出不一致的结果。 |
| `README.md` / `README-ZH.md` | 英文与中文文档。 |
| `zh/` | 中文文档（本文件、`CHANGELOG-ZH.md`，以及被 git 忽略的本地对读版 `skill-zh.md`）。 |
| `assets/` | README 头部使用的 SVG 图标、横幅与本地徽章。 |
| `tests/*.test.mjs` | 测试套件（见「验证改动」）。 |
| `tests/prompts.json` | 评测用例，不是运行时资产：每条把一句真实请求与技能必须表现出的行为配成对（只读、带日期回退、应用闸门）。没有任何代码加载它；改动工作流时手工跑一遍，或交给一个 agent 跑。 |
| `LICENSE` | 完整的 GPL-3.0-or-later 许可证文本。 |
| `CONTRIBUTING.md` / `CHANGELOG.md` | 贡献指南与更新日志（英文；中文在 `zh/` 下）。 |

## 进行改动

1. 复刻仓库，然后从 `main` 切出主题分支——见基本原则 6（`feat/…`、`fix/…`、`docs/…`、`chore/…`）。
2. 完成改动。如果你改动了 `SKILL.md`，请让 `references/` 与两份 README 与其保持一致。
3. 按下文进行验证。
4. 提交拉取请求，说明改了什么、为什么。

## 验证改动

本项目没有构建步骤。测试套件使用 Node 内置的 `node:test`（零依赖）：

```bash
node --test tests/*.test.mjs              # 计价、发现、用量、CLI、report/apply
node --check scripts/go.mjs               # 语法检查（每个 .mjs 都跑一遍）
node --check tools/check-docs.mjs
node tools/check-docs.mjs                 # 一站式文档校验（见下）
node scripts/go.mjs run --offline --json  # 无网络时也能干净降级
```

`tests/golden/` 保存的是重构前脚本产出的黄金输出。黄金输出与当前代码不一致即为回归——只有在改动是有意为之时才刷新黄金输出，并在提交信息中说明。

`check-docs.mjs` 会校验相对链接、中英文档对、frontmatter 合法性、英文文档中不含中文字符，以及版本徽章与两份 CHANGELOG 是否与 `SKILL.md` 的 `metadata.version` 一致——任何文档或 `SKILL.md` 改动后都要运行它。所有脚本都保持零依赖：复用 `scripts/lib/json-io.mjs`（读取、原子写入）与 `scripts/lib/proxy.mjs`（代理 re-exec），不要再引入包，也不要再抄一份同样的实现。上游发布新榜单后要重生成 LMArena 评分种子，运行 `node scripts/go.mjs run`（或 `scripts/lib/scores.mjs` 的 `refreshScores` 导出）并提交 `references/model-scores.json`；价格种子通过 `scripts/lib/prices.mjs` 以同样方式刷新。

如果你改动了某个动词的行为，请扩展 `tests/cli.test.mjs`——断言的对象就是 CLI 表面本身：单一入口、四个动词、降级运行仍产出可用的 `run.json`，以及 `apply` 不带 `--write` 绝不写入。如果你改动了模型指引，请对照 `references/plan-facts.md` 中列出的来源重新核实相关论断，并更新「已核实日期」的标注。如果你手工编辑了 `assets/` 下的任何 SVG，建议改为编辑 `tools/generate-assets.mjs` 并重新运行它，让资源保持可复现。

## 报告问题

请附上：

- 你使用的提示词，以及你的预期与实际结果。
- 你的 OpenCode 版本；如相关，还有已安装的 `oh-my-opencode-slim` 版本。
- 任何相关输出（请先移除敏感信息）。

## 贡献的许可

一旦贡献，即表示你同意你的贡献按本项目的许可证 **GPL-3.0-or-later** 授权（见 [`LICENSE`](../LICENSE)）。
