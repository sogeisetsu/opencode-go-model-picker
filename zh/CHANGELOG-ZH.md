# 更新日志

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，且本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

[英文版](../CHANGELOG.md)

## [3.0.0] - 2026-11-01

### 破坏性变更

- **单一入口。** `scripts/go.mjs` 取代了十一个脚本——`discover-agents`、`probe-console`、`calibrate-usage`、`quota-math`、`refresh-snapshot`、`refresh-prices`、`refresh-scores`、`snapshot-summary`、`fetch-go-models` 全部移除。四个动词：`run`（盘点 agent → 探 Console → 读本地用量 → 刷数据 → 比套餐变化 → 定 Basis，一次串行产出 `run.json`）、`report`（表格、金额列、配置块）、`check`（交付前的机检闸门）、`apply`（精确 diff；只有带 `--write` 才写，只写用户点名的那个文件，只改该 agent 的 `model`）。
- **一份 reference。** `references/plan-facts.md` 取代 `quota-math.md`、`model-snapshot.md`、`data-sources.md`、`agent-sources.md`、`console-mcp.md` 与 `output-format.md`。`SKILL.md` 从约 19k 字符降到约 4k，只面向模型；教学性内容移入 README。
- **能写进代码的就不写进散文。** 刷新顺序（三个写入者共用一个快照文件）、`Basis:` 行与分母、计价 `$/session` 列、回退链形状规则、种子过期判定、模式决议与 apply 的 diff 全部由代码计算。原来的九条自查变成 `go.mjs check`。
- `apply` 会拒绝包含死 id 的链，也会拒绝写入一个无法重新解析的结果。

### 新增

- `node --test tests/*.test.mjs`（内置 `node:test`，不引入任何依赖）：`tests/golden/` 保存了从 2.0.0 脚本录制的金标，覆盖计价、agent 盘点与 Console 五态；CLI 测试覆盖离线降级、报告闸门，以及 dry-run 与 `--write` 的差别。
- `run --offline` 始终产出自带日期、标注为 seed 的 `run.json`；`data.quality` 直接给出 `live` / `seed` / `none`，不再让读者自己推断。

### 已变更

- `scripts/check-docs.mjs` 与 `scripts/generate-assets.mjs` 移到 `tools/`：它们维护仓库，不属于技能运行时，也不进最小安装包。
- 把 `test-prompts.json` 移到 `tests/prompts.json`，并在仓库结构表里说明它是评测夹具（一句请求配一段技能必须表现出的行为），不是运行时资产——没有任何代码加载它。

## [2.0.0] - 2026-10-30

### 新增

