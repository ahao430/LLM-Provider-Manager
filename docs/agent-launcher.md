# Agent 启动器（Agent Launcher）

渠道切换的核心语义：**只改变 Agent 下一次启动时使用的配置，不改变 Agent 发出的请求。**

- 不引入本地网关 / 代理（Magpie 式方案不作为默认，也不作为渠道切换的基础设施）。
- 不修改用户已有的 Agent 配置文件（CC Switch 式改文件只作为特定 Agent 的适配手段，不作为默认）。
- 启动式切换：环境变量注入（Claude Code CLI）或独立配置目录（Codex CLI）。

对应 PLAN.md「Agent 启动器」章节；架构边界见 [adapter-boundaries.md](./adapter-boundaries.md)。

## 三种方案对比

| 方案 | 实现方式 | 优点 | 缺点 |
|---|---|---|---|
| CC Switch 模式 | 修改 Agent 配置文件 | 持久化、适合桌面端 | 需要管理配置文件和冲突 |
| 环境变量启动 | 启动进程时注入 Base URL、Token | 不改原配置、切换快速 | 不适合所有 Agent |
| Magpie 式网关 | Agent 请求经过本地代理 | 统一管理、可动态切换 | 增加代理层，可能改变请求行为 |

| 维度 | 环境变量 / 配置文件 | 本地网关 |
|---|---|---|
| 是否改变 API 请求路径 | 否 | 是 |
| 是否需要常驻代理 | 否 | 是 |
| 是否需要协议转换 | 否 | 可能 |
| 渠道切换方式 | 新进程配置 | 代理动态路由 |
| 原生行为透明度 | 高 | 需要额外保证 |
| 实现复杂度 | 较低 | 较高 |

## Per-Agent 适配策略

| Agent | 首选实现 | 是否修改原配置 |
|---|---|---|
| Claude Code CLI | 进程环境变量注入 | 不需要 |
| Codex CLI | 独立 `CODEX_HOME` / Profile | 不需要 |
| Claude Code VS Code 插件 | 插件自身的环境变量配置入口 | 视插件启动方式 |
| Claude Code 桌面端 | 官方支持的第三方推理配置 | 不假定 CLI 环境变量生效 |
| 其他 CLI Agent | 环境变量优先 | 视情况 |
| 其他桌面 Agent | 官方配置机制 | 视情况 |

**Phase 1 实现两个**：Claude Code CLI（环境变量）与 Codex CLI（独立 CODEX_HOME），验证整个 Launcher 架构。

## Claude Code CLI：环境变量注入

| 环境变量 | 作用 |
|---|---|
| `ANTHROPIC_BASE_URL` | API Base URL |
| `ANTHROPIC_AUTH_TOKEN` | Bearer Token |
| `ANTHROPIC_API_KEY` | API Key |
| `ANTHROPIC_CUSTOM_HEADERS` | 自定义 Header |
| `ANTHROPIC_MODEL` | 默认模型 |

要点：

- 不修改 `~/.claude/settings.json` 与项目 `.claude/settings.json`，无需代理与协议转换。
- 进程退出后注入的环境变量自然不影响其他终端会话。
- **认证优先级**：用户若已配置 OAuth 登录，必须明确处理 API Key / `ANTHROPIC_AUTH_TOKEN` 与 OAuth 的优先级冲突，不能假设一定并存。启动前如检测到冲突应提示用户。

## Codex CLI：独立 CODEX_HOME

Codex 的 `base_url` 与 `wire_api` 属于 Provider 配置，通用环境变量无法完成全部切换，因此为每个渠道维护独立配置目录：

```text
app-data/agent-profiles/codex/
├── channel-a/
│   └── config.toml
└── channel-b/
    └── config.toml
```

`config.toml` 模板（由渠道配置生成，不含 Token 明文，Token 走 `env_key`）：

```toml
model = "<model>"
model_provider = "lcm_channel"

[model_providers.lcm_channel]
name = "<channel name>"
base_url = "<base_url>/v1"
env_key = "LCM_CODEX_API_KEY"
wire_api = "responses"
```

启动：`CODEX_HOME=<app-data>/agent-profiles/codex/<channel>/ LCM_CODEX_API_KEY=<token> codex`（在用户选择的工作目录中）。

## 启动流程（实现约定）

用户点击「启动」执行真实进程启动，不只是切换界面上的当前渠道：

1. 读取渠道配置与所选模型。
2. 从系统凭证库读取 Token（受控读取，不落日志）。
3. 按 Agent 类型生成启动配置（env 集 / config.toml）。
4. 必要时物化 `agent-profiles/` 目录（幂等，覆盖前 diff 提示）。
5. 创建子进程：注入环境变量或指定 `CODEX_HOME`，设置工作目录。
6. 记录 AgentLaunch 快照（见下）。
7. 展示进程状态；进程退出时回填 `exited_at`。

### 切换语义

- 切换只影响**下一次启动**；已运行的 Agent 会话不修改配置、不中断、不强杀。
- 多个 Agent 进程可同时使用不同渠道，互不干扰。
- Agent 直接请求渠道，不经过 LCM 网关和 Adapter。

## 启动配置快照（agent_launches 表）

| 字段 | 说明 |
|---|---|
| `launch_id` | 主键（UUID） |
| `agent_type` | `claude_code_cli` / `codex_cli` / ... |
| `channel_id` / `channel_model_id` | 启动时使用的渠道与模型 |
| `working_directory` | 工作目录 |
| `launch_method` | `env_injection` / `codex_home` / `profile` / `native_config` |
| `base_url` / `model` | 实际生效值 |
| `credential_ref` | 凭证引用（**不存 Token 明文**） |
| `config_snapshot_json` | 脱敏快照：变量名、非敏感值、配置版本（**不含任何凭证值**） |
| `process_id` | 子进程 PID |
| `started_at` / `exited_at` | 生命周期 |

规则：

1. 历史启动记录不随默认渠道切换而改变——回答「这个会话当时用了哪个渠道、哪个模型」。
2. Agent 进程自行产生的请求不经过 LCM，**不归档为 LCM API 测试记录，也不声称已被 LCM 完整观测**。
3. 快照写库失败不应导致启动失败静默：启动与快照是两件事，分别报告结果。

## 与其他模块的关系

- 依赖 `channels/`（渠道配置）、`credentials/`（Token 受控读取）。
- 位于 `src-tauri/src/agent/launcher/`，与其他 agent 模块一样**禁止依赖 `adapters/`**（自动化测试强制）。
- 凭证只注入子进程环境，不进入日志、快照与诊断。

## 单次探针（Agent 测试）

除交互式启动外，`agent/probe.rs` 提供**单次非交互调用**（测试中心「Agent 测试」）：

- **Claude Code**：`claude -p <prompt> --output-format json [--model m]`，从 JSON 输出提取回复正文、session_id、耗时、成本与 token 用量（解析失败回退原始 stdout）。
- **Codex**：`codex exec --skip-git-repo-check [-m <model>] <prompt>`，stdout 原样展示。
- 凭证注入与 launcher 完全一致（`build_claude_launch` / `build_codex_launch` 复用）；**渠道未配置主凭证时快速失败**，不发无鉴权请求。
- stdout / stderr 捕获上限 256KB，写入 `logs/agent-launches/{launch_id}.log`；超时 10 分钟自动 kill。
- 只写 `agent_launches` 快照（kind=probe），**不写 request_records**——Agent 原生请求不归档为 LCM 测试记录。
- 支持自定义 CLI 可执行文件路径（GUI 环境 PATH 与终端可能不同）。
