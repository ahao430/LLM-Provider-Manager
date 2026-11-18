# 更新日志

本项目所有显著变更都记录在此文件中。

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本策略见 [AGENTS.md](./AGENTS.md)：每次改动第三位 +1（patch），较大改动第二位 +1（minor），第一位仅在维护者要求时升级。

## [0.10.5] - 2026-11-18

新增「模型列表」菜单（渠道管理与市场信息之间）。

### 新增

- **模型维度聚合**：全部渠道的模型平铺为一张表，同名模型（actualModelId，大小写不敏感）合并为一行；渠道列合并展示渠道徽章（禁用渠道灰显，超过 3 个折叠为 +N）。
- **标注价范围**：同名模型多渠道标注价按币种分组取 min~max（如 `CNY 2~4 / 8~16`），单值直接显示；仅参考不算费用。
- **点击查看详情**：行点击弹出详情，逐渠道列出协议、渠道/模型启用状态、标注价，并提供跳转渠道详情入口。
- **分渠道测试**：测试按渠道分开——行内展示前两个渠道的测试按钮（多渠道时按钮带渠道名，其余收进详情）；详情弹窗内每渠道独立测试（用该渠道模型的协议）。测试按钮抽取为共享组件 `ModelTestButton`，渠道列表展开行复用。
- **搜索与筛选**：按模型 ID / 渠道名搜索，按类型（多模态 / 图像 / 文本 / 决策）筛选。
- 后端新增 `list_all_channel_models` 聚合查询（channel_models JOIN channels，含标注价三字段）与命令；导航新增「模型列表」（Boxes 图标，路由 /models）。

## [0.10.4] - 2026-11-18

渠道列表交互增强。

### 新增

- **凭证复制**：渠道列表「凭证」列旁新增复制按钮，一键将主凭证明文写入系统剪贴板（后端从 keyring 读取直写剪贴板，明文不进 UI、不进日志；需官方 `tauri-plugin-clipboard-manager`，能力仅授权 `allow-write-text`）。
- **行内编辑**：每行右侧新增编辑按钮，直接打开渠道编辑弹窗（不必先进详情页）。
- **展开查看模型**：点击行首箭头展开该渠道的模型清单（模型 ID / 类型 / 协议 / 启用状态），数据走既有 `channel-models` 查询缓存。
- **逐模型测试**：展开的每个模型右侧有「测试」按钮，用该模型自身的协议发送最小请求（写入测试记录）；`quick_test_channel` 新增可选 `model` 参数，缺省行为不变。

## [0.10.3] - 2026-11-18

### 移除

- Dashboard 精简：去掉「本地测试费用（估算）」卡片、「Token 用量」卡片、「月度请求趋势」与「月度本地估算费用」图表。保留渠道 / 模型 / 测试统计卡、累计充值与供应商账单（分开统计）、最近测试与最近错误列表。后端统计接口与逐条测试记录中的 Token / 费用字段不变。

## [0.10.2] - 2026-11-18

### 移除

- 市场信息页去掉「我的标注价」列：市场页只展示抓取的市场价格；渠道标注价仍在「渠道详情 → 模型」列表中显示（`list_channel_price_annotations` 后端接口保留）。

## [0.10.1] - 2026-11-18

市场信息支持「一键抓取最新数据」。

### 新增

