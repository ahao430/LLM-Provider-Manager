# Agent 兼容性模型

## 定位

LCM 为 Agent（Claude Code、Codex、其他 Coding Agent）提供渠道兼容性信息，但**不改变 Agent 的原生调用行为**：

- 不做协议转换（Anthropic ↔ OpenAI、Chat Completions ↔ Responses）。
- 不自动修改请求体、注入 Prompt、注入影响模型行为的 Header。
- 不自动调整参数、转换 Tool Calls、重组 Thinking、转换流式事件。
- 不自动补全接口能力、切换模型或渠道、自动重试。

Agent 直接使用渠道原生 API；如果 Agent 直接访问渠道，LCM 不会为了监控而偷偷插入代理。

## 兼容性记录

每个渠道可维护 Agent 兼容性记录（`agent_compatibility` 表）：

| Agent | 状态 |
|---|---|
| Claude Code | supported / unsupported / unverified |
| Codex | supported / unsupported / unverified |
| 其他 Agent | supported / unsupported / unverified |

要求：

1. 状态必须来自**实际测试或可靠证据**（`evidence` + `tested_at`）。
2. 不能因为渠道声称「兼容 OpenAI / Anthropic」就认定它兼容对应 Agent 的全部功能。
3. 不兼容时如实展示原因与测试证据，不通过 Adapter 掩盖差异。

## 常见不兼容情况

- 渠道只支持 OpenAI Chat Completions，Agent 需要 Anthropic Messages。
- 渠道不支持特定 Tool Call 格式或 Agent 所需的流式事件。
- 渠道缺少必要参数或 Header。

LCM 的职责是让用户**在配置 Agent 之前**知道这些事实。

## 模块边界

- `src-tauri/src/agent/` 只负责：兼容性信息管理、使用说明、原生配置生成或导出（用户确认后执行）、兼容性测试结果展示。
- `agent/` 不得依赖 `adapters/`，由 `src-tauri/tests/architecture_boundaries.rs` 自动化测试强制执行。

详见 [adapter-boundaries.md](./adapter-boundaries.md)。
