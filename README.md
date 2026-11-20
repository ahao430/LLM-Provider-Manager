# LCM — Local Channel Manager

**本地优先的大模型渠道管理与 API 测试工具。**

[![CI](https://github.com/ahao430/LLM-Provider-Manager/actions/workflows/ci.yml/badge.svg)](https://github.com/ahao430/LLM-Provider-Manager/actions/workflows/ci.yml)
[![Release](https://github.com/ahao430/LLM-Provider-Manager/actions/workflows/release.yml/badge.svg)](https://github.com/ahao430/LLM-Provider-Manager/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/ahao430/LLM-Provider-Manager)](https://github.com/ahao430/LLM-Provider-Manager/releases/latest)

LCM 用于统一管理不同 AI 服务商、API 渠道、模型、价格、充值记录和账单，并提供 API 测试、真实 Agent 调用（Claude Code / Codex CLI）、图片生成与理解、测试记录与响应分析能力。

**项目主页**：[ahao430.github.io/LLM-Provider-Manager](https://ahao430.github.io/LLM-Provider-Manager/)（源码 [site/index.html](./site/index.html)，经 GitHub Pages 发布）

项目的核心原则是：

> **忠实呈现渠道原生能力，不擅自优化、转换或修复用户的请求。**

LCM 不是 AI Gateway、API Proxy、模型路由器或协议转换服务，而是一个帮助用户管理、测试、观察和分析大模型渠道的本地桌面工具。

完整产品设计与开发计划见 [PLAN.md](./PLAN.md)。

---

## 目录

- [核心设计原则](#核心设计原则)
- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [项目结构](#项目结构)
- [版本策略](#版本策略)
- [开发路线](#开发路线)
- [文档](#文档)

---

## 核心设计原则

1. **原生优先** — 用户配置什么就原样发送什么，渠道返回什么就原样记录什么。LCM 不为了让某个渠道「看起来更兼容」而改变它的实际行为。
2. **Agent 与工作台严格隔离** — Claude Code、Codex 等 Agent 使用渠道原生 API，不经过任何 Adapter；只有 API 测试工作台和画图工作台允许使用 Adapter，且处理过程必须透明记录。
3. **原始数据与展示数据分离** — 用户输入 / 实际发送 / 原始接收 / 工具处理结果四层分开。Raw 是事实记录，Preview 是解释结果，Preview 不得覆盖 Raw。
4. **处理透明** — 工具进行的任何处理（序列化、认证头、解析、归档、诊断）都如实记录为 ProcessingEvent。
5. **失败归因准确** — 请求失败、解析失败、归档失败、诊断失败分别记录；错误性质与错误来源分开，事实与推测分开，置信度必须明确。

## 功能概览

| 模块 | 说明 | 阶段 |
|---|---|---|
| 仪表盘 | 渠道/模型/请求整体情况，充值与账单分开统计 | Phase 5 ✅ |
| 渠道管理 | 服务商模板、多渠道实例、连接配置、凭证安全、Agent 兼容性、模型标注价 | Phase 1 ✅ |
| 模型列表 | 全渠道模型按模型维度聚合：渠道合并、标注价范围、分渠道快速测试 | v0.10.5 ✅ |
| 市场信息 | 各厂商模型价格快照：内置 + 一键抓取（models.dev），仅参考不算费用 | v0.10.0 ✅ |
| Agent 测试 | 真实调用 Claude Code / Codex CLI（单次探针）：凭证注入环境、收集实际输出、启动快照 | v0.14.0 ✅ |
| Agent 启动器 | 启动式渠道切换：Claude Code 环境变量注入 / Codex 独立 CODEX_HOME；不修改原配置、不代理请求、启动快照 | Phase 1 ✅ |
| 资金与账单 | 充值 / 供应商账单 / 余额快照；余额查询方式按服务商自动派生（NewAPI 用户额度、阿里云百炼费用中心，支持账单按月净额导入） | Phase 6 ✅ |
| 测试中心 | API 测试 / Agent 测试 / 画图（生成 + 编辑）/ 图像理解，一个菜单收敛 | v0.10.0 ✅ |
| 测试记录 | Trace ID、Raw、Preview、TTFB/TTFT/TPS、Token、历史重新解析、重放、复制 curl | Phase 3 ✅ |
| 设置 | 常规（应用 / 外观主题 / MCP 接入 / 市场数据源）/ 数据（加密备份·一致性·清理）/ 应用内一键更新（minisign 验签 + 自动重启，v0.30.0） | Phase 0（已上线） |
| MCP | `lcm-mcp` 只读 MCP 服务器（stdio）：渠道、模型与标注价、测试记录、错误诊断（知识库）、余额、账单、市场行情；凭证零输出 | v0.15.0 ✅ |

## 技术栈

**桌面端**

- UI 基础组件：[shadcn/ui](https://ui.shadcn.com/)
- 表单：React Hook Form + Zod
- 表格：TanStack Table
- 图表：Recharts
- 编辑器：Monaco Editor
- 图标：Lucide
- 通知：Sonner
- 状态：Zustand
- 请求缓存：TanStack Query
- 样式：Tailwind CSS

**应用与后端**

- Tauri 2 · React · TypeScript · Vite · React Router
- Rust · rusqlite（SQLite）
- 独立凭证文件（应用数据目录 credentials.json，0600 权限；开发期 Keychain 逐次弹窗已弃用，首次启动自动迁移）

## 快速开始

### 下载安装（普通用户）

从 [Releases](https://github.com/ahao430/LLM-Provider-Manager/releases) 下载对应平台安装包：

| 平台 | 资产 |
|---|---|
| macOS (Apple Silicon) | `LCM_x.y.z_aarch64.dmg` |
| macOS (Intel) | `LCM_x.y.z_x64.dmg` |
| Windows | `LCM_x.y.z_x64-setup.exe`（或 `.msi`） |
| Linux | `LCM_x.y.z_amd64.AppImage`（或 `.deb`） |

**macOS 首次运行**：应用未做 Apple 公证（notarization），拖入「应用程序」后首次打开可能被 Gatekeeper 拦截（提示「已损坏，无法打开」）。在终端执行以下命令清除隔离属性后即可正常打开：

```bash
xattr -cr /Applications/LCM.app
```

> 也可以在「系统设置 → 隐私与安全性」里点击「仍要打开」放行；若仍不行再用上面的命令。

应用内一键更新（v0.30.0 起）：启动自动检测新版本，侧边栏版本号旁出现「升级」按钮（或设置 → 关于），点击后应用内下载（带进度条）→ 签名验证 → 自动替换 → **自动重启生效**，无需手动覆盖安装。

> 注意：
> - 从 v0.29.x 及更早版本升级到 v0.30.0 仍需手动覆盖安装一次（旧版本内没有更新插件，这是最后一次手动安装），此后版本均可应用内一键更新。
> - Linux 以 `.deb` / `.rpm` 安装的用户不适用应用内更新（由包管理器负责），界面会引导走下载页。

### 更新签名（维护者）

应用内更新走 [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/)，更新包用 **minisign 签名**，应用内置公钥校验，防止更新通道被篡改。配置一次后无需再管：

```bash
# 1. 生成本机签名密钥对（私钥不进仓库，记牢密码）
pnpm tauri signer generate -w ~/.tauri/lcm-updater.key

# 2. GitHub 仓库 → Settings → Secrets and variables → Actions → Secrets → Repository secrets，添加两条：
#    TAURI_SIGNING_PRIVATE_KEY          = ~/.tauri/lcm-updater.key 文件的完整内容（含注释行）
#    TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 生成密钥时设置的密码

# 3. 公钥（~/.tauri/lcm-updater.key.pub 的内容）填入 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
```

工作方式：推送 `v*` tag 后，Release workflow 的 tauri-action 注入私钥自动对更新产物（macOS `.app.tar.gz` / Windows `setup.exe` / Linux `AppImage`）生成 `.sig`，并把各平台签名聚合上传为 Release 的 `latest.json` 清单；应用从 `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` 检查更新（正式发布后可见，与「草稿 → 全平台成功自动发布」流程兼容）。

### 前置要求

- [Node.js](https://nodejs.org/) ≥ 20（建议 22）与 [pnpm](https://pnpm.io/) ≥ 9
- [Rust](https://www.rust-lang.org/) stable（含 cargo）
- 平台依赖：
  - macOS：Xcode Command Line Tools
  - Windows：[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（一般已内置）、[Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  - Linux：`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### 安装与运行

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 启动桌面应用（开发模式，含 Rust 编译）
```

只想调试前端界面（部分命令不可用）：

```bash
pnpm dev
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm tauri dev` | 启动桌面应用开发模式 |
| `pnpm tauri build` | 构建当前平台安装包 |
| `pnpm dev` / `pnpm build` | 仅前端开发 / 构建 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行前端测试（Vitest） |
| `cargo fmt` / `cargo clippy` / `cargo test`（在 `src-tauri/` 下） | Rust 格式化 / 静态检查 / 测试 |
| `cargo build --release --bin lcm-mcp` | 构建 MCP 只读服务器（注册到 Claude Code / Codex，见设置页「MCP」） |
| `pnpm version:sync 0.0.2` | 同步三处版本号并提醒更新 CHANGELOG |

## 项目结构

```text
├── src/                        # React 前端
│   ├── app/                    # 应用入口、路由、布局
│   ├── components/             # 通用组件（含 shadcn/ui 基础组件）
│   ├── features/               # 按领域划分的页面（dashboard/channels/api-testing/...）
│   ├── hooks/ · lib/ · stores/ · types/
├── src-tauri/                  # Rust 核心
│   ├── src/
│   │   ├── commands/           # Tauri Command 层
│   │   ├── services/           # 业务服务层
│   │   ├── channels/ · models/ · credentials/ · billing/
│   │   ├── agent/              # Agent 兼容性 + Launcher + 真实 Agent 探针（禁止依赖 adapters/）
│   │   ├── mcp/                # 只读 MCP 服务器（bin/lcm-mcp；凭证零输出）
│   │   ├── workbenches/        # 工作台（唯一允许调用 adapters/ 的模块）
│   │   ├── adapters/           # Provider / Protocol Adapter
│   │   ├── requests/ · processing/ · diagnostics/ · backup/
│   │   └── storage/            # SQLite + 文件归档
│   ├── migrations/             # SQL 迁移（只追加）
│   └── tauri.conf.json
├── tests/                      # 前端测试
├── docs/                       # 架构与设计文档
├── PLAN.md                     # 产品设计与开发计划（单一事实来源）
├── AGENTS.md                   # AI 协作开发规范
└── CHANGELOG.md                # 更新日志
```

## 版本策略

遵循语义化版本（SemVer）：

- **每次改动**：第三位 +1（patch），如 `0.0.1 → 0.0.2`
- **较大改动**：第二位 +1（minor），如 `0.0.9 → 0.1.0`
- **第一位（major）**：仅在维护者明确要求时升级

版本号出现在三处（用 `pnpm version:sync` 统一同步）：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。每个版本在 [CHANGELOG.md](./CHANGELOG.md) 中记录。

## 开发路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 项目初始化：Tauri 2 + React + SQLite + 迁移 + 导航布局 + CI/CD | ✅ 完成 |
| Phase 1 | 渠道管理：CRUD、模板、凭证安全、Agent 兼容性、Agent 启动器（Claude Code / Codex） | ✅ 主体完成 |
| Phase 2 | 模型和价格：全局/渠道模型、列表获取与导入、能力标记、价格历史与折扣 | ✅ 主体完成 |
| Phase 3 | API 测试工作台：三种协议、流式、Raw + Preview、请求记录 | ✅ 主体完成 |
| Phase 4 | 画图工作台：图片生成、Vision 理解、本地归档 | ✅ 主体完成 |
| Phase 5 | 请求记录和 Dashboard：Trace、Raw、指标、费用估算、重放 | ✅ 主体完成 |
| Phase 6 | 资金与账单：充值、账单、余额快照、估算余额 | ✅ 主体完成 |
| Phase 7 | 备份与跨平台完善：加密备份、恢复、一致性检查、CSP 收紧 | ✅ 主体完成 |
| Phase 8 | 高级诊断与 MCP（错误知识库、AI 诊断、多层网关归因、账单文件导入） | ⏳ |

## 文档

- [PLAN.md](./PLAN.md) — 产品设计与开发计划（必读，单一事实来源）
- [AGENTS.md](./AGENTS.md) — AI 协作开发规范（版本策略、架构红线）
- [CHANGELOG.md](./CHANGELOG.md) — 更新日志
- [docs/architecture.md](./docs/architecture.md) — 系统架构
- [docs/database.md](./docs/database.md) — 数据库结构与迁移规则
- [docs/security.md](./docs/security.md) — 凭证与安全边界
- [docs/agent-compatibility.md](./docs/agent-compatibility.md) — Agent 兼容性模型
- [docs/agent-launcher.md](./docs/agent-launcher.md) — Agent 启动器（启动式渠道切换）
- [docs/adapter-boundaries.md](./docs/adapter-boundaries.md) — Adapter 边界与强制措施

---

*LCM 的价值不在于让所有渠道表现得一样，而在于让用户清楚地知道每个渠道真实的样子。*
