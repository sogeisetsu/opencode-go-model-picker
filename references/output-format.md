# Output Format

Follow this structure exactly. Keep it scannable.

## 1. 套餐快照 (Plan Snapshot)
- Sources used + fetch timestamp.
- Table of only the models relevant to this user:
  `model | input$/1M | output$/1M | monthly $ limit | est req/5h | context | reasoning | vision | status`.

## 2. 变化提示 (What Changed)
New/removed models, changed limits/prices, active limited-time promos vs. the last
snapshot. If first run, say "首次运行，无历史对比".

## 3. 当前配置 (Current)
The active `preset` and each agent's current chain (read-only), one row per agent.

## 4. 推荐 (Recommendation)
`| agent | recommended chain | cost tier | why |`
Explain the cost signal (monthly limit + $/1M) and capability fit per agent.

## 5. 可粘贴配置 (Paste-ready)
A JSONC block to use as a preset, including:
- `$schema`
- `"preset": "<name>"`
- `"presets": { "<name>": { ...agents... } }`

Keep model ids exact (`opencode-go/<id>`). Do not include unrelated keys.

## 6. 需人工核实 / Verify
- List every unverified item (`需人工核实`).
- Commands to verify: `opencode models --refresh`, `/models`, `opencode debug config`.
- State that changes apply on the next OpenCode run/restart.

## Apply gate
End by asking the user (via the `question` tool) whether to apply the snippet to
`~/.config/opencode/oh-my-opencode-slim.json`. Do NOT edit config before confirmation.
