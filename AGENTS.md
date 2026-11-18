# AGENTS.md — AI 协作开发规范

本文件面向在本仓库工作的人类开发者和 AI 编码代理。开始任何工作前，请先阅读 [PLAN.md](./PLAN.md)（产品设计与开发计划的单一事实来源）。

## 项目一句话

LCM 是本地优先的大模型渠道管理与 API 测试桌面工具（Tauri 2 + React + TypeScript + Rust + SQLite）。它忠实呈现渠道原生能力，**不擅自优化、转换或修复用户的请求**。

## 环境与命令

```bash
pnpm install                 # 安装前端依赖（需要 Node ≥ 20、pnpm ≥ 9）
pnpm tauri dev               # 桌面应用开发模式
pnpm tauri build             # 构建当前平台安装包
pnpm typecheck               # TS 类型检查（严格模式，禁止 any 滥用）
pnpm test                    # Vitest 前端测试
pnpm build                   # 仅前端构建

# Rust（在 src-tauri/ 目录下）
cargo fmt --all              # 格式化（CI 会 --check）
cargo clippy --all-targets -- -D warnings
cargo test                   # 单元测试 + 架构边界测试
```

本地工具链：Node 22（nvm）、pnpm 10、Rust stable、`cargo tauri` CLI。

## 版本策略（重要）

遵循语义化版本，从 `0.0.1` 开始：

| 改动类型 | 版本变化 | 示例 |
|---|---|---|
| 每次改动（默认） | 第三位 +1（patch） | `0.0.1 → 0.0.2` |
| 较大改动 / 破坏性变更 | 第二位 +1（minor） | `0.1.2 → 0.2.0` |
| 第一位（major） | **仅当用户明确要求时升级** | `0.9.0 → 1.0.0` |

每次合并改动必须：

1. 用 `pnpm version:sync <新版本号>` 同步版本号（`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`）；
2. 在 [CHANGELOG.md](./CHANGELOG.md) 按 Keep a Changelog 格式追加对应版本的变更记录（新增 / 变更 / 修复 / 移除）；
3. `src-tauri/Cargo.lock` 中的 `lcm` 包版本随下一次 cargo 命令自动更新，无需手工改。

## 架构红线（违反即返工）

以下规则来自 PLAN.md「设计约束」，是长期维护的硬性约束：

1. **Agent 与 Adapter 严格隔离**：`src-tauri/src/agent/` 不得依赖 `src-tauri/src/adapters/`（Provider / Protocol Adapter）。该边界由 `src-tauri/tests/architecture_boundaries.rs` 自动化测试强制执行。只有 `workbenches/`（API 测试工作台、画图工作台）可以调用 Adapter。
2. **不自动转换 / 修改 / 重试**：不自动转换协议、修改请求体、注入 Prompt 或影响模型行为的 Header、调整参数、切换模型渠道、自动重试、自动修复兼容性。
3. **Raw 与 Preview 分离**：原始请求/响应完整归档，Preview 只是解释结果，不得覆盖 Raw；解析失败时原始数据仍然保留。
4. **价格历史只追加**：不覆盖、不删除历史价格记录。
5. **迁移只追加**：`src-tauri/migrations/` 中已发布的迁移文件不得修改，只能新增 `NNNN_description.sql` 并在 `storage/migrations.rs` 注册。
6. **凭证安全**：密钥不以明文存入 SQLite；不得进入日志、调试输出、AI 诊断上下文、MCP 返回、普通配置导出。默认掩码，明文查看由用户主动操作。
7. **三种金额分开**：充值金额、本地测试费用、供应商账单金额必须分开统计；不同币种分组，无明确汇率不相加；估算值必须标注。
8. **错误归因**：错误性质与来源分开、事实与推测分开、置信度必须明确（confirmed / probable / unknown），证据不足时标 unknown。
9. **启动式渠道切换**：渠道切换只改变 Agent 下一次启动的进程配置（Claude Code 环境变量注入 / Codex 独立 `CODEX_HOME`），不修改用户已有 Agent 配置文件、不修改或中断已运行进程、不引入本地网关；启动快照（agent_launches）不保存 Token 明文；Agent 原生请求不归档为 LCM 测试记录，不声称已被 LCM 完整观测。见 docs/agent-launcher.md。

## 代码组织约定

- **前端**：页面按领域放 `src/features/<domain>/`，通用组件放 `src/components/`；UI 基础组件用 shadcn/ui（`pnpm dlx shadcn@latest add <component>`），不要手写重复造轮子；表单用 React Hook Form + Zod，表格用 TanStack Table，图表用 Recharts，编辑器用 Monaco，通知用 Sonner，图标用 Lucide；服务端状态用 TanStack Query，全局 UI 状态用 Zustand。
- **后端**：Tauri Command（`commands/`）只做薄封装，业务逻辑进 `services/` 或领域模块；错误统一用 `error::AppError`；新表先加迁移文件再写代码。
- **命名**：Rust 命令函数用 snake_case（前端 invoke 同名）；返回给前端的 struct 加 `#[serde(rename_all = "camelCase")]`。
- **注释**：中文为主，说明「为什么」而不是「是什么」。

## 提交与工作流

- 提交信息建议 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`）。
- CI（`.github/workflows/ci.yml`）：前端 typecheck + test + build；Rust fmt --check + clippy -D warnings + test。提交前本地跑一遍对应命令。
- Release（`.github/workflows/release.yml`）：推送 `v*` tag 触发三平台构建，产出草稿 Release，确认后发布。

## 其他注意事项

- 不要提交密钥、真实 API Key、`.env`、`src-tauri/target/`、`node_modules/`。
- 用户数据位于 Tauri App Data Directory（不写死路径）；测试中不要依赖真实用户数据目录。
- 当前 `tauri.conf.json` 的 CSP 为 null（开发期），收紧 CSP 属于 Phase 7 安全工作，届时更新 docs/security.md。
