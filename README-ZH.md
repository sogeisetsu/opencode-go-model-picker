<p align="center">
  <img src="assets/icon.svg" width="112" height="112" alt="OpenCode Go 模型选择器图标">
</p>

<h1 align="center">OpenCode Go 模型选择器</h1>

<p align="center">
  <em>为 oh-my-opencode-slim 智能体做感知套餐的模型选择 —— 只读、有来源、可回退。</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-GPL--3.0--or--later-4B4646?style=flat-square" alt="许可证：GPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.0-03B000?style=flat-square" alt="版本 0.1.0">
  <img src="https://img.shields.io/badge/Node-%3E%3D18-4B4646?style=flat-square" alt="Node.js 18 或更新">
  <img src="https://img.shields.io/badge/OpenCode-Agent_Skill-4B4646?style=flat-square" alt="OpenCode 智能体技能">
  <img src="https://img.shields.io/badge/%E6%AC%A2%E8%BF%8E-PR-03B000?style=flat-square" alt="欢迎提交 PR">
</p>

<p align="center">
  <a href="README.md">英文文档</a>
</p>

<p align="center">
  <img src="assets/banner-zh.svg" alt="OpenCode Go 模型选择器横幅">
</p>

一份 [OpenCode](https://opencode.ai/) 的**智能体技能**：根据**最新的** OpenCode Go 套餐，为 [`oh-my-opencode-slim`](https://github.com/code-yeongyu/oh-my-openagent) 的每个智能体挑选高性价比的模型并给出回退链。默认**只读**，只有在用户确认后才会写入配置。

---

## 它是什么

OpenCode Go 的套餐变动非常频繁——每个模型有独立的月度美元额度、限时用量倍数，模型也会上架或被下线。任何硬编码的模型清单都会过期。本技能让智能体**每次运行都重新抓取套餐**，与你的当前配置对比，并为每个智能体推荐模型及有序回退链，且每个数字都附带**来源与抓取日期**。

它刻意保持保守：

- **绝不编造价格、额度或模型编号。** 无法核实的值一律标记为「待人工核实」。
- **默认只读。** 只产出预览，必须经你通过 OpenCode 的 `question` 工具确认后才写入。
- **以已安装插件的结构规范为准**，而不是随便一份在线文档。

## 前置要求

- 支持技能功能的 OpenCode（技能从 `~/.config/opencode/skills/` 加载）。
- [`oh-my-opencode-slim`](https://github.com/code-yeongyu/oh-my-openagent) **2.2.x**（该版本的结构规范是事实来源）。
- 仅当运行可选的目录抓取脚本时需要 Node.js **18+**（已在 Node 22 上测试）。

## 安装

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

## 用法

用自然语言提问即可。示例：

- “帮我按最新 Go 套餐给每个 oh-my-opencode-slim 智能体选模型。”
- “我现在的智能体模型配置还适合当前 Go 套餐吗？”
- “给我一份可直接粘贴的 OpenCode Go 预设配置，带回退链。”

智能体会读取你的配置、抓取套餐，并输出六段式报告：

1. **套餐快照** —— 与你相关的模型，附来源 + 抓取时间。
2. **变化提示** —— 新增/下架模型、额度或价格变化、进行中的促销。
3. **当前配置** —— 当前预设与各智能体的现有链路（只读）。
4. **推荐** —— 每个智能体的链路、成本档位与理由。
5. **可粘贴配置** —— 一份 JSONC 预设块。
6. **需人工核实** —— 所有未核实项及验证命令。

随后它会**停下并询问**，确认后才应用。

## 工作原理

技能由一份指令文件（`SKILL.md`）加若干按需加载的参考文档组成。一次运行时，智能体会：

1. **读取当前设置**（只读）：`~/.config/opencode/oh-my-opencode-slim.json`（及 `.jsonc`）、`opencode.jsonc`，以及已安装插件的 `oh-my-opencode-slim.schema.json`。
2. **抓取套餐**（见下方来源）并构建快照。
3. **检测变化**，与上一次快照对比（如有）。
4. **按角色分配模型**，依据 `SKILL.md` 中的角色与特质对应策略。
5. **构建回退链** —— 有序的 `model: [a, b, c]` 故障转移列表（2 至 4 项）。
6. **输出**六段式报告，并在写入前**征询确认**。

机制背景：

- Go 额度是**按模型计的月度美元金额**；整体窗口为 5 小时 = 20%、每周 = 50%、每月 = 100%。因为额度按模型独立计算，某个模型被限流时另一个 Go 模型仍然可用——这正是第一层回退常常选择另一个 Go 模型的原因。
- 形如 `model: ["a", "b", "c"]` 的数组是有序故障转移链（依据 `oh-my-opencode-slim` 2.2.x 的 `ForegroundFallbackManager` 核实）。若**所有**条目都失败，会话会中止——因此链尾应当是用户真正可以依赖的模型。
- 能力必须从模型**所属实验室的官方文档**核实，绝不从名字推断——这对 `observer` 智能体需要的**视觉**输入尤其重要。

## 数据来源

每次运行都重新抓取；完整清单与解析注意事项见 [`references/data-sources.md`](references/data-sources.md)。

| 优先级 | 来源 | 网址 | 提供内容 |
|---|---|---|---|
| 1 | Go 落地页 | https://opencode.ai/go | 最新促销 + 精选用量表 |
| 2 | Go 文档 | https://opencode.ai/docs/go/ | 完整模型 / 价格 / 月度额度表 |
| 3 | 模型端点 | https://opencode.ai/zen/go/v1/models | 实时目录编号（经 `scripts/fetch-go-models.mjs`） |
| 4 | models.dev | https://models.opencode.ai/providers/opencode-go/ | 上下文 / 输出 / 价格 / 能力 |
| 5 | julien.cloud 追踪 | https://julien.cloud/opencode-go-models/ | 合并视图 + 价格变动 / 弃用日志 |

## 安全与隐私

- **默认只读。** 在你确认之前，技能不会编辑 `oh-my-opencode-slim.json`、`opencode.jsonc` 或任何配置；确认之后会展示确切的改动。
- **本地读取：** `~/.config/opencode/` 下的 OpenCode 配置文件，以及已安装插件的结构规范。
- **网络访问：** 抓取上述公开页面，并通过本地 Node 脚本调用 `opencode.ai` 的免鉴权模型端点。不发送凭据，也不发送个人数据。
- **不编造数字：** 每个数值都带来源与抓取日期；无法核实的值标记为「待人工核实」。
- **非官方。** 本项目与 OpenCode、SST 或任何模型厂商均无隶属、背书或赞助关系。模型名称与价格归各自所有者。

## 参与贡献

欢迎贡献。详见 [`CONTRIBUTING-ZH.md`](CONTRIBUTING-ZH.md)。

## 更新日志

详见 [`CHANGELOG-ZH.md`](CHANGELOG-ZH.md)。

## 许可证

基于 **GNU 通用公共许可证第 3 版或更新版本**（`GPL-3.0-or-later`）授权。见 [`LICENSE`](LICENSE)。

## 由来

本项目源于 2026 年 9 月的一次调研：当时没有任何官方或知名技能能做“感知套餐的 OpenCode Go 智能体模型选择”。最接近的同类是面板生成器 [`itsmylife44/cliproxyapi-dashboard`](https://github.com/itsmylife44/cliproxyapi-dashboard)（`oh-my-opencode-slim-config-generator.tsx`，MIT 许可），以及成本画像需求 [`code-yeongyu/oh-my-openagent#1768`](https://github.com/code-yeongyu/oh-my-openagent/issues/1768)。这里复用了 OpenCode Go 的官方数据来源，以及 `oh-my-opencode-slim` 静态的按智能体角色指引。
