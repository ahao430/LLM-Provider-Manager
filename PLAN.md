# LCM — Local Channel Manager

本地优先的大模型渠道管理与 API 测试工具。

LCM 用于统一管理不同 AI 服务商、API 渠道、模型、价格、充值记录和账单，并提供 API 测试、图片生成、请求记录、响应分析和错误诊断能力。

项目的核心原则是：

**忠实呈现渠道原生能力，不擅自优化、转换或修复用户的请求。**

LCM 不是 AI Gateway、API Proxy、模型路由器或协议转换服务，而是一个帮助用户管理、测试、观察和分析大模型渠道的本地桌面工具。

---

## 目录

- [项目定位](#项目定位)
- [核心设计原则](#核心设计原则)
- [功能概览](#功能概览)
- [系统架构](#系统架构)
- [Agent 原生调用](#agent-原生调用)
- [Agent 启动器](#agent-启动器)
- [渠道管理](#渠道管理)
- [模型管理](#模型管理)
- [价格管理](#价格管理)
- [资金与账单管理](#资金与账单管理)
- [API 测试工作台](#api-测试工作台)
- [画图工作台](#画图工作台)
- [请求记录与响应分析](#请求记录与响应分析)
- [处理透明度](#处理透明度)
- [错误诊断与多层网关归因](#错误诊断与多层网关归因)
- [MCP 集成](#mcp-集成)
- [数据存储](#数据存储)
- [凭证安全](#凭证安全)
- [备份与恢复](#备份与恢复)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [开发计划](#开发计划)
- [安全边界](#安全边界)
- [设计约束](#设计约束)

---

## 项目定位

### 为什么需要 LCM

在日常使用 Claude Code、Codex 等 Coding Agent，以及不同大模型 API 的过程中，通常需要管理多个服务商和渠道：

- 阿里云百炼
- NewAPI
- 火山方舟
- 硅基流动
- 其他 OpenAI、Anthropic 兼容 API
- 自建模型服务和其他自定义渠道

不同渠道可能存在以下差异：

- API 协议不同
- Base URL 不同
- 认证方式不同
- 模型名称不同
- 模型能力不同
- 参数支持情况不同
- 上游网关行为不同
- 价格和计费方式不同
- 对 Claude Code、Codex 等 Agent 的兼容程度不同

目前这些信息往往分散在多个管理后台、配置文件和文档中。

LCM 希望将这些信息集中管理，并提供统一的测试与分析入口。

### 产品目标

1. 统一管理多个 AI 服务商和 API 渠道。
2. 管理不同渠道提供的模型及其能力。
3. 记录模型价格和历史价格变化。
4. 记录每个渠道的充值记录和供应商账单。
5. 测试渠道原生 API 的真实行为。
6. 提供图片生成和图片理解测试能力。
7. 完整记录 API 请求、原始响应和处理过程。
8. 分析接口错误及多层网关中的错误来源。
9. 为 Agent 提供渠道兼容性信息，但不改变 Agent 的原生调用行为。
10. 提供本地优先的数据存储和安全备份能力。

### 非目标

LCM 不承担以下职责：

- 不作为企业级 AI Gateway。
- 不作为通用 HTTP 反向代理。
- 不默认提供本地网关或代理作为 Agent 渠道切换手段。
- 不进行智能模型路由。
- 不自动切换渠道。
- 不自动重试失败请求。
- 不自动优化 Prompt。
- 不自动调整模型参数。
- 不自动转换 Agent 请求协议。
- 不自动修复渠道兼容性。
- 不自动修改渠道原始响应。
- 不自动同步或伪造供应商余额。

---

## 核心设计原则

### 1. 原生优先

用户配置什么，就尽可能原样发送什么。

渠道返回什么，就尽可能原样记录什么。

LCM 不应该为了让某个渠道看起来更兼容，而擅自改变它的实际行为。

这里的原样性指 API 层语义忠实、实际发送内容可追溯、原始响应可验证，不要求 HTTP 传输字节与用户输入完全一致。

### 2. Agent 与工作台严格隔离

这是项目的架构级约束。

| 使用场景 | 是否允许 Adapter |
|---|---|
| Claude Code | 不允许 |
| Codex | 不允许 |
| 其他 Coding Agent | 不允许 |
| API 测试工作台 | 允许 |
| 画图工作台 | 允许 |

Agent 使用渠道原生 API 能力，不经过 Provider Adapter 或 Protocol Adapter。

如果渠道本身不适合某个 Agent，LCM 必须如实展示不兼容情况，而不是通过转换、补全或改写来掩盖问题。

工作台可以使用 Adapter，但所有可能影响请求语义的处理都必须透明记录。

### 3. 原始数据与展示数据分离

所有请求和响应至少区分四层：

| 层级 | 含义 |
|---|---|
| 用户输入 | 用户在工作台中填写的原始内容 |
| 实际发送 | 最终通过 HTTP 发送的请求 |
| 原始接收 | 渠道返回的原始 HTTP 响应或 SSE |
| 工具处理结果 | 解析、统计、展示和诊断结果 |

Raw 是事实记录。

Preview 是解释结果。

Preview 不得覆盖 Raw。

### 4. 处理透明

工具进行的任何处理，都应该如实记录和展示。

包括：

- 请求序列化
- 认证 Header 添加
- HTTP 请求发送
- SSE 解析
- JSON 解析
- Usage 提取
- Preview 生成
- 图片元数据提取
- 图片本地归档
- 错误诊断
- 历史请求重新解析

区分必要的 HTTP/API 封装和可能改变模型行为的语义处理。

### 5. 失败归因准确

请求失败、解析失败、归档失败和诊断失败必须分别记录。

例如：

- HTTP 200，但 SSE 解析失败：不能认定为渠道请求失败。
- HTTP 请求成功，但 Raw 文件保存失败：不能认定为渠道 API 失败。
- 渠道返回错误，但 AI 诊断失败：不能改变原始错误结论。

---

## 功能概览

主导航：

1. 仪表盘
2. 渠道管理
3. 模型列表
4. 市场信息
5. 测试中心（API 测试 / Agent 测试 / 画图 / 图像理解）
6. 测试记录
7. 设置

### 仪表盘

提供整体使用情况：

- 渠道数量
- 模型数量
- 渠道启用情况
- 请求总量
- 成功率
- 失败率
- 累计充值金额
- 供应商账单金额
- 最近请求记录
- 最近错误记录

充值与供应商账单必须分开统计，不能混为一个消费数字。

### 渠道管理

集中管理服务商、渠道、模型、价格、连接配置和资金记录。

- 渠道列表展示各渠道最近余额快照，可一键查询（数值可解析时写快照；币种在余额查询配置中设置）。
- 渠道模型可标注价格（每百万 token 输入 / 输出价 + 币种）。标注价仅供人工记录与市场比较展示，**不参与本地测试费用估算**（估算仍走 model_prices 价格历史，两套独立）。
- 渠道模型可标记**接口类型**（Chat Completions / Responses / Anthropic Messages），默认按名称推断：含 claude → Anthropic Messages，否则 Chat Completions；测试按该类型调用。

### 模型列表

全部渠道的模型以模型维度聚合展示：

- 同名模型（actualModelId，大小写不敏感）跨渠道合并为一行，渠道合并展示；
- 标注价展示各渠道范围（按币种分组 min~max）；
- **最近测试**：组内跨渠道取最新结果（状态 + 时间，点击跳记录），详情内逐渠道展示；
- 点击行查看详情：逐渠道接口类型 / 启用状态 / 标注价 / 最近测试，可跳转渠道详情；
- 测试按渠道分开：行内快捷测试前两个渠道，详情内每渠道独立测试（用该渠道模型的接口类型）；
- 支持按模型 / 渠道搜索与类型筛选。

### 市场信息

各厂商模型价格快照，支持按厂商筛选与模型搜索；点击厂商名跳转官方价格页。中转 / 聚合渠道价格各异，以渠道页为准。

数据来源与更新：

- **内置快照**随应用打包（`src-tauri/src/market/data.json`），可用 `pnpm market:refresh` 脚本从 models.dev 重新生成；
- 页面「**抓取数据**」按钮实时拉取 [models.dev/api.json](https://models.dev/api.json)（机器可读、官方第一方厂商、统一 USD/百万 token），存入 `market_cache` 表，展示优先用抓取缓存；
- 不爬 HTML 价格页（JS 渲染、结构频繁变动）；models.dev 收录 300+ 供应商，取白名单 16 家官方厂商，聚合中转不收录。

### 测试中心

测试功能收敛为一个菜单，含四个子页（路由化，支持前进后退）：

- **API 测试**：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 原生测试（单轮）。
- **Agent 测试**：真实调用 Claude Code / Codex CLI（单次探针：选渠道 + 工作目录，发一条 prompt 收集实际输出）；LCM 不自己发请求，Agent 原生请求不归档为 LCM 测试记录，仅记 agent_launches 快照。
- **画图**：图片生成（/images/generations）与图片编辑（/images/edits，multipart 原图 + 蒙版）。
- **图像理解**：上传 / 拖拽 / 粘贴多图（base64 原样发送）+ URL 提问。

### 请求记录

提供请求历史、Raw、Preview、流式事件、耗时、Token 和错误诊断。

---

## 系统架构

LCM 采用桌面应用架构。

```text
┌──────────────────────────────────────────────┐
│                  React UI                    │
│                                              │
│ Dashboard / Channels / API Testing / Image   │
│ Request History / Settings                   │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│               Tauri Command Layer            │
│                                              │
│ Channel Management                           │
│ Model Management                              │
│ Credential Management                         │
│ Request Management                            │
│ Billing Management                            │
│ Backup / Restore                              │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│                Rust Core                     │
│                                              │
│ Channel Service                               │
│ Agent Compatibility                           │
│ API Testing Engine                            │
│ Image Testing Engine                          │
│ Provider Adapters                             │
│ Protocol Adapters                             │
│ Request Recorder                              │
│ Response Parser                               │
│ Error Analyzer                                │
│ Storage Service                               │
└──────────────────────┬───────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
┌─────────▼────────┐      ┌─────────▼────────┐
│      SQLite      │      │   Local Files    │
│                  │      │                  │
│ Metadata         │      │ Raw Requests     │
│ Channels         │      │ Raw Responses    │
│ Models           │      │ SSE Streams      │
│ Prices           │      │ Images           │
│ Recharges        │      │ Backups          │
│ Bills            │      │                  │
│ Request Index    │      │                  │
└──────────────────┘      └──────────────────┘
```

### 两条独立的使用路径

**Agent 原生使用路径**

```text
Claude Code / Codex / Other Agents
                 │
                 ▼
          Channel Config
                 │
                 ▼
          Native API Call
                 │
                 ▼
       Original Provider / Gateway
```

这条路径不使用 LCM 的 Provider Adapter 和 Protocol Adapter。

Agent 直接使用用户配置的原生渠道地址、认证信息和协议。

如果 Agent 直接访问渠道，LCM 不会为了监控而偷偷插入代理。

**工作台测试路径**

```text
API Testing Workbench / Image Workbench
                 │
                 ▼
              Engine
                 │
                 ▼
       Provider / Protocol Adapter
                 │
                 ▼
           HTTP Client
                 │
                 ▼
              Channel
```

工作台允许适配不同服务商和 API 协议。

Adapter 只能服务于明确授权的工作台调用，不能被 Agent 原生调用链路依赖。

---

## Agent 原生调用

### 支持场景

- Claude Code
- Codex
- 其他 Coding Agent
- 其他使用用户自定义 API 地址和认证信息的 Agent

### 核心要求

Agent 使用渠道原生接口。

LCM 不做：

- Anthropic 到 OpenAI 的协议转换。
- OpenAI 到 Anthropic 的协议转换。
- Chat Completions 到 Responses 的转换。
- 自动修改请求体。
- 自动注入额外 Prompt。
- 自动注入影响模型行为的 Header。
- 自动调整参数。
- 自动转换 Tool Calls。
- 自动重组 Thinking 内容。
- 自动转换流式事件。
- 自动补全接口能力。
- 自动切换模型或渠道。
- 自动重试。

### 兼容性信息

渠道可以维护 Agent 兼容性记录：

| Agent | 状态 |
|---|---|
| Claude Code | 支持 / 不支持 / 未验证 |
| Codex | 支持 / 不支持 / 未验证 |
| 其他 Agent | 支持 / 不支持 / 未验证 |

状态需要来自实际测试或可靠证据。

不能因为某个渠道声称兼容 OpenAI 或 Anthropic，就直接认定它兼容对应 Agent 的全部功能。

### 不兼容时的处理

例如：

- 渠道只支持 OpenAI Chat Completions。
- Agent 需要 Anthropic Messages。
- 渠道不支持特定 Tool Call 格式。
- 渠道不支持 Agent 所需的流式事件。
- 渠道缺少某些必要参数或 Header。

LCM 应如实展示不兼容原因和测试证据。

不通过 Adapter 掩盖这些差异。

### 架构约束

Agent 模块只负责：

- 渠道兼容性信息管理。
- Agent 使用说明。
- 原生配置生成或导出（明确由用户确认后执行）。
- Agent 原生进程启动（Agent Launcher：仅注入启动配置，不代理请求）。
- 兼容性测试结果展示。

Agent 模块不得依赖工作台 Adapter Pipeline。

---

## Agent 启动器

LCM 的渠道切换采用启动式切换：只改变 Agent 下一次启动时使用的配置，不改变 Agent 发出的请求，也不引入本地网关。

三种可选方案：

| 方案 | 实现方式 | 优点 | 缺点 |
|---|---|---|---|
| CC Switch 模式 | 修改 Agent 配置文件 | 持久化、适合桌面端 | 需要管理配置文件和冲突 |
| 环境变量启动 | 启动进程时注入 Base URL、Token | 不改原配置、切换快速 | 不适合所有 Agent |
| Magpie 式网关 | Agent 请求经过本地代理 | 统一管理、可动态切换 | 增加代理层，可能改变请求行为 |

三种方式并不冲突，可以组合使用，但网关不作为默认方案，也不作为 Agent 渠道切换的基础设施。

### 技术决策

| Agent | 首选实现 | 是否修改原配置 |
|---|---|---|
| Claude Code CLI | 进程环境变量注入 | 不需要 |
| Codex CLI | 独立 CODEX_HOME / Profile | 不需要 |
| Claude Code VS Code 插件 | 插件自身的环境变量配置入口 | 视插件启动方式 |
| Claude Code 桌面端 | 官方支持的第三方推理配置 | 不假定 CLI 环境变量生效 |
| 其他 CLI Agent | 环境变量优先 | 视情况 |
| 其他桌面 Agent | 官方配置机制 | 视情况 |

第一阶段实现两个 Agent，验证整个 Agent Launcher 架构：

1. Claude Code CLI：环境变量启动。
2. Codex CLI：独立 CODEX_HOME 启动。

### Claude Code 环境变量启动

Claude Code 支持通过环境变量指定 API 地址和认证信息：

| 环境变量 | 作用 |
|---|---|
| ANTHROPIC_BASE_URL | API Base URL |
| ANTHROPIC_AUTH_TOKEN | Bearer Token |
| ANTHROPIC_API_KEY | API Key |
| ANTHROPIC_CUSTOM_HEADERS | 自定义 Header |
| ANTHROPIC_MODEL | 默认模型 |

由 LCM 直接启动 Claude Code 子进程并注入上述变量：

- 不修改 `~/.claude/settings.json`，不修改项目 `.claude/settings.json`。
- 不需要本地代理，不需要转换请求，不需要修改 Claude Code 本身。
- 进程关闭后，注入的环境变量不影响其他终端会话。
- 必须明确处理 API Key 与 OAuth 订阅认证的优先级冲突，不能假设环境变量一定与原认证方式并存。

### Codex 独立配置环境

Codex 的 `base_url` 和 `wire_api` 属于 Provider 配置，不能靠通用环境变量完成全部渠道切换。使用独立 `CODEX_HOME` 为不同渠道创建隔离配置，不修改用户原有 `~/.codex`：

```text
app-data/
└── agent-profiles/
    └── codex/
        ├── channel-a/
        │   └── config.toml      # model_providers.<id> + wire_api
        └── channel-b/
            └── config.toml
```

启动时指定 `CODEX_HOME` 指向对应目录，Token 通过 `env_key` 环境变量注入。

### 启动流程

用户点击启动按钮时执行真实进程启动，不只是切换界面上的当前渠道：

1. 读取渠道配置。
2. 从凭证文件读取 Token。
3. 根据 Agent 类型生成启动配置。
4. 创建子进程。
5. 注入环境变量或指定独立配置目录。
6. 将工作目录设置为用户选择的项目目录。
7. 启动原生 Agent。
8. 记录 AgentLaunch 快照。

### 切换语义

- 渠道切换只影响下一次启动的进程。
- 已运行的 Agent 会话不被修改配置、不被中断、不被强杀。
- 多个 Agent 进程可以同时使用不同渠道，互不干扰。
- Agent 直接请求渠道，不经过 LCM 网关和 Adapter。

### 启动配置快照

每次启动 Agent 保存一份快照：

```text
AgentLaunch
├── launch_id
├── agent_type
├── channel_id
├── channel_model_id
├── working_directory
├── launch_method
├── base_url
├── model
├── credential_ref
├── config_snapshot
├── process_id
├── started_at
└── exited_at
```

规则：

- 不保存 Token 明文，只保存 credential_ref。
- base_url、模型和实际使用的配置版本（脱敏快照）可以记录。
- 记录启动方式（env_injection / codex_home / profile / native_config）。
- Agent 进程自行产生的请求不经过 LCM，不归档为 LCM API 测试记录，也不能声称已被 LCM 完整观测。
- 历史启动记录不随默认渠道切换而改变，可以回答「这个会话当时用了哪个渠道、哪个模型」。

---

## 渠道管理

### 渠道模板

内置常见服务商模板：

- 阿里云百炼
- NewAPI
- 火山方舟
- 硅基流动
- 自定义渠道

模板只是初始化配置，不代表所有渠道都具有相同能力。

### 多渠道实例

同一个服务商允许配置多个渠道实例。

例如：

```text
阿里云百炼
├── 百炼正式环境
├── 百炼测试环境
└── 百炼备用环境

NewAPI
├── 公司 NewAPI
├── 个人 NewAPI
└── 第三方 NewAPI
```

### 渠道字段

```text
Channel
├── id
├── name
├── provider_id
├── channel_type
├── base_url
├── default_protocol
├── enabled
├── notes
├── config_json
├── created_at
└── updated_at
```

### 连接配置

支持：

- Base URL
- API Path
- 默认协议
- 认证方式
- API Key
- Bearer Token
- x-api-key
- AccessKey ID
- AccessKey Secret
- 自定义 Header
- 自定义 Query 参数
- 请求超时
- TLS 配置

自定义 Header 可以标记为敏感字段。

### 渠道详情

包含：

- 概览
- 模型
- 连接配置
- 价格
- 资金与账单
- Agent 兼容性
- 外部链接
- 测试记录

### 外部链接

支持：

- 官网
- 控制台
- API Key 管理
- 官方文档
- 服务状态页
- 自定义链接

外部状态页仅作为浏览器链接，不擅自接入供应商状态 API。

---

## 模型管理

模型采用全局模型和渠道模型两层结构。

### 全局模型 Model

表示统一的模型身份。

例如：

```text
GLM-5.2
DeepSeek-V4-Flash
Claude Sonnet
GPT
```

### 渠道模型 ChannelModel

表示某个渠道实际提供的模型。

```text
ChannelModel
├── id
├── channel_id
├── model_id
├── actual_model_id
├── protocol
├── capabilities
├── parameters
├── notes
├── enabled
├── created_at
└── updated_at
```

一个统一模型可以对应多个渠道模型。

同一个模型在不同渠道可能存在：

- 实际模型 ID 不同。
- 支持的协议不同。
- 参数范围不同。
- Tool Calling 能力不同。
- Thinking 能力不同。
- Vision 能力不同。
- 流式行为不同。

### 能力状态

能力状态统一使用：

- supported
- unsupported
- unknown

不能因为其他渠道支持某个功能，就推断当前渠道也支持。

### 模型导入

模型获取和模型导入分离。

获取模型列表后，由用户选择确认是否写入数据库。

导入时不覆盖已有备注、价格、参数配置和其他人工维护信息。

---

## 价格管理

价格以 ChannelModel 为维度维护。

支持：

- Input Token Price
- Output Token Price
- Cache Read Price
- Cache Write Price
- Image Price
- Other Usage Price
- Currency
- Pricing Unit
- Effective Date

价格由用户手工维护，不自动爬取和覆盖。

### 价格历史

价格调整采用追加历史记录的方式保存。

历史价格不能直接覆盖删除。

例如：

```text
GLM-5.2
├── 2026-01-01：价格版本 A
├── 2026-06-01：价格版本 B
└── 2026-11-01：价格版本 C
```

### 折扣

折扣按照明确比例计算。

例如折扣 80%，表示按原价的 80% 计算。

必须区分官方价格、实际折扣价格和用户估算费用。

---

## 资金与账单管理

每个渠道支持记录多次充值和供应商账单。

这部分属于渠道资金管理，不等同于自动查询供应商账户余额。

### 充值记录

每笔充值单独保存。

```text
ChannelRecharge
├── id
├── channel_id
├── amount
├── currency
├── payment_method
├── transaction_id
├── recharged_at
├── notes
└── created_at
```

支持：

- 新增充值记录。
- 编辑充值记录。
- 删除充值记录。
- 按时间查询。
- 按金额查询。
- 按币种统计。
- 查看充值历史。

### 供应商账单

```text
ChannelBill
├── id
├── channel_id
├── billing_period
├── amount
├── currency
├── source
├── imported_file
├── notes
└── created_at
```

支持手工录入供应商账单。

后续支持 CSV、Excel 导入。

### 余额快照

可选记录人工从供应商控制台抄录的余额：

```text
ChannelBalanceSnapshot
├── id
├── channel_id
├── balance
├── currency
├── captured_at
└── notes
```

不自动假装能够同步供应商余额。

### 三种金额必须区分

**充值金额**

用户实际投入渠道的资金。

**本地 API 使用费用**

根据 LCM 测试请求中的 Token Usage 和价格配置计算的估算费用。

它只代表本工具记录的请求，不代表该渠道全部消费。

**供应商账单金额**

供应商实际结算或统计的消费金额。

不能用本地测试请求费用替代供应商账单。

### Dashboard 统计

支持：

- 累计充值金额。
- 充值次数。
- 平均充值金额。
- 月度充值趋势。
- 月度供应商账单。
- 本地测试费用。
- 渠道资金投入对比。
- 本地估算费用与供应商账单差异。

不同币种分别统计。

没有明确汇率时不直接相加。

### 余额估算

可以提供：

```text
手工估算余额 = 累计充值 - 供应商账单金额
```

但必须标注为估算值。

该公式不包含赠送额度、退款、人工调整、其他消费等因素，不能当作真实供应商余额。

---

## API 测试工作台

支持常见大模型 API 的独立测试。

### 支持协议

第一阶段：

1. OpenAI Chat Completions
2. OpenAI Responses
3. Anthropic Messages

不同协议使用独立的请求和响应适配器。

不能将某个协议的响应直接伪装成另一个协议的原始响应。

### 请求编辑

支持：

- System Prompt
- 多轮消息
- User Message
- Assistant Message
- Tool Message
- 图片输入
- 模型选择
- Stream / Non-stream
- Temperature
- Top P
- Max Tokens
- Stop Sequences
- Tools
- Tool Choice
- 自定义参数
- 自定义 Header
- 自定义 Query
- Raw JSON

### 临时修改

工作台允许临时修改请求配置。

临时修改默认不写回正式渠道配置。

### Adapter

API 测试工作台允许使用 Provider Adapter 和 Protocol Adapter。

适配的目的只是让工作台能够测试不同渠道的 API。

任何可能改变请求语义的操作，都必须记录。

必须区分：

- 用户填写的请求。
- Adapter 处理后的请求。
- 实际 HTTP 请求。
- 渠道返回的原始响应。
- Adapter 处理后的展示结果。

Adapter 不能隐藏渠道实际返回的错误和不兼容行为。

### 流式请求

支持 SSE 流式响应。

完整保存：

- event
- data
- 注释
- 结束标记
- 接收顺序
- 原始数据片段

解析失败时仍然可以查看原始流。

---

## 画图工作台

用于测试渠道的图片相关能力。

### 图片能力分类

分别记录：

- Vision
- Image Generation
- Image Editing
- Image Variation

不能根据模型名称自动推断全部能力。

### 图片生成

支持：

- 选择渠道。
- 选择模型。
- 输入 Prompt。
- 图片尺寸。
- 图片数量。
- 其他 API 原生参数。
- 查看原始响应。
- 查看图片结果。
- 保存图片到本地。

### 图片理解

支持：

- 图片上传。
- 拖拽上传。
- 粘贴图片。
- 多图片输入。
- URL 图片。
- Base64 图片。

### 图片编辑

作为后续扩展能力。

### Adapter

画图工作台允许使用图片 Provider Adapter 和相关协议适配。

但必须如实记录实际发送的请求和原始响应。

不自动压缩、裁剪或转换用户图片。

如果某个渠道要求特定图片格式，应明确展示格式要求，由用户决定如何处理。

### 图片存储

图片二进制文件不直接塞入 SQLite。

本地归档：

```text
archives/
└── images/
    └── YYYY/
        └── MM/
            └── trace-id/
```

URL 图片只有在用户允许归档时才下载。

下载需要限制：

- 文件大小
- MIME 类型
- 请求超时
- 重定向次数
- 私网地址访问
- 不安全协议

---

## 请求记录与响应分析

所有工作台 API 请求都需要生成 Trace ID。

### Request Record

```text
RequestRecord
├── trace_id
├── parent_trace_id
├── channel_id
├── channel_model_id
├── protocol
├── request_type
├── status
├── request_ref
├── response_ref
├── error_code
├── error_message
├── provider_request_id
├── http_status
├── ttfb_ms
├── ttft_ms
├── duration_ms
├── input_tokens
├── output_tokens
├── cache_tokens
├── tokens_per_second
├── created_at
└── completed_at
```

### 耗时指标

TTFB：首次收到 HTTP 响应字节的时间。

TTFT：首次收到模型内容片段的时间。

Total Duration：请求总耗时。

TPS：仅在数据足够可靠时计算。

没有产生首 Token 的请求，TTFT 保存 NULL，而不是 0。

### 请求详情

包含以下 Tab：

- Overview
- Request
- Response
- Stream
- Timeline
- Processing
- Error Diagnosis

### Raw

非流式请求保存：

- HTTP Status
- Response Headers
- Response Body

流式请求保存完整 SSE 原始内容。

Raw 不因为解析失败而丢失。

### Preview

将不同协议的响应解析为统一展示结构：

- Text
- Thinking
- Tool Call
- Image
- Usage
- Finish
- Error
- Other

Preview 只用于展示和分析，不替代原始数据。

### 历史重新解析

保存 parser_version。

未来解析器升级后，可以重新解析历史 Raw。

重新解析不能覆盖原始响应。

### 重放请求

重放生成新的 Trace ID，并保存：

```text
parent_trace_id
```

重放是用户主动操作，不自动重试。

---

## 处理透明度

所有工具内部处理都应该有记录。

### ProcessingEvent

```text
ProcessingEvent
├── event_id
├── trace_id
├── stage
├── operation
├── input_ref
├── output_ref
├── status
├── changed
├── description
├── metadata
└── created_at
```

### 记录的处理事件

包括：

- Request Serialization
- Authentication Header
- HTTP Request
- Raw Request Saving
- HTTP Response Receiving
- Raw Response Saving
- SSE Parsing
- JSON Parsing
- Preview Generation
- Usage Extraction
- Image Metadata Extraction
- Image Archiving
- Historical Re-parsing
- AI Error Diagnosis

### 展示原则

例如：

```text
用户输入
   │
   ▼
请求序列化
   │
   ▼
认证 Header 添加
   │
   ▼
HTTP 请求
   │
   ▼
原始响应
   │
   ▼
SSE / JSON 解析
   │
   ▼
Preview
```

用户可以查看每一步的状态和处理结果。

必要的序列化不等于模型语义转换。

所有处理事件必须如实描述，不得把工具生成的数据说成渠道原始数据。

---

## 错误诊断与多层网关归因

错误码不等于错误来源。

尤其是 NewAPI、企业网关、上游 NewAPI、云厂商等多层嵌套时，需要分别判断错误性质和错误来源。

### 错误类型

例如：

- DNS_ERROR
- TLS_ERROR
- CONNECTION_ERROR
- TIMEOUT
- HTTP_ERROR
- AUTH_ERROR
- RATE_LIMIT
- MODEL_NOT_FOUND
- PROTOCOL_PARSE_ERROR
- STREAM_INTERRUPTED
- STORAGE_ERROR
- ARCHIVE_ERROR

### 错误来源

```text
client
gateway
upstream_gateway
nested_gateway
provider
local_tool
unknown
```

### 置信度

- confirmed
- probable
- unknown

不能仅凭渠道配置就断言真实请求链路。

如果 NewAPI A 包装了 NewAPI B 的错误，仅凭最终响应可能无法确认来源，应标记为 probable 或 unknown。

### 证据

诊断可以使用：

- 原始 HTTP Status
- 原始错误 Code
- 原始错误 Type
- 原始错误 Message
- Response Headers
- Provider Request ID
- 当前渠道配置
- 已确认的请求链路
- 可选 NewAPI 日志
- 供应商官方文档

事实、推测和未知必须明确区分。

### AI 错误诊断

输出：

1. 错误概述。
2. 错误类型。
3. 可能来源。
4. 来源置信度。
5. 证据。
6. 可能原因。
7. 建议排查步骤。
8. 官方文档链接。
9. 诊断限制。

AI 诊断不得修改请求、响应、渠道配置或自动执行修复。

### NewAPI 错误知识库

区分：

- NewAPI 自身错误。
- NewAPI 包装上游错误。
- NewAPI 原样转发上游错误。
- 请求插件产生的错误。
- 响应插件产生的错误。

需要考虑不同 NewAPI 版本之间的行为差异。

### 百炼错误知识库

后续逐步整理常见错误：

- InvalidApiKey
- AccessDenied
- Arrearage
- ModelNotFound
- NotFound
- Throttling.RateQuota
- Throttling.AllocationQuota
- insufficient_quota
- InvalidParameter
- InternalError
- ServiceUnavailable

错误码、含义和排查建议需要根据官方文档及版本核对。

### NewAPI 只读连接器

作为 P2 功能。

可选连接 NewAPI 管理接口，读取：

- 请求日志
- 错误日志
- Request ID
- 上游调用信息

仅使用只读权限。

不同 NewAPI 实例可能存在版本差异，需要适配对应的数据结构。

不能假定读取到的日志一定能完整还原整个请求链路。

---

## MCP 集成

提供只读 MCP 能力，让外部 AI Agent 可以查询 LCM 中的请求记录和诊断信息。

### 工具列表

```text
get_request_record
get_request_error
diagnose_request_error
search_error_docs
get_processing_events
get_error_chain
search_request_records
```

### 权限限制

MCP 只能查询和分析。

不允许：

- 修改渠道配置。
- 修改 API Key。
- 修改模型配置。
- 修改价格。
- 修改充值记录。
- 自动重试。
- 自动切换渠道。
- 自动修改请求。
- 自动执行诊断建议。

### 敏感信息

默认脱敏。

MCP 不返回 API Key、Bearer Token、AccessKey Secret 或其他渠道凭证。

完整 Prompt 和图片等内容需要根据用户授权决定是否提供。

> **v0.15.0 已提供**：`lcm-mcp` stdio 只读服务器（`src-tauri/src/mcp/` + `src/bin/lcm_mcp.rs`），
> 9 个只读工具——list_channels / list_models / search_request_records / get_request_record /
> get_request_error / get_request_raw / list_balances / list_funds / search_market_prices；
> DB 只读打开、凭证零输出。注册方式见 App 设置页「MCP」卡片。
> `diagnose_request_error` / `search_error_docs` / `get_error_chain` 依赖错误知识库，仍属 Phase 8 后续。

---

## 数据存储

采用 SQLite + 本地文件存储。

### SQLite

用于存储：

- Channels
- Models
- ChannelModels
- ModelPrices
- ChannelRecharges
- ChannelBills
- ChannelBalanceSnapshots
- AgentCompatibility
- RequestRecords
- ProcessingEvents
- RequestAttachments
- ErrorDiagnoses
- Settings

所有数据库变更使用 migrations 管理。

### 文件存储

用于存储：

- Raw Request
- Raw Response
- SSE Stream
- Images
- Backup Files

建议目录：

```text
app-data/
├── database/
│   └── lcm.sqlite
│
├── archives/
│   ├── requests/
│   ├── responses/
│   ├── streams/
│   └── images/
│
├── backups/
│
└── logs/
```

实际目录通过 Tauri App Data Directory 获取，不写死用户目录。

### 文件归档一致性

使用以下流程：

1. 写入临时文件。
2. 校验文件完整性。
3. 计算 checksum。
4. 原子重命名到正式路径。
5. 提交 SQLite 元数据。
6. 失败时清理临时文件和孤儿文件。

### 数据保留

默认长期保留。

用户可以按日期、渠道、模型清理历史数据。

清理时需要同时处理数据库记录和对应文件。

---

## 凭证安全

LCM 是本地管理工具，凭证管理属于核心功能。

用户需要能够查看、编辑和管理已经保存的令牌。

### 凭证存储

敏感凭证不以明文保存到 SQLite。

使用操作系统凭证存储：

- 凭证文件（应用数据目录 credentials.json，0600）
- Windows Credential Manager
- Linux Secret Service

SQLite 保存 credential_ref。

### 凭证类型

支持：

- API Key
- Bearer Token
- x-api-key
- NewAPI 管理 Token
- AccessKey ID
- AccessKey Secret
- 自定义敏感 Header
- 用户标记为 Sensitive 的字段

### 默认显示

所有敏感字段默认以星号掩码展示。

例如：

```text
API Key
sk-********************
```

用户点击眼睛图标后显示明文，再次点击恢复掩码。

### 编辑回显

编辑渠道时允许读取已保存凭证并回显。

交互要求：

1. 默认仍然掩码。
2. 用户点击眼睛后查看明文。
3. 未修改的凭证不重新写入。
4. 修改后的凭证保存到凭证文件。
5. 支持主动清空或替换。
6. 页面关闭或离开时尽可能清理前端明文状态。

凭证读取通过受控的 Tauri Command 执行。

不能为了实现编辑回显而将密钥明文写入 SQLite。

### 凭证复制

支持用户主动复制凭证。

可以提供复制前二次确认的安全选项。

### 防止凭证泄露

凭证不得进入：

- 普通应用日志。
- 调试输出。
- AI 诊断上下文。
- MCP 返回结果。
- 普通配置导出。
- 非授权的错误报告。

Raw 请求可能包含认证 Header，因此界面展示和导出时需要执行脱敏策略，同时保留必要的受控原始数据访问能力。

### 安全边界

受控读取并不代表凭证能够抵御本地管理员、恶意进程或已被攻陷的应用。

不能承诺明文在前端内存中绝对不可读取。

后续可以增加系统生物识别或系统凭证验证作为额外解锁保护。

---

## 备份与恢复

### 完整备份

备份包含：

- SQLite 数据库。
- Raw 请求和响应。
- SSE 文件。
- 图片文件。
- 相关配置。
- 关联元数据。

使用 `.lcmbackup` 文件格式。

完整备份采用用户密码加密。

可以由用户选择是否包含凭证。

如果包含凭证，必须经过额外加密保护，不能把凭证文件中的明文直接写入普通备份文件。

### 普通配置导出

可以导出：

- 渠道配置。
- 模型配置。
- 价格配置。
- Agent 兼容性信息。

默认不包含任何凭证。

### 恢复

支持从完整备份恢复数据库和文件。

恢复前应进行完整性检查。

恢复过程需要避免覆盖当前数据而没有确认。

---

## 技术栈

### 桌面端

- Tauri 2
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Zustand
- TanStack Query
- React Router
- Monaco Editor
- Recharts

### Rust 后端

- Rust
- Tokio
- Reqwest
- Serde
- SQLite
- SQLx 或等效数据库访问层

### 存储与安全

- SQLite
- 独立凭证文件（0600）
- 本地文件归档
- 加密备份

### 构建

GitHub Actions。

目标平台：

- macOS
- Windows
- Linux

第一阶段不实现自动更新。

---

## 项目结构

建议采用以下结构：

```text
lcm/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── channels/
│   │   ├── models/
│   │   ├── pricing/
│   │   ├── billing/
│   │   ├── agent-compatibility/
│   │   ├── api-testing/
│   │   ├── image-workbench/
│   │   ├── requests/
│   │   └── settings/
│   ├── hooks/
│   ├── lib/
│   ├── stores/
│   ├── types/
│   └── main.tsx
│
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── services/
│   │   ├── channels/
│   │   ├── models/
│   │   ├── credentials/
│   │   ├── billing/
│   │   ├── agent/
│   │   ├── workbenches/
│   │   │   ├── api_testing/
│   │   │   └── image/
│   │   ├── adapters/
│   │   │   ├── providers/
│   │   │   └── protocols/
│   │   ├── requests/
│   │   ├── processing/
│   │   ├── diagnostics/
│   │   ├── storage/
│   │   ├── backup/
│   │   └── main.rs
│   ├── migrations/
│   ├── capabilities/
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── security.md
│   ├── agent-compatibility.md
│   └── adapter-boundaries.md
│
├── tests/
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
└── README.md
```

### 架构边界

`agent/` 不得调用 `adapters/`。

`workbenches/api_testing/` 可以调用协议和供应商 Adapter。

`workbenches/image/` 可以调用图片供应商 Adapter。

通过模块依赖约束和自动化测试，确保 Agent 路径不会意外引入 Adapter。

---

## 开发计划

### Phase 0：项目初始化

- 初始化 Tauri 2。
- 初始化 React + TypeScript。
- 配置 Tailwind 和 shadcn/ui。
- 配置 Rust 基础结构。
- 配置 SQLite。
- 建立 migrations。
- 建立基础导航和布局。
- 建立跨平台构建流程。

### Phase 1：渠道管理

- 渠道 CRUD。
- 服务商模板。
- 多渠道实例。
- 连接配置。
- 敏感凭证管理。
- 凭证默认掩码。
- 凭证主动查看。
- 编辑回显。
- 外部链接。
- Agent 兼容性信息。
- Agent Launcher 架构。
- Claude Code CLI 环境变量启动。
- Codex CLI 独立 CODEX_HOME 启动。
- AgentLaunch 启动快照。

### Phase 2：模型和价格

- 全局模型管理。
- 渠道模型管理。
- 模型列表获取。
- 模型导入。
- 能力标记。
- 价格管理。
- 价格历史。
- 折扣计算。

### Phase 3：API 测试工作台

- OpenAI Chat Completions。
- OpenAI Responses。
- Anthropic Messages。
- 非流式请求。
- 流式请求。
- 多轮消息。
- 参数编辑。
- Raw JSON。
- 自定义 Header。
- 自定义 Query。
- Protocol Adapter。
- Provider Adapter。
- Raw 请求和响应。
- Preview。
- ProcessingEvent。

### Phase 4：画图工作台

- Vision 图片上传。
- 图片拖拽和粘贴。
- 多图片输入。
- 图片生成。
- 图片 Preview。
- 图片本地归档。
- 图片原始响应。
- 图片请求记录。
- 图片 Adapter。

### Phase 5：请求记录和 Dashboard

- Trace ID。
- 请求历史。
- 请求详情。
- Raw 查看。
- Preview 查看。
- SSE 原始流查看。
- TTFB / TTFT / TPS。
- Token Usage。
- 本地费用估算。
- Dashboard。
- 历史请求重放。
- 历史重新解析。

### Phase 6：资金与账单

- 多次充值记录。
- 充值编辑和删除。
- 充值统计。
- 供应商账单录入。
- 月度账单统计。
- 余额快照。
- Dashboard 资金统计。
- 不同币种分组。

### Phase 7：备份和跨平台完善

- 完整备份。
- 加密备份。
- 可选凭证备份。
- 数据恢复。
- 三平台打包。
- 文件归档一致性检查。
- 安全检查。

### Phase 8：高级诊断与 MCP（P2）

- 错误知识库。
- AI 错误诊断。
- 多层网关错误归因。
- NewAPI 只读连接器。
- MCP 只读工具。
- 供应商账单 CSV / Excel 导入。
- 图片编辑。
- 更完善的多模态能力统计。

---

## 安全边界

LCM 采用本地优先设计。

需要注意：

1. 本地数据不代表天然安全。
2. 凭证使用独立凭证文件保存（0600；macOS Keychain 因开发期二进制签名变化逐次弹授权窗，已弃用并自动迁移）。
3. 敏感信息默认掩码。
4. 明文查看必须由用户主动操作。
5. 日志不记录凭证明文。
6. MCP 不返回凭证。
7. 普通配置导出不包含凭证。
8. 完整备份使用加密。
9. HTTP 重定向时需要清除不应跨域传递的认证 Header。
10. 图片 URL 下载需要防止 SSRF。
11. TLS 默认启用证书验证。
12. Tauri 使用最小权限配置。

---

## 设计约束

以下规则是项目长期维护必须遵守的约束。

### Agent 约束

- Agent 原生调用不经过 Adapter。
- 不自动进行协议转换。
- 不自动修改请求。
- 不自动修改响应。
- 不自动注入额外 Prompt。
- 不自动注入影响模型行为的 Header。
- 不自动调整参数。
- 不自动修复兼容性。
- 不自动切换模型和渠道。
- 不自动重试。
- 渠道切换只改变下一次启动的 Agent 进程配置。
- 不通过修改用户已有 Agent 配置文件实现渠道切换。
- 不默认提供本地网关或代理。
- 不兼容时如实展示。

### 工作台约束

- API 测试工作台允许 Adapter。
- 画图工作台允许 Adapter。
- Adapter 处理过程必须可追溯。
- 原始请求和响应必须保留。
- Preview 不得覆盖 Raw。
- 不能将工具生成的内容伪装成供应商原始内容。

### 数据约束

- 不丢弃原始请求和响应。
- 不覆盖历史价格。
- 不覆盖人工维护的模型备注。
- 不将本地测试费用等同于供应商账单。
- 不将估算余额等同于供应商真实余额。
- 数据库与文件归档必须保持一致。

### 安全约束

- 密钥不以明文存入 SQLite。
- 默认掩码显示。
- 用户可以主动查看和编辑已有凭证。
- 不向日志、诊断和 MCP 暴露凭证。
- 普通配置导出不包含密钥。
- 完整凭证备份必须加密。

### 错误诊断约束

- 错误性质和错误来源分开。
- 事实和推测分开。
- 置信度必须明确。
- 证据不足时允许 unknown。
- 不得仅根据渠道配置推断真实调用链路。
- 不允许 AI 自动修改请求或渠道配置。

---

## 最终产品原则

LCM 的价值不在于让所有渠道表现得一样，而在于让用户清楚地知道：

- 我配置了什么渠道。
- 这个渠道实际提供什么模型。
- 这个模型支持哪些能力。
- 这个渠道对不同 Agent 是否兼容。
- API 请求实际上发送了什么。
- 渠道原始返回了什么。
- 工具对数据做了什么处理。
- 请求为什么失败。
- 错误可能来自哪一层。
- 渠道投入了多少钱。
- 供应商实际账单是多少。

**不掩盖渠道差异，不伪造兼容性，不改变原始行为，不隐藏工具处理过程。**

这就是 LCM 的核心价值。