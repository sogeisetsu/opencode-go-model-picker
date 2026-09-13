<p align="center">
  <img src="assets/icon.svg" width="112" height="112" alt="OpenCode Go Model Picker 图标">
</p>

<h1 align="center">OpenCode Go Model Picker</h1>

<p align="center">
  <em>为 OpenCode 智能体（原生、oh-my-opencode-slim 或插件注入）做感知套餐的模型选择 —— 只读、有来源、可回退。</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="assets/badges/license.svg" alt="许可证：GPL-3.0-or-later"></a>
  <img src="assets/badges/version.svg" alt="版本 0.1.0">
  <img src="assets/badges/node.svg" alt="Node.js 18 或更新">
  <img src="assets/badges/agent-skill.svg" alt="OpenCode Agent Skill">
  <img src="assets/badges/prs-welcome.svg" alt="欢迎提交 PR">
</p>

<p align="center">
  <a href="README.md">英文文档</a>
</p>

<p align="center">
  <img src="assets/banner-zh.svg" alt="OpenCode Go Model Picker 横幅">
</p>

一份 [OpenCode](https://opencode.ai/) 的**智能体技能**：根据**最新的** OpenCode Go 套餐，为你的 OpenCode 智能体——定义在 `opencode.jsonc` 或 `~/.config/opencode/agents/` 下的原生智能体、[`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim) 预设，以及其他注入智能体的插件——挑选高性价比的模型并给出回退链。默认**只读**，只有在用户确认后才会写入配置。

---

## 它是什么

OpenCode Go 的套餐变动非常频繁——每个模型有独立的月度美元额度、限时用量倍数，模型也会上架或被下线。任何硬编码的模型清单都会过期。本技能让智能体**每次运行都重新抓取套餐**，与你的当前配置对比，并为每个**自定义**智能体推荐模型（若工具支持，则给出有序回退链），且每个数字都附带**来源与抓取日期**。OpenCode 自带的智能体——Build、Plan 以及自带 subagent——有意不动。

它刻意保持保守：

- **绝不编造价格、额度或模型编号。** 无法核实的值一律标记为「待人工核实」。
- **默认只读。** 只产出预览，必须经你通过 OpenCode 的 `question` 工具确认后才写入。
- **以已安装插件的结构规范为准**，而不是随便一份在线文档。

## 前置要求

- 支持技能功能的 OpenCode（技能从 `~/.config/opencode/skills/` 加载）。
- 需要纳入的 OpenCode 智能体：原生智能体、[`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim) **2.2.x**（可选——只是受支持的来源之一；其已安装的结构规范是事实来源），或其他注入智能体的插件。
- 仅当运行可选的目录抓取脚本时需要 Node.js **18+**（已在 Node 22 上测试）。

## 安装

直接把仓库克隆进 OpenCode 的技能目录，使文件夹名与技能的 `name` 一致：

**Linux / macOS**
```bash
git clone https://github.com/sogeisetsu/opencode-go-model-picker.git \
  ~/.config/opencode/skills/opencode-go-model-picker
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/sogeisetsu/opencode-go-model-picker.git `
  "$env:USERPROFILE\.config\opencode\skills\opencode-go-model-picker"
```

**最小化安装。** 不需要整个仓库——运行时只用到 `SKILL.md`、`references/` 和 `scripts/` 这三样。只把它们复制到 `~/.config/opencode/skills/opencode-go-model-picker/` 即可，还能省空间；其余内容（README、LICENSE、`assets/`、`zh/` 等）只是文档。

验证脚本可运行：

```bash
node scripts/fetch-go-models.mjs   # 输出 { fetchedAt, source, count, ids }
```

### 让 AI Agent 帮你安装

把下面这段复制粘贴给你的 AI Agent：

```text
帮我安装 "OpenCode Go Model Picker" 这个技能。

1. 获取仓库：https://github.com/sogeisetsu/opencode-go-model-picker
2. 只把下面这些复制到我的全局 OpenCode 技能目录
   （~/.config/opencode/skills/opencode-go-model-picker/）：
   - SKILL.md
   - references/
   - scripts/
3. 不要复制仓库里的其他内容（README、LICENSE、assets 等）。
4. 验证：在安装目录里运行 "node scripts/fetch-go-models.mjs"，确认能输出 JSON。
5. 告诉我安装路径以及是否成功。
```

## 用法

用自然语言提问即可。示例：

- “帮我按最新 Go 套餐给每个智能体选模型。”
- “我现在的智能体模型配置还适合当前 Go 套餐吗？”
- “给我一份可直接粘贴的 OpenCode Go 预设配置，带回退链。”
- “我的智能体定义在 `opencode.jsonc` 里，帮我推荐模型。”
- “用穷鬼模式（budget），尽量帮我选最便宜的模型。”

三种模式在**性能与价格**之间取舍：`budget`（省钱，能接受的最低价）、`balanced`（默认，性价比最优）、`quality`（最佳性能）。在提问时点名模式即可；不点名则用 `balanced`。

智能体会读取你的配置、抓取套餐，并输出六段式报告：

1. **套餐快照** —— 与你相关的模型，附来源 + 抓取时间。
2. **变化提示** —— 新增/下架模型、额度或价格变化、进行中的促销。
3. **当前配置** —— 从所有来源发现的每个智能体及其现有链路（只读）。
4. **推荐** —— 每个智能体的链路、成本档位与理由。
5. **可粘贴配置** —— 一份 JSONC 预设块。
6. **需人工核实** —— 所有未核实项及验证命令。

随后它会**停下并询问**，确认后才应用。

## 工作原理

技能由一份指令文件（`SKILL.md`）加若干按需加载的参考文档组成。一次运行时，智能体会：

1. **发现智能体**（只读）：来自 `opencode.jsonc` / `~/.config/opencode/agents/*.md` 的原生智能体、`oh-my-opencode-slim` 预设（用已安装的结构规范校验），以及你声明的其他插件来源。适配器模型、inventory 记录与角色特征映射见 [`references/agent-sources.md`](references/agent-sources.md)。
2. **刷新模型快照**：对 `~/.cache/` 下的缓存文件运行 `scripts/refresh-snapshot.mjs`，抓取实时目录并返回紧凑的新增/下架差异。LiveBench 评分会被缓存，按 7 天 TTL 刷新。
3. **抓取套餐**，只重新核实差异标出的模型，其余复用缓存。
4. **按角色特征分配模型**（含已知角色覆盖）——策略见 `SKILL.md`。
5. **构建回退链** —— 有序的 `model: [a, b, c]` 故障转移列表（2 至 4 项）。
6. **输出**六段式报告，并在写入前**征询确认**。

机制背景：

- Go 额度是**按模型计的月度美元金额**；整体窗口为 5 小时 = 20%、每周 = 50%、每月 = 100%。因为额度按模型独立计算，某个模型被限流时另一个 Go 模型仍然可用——这正是第一层回退常常选择另一个 Go 模型的原因。
- 形如 `model: ["a", "b", "c"]` 的数组在 `oh-my-opencode-slim` 2.2.x 中是有序故障转移链（依据 `ForegroundFallbackManager` 核实）。若**所有**条目都失败，会话会中止——因此链尾应当是用户真正可以依赖的模型。原生 OpenCode 智能体只接受单个 `model`，因此对它们本技能只推荐一个模型，并说明无法表达回退链。任何支持模型链的其他工具同样适用——使用 `oh-my-opencode-slim` 只是一个建议，而非必须。
- 能力必须从模型**所属实验室的官方文档**核实，绝不从名字推断——这对视觉类智能体（如 `observer`）需要的**视觉**输入尤其重要。
- **省 token：** 一份缓存快照（`~/.cache/opencode/opencode-go-model-picker/snapshot.json`）保存归一化后的目录与模型评分，每次运行只重新抓取并核实发生变化的部分。缓存绝不取代来源——每个值都带来源与抓取日期。见 [`references/model-snapshot.md`](references/model-snapshot.md)。

## 数据来源

每次运行都重新抓取；完整清单与解析注意事项见 [`references/data-sources.md`](references/data-sources.md)。

| 优先级 | 来源 | 网址 | 提供内容 |
|---|---|---|---|
| 1 | Go 落地页 | https://opencode.ai/go | 最新促销 + 精选用量表 |
| 2 | Go 文档 | https://opencode.ai/docs/go/ | 完整模型 / 价格 / 月度额度表 |
| 3 | 模型端点 | https://opencode.ai/zen/go/v1/models | 实时目录编号（经 `scripts/fetch-go-models.mjs`） |
| 4 | models.dev | https://models.opencode.ai/providers/opencode-go/ | 上下文 / 输出 / 价格 / 能力 |
| 5 | julien.cloud 追踪 | https://julien.cloud/opencode-go-models/ | 合并视图 + 价格变动 / 弃用日志 |
| 6 | LiveBench（排名） | https://livebench.ai/ | Overall + 各分类分 + 每次成功任务成本（缓存；7 天 TTL） |

## 安全与隐私

- **默认只读。** 在你确认之前，技能不会编辑 `oh-my-opencode-slim.json`、`opencode.jsonc`、智能体 Markdown 文件或任何配置；确认之后会展示确切的改动。
- **本地读取：** `~/.config/opencode/` 下的 OpenCode 配置文件（含 `agents/`），以及已安装插件的结构规范。
- **网络访问：** 抓取上述公开页面，并通过本地 Node 脚本调用 `opencode.ai` 的免鉴权模型端点。不发送凭据，也不发送个人数据。
- **不编造数字：** 每个数值都带来源与抓取日期；无法核实的值标记为「待人工核实」。
- **非官方。** 本项目与 OpenCode、SST 或任何模型厂商均无隶属、背书或赞助关系。模型名称与价格归各自所有者。

## 参与贡献

欢迎贡献。详见 [`CONTRIBUTING-ZH.md`](zh/CONTRIBUTING-ZH.md)。

说明：出于个人隐私，本项目有意**不**把 `AGENTS.md` 提交进仓库（与常见约定不同）。可共享的项目约定见 [`CONTRIBUTING-ZH.md`](zh/CONTRIBUTING-ZH.md)。

## 更新日志

详见 [`CHANGELOG-ZH.md`](zh/CHANGELOG-ZH.md)。

## 许可证

版权所有（C）2026 sogeisetsu

基于 **GNU 通用公共许可证第 3 版或更新版本**（`GPL-3.0-or-later`）授权。

本程序为自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证条款，对本程序进行再发布及/或修改，许可版本为第三版，或（随你选择）任何更新的版本。发布本程序的目的是希望它有用，但不提供任何担保；甚至不保证其具有经济价值或适合特定用途。详情参见 GNU 通用公共许可证。

完整文本见 [`LICENSE`](LICENSE)（英文原文，具法律效力），或查阅 [`zh/LICENSE-ZH.md`](zh/LICENSE-ZH.md)（非官方中文参考译本）。

## 由来

本项目源于 2026 年 9 月的一次调研：当时没有任何官方或知名技能能做“感知套餐的 OpenCode Go 智能体模型选择”。最接近的同类是面板生成器 [`itsmylife44/cliproxyapi-dashboard`](https://github.com/itsmylife44/cliproxyapi-dashboard)（`oh-my-opencode-slim-config-generator.tsx`，MIT 许可），以及成本画像需求 [`code-yeongyu/oh-my-openagent#1768`](https://github.com/code-yeongyu/oh-my-openagent/issues/1768)。这里复用了 OpenCode Go 的官方数据来源，以及 `oh-my-opencode-slim` 静态的按智能体角色指引。后来从“仅支持 `oh-my-opencode-slim`”扩展为支持任意 OpenCode 智能体来源——见 [`references/agent-sources.md`](references/agent-sources.md)。
