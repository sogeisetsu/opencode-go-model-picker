# 更新日志

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，且本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

[英文版](../CHANGELOG.md)

## [未发布]

## [1.1.0] - 2026-09-26

### 已变更

- 报告输出格式从六段式报告改为**三段正文 + 数据附录**：**推荐表**（每个自定义智能体一行——智能体名称、能力侧重（trait）、当前模型、推荐模型，以及成本 / 吞吐 / 能力层面的理由，限时、地理或训练相关的注意事项用 ⚠ 标出）、**可粘贴配置**（针对每个检测到的来源给出一段完整、可直接复制粘贴的 JSONC——slim 预设对应 `oh-my-opencode-slim.json`，原生 `agent` 块对应 `opencode.jsonc`，两者都检测到就两段都给；来源支持回退链的会保留链路）、**要点说明**（一段话覆盖模式与理由、价格上限、完整的注意事项原文，以及与上次快照相比的套餐变化），随后是**数据附录**（来源与抓取日期并标注种子、快照差异、相关模型价格表、首次使用的决策因素表、待人工核实清单，以及验证命令）。应用闸门保持不变：技能仍然会**停下来问你**，确认后才动配置。已在 `README.md` / `README-ZH.md`、`CONTRIBUTING`（中英）、`docs/index.html` 与 `test-prompts.json` 中同步。

## [1.0.0] - 2026-09-25

### 新增

- 新增提交进仓库的价格种子（`references/model-prices.json`）与 `scripts/refresh-prices.mjs`：脚本读取 models.dev 的 `opencode-go` provider，写入逐模型的 `inputPer1M` / `outputPer1M` / `cacheReadPer1M` / `context` / `outputLimit`，以及维护者人工核实的月度额度、预估请求、促销与状态字段。`null` 表示未核实，绝不猜测。只有当每条记录的 `upstreamUpdatedAt` 仍等于线上 models.dev 的 `last_updated`、且覆盖整个目录时才复用种子；套餐页面无法抓取时，技能直接把种子当作**带日期的离线回退**读取，而实时读取始终优先。
- 新增首次使用的模式诊断：请求未指定模式、也没有已记住的模式时，技能会问两个简短的加权问题（主要目标 0.7，主要任务 0.3），经表格解析出模式，把答案存入 `snapshot.preferences`（`mode`、`answers`、`chosenAt`），之后沿用。显式点名的模式始终覆盖它；跳过问题则回退到 `balanced`。
- 报告新增可审计的**决策因素表**：首次诊断的两个问题各自列出答案与权重，所选模式可以追溯回输入，而不是凭空给出。
- 在 `CONTRIBUTING`（中英）把「绝不直接提交到 `main`」正式写成基本原则 6：每项改动都从 `main` 切出的主题分支（`feat/…`、`fix/…`、`docs/…`、`chore/…`）开始，只有检查全部通过后才合并回 `main`；这条对维护者同样适用，以保证 `main` 始终通过检查、可审查。「进行改动」第 1 步现在指向该原则。
- 新增提交进仓库的 LMArena 评分种子（`references/model-scores.json`）与 `scripts/refresh-scores.mjs`：脚本经 Hugging Face datasets-server 读取官方 LMArena 排行榜数据集（免 key、无浏览器），使用三个榜单（overall / coding / vision）的 Arena ELO。只有当种子的 `source.publishDates` 仍与线上榜单一致、且覆盖当前目录时才复用；否则脚本重新抓取。数据集没有 cost 列，故 cost 保持 `null`；脚本会在配置了系统代理时自动启用。
- 将智能体发现从 `oh-my-opencode-slim` 扩展到更多来源：技能现在通过新增的 `references/agent-sources.md` 中的来源适配器，读取原生 OpenCode 智能体（`opencode.json`/`opencode.jsonc` 的 `agent` 键，以及 `~/.config/opencode/agents/` 或 `.opencode/agents/` 下的 Markdown 文件）和其他注入智能体的插件。分配策略改为基于角色特征，并用已知角色覆盖保持此前的逐智能体行为。
- 新增三种在性能与价格之间取舍的推荐模式：`budget`（省钱，能接受的最低价）、`balanced`（默认）、`quality`（最佳性能）。报告会写明所选模式，非默认模式时会说明理由。
- 新增**预估请求数**（每 5 小时 / 每周 / 每月）作为一等信号：相同的月度美元额度并不意味着相同的吞吐量，所以技能现在会从套餐页面读取请求数（落地页更新更及时），在价格与能力相当时优先选请求数更高者。快照 schema 与报告新增 `est req/week` 与 `est req/month`。
- 新增强制**注意事项标记**：依赖限时倍数的推荐（附促销结束后回落的基础额度）、有地理限制的模型，以及用用户 prompt 与补全结果训练模型的「隐私换折扣 / Contributor」档（属自愿选择，绝不悄悄推荐）。
- 新增 **balanced 价格上限**：对常用的高用量智能体，最贵的推荐应该只比当前「便宜但够用」的基线（写作时为 DeepSeek V4.1 Flash）贵一点点、且明显更强；否则就推荐基线本身。
- 更新横幅副标题，直白地说明「为每个自定义智能体挑选合适的 OpenCode Go 模型」。
- 把 `scripts/check-docs.mjs` 扩展为一站式文档校验：现在还校验 frontmatter（包括曾悄悄让 `SKILL.md` 失效的未加引号 `: ` 情况），并检查英文文档中不含中文字符。在 `CONTRIBUTING`（中英）新增术语约定，钉死「custom agent」与「built-in agent」，并提醒不要用「原生 OpenCode」指代自定义智能体。
- 新增持久化模型快照缓存（`~/.cache/opencode/opencode-go-model-picker/snapshot.json`）与 `scripts/refresh-snapshot.mjs`：对实时目录做差异，输出紧凑的新增 / 下架差异，使每次运行只重新核实发生变化的部分。排名评分（LMArena，Arena ELO）以 1 天 TTL 缓存。详见 `references/model-snapshot.md`。
- 推荐范围限定为**自定义**智能体：有意跳过 OpenCode 自带的 `build`、`plan` 以及自带 subagent。
- 把两份 README、横幅与参考文档从“仅 `oh-my-opencode-slim`”的措辞扩展为面向所有智能体来源，并把回退链说明弱化为“建议”而非“必须”。
- `opencode-go-model-picker` 技能的初始开源脚手架。
- `SKILL.md` 中的技能指令，以及套餐数据来源参考（`references/data-sources.md`）与输出格式参考（`references/output-format.md`）。
- 目录抓取脚本 `scripts/fetch-go-models.mjs`。
- 双语文档：英文（`README.md`）与中文（`README-ZH.md`），以及对应的中文贡献指南与更新日志。
- `assets/` 下的视觉资源（SVG 图标、点阵中英文横幅，以及本地 SVG 徽章），以及居中的 README 头部——不依赖任何外部图片或徽章服务，离线也能正常显示。
- 横幅重新设计：`Go` 使用小米橘色，`Model Picker` 使用本项目的绿色，除点阵的 `OpenCode`（字形改为统一基线、整数网格对齐）外，所有文字改用打字机等宽体（Courier）。
- 新增被 git 忽略的中文仓库初始化偏好指南 `zh/repo-init-guide-zh.md`。
- 在 README 中说明：出于隐私考虑，`AGENTS.md` 有意不提交；可共享的约定见 `CONTRIBUTING.md`。
- 扩充两份 README 的安装章节：新增「最小化安装」说明（只需 `SKILL.md` + `references/` + `scripts/`），以及一段供 AI Agent 安装用的复制粘贴提示词。
- 修正两份 README 中 `oh-my-opencode-slim` 的链接（原先错指向 `code-yeongyu/oh-my-openagent`，现改为 `alvinunreal/oh-my-opencode-slim`）。
- 新增 `scripts/check-docs.mjs`，用于校验相对链接与中英文档对是否同步，并在 `CONTRIBUTING`（中英）与本地 `AGENTS.md` 中说明用法。
- 中文 `CONTRIBUTING` 与 `CHANGELOG` 归入 `zh/`，并新增被 git 忽略的 `SKILL.md` 中文对读版 `zh/skill-zh.md`。
- 仓库文件：`LICENSE`（GPL-3.0-or-later）、`.gitignore`、`.gitattributes` 与 `CONTRIBUTING.md`。
- 新增明确的 `## Failure Modes (if → then → still failing)` 表格，覆盖快照写入竞争时的串行刷新、带日期的种子/缓存回退、非 Go 回退 id 的本地 registry `status` 核验，以及零智能体时的停止分支。
- 在输出闸门、首次使用的模式诊断与应用闸门处显示 🛑/🔴 检查点标记。

