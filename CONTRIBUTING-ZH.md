# 参与贡献

感谢你有兴趣改进 OpenCode Go Model Picker。这是一个小而专注的项目，因此最容易被接纳的贡献，是那些保持其设计原则不变的改动。

[英文版](CONTRIBUTING.md)

## 基本原则

1. **绝不编造价格、额度或模型编号。** 推荐中的每个数字都必须来自抓取到的来源，并附带来源与抓取日期。无法核实的值应标记为待人工核实，而不是猜测。
2. **默认保持只读。** 技能绝不能在没有预览和明确确认的情况下编辑用户配置。
3. **以已安装插件的结构规范为准**，而不是随便一份在线文档。事实来源是随已安装插件版本一起提供的 `oh-my-opencode-slim.schema.json`。
4. **从模型所属实验室的官方文档核实能力**，绝不从名字推断。这对 `observer` 智能体所需的视觉输入尤其重要。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `SKILL.md` | 技能本体：frontmatter、铁律、工作流、分配策略、回退策略、结构规范说明。 |
| `references/data-sources.md` | 从哪里抓取实时套餐数据，以及如何解析。 |
| `references/output-format.md` | 技能必须产出的六段式报告的具体格式。 |
| `scripts/fetch-go-models.mjs` | 辅助脚本：把实时模型目录输出为 JSON。 |
| `scripts/generate-assets.mjs` | 重新生成 SVG 图标、横幅与本地徽章。 |
| `README.md` / `README-ZH.md` | 英文与中文文档。 |
| `assets/` | README 头部使用的 SVG 图标、横幅与本地徽章。 |

## 进行改动

1. 复刻仓库并新建分支。
2. 完成改动。如果你改动了 `SKILL.md`，请让 `references/` 与两份 README 与其保持一致。
3. 按下文进行验证。
4. 提交拉取请求，说明改了什么、为什么。

## 验证改动

本项目没有构建步骤或测试套件。请手动验证：

```bash
node --check scripts/fetch-go-models.mjs   # 语法检查
node scripts/fetch-go-models.mjs           # 确认端点仍然可用
```

如果你改动了工作流或输出结构，请对照 `references/output-format.md` 在心里走一遍流程，确认六个章节仍然都能产出。如果你改动了模型指引，请对照 `references/data-sources.md` 中列出的来源重新核实相关论断，并更新“已核实日期”的标注。如果你手工编辑了 `assets/` 下的任何 SVG，建议改为编辑 `scripts/generate-assets.mjs` 并重新运行 `node scripts/generate-assets.mjs`，让资源保持可复现。

## 报告问题

请附上：

- 你使用的提示词，以及你的预期与实际结果。
- 你的 OpenCode 版本和已安装的 `oh-my-opencode-slim` 版本。
- 任何相关输出（请先移除敏感信息）。

## 贡献的许可

一旦贡献，即表示你同意你的贡献按本项目的许可证 **GPL-3.0-or-later** 授权（见 [`LICENSE`](LICENSE)）。