- `references/quota-math.md` 与 `scripts/quota-math.mjs`：唯一的计价实现。v2 公式按每条 assistant message 自己的时间戳计价；模型有上下文分档时，按该请求的 prompt 长度选档；峰谷倍数只作用于声明了峰谷的模型；只有真正收取缓存写入费的模型才计 `p_cw`。推理 token 按输出价计费（逐条与提供方返回的单条成本核对，漏掉会少算 4–34%）。同时定义派生量（占单模型额度、三个互相独立的池窗口、各窗口可跑会话数、官方容量与实测容量）、池子反解顺序、8 个已知缺口，以及每个字段缺失时的降级规则。
- `references/console-mcp.md` 与 `scripts/probe-console.mjs`：Console MCP 的五态（`authorized` / `gated` / `unauthenticated` / `absent` / `unknown`），按成本升序判定（本次运行的工具结果 → `opencode mcp list` → 配置文件 → 一次 `initialize` 请求）；附带按 state 分支的固定引导文案、三级保底方案，以及 OpenCode CLI 与 OpenChamber 的开启步骤。探测过程绝不打印 token，也绝不把网络故障判成「没配置」。
- `scripts/calibrate-usage.mjs`：汇总本地 OpenCode SQLite 数据库的按智能体 / 按模型花费，与 Console 自己的账单相比测出 bias（漂移超过 10% 告警），按文档规定的顺序反解计划池，按计费周期外推月末占用，并在 `--write` 时把 `plan`、`models.<id>.billing`、`usage.agentSplit`、`calibration` 写进快照。
- `references/model-prices.json` 新增 `cacheWritePer1M`、`ctxTiers`、`capUsd`、`peak`、`promoUntil` 与逐模型 `status`，并补齐本轮 `planVerifiedAt`。它现在是价格、额度、上下文分档与峰谷时段的唯一存放处。
- 快照 schema v3：新增 `plan.go`、`models.<id>.billing`、`availability`、`capabilities`（每个能力自带 `source` 与 `verifiedAt`）、`usage.agentSplit`、`calibration`。
- `scripts/discover-agents.mjs` 现在输出运行级 `deadChainIds` 汇总（`missing-from-catalog`、`retired`、`registry-missing`、`registry-deprecated`），对共用链头的智能体给出 `contention` 警告（Go 额度按模型计，会被分摊），并在 Go id 的目录状态为已退役时逐个智能体给出 `catalog` 警告。
- `references/data-sources.md` 新增 Console 账单（优先级 0）、两层额度、官方请求数与实测请求数、以及带日期的能力 / 合规表（图像输入、训练、留存、可用地区）。
- `quota-math.mjs` 会报告价格种子的新鲜度——`verifiedAt`（表中最新的 `planVerifiedAt` / `priceVerifiedAt`）、`ageDays` 与 `stale`——并把超过 7 天的种子标为已过期，让离线运行给数字贴日期而不是当成当前值。`calibrate-usage.mjs` 在 `prices` 字段里报告同样的信息。

### 已变更

- 报告开头强制一行 `Basis:`（`Console bill (authoritative)` / `Estimate` / `Uncalibrated`），全表同一分母；表格列改为计价列：头部额度、记账 `$/session`（中位 · P90）、占该模型额度、10 次占三个池窗口的比例、实际月占用、理由。
- 新增强制的 `Usage evidence` 段：近 30 天花费与请求数、近 7 天节奏与月末预测、无 ELO 候选数量、本次运行的死链 id、主智能体花费占比。
- `SKILL.md` 工作流重排为：发现智能体 → 探测 Console → 读账单并校准 → 刷新快照 → 检测套餐变化 → 分配 → 建链 → 输出 → 停止，并在末尾新增 9 条自检。
- `scripts/refresh-prices.mjs` 从 models.dev 读取缓存写入价格与上下文分档，并在重写时保留套餐侧常量（`capUsd` / `monthlyLimitUsd`、`peak`、`promoUntil`、`estReq*`、`status`），重新生成种子不再把它们删掉。
- `calibrate-usage.mjs --write` 在写入 v3 键时把 `schemaVersion` 提到 3；已有的 v2 文件原样可读（v3 的每个键都是可选的）。
- `references/agent-sources.md` 明确：原生 `agent.<name>.model` 无法表达模型链，需要故障转移时应改用支持链的来源。
- 按 2026-10-30 的套餐页面更正 2026-09/10 的过期事实（DeepSeek V4.1 Flash 的 4 倍促销已结束，额度改为 $80，改为峰谷计价）。

### 破坏性变更

- 输出格式：旧表格列（职责介绍、能力侧重、当前模型）被计价列取代，且 `Basis:` 行成为强制项。v1 的报告形状不再有效。
- 快照 schema v2 → v3。旧文件仍可读，但新字段在 `calibrate-usage.mjs --write` 运行前为 `null`。
- `references/model-prices.json` 单条记录字段从 16 个增至 21 个；直接读取该种子的代码需要容忍新字段。
- `SKILL.md` 工作流编号变了，任何「第 2 步 = 刷新快照」的说法现在指向 Console 探测。

## [1.4.0] - 2026-10-17

### 新增