- **「抓取数据」按钮**（市场信息页）：实时拉取 [models.dev/api.json](https://models.dev/api.json)（机器可读价格源：官方第一方厂商、统一 USD/百万 token），映射为 16 家厂商 / 280+ 模型的快照，存入本地 `market_cache` 表；此后展示优先用抓取缓存，页头标注数据来源与抓取时间。抓取为异步 HTTP，不持数据库锁。
- **白名单过滤**：models.dev 收录 300+ 供应商（多为聚合中转），只收录 16 家官方厂商（OpenAI / Anthropic / Google / xAI / Mistral / Cohere / Perplexity / Meta / DeepSeek / 阿里云百炼 / Kimi / 智谱 / 豆包 / MiniMax / 阶跃 / 小米）；无价模型自动跳过；`reasoning` 归为决策类型、输入含图归多模态、输出含图归图像。
- **刷新脚本** `pnpm market:refresh`（scripts/fetch-market-prices.mjs）：同一白名单与映射规则，重新生成内置 `data.json`；本次已运行，内置快照更新为 **2026-11 当前数据**（替换原手工整理的 2025-09 CNY 快照，统一 USD）。

### 变更

- `list_market_prices` 改为「抓取缓存优先、内置兜底」，返回值带 `source` / `fetchedAt` 字段。
- 不爬 HTML 价格页（JS 渲染、结构脆弱），只消费机器可读 JSON 源——这是「自动抓取」能长期稳定的前提。

### 数据库迁移 0008

- 新建 `market_cache` 单行表（snapshot_json / source / fetched_at）。

## [0.10.0] - 2026-11-18

市场信息 + 渠道模型标注价格 + 测试功能收敛为「测试中心」。

### 新增

- **市场信息页**：内置 9 家厂商（OpenAI / Anthropic / Google / xAI / DeepSeek / 阿里云百炼 / 智谱 / 月之暗面 / 火山方舟）模型价格快照，标注快照日期，支持厂商筛选与模型搜索；点击厂商名经系统浏览器打开官方价格页；已标注价格的渠道模型按模型 ID 并排展示「我的标注价」，供比较。快照随应用打包、不联网抓取、仅供参考。
- **渠道模型标注价格**：模型列表每行可标注每百万 token 输入 / 输出价 + 币种（CNY / USD）。**仅用于标注与市场比较展示，不参与本地测试费用计算**（费用估算仍走 model_prices 价格历史，两套独立）。
- `tauri-plugin-opener`：外链经系统浏览器打开（市场信息价格页），能力配置追加 `opener:default`。

### 变更

- **测试功能收敛为「测试中心」一个菜单**（导航：Dashboard / 渠道管理 / 市场信息 / 测试中心 / 测试记录 / 设置）：
  - API 测试（原 API 测试工作台，路由 /testing/api）
  - Agent 测试（原内嵌 Agent，/testing/agent）
  - 画图 = 图片生成 + 图片编辑（/testing/image）
  - 图像理解（/testing/vision，从原图片工作台拆出）
  - 子 Tab 路由化，支持前进 / 后退；旧路由 /agent、/api-testing、/image-workbench 移除。
- 顶部面包屑按前缀匹配子路由（/channels/:id、/testing/:tab 正确高亮所属菜单）。

### 数据库迁移 0007

- `channel_models` 增加 price_input_per_1m / price_output_per_1m / price_currency（标注价，可空）。币种为空时价格一并忽略，避免出现"有价无币种"。

## [0.9.0] - 2026-11-18

按用户反馈进行五大交互重构。

### 1. 渠道管理重构

- **去掉新建/编辑中的协议、认证方式、超时、自定义 Header**：认证按协议自动派生（Anthropic → x-api-key + anthropic-version；OpenAI 系 → Bearer），超时统一 120s，TLS 验证默认启用。
- **三协议 Base URL**：默认展示 Chat Completions 地址；Anthropic / Responses 专用地址默认相同，可展开单独填写（留空即回退）。
- **官网链接改为单输入框**（可选）。
- **模型管理按钮**：弹窗内获取模型列表 → 全选 / 多选 → 确认导入（不覆盖已有）；手动添加模型（模型名称 + 模型 ID + 类型标记：多模态 / 图像 / 文本 / 决策）；类型可在模型列表中随时改。
- **快速测试按钮**：三种协议格式（Chat / Responses / Anthropic）下拉选择，发送最小请求验证连通性（写入测试记录）。
- **余额查询按钮**：按服务商类型配置查询路径（如 NewAPI /dashboard/billing/subscription）+ 余额 JSON 路径（如 data.total_balance）；支持立即查询（只读 GET，Bearer），点路径提取余额。

### 2. 数据库迁移 0006

- `channels` 增加 chat/anthropic/responses 三个 Base URL 列（旧 base_url 迁移为 chat_base_url）。
- `channel_models` 增加 model_type 列（multimodal / image / text / decision，CHECK 约束）。
- `agent_conversations` 增加 mode 列（claude_code / codex）。

### 3. 内嵌 Agent 模式化

新建对话不再堆设置：**先选 Claude Code / Codex 模式**（自动决定协议与预设 system prompt），**页面上选渠道和模型**（三联动），开始连续对话；一键新建新对话。

### 4. API 测试工作台单轮化

去掉多轮消息编辑，改为**单条消息输入**；模型下拉选择后 **ID 自动填入**；参数（temperature/top_p/max_tokens/stop）折叠为可展开区；保留流式与 Raw JSON 模式。

### 5. 图片工作台

导航从「画图工作台」更名为「**图片工作台**」；新增**图片编辑** Tab（multipart /images/edits：原图 + 可选蒙版 + Prompt，图片原样上传不压缩）；生成 / 理解 / 编辑三 Tab 统一结果卡片。

### 变更

- `ChannelInput` 字段精简（name / providerId / 三 URL / officialUrl / notes / primaryCredential）。
- 启动器按协议取 Base URL（Claude Code → anthropic 地址；Codex → chat 地址）；令牌以 sk-ant- 开头时按 API Key 注入。
- 模型能力（capabilities 六项三态）简化为模型类型四选一，符合实际使用习惯。

### 已知限制

- Anthropic 兼容渠道如果只配了 chat 地址，Vision 走 chat 地址（请求头自动带 anthropic-version）。
- 余额查询仅支持 Bearer 认证的只读 GET（NewAPI / OneAPI 风格）。
- 图片编辑仅支持 openai 格式的 /images/edits。

## [0.8.1] - 2026-11-18

### 变更

- **UI 术语调整**：主导航与各页面中的「请求记录」更名为「**测试记录**」（Dashboard 最近列表、详情页标题、内嵌 Agent 与设置页文案同步）。后端数据语义不变（request_type、表名与 PLAN.md 设计文档保持原术语）。

## [0.8.0] - 2026-11-18

新增导航模块「内嵌 Agent」：应用内多轮对话。

### 新增

- **内嵌 Agent**：用已配置的渠道直接进行多轮流式对话（openai_chat / anthropic_messages 双协议），对话列表持久化（自动以首条回复命名）、System Prompt、上下文窗口最近 20 条、模型可选自渠道模型列表。
- **透明度不打折**：每轮请求写入 request_records（request_type = agent_chat，parent_trace_id = 会话 ID），Raw 请求 / SSE 响应照常归档，处理事件完整记录；助手消息可一键跳转对应请求详情（Raw / 处理过程 / 费用估算）。
- **流中断容错**：中断前已收到的内容保留在消息中并如实标记 stream_error。
- **数据库迁移 0005**：agent_conversations / agent_messages（消息级联删除）。
- **测试**：+1（对话与消息流、角色校验、级联删除）。

### 变更

- 主导航新增「内嵌 Agent」（位于渠道管理之后）；导航测试覆盖新增项的唯一性。

### 已知限制

- 暂不支持 Tool Calling 与图片输入（保持纯文本多轮）；上下文窗口固定最近 20 条（暂无 token 预算裁剪）。
- 新建对话须先在渠道管理中启用渠道并配置模型。

## [0.7.0] - 2026-11-18

Phase 7（备份和跨平台完善）核心完成。

### 新增

- **加密备份（.lcmbackup）**：数据库（`VACUUM INTO` 快照）+ 文件归档 + manifest 打包为 zip，整包 AES-256-GCM 加密（PBKDF2-HMAC-SHA256，200,000 轮派生密钥）；文件格式带魔数与版本。
- **可选凭证备份**：勾选后凭证写入**独立加密段**（独立盐与密钥派生），绝不以明文进入普通备份；恢复时自动写回系统凭证库（逐条报告成功 / 失败）。
- **恢复**：完整性检查（manifest / 数据库必须存在）、**回滚保护**（恢复前把当前数据移入 `backups/pre-restore-<ts>/`）、防路径穿越；恢复后提示重启应用生效。
- **归档一致性检查**：对比数据库引用与 `archives/` 磁盘文件，报告缺失文件与孤儿文件（含体积）；只报告不自动处理。
- **数据清理**：删除指定日期之前的请求记录（处理事件级联）与其归档文件；管理数据（渠道 / 模型 / 价格 / 充值）不受影响；两步确认。
- **Settings 页重构**：应用信息 / 数据库状态 / 备份创建（密码 + 凭证开关）/ 恢复（浏览 + 密码 + 二次确认）/ 一致性检查 / 数据清理。
- **CSP 收紧**：`tauri.conf.json` 从 null 收紧为白名单 CSP（`ws://localhost:5173` 仅为开发 HMR 例外，见 docs/security.md）。

### 变更

- `AppError` 新增 Zip 错误变体；新增依赖 zip / aes-gcm / pbkdf2 / sha2 / rand。
- 归档写入统一走临时文件 + 原子重命名（Phase 3 起约定，本阶段梳理）。

### 已知限制

- 恢复后需重启应用（旧数据库连接指向原文件句柄）。
- 凭证备份依赖系统凭证库可读；Linux 无 Secret Service 环境下凭证段可能为空。
- 图片 URL 形态的下载归档仍延后（配合 SSRF 防护在 Phase 8）。

## [0.6.0] - 2026-11-18

Phase 6（资金与账单）主体完成。

### 新增

- **充值记录**：多笔录入（金额 / 币种 / 支付方式 / 流水号 / 充值时间 / 备注）、编辑与删除；按渠道查看。
- **供应商账单**：手工录入（账期 YYYY-MM + 金额 + 币种 + 来源），同渠道同账期同来源唯一约束；删除支持。
- **余额快照**：人工抄录供应商控制台余额（不做自动同步，如实声明）。
- **渠道资金汇总**：充值合计 / 账单合计 / **估算余额**（充值 − 账单，负数如实显示并说明不含赠送 / 退款 / 其他消费）；不同币种分组，不相加。
- **前端**：渠道详情新增「资金」Tab（汇总卡片 + 三个记录表 + 三个录入对话框）。
- **测试**：+3（充值 CRUD 与按渠道汇总、账单唯一性与账期校验、估算余额为负如实呈现、快照增删）。

### 变更

- 充值输入收敛为 `RechargeInput` 结构（新增 / 编辑共用），Tauri 命令参数同步收敛。

### 已知限制

- 估算余额不包含赠送额度、退款、人工调整与其他消费，不能当作真实供应商余额。
- 供应商账单 CSV / Excel 导入在 Phase 8。
- 账单金额录入后仅允许改金额与备注（账期 / 来源变更通过删除重录）。

## [0.5.0] - 2026-11-18

Phase 5 收尾（Dashboard + 费用估算 + 重放）完成，PLAN Phase 5 全部落地。

### 新增

- **本地费用估算**：按「生效日期 ≤ 请求创建日期」的价格版本计算单条请求费用（Token 数 × 单价 ÷ 计价单位 × 折扣），支持 per_1m_tokens / per_1k_tokens；只有 Token 与对应价格都存在的项目才计入，不虚构完整账单；严格区别于供应商账单。
- **Dashboard 真实统计**：渠道（启用/总数）、模型、请求总量与成功率、Token 用量；**三类金额分开呈现**（累计充值 / 供应商账单 / 本地估算费用，按币种分组不相加）；近 6 个月请求趋势与月度费用趋势（Recharts）；最近请求与最近错误列表。
- **历史请求重放**：详情页一键重放——读取原 Raw 请求体**原样重发**（凭证按当前渠道配置重新注入），生成新 Trace 并记录 `parent_trace_id`；流式原请求以同一请求体重放（SSE 完整文本归档）。重放是用户主动操作，不自动重试。
- **数据库迁移 0004**：`request_records` 补充 `model` 列（0001 遗漏，Phase 3 代码引用，如实补齐）。
- **测试**：+4（费用估算折扣与单位换算、无绑定时如实为空、空统计、充值/账单分账）。

### 变更

- `insert_pending` 支持 `parent_trace_id`（图片生成协议标记修正为 `openai_images`，Vision 标记为 `vision`）。

### 修复

- **schema 缺口**：`request_records.model` 列此前在迁移中缺失（Phase 3 完成请求会写入失败），本轮测试发现并补齐——新装与存量库都会由迁移 0004 处理。

### 已知限制

- 月度费用趋势不含按张计价等非 Token 单位；估算不含阶梯计价。
- 重放不区分原请求是否为流式以外的时序差异（重放即"当前时间重新执行一次"，指标以重放时为准）。

## [0.4.0] - 2026-11-18

Phase 4（画图工作台）主体完成。

### 新增

- **图片生成**：OpenAI Images 兼容接口（POST /images/generations），Prompt / 尺寸 / 数量 / response_format / 其他原生参数；`b64_json` 自动归档到 `archives/images/YYYY/MM/<trace-id>/`（原子写入 + request_attachments 元数据），`url` 形态仅记录原文**不自动下载**（外网请求需用户确认）；结果画廊支持从归档懒加载展示。
- **图片理解（Vision）**：openai_chat（image_url：URL / data base64）与 anthropic_messages（image.source：base64 / url）双协议；**拖拽 / 粘贴 / 选择本地图片**（FileReader 转 base64，原样发送不压缩不转换）、URL 添加、多图；Anthropic 自动补 max_tokens 默认值与 media_type。
- **请求记录打通**：生成与 Vision 均写入 request_records（request_type = image_generation / vision），复用 Raw 归档（请求 Header 脱敏；Vision 请求 Raw 中 base64 以长度摘要代替，原始输入由用户本地持有）、处理事件与请求详情页。
- **归档读取**：`read_archived_image` 命令（含路径穿越防护）供前端展示归档图。
- **测试**：base64 编解码往返与标准向量、原样传递语义在 builder 注释与事件描述中固化。

### 变更

- `util::http_client` 统一 HTTP 客户端构建（API 测试 / 模型获取 / 画图三处共用），TLS 验证默认启用。
- `api_testing/builder` 重构出 `request_target`（URL + 认证 + 自定义 Header / Query 组装），工作台与画图模块共用。

### 已知限制

- 图片编辑 / Variation 属后续扩展（PLAN）。
- Vision 请求 Raw 归档不含完整 base64（体积原因），以摘要代替；实际发送内容为完整请求体。
- URL 形态生成结果的下载归档与 SSRF 防护在 Phase 7 完善。

## [0.3.0] - 2026-11-18

Phase 3（API 测试工作台 + 请求记录）主体完成。

### 新增

- **API 测试工作台**：OpenAI Chat Completions / OpenAI Responses / Anthropic Messages 三协议独立适配（system 字段与参数按协议映射，全部映射规则写入 ProcessingEvent）；Stream / Non-stream；多轮消息编辑；参数面板（temperature / top_p / max_tokens / stop）；临时 Header 覆盖；**Raw JSON 模式**（请求体用户原样 JSON，不注入任何字段）。
- **流式 SSE**：增量解析器（跨 chunk 分块安全、容忍行首空白、注释与 event 字段处理）；首 Token / 增量 / usage 事件实时推送（Tauri Channel）；SSE 原文（含顺序与中断前内容）完整归档。
- **Raw 归档**：请求与响应原子写入 archives/{requests,responses}，Header 自动脱敏（Authorization / x-api-key 只保留前 6 字符）；路径穿越防护；解析失败不丢原始数据。
- **Preview**：统一提取 text / thinking / tool_calls / usage / finish / provider_request_id；错误时保留原始错误对象，不伪装成正常响应。
- **请求记录**：Trace ID 贯穿；状态区分 success / http_error / protocol_error / stream_error；TTFB / TTFT / 总耗时 / TPS（仅流式且数据可靠时计算，非流式 TTFT 为 NULL 而非 0）；Token 用量。
- **处理透明度**：序列化 / 认证注入 / Raw 保存 / SSE 解析 / Preview 生成每步写 ProcessingEvent（changed 标记），详情页时间线展示。
- **请求记录页**：列表（渠道 / 模型 / 协议 / 状态 / 耗时 / Tokens / TPS）+ 详情页（Overview / Raw 查看请求与响应 / Processing 事件 / 历史重新解析 / 错误诊断占位）。
- **历史重新解析**：对已归档 Raw 用当前解析器重新提取 Preview（含流式 SSE 重放），不覆盖原始数据。
- **测试**：Rust 26 项（三协议 Preview 提取、SSE 分块解析、各协议增量提取、错误透明保留等）。

### 变更

- 流式命令拆为「异步接收（无数据库锁）+ 同步收尾（锁内）」两阶段，锁不跨 await。
- reqwest 启用 `stream` feature，新增 futures-util。
- `util::effective_base_url` 被工作台与模型获取共用。

### 已知限制

- Tool Calls 的工具消息（role=tool / tool_result 块）需用 Raw JSON 模式构造。
- Adapter 独立层（Provider 差异化处理）尚未拆分，当前协议序列化即最小适配，映射规则已透明记录。
- 非流式响应的 duration 使用命令层计时（含归档前后开销，略大于纯网络耗时）。

## [0.2.0] - 2026-11-18

Phase 2（模型和价格）主体完成。

### 新增

- **全局模型**：统一模型身份管理（创建 / 重命名 / 删除），名称大小写不敏感查重，被渠道模型引用时不可删除。
- **渠道模型**：全局模型 ↔ 渠道实际模型绑定（`actual_model_id`），同渠道唯一；协议按渠道模型独立设置；启用开关。
- **能力标记**：视觉 / 工具调用 / 思考 / 流式 / 图像输入 / 图像输出，统一 supported / unsupported / unknown 三态；导入的新模型默认全「未知」，不做跨渠道推断。
- **模型列表获取**：调用渠道 `/models` 接口（OpenAI `{data:[{id}]}` 与 Anthropic `{data:[{id,display_name}]}` 两种形状，按认证方式注入 Header，anthropic 协议自动带 `anthropic-version`）；HTTP 错误透明携带状态码与响应片段；不可解析时如实报错并展示顶层字段。
- **获取与导入分离**：获取结果先展示，用户勾选确认后才写入；已存在的 `(channel_id, actual_model_id)` 自动跳过并保留人工备注 / 能力 / 价格配置（导入结果如实报告 created / skipped）。
- **价格管理**：以渠道模型为维度；六个价格项（输入 / 输出 / 缓存读 / 缓存写 / 图像 / 其他）+ 币种 + 计价单位 + 生效日期；**历史追加式**——同一生效日期已存在版本时拒绝写入，已生效 / 历史版本不可删除，只允许删除未来生效版本；折扣按百分比计算（80 = 八折），生效价格同时呈现官方价与折扣价；非法折扣按原价计不放大。
- **生效价格查询**：按当天（本地时区）取 `effective_date` 最新版本，无则如实为空。
- **HTTP 客户端**：引入 reqwest（rustls-tls），TLS 证书验证默认启用、仅用户显式关闭时放宽。
- **前端**：渠道详情新增「模型」「价格」Tab（获取导入面板、渠道模型列表与能力编辑、全局模型管理、生效价格卡片、价格历史表、新增版本表单）。

### 变更

- `util::effective_base_url` 从 agent/launcher 上移为通用工具（模型获取复用，避免 models → agent 依赖）。

### 已知限制

- 模型获取当前仅适配 OpenAI / Anthropic 兼容列表形状，特殊网关请看错误信息中的原始响应片段。
- 价格历史仅支持新增与删除未来版本，不支持修订历史记录（数据约束）。
- 折扣为简单百分比，暂不支持阶梯 / 分层计价。

## [0.1.0] - 2026-11-18

Phase 1（渠道管理 + Agent 启动器）主体完成。

### 新增

- **渠道 CRUD**：服务商选择（内置模板预填 Base URL / 协议）、Base URL / API Path / 默认协议 / 认证方式 / 请求超时 / TLS 验证、自定义 Header（支持「敏感」标记）、外部链接、备注；渠道列表（TanStack Table，排序 + 启用开关）与详情页（概览 / 凭证 / 兼容性 / 启动器 Tabs）。
- **凭证安全**：接入系统凭证库（macOS Keychain / Windows Credential Manager / Linux Secret Service）；SQLite 仅存凭证引用；默认掩码展示，眼睛图标受控查看明文，支持替换与清空；敏感自定义 Header 每项独立凭证条目；删除渠道时联动清理全部凭证。凭证不进入日志、诊断与导出。
- **Agent 兼容性**：按渠道维护 claude_code / codex 的 supported / unsupported / unverified 状态与测试证据（upsert，unverified 不记 tested_at）。
- **Agent Launcher（Phase 1 双 Agent）**：
  - Claude Code CLI：子进程环境变量注入（ANTHROPIC_BASE_URL / AUTH_TOKEN / API_KEY / MODEL / CUSTOM_HEADERS），含 OAuth 认证冲突提示；不修改 `~/.claude/settings.json`。
  - Codex CLI：独立 CODEX_HOME（`agent-profiles/codex/<channel>/config.toml`，toml 生成，Token 经 env_key 注入，wire_api 随渠道协议）；不修改用户 `~/.codex`。
  - 启动快照 `agent_launches`（仅存凭证引用，不含 Token 明文）；守护线程回填 `exited_at`；子进程 stdout/stderr 归档到 `logs/agent-launches/`。
  - 项目工作目录选择（Tauri dialog 插件，capabilities 保持最小权限 + `dialog:default`）。
- **前端**：shadcn/ui 组件补齐（dialog / select / tabs / textarea / switch / table / form），React Hook Form + Zod 表单，TanStack Query 缓存与失效，Sonner 通知。
- **数据库迁移**：`0002_agent_launches`、`0003_seed_providers`（内置 5 个服务商种子）。
- **测试**：Rust 10 项单元测试 + 架构边界测试（迁移幂等 / 渠道 CRUD / 服务商种子 / 凭证掩码 / Launcher 纯函数 / 兼容性 upsert）。

### 变更

- `storage::database` 拆分出 `open_connection` / `db_path`，供启动器守护线程独立建连。
- TanStack Table 固定 v8 稳定线（v9 为重写版本，暂不跟进）。

### 已知限制

- 凭证读写首次访问可能触发系统授权弹窗。
- Codex `config.toml` 的 `base_url` 直接取渠道配置，特殊网关需自行调整 API Path。
- Windows 下 npm 安装的 CLI 经 `cmd /C` 启动。
- 模型列表获取与价格管理属 Phase 2，启动器暂以手填模型名过渡。

## [0.0.2] - 2026-11-18

落地「Agent 启动器」架构决策：渠道切换只改变 Agent 下一次启动的配置，不改变 Agent 发出的请求，不引入本地网关。

### 新增

- **PLAN.md**：新增「Agent 启动器」章节（三种方案对比、per-Agent 技术决策、Claude Code 环境变量启动、Codex 独立 CODEX_HOME、启动流程、切换语义、AgentLaunch 快照）；「非目标」「设计约束」「Phase 1 计划」同步更新。
- **docs/agent-launcher.md**：Agent 启动器设计文档（环境变量表、Codex config.toml 模板、启动流程约定、快照规则、模块关系）。
- **数据库迁移 0002**：`agent_launches` 表（启动快照：agent_type / channel / launch_method / base_url / model / credential_ref / 脱敏 config_snapshot / 进程与时间信息），仅存凭证引用不存 Token 明文。
- **Rust**：`agent/launcher` 子模块占位（含设计约束说明），架构边界测试继续覆盖（agent/ 禁止依赖适配器模块）。

### 变更

- docs/architecture.md：Agent 原生路径补充 Agent Launcher 说明，模块表更新。
- README.md / AGENTS.md：功能概览、路线图、文档索引与第 9 条架构红线（启动式渠道切换）。

## [0.0.1] - 2026-11-18

首个版本。完成 Phase 0（项目初始化）。

### 新增

- **项目骨架**：Tauri 2 + React + TypeScript + Vite + Tailwind CSS v4 初始化，配置 shadcn/ui 设计令牌与 `components.json`（组件按需通过 CLI 添加）。
- **前端技术栈接入**：React Router（导航）、TanStack Query（请求缓存）、Zustand（全局状态）、Sonner（通知）、Lucide（图标）；TanStack Table、React Hook Form + Zod、Recharts、Monaco Editor 作为依赖纳入（随功能 Phase 启用）。
- **基础导航与布局**：侧边栏（可折叠）+ 顶栏（当前页 + 版本徽标）+ 六个主页面占位（Dashboard、渠道管理、API 测试工作台、画图工作台、请求记录、设置）。
- **设置页（可用）**：通过 Tauri Command 展示应用信息（名称 / 版本 / 数据目录）与 SQLite 各表行数，打通前端 → Rust → 数据库链路。
- **Rust 核心**：Tauri Command 层、统一错误类型（`AppError`）、应用状态（`AppState`）、SQLite 初始化（WAL + 外键 + 迁移）。
- **数据库迁移**：`0001_init.sql` 建立全部 14 张业务表（providers、channels、models、channel_models、model_prices、channel_recharges、channel_bills、channel_balance_snapshots、agent_compatibility、request_records、processing_events、request_attachments、error_diagnoses、settings）及索引，含幂等迁移执行器。
- **存储目录布局**：`database/`、`archives/{requests,responses,streams,images}`、`backups/`、`logs/`（基于 Tauri App Data Directory）。
- **架构边界强制**：按 PLAN.md 建立领域模块（agent / adapters / workbenches / channels / models / credentials / billing / requests / processing / diagnostics / backup / services / storage），新增自动化测试禁止 `agent/` 依赖 `adapters/`。
- **测试**：前端导航配置测试（Vitest）；Rust 迁移幂等与目录布局测试。
- **工程化**：占位应用图标生成与全平台图标派生；版本号同步脚本 `pnpm version:sync`；GitHub Actions CI（前端 typecheck/test/build + Rust fmt/clippy/test）与 Release（macOS aarch64/x64、Windows、Linux 三平台构建，tag 触发草稿发布）。
- **文档**：README、AGENTS、本 CHANGELOG，以及 docs/architecture.md、docs/database.md、docs/security.md、docs/agent-compatibility.md、docs/adapter-boundaries.md。

### 已知限制

- 仅 Phase 0 完成：渠道管理等功能页面为规划占位，将在 Phase 1+ 逐步实现。
