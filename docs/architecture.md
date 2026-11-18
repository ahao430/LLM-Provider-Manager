# 系统架构

本文档描述 LCM 的整体架构。产品层面的完整设计见 [PLAN.md](../PLAN.md)，模块边界细则见 [adapter-boundaries.md](./adapter-boundaries.md)。

## 分层

```text
┌──────────────────────────────────────────────┐
│                  React UI                    │
│  Dashboard / Channels / API Testing / Image  │
│  Request History / Settings                  │
└──────────────────────┬───────────────────────┘
                       │ invoke (Tauri Command)
┌──────────────────────▼───────────────────────┐
│               Tauri Command Layer            │
│  commands/ — 薄封装，参数校验后调用领域模块    │
└──────────────────────┬───────────────────────┘
┌──────────────────────▼───────────────────────┐
│                  Rust Core                   │
│  channels / models / credentials / billing   │
│  workbenches (api_testing / image)           │
│  adapters (providers / protocols)            │
│  requests / processing / diagnostics         │
│  services / backup / agent                   │
└──────────────────────┬───────────────────────┘
          ┌────────────┴────────────┐
┌─────────▼────────┐      ┌─────────▼────────┐
│      SQLite      │      │   Local Files    │
│  元数据 / 索引    │      │ Raw / SSE / 图片  │
└──────────────────┘      └──────────────────┘
```

## 两条独立的使用路径

### Agent 原生使用路径（不经过 Adapter）

```text
Claude Code / Codex / Other Agents
        │  使用 LCM 生成的渠道原生配置
        ▼
  Channel Native API（用户配置的地址 + 认证 + 协议）
        ▼
  Original Provider / Gateway
```

- LCM 不插入代理、不转换协议、不修改请求/响应、不重试。
- LCM 可以作为 **Agent Launcher** 启动 Agent 原生进程：仅注入启动配置（Claude Code 环境变量 / Codex 独立 `CODEX_HOME`），之后即退出数据路径。渠道切换只影响下一次启动；已运行进程不修改、不中断。详见 [agent-launcher.md](./agent-launcher.md)。
- `agent/` 模块只负责：兼容性信息管理、使用说明、配置生成或导出（用户确认后）、Agent 启动、测试结果展示。
- 如果渠道不适合某个 Agent，LCM 如实展示不兼容情况与证据，**不掩盖**。

### 工作台测试路径（允许 Adapter）

```text
API Testing Workbench / Image Workbench
        ▼
     Engine（workbenches/）
        ▼
Provider / Protocol Adapter（adapters/）
        ▼
    HTTP Client → Channel
```

- Adapter 只服务于工作台，不能被 Agent 原生调用链路依赖。
- 所有可能影响请求语义的处理必须生成 ProcessingEvent（`processing/` 模块）。

## 模块职责（src-tauri/src/）

| 模块 | 职责 | 阶段 |
|---|---|---|
| `commands/` | Tauri Command 薄封装 | Phase 0 |
| `services/` | 业务服务层 | Phase 1+ |
| `storage/` | SQLite 初始化、迁移、目录布局、文件归档 | Phase 0 |
| `channels/` | 渠道 CRUD、连接配置、外部链接 | Phase 1 |
| `credentials/` | OS 凭证库读写、掩码、受控读取 | Phase 1 |
| `models/` | 全局模型 / 渠道模型、获取与导入 | Phase 2 |
| `billing/` | 充值、账单、余额快照 | Phase 6 |
| `agent/` | Agent 兼容性、Agent Launcher 启动式渠道切换（禁止依赖 adapters） | Phase 1 |
| `workbenches/` | API 测试 / 画图工作台引擎 | Phase 3 / 4 |
| `adapters/` | Provider / Protocol Adapter（仅工作台可用） | Phase 3+ |
| `requests/` | Trace ID、RequestRecord、Raw 归档 | Phase 3 |
| `processing/` | ProcessingEvent 生成与查询 | Phase 3 |
| `diagnostics/` | 错误诊断与多层网关归因 | Phase 8 |
| `backup/` | 加密备份与恢复 | Phase 7 |
| `mcp/` | 只读 MCP 服务器（stdio，供外部 AI Agent 查询；凭证零输出，bin 目标 `lcm-mcp`） | v0.15.0 |

## 数据流四层分离

所有工作台请求至少区分四层，Raw 是事实记录，Preview 是解释结果：

| 层级 | 含义 | 存储 |
|---|---|---|
| 用户输入 | 用户在工作台填写的原始内容 | Raw Request 文件（前端表单态） |
| 实际发送 | 最终通过 HTTP 发送的请求 | `archives/requests/` |
| 原始接收 | 渠道返回的原始 HTTP 响应或 SSE | `archives/responses/`、`archives/streams/` |
| 工具处理结果 | 解析、统计、展示和诊断 | SQLite（preview / processing_events / error_diagnoses） |

## 跨平台构建

- GitHub Actions：`.github/workflows/ci.yml`（质量门禁）与 `.github/workflows/release.yml`（tag 触发三平台打包）。
- 目标平台：macOS（aarch64 / x86_64）、Windows、Linux。
- 第一阶段不实现自动更新。