- 新增 `scripts/lib/json-io.mjs` 与 `scripts/lib/proxy.mjs`：给各脚本共用的零依赖工具——容忍 BOM 的 JSON 读取、原子写入（写同目录临时文件再 rename 覆盖），以及此前只存在于 `refresh-scores.mjs` 里的 `NODE_USE_ENV_PROXY` re-exec。现在四个联网脚本都支持系统代理；运行时若不支持该变量，会在 stderr 明确提示，而不是表现得像网络故障。
- `scripts/discover-agents.mjs` 现在会输出 `references/agent-sources.md` 承诺的完整 inventory 记录：`mode`、`hidden`、`traits`（由 description + name + mode 推导，含已知角色覆盖）、以及 `provenance.fetchedAt`；被跳过的内置名字会列在 `skippedBuiltins` 里，不再无声消失。
- 新增标志：`--include-builtin-names`、`--builtin`、`--extra-builtin`（`discover-agents.mjs`）与 `--rebuild`（`refresh-snapshot.mjs`）。

### 已变更

- `scripts/refresh-*.mjs` 改为原子写入快照，并拒绝重建读不出来的快照：无法解析的快照会以清晰报错退出 1，原文件（连同其中的 `preferences.mode` 与缓存的评分/价格）保持不变，而不是静默地从空缓存开始。需要故意丢弃时用 `refresh-snapshot.mjs --rebuild`。
- 版本徽章改为从 `SKILL.md` 的 `metadata.version` 生成，`check-docs.mjs` 也会校验徽章与两份 CHANGELOG 是否与之一致；像「技能已是 1.3.0、徽章还停在 1.2.0」这种已提交的漂移不会再悄悄发生。
- `SKILL.md` 工作流第 2 步写明：三条刷新命令必须串行执行，绝不要作为并行的工具调用——它们写的是同一个快照。
- `references/agent-sources.md` 说明了内置名字拒绝清单（以及为什么被跳过的名字要报告而不是丢弃）与特征推导的优先级。

### 已修复

- 已知角色的特征覆盖改为大小写不敏感匹配：`Observer.md` 与 `observer.md` 一样解析为视觉通道，而不再退回到按 description 推导的信号。
- `readJsonFile`（因此所有刷新脚本）只把 `ENOENT` 当作「文件不存在」：权限或共享冲突属于错误，所以「文件存在但读不出来」绝不会被替换成一份新快照。原子替换失败时（Windows 上文件被占用）会报出路径并说明旧文件完好，而不是抛裸的系统错误。
- `SKILL.md` 第 1 步要求运行期读取 `discover-agents.mjs` 的 `skippedBuiltins`，对可能是用户自定义智能体的条目要问用户，让这份可见性真正被用起来。
- 代理警告的触发范围改为「低于已实测版本（22.23.1）的所有运行时」，而不再只是 22 以下的大版本。

## [1.3.0] - 2026-10-04

### 新增

- 新增 `scripts/discover-agents.mjs`：只读、零依赖的 CLI，发现自定义智能体（slim 预设 + 原生智能体）并校验回退链——重复 id、链长 2–4、本地 registry 中无法确认的非 Go id，以及 `vision` 特征智能体的快照 `vision` 字段未置位（这是字段检查，不是能力核实——铁律 5 仍要求查实验室自己的文档）。输出紧凑的 `{ agents, warnings }` JSON，不必再逐个手读配置文件。
- 新增 `scripts/snapshot-summary.mjs`：只读的紧凑摘要，替代约 1,580 行的 `snapshot.json` 整读（行数减少约 97%）。支持 `--ids`（只看指定模型 id）、`--trait`（按特征重排并标出相关列，但不丢弃任何模型）、`--json`（同一摘要的紧凑 JSON）；缺失值输出 `-` / `null`，绝不猜测，任何文件错误都是一行 `{"error": ...}` 加非零退出码。
- 推荐表新增**职责介绍**列：一行白话说明每个智能体是干什么的，取自其 `description`，没有时用 `references/agent-sources.md` 中的已知角色基线，并按用户的语言渲染。

### 已变更