### 已变更

- 重写了两份 README，语气更自然易懂，并重新组织了结构，让人一眼能看懂项目在做什么。
- 明确范围：只对自定义智能体推荐模型；自定义智能体即使不支持回退链也在范围内。自带智能体按「包括但不限于」已知名单的方式跳过（OpenCode 各版本自带名单可能变化）。新增一条明确但可选的建议——使用支持回退链的工具。修正快照说明中把差异写成 `changed`（脚本实际只报告 `added` / `removed`）的措辞。
- 修正 `budget` 的回退顺序（最便宜的 Go → 次便宜的 Go），并把按来源的 Schema 规则明确为「自定义的原生智能体」。
- 刷新策略去重为单一事实来源（`Snapshot Cache` 章节）；Failure Modes 第 5 行消歧（明确区分 `deprecated` / `removed` 区块；缺少 `status` 字段表示默认启用）。
- 两份 README（中英）现在都写明了显式的失败路径处理。

### 修复

- `scripts/refresh-snapshot.mjs` 写入时不再丢弃 `preferences` 等顶层键，因此记住的推荐模式真正能够持久化；快照 `schemaVersion` 现在写入 `2`，与 `references/model-snapshot.md` 一致。
- `scripts/refresh-prices.mjs` 的输出现在区分种子覆盖情况（`seedUsed`）、已定价数量（`priced 40/42`）与上游为 `null` 的 id，不再给出误导性的 `matched` 数字。

[未发布]: https://github.com/sogeisetsu/opencode-go-model-picker/commits/main
[1.1.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.1.0
[1.0.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.0.0