- 工作流第 4 步以**支配性检查**收尾：在同一次运行的快照内，某个链路槽位上的模型若在价格 + 吞吐 + 与特征匹配的能力（对应智能体特征的 ELO 榜；缺失值视为「不可比」）三个维度都不更差、且至少一个维度严格更好，就替换掉被支配的模型；保留被支配模型时必须在 `why` 列说明理由（例如跨 provider 配额回退）。
- 补充了 Windows 下刷新失败的处理路径：任何 `scripts/refresh-*.mjs` 之前先设置 `$env:NODE_USE_ENV_PROXY=1`；成败以脚本 stdout 的 JSON 判断，而非退出码或 stderr 噪音；stdout 出现 `catalog.error: "fetch failed"` 才是真正失败。

### 已修复

- 更新 `references/data-sources.md` 的视觉核实记录（2026-10-03）：`mimo-v2.6-flash`、`mimo-v2.6-pro` 与 `deepseek-v4.1-flash` 支持图像输入，并为 DeepSeek 写清 Go 目录 id / 实验室版本名 / API 请求模型 id 三者的区分，另附 JS 渲染实验室页面的回退解析说明。

## [1.2.0] - 2026-09-29

### 已变更

- 按渐进式披露重构 `SKILL.md`：正文变成**决策面**（约 158 行，原为 325 行），而不再是 `references/` 的摘要。所有与参考文档重复的内容都归到唯一归属处——快照刷新机制与种子归属归 `references/model-snapshot.md`，端点表与快照形状归 `references/data-sources.md`，特征推导信号归 `references/agent-sources.md`，首次运行的模式裁决表归 `references/output-format.md`。
- 每个较长的参考文档都加了章节清单；`SKILL.md` 新增 `## References — read when` 表格，把每个文件对应到需要它的工作流步骤。逐症状的失败分支移出正文，改为 `references/model-snapshot.md` 与 `references/data-sources.md` 中的 `## Failure handling` 章节；正文只保留规则（绝不即兴编数字、使用带日期的回退、未覆盖的先报告）。
- 从常驻加载的文本中移除易变事实：写死的视觉模型 id、配套的核实日期与价格声明、balanced 基线模型名、frontmatter 里的 `oh-my-opencode-slim 2.2.x` 版本钉死，以及关于回退管理器的版本断言（两份 README 也不再钉死版本号）。带日期的证据留在参考文档里。
- 恢复按来源的 schema 字段清单（原生 `agent.<name>` 字段、slim 的 `model` / `fallback` 键、`tools` 已弃用），落在 `references/agent-sources.md` 的「Per-source schema fields」章节——这正是 `SKILL.md` 早已指向、却在重构中被清空的章节。
- 有意保持不变：六条铁律、🛑 应用闸门及其四步、特征表、已知角色覆盖、三种模式及其能力下限、balanced 价格上限，以及回退链规则。`zh/skill-zh.md` 已同步。

## [1.1.0] - 2026-09-26

### 已变更

- 报告输出格式从六段式报告改为**三段正文 + 数据附录**：**推荐表**（每个自定义智能体一行——智能体名称、能力侧重（trait）、当前模型、推荐模型，以及成本 / 吞吐 / 能力层面的理由，限时、地理或训练相关的注意事项用 ⚠ 标出）、**可粘贴配置**（针对每个检测到的来源给出一段完整、可直接复制粘贴的 JSONC——slim 预设对应 `oh-my-opencode-slim.json`，原生 `agent` 块对应 `opencode.jsonc`，两者都检测到就两段都给；来源支持回退链的会保留链路）、**要点说明**（一段话覆盖模式与理由、价格上限、完整的注意事项原文，以及与上次快照相比的套餐变化），随后是**数据附录**（来源与抓取日期并标注种子、快照差异、相关模型价格表、首次使用的决策因素表、待人工核实清单，以及验证命令）。应用闸门保持不变：技能仍然会**停下来问你**，确认后才动配置。已在 `README.md` / `README-ZH.md`、`CONTRIBUTING`（中英）、`docs/index.html` 与 `test-prompts.json`（现已移到 `tests/prompts.json`）中同步。

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
[1.4.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.4.0
[1.3.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.3.0
[1.2.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.2.0
[1.1.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.1.0
[1.0.0]: https://github.com/sogeisetsu/opencode-go-model-picker/releases/tag/v1.0.0
