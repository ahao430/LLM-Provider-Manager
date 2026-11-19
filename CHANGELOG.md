# 更新日志

本项目所有显著变更都记录在此文件中。

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本策略见 [AGENTS.md](./AGENTS.md)：每次改动第三位 +1（patch），较大改动第二位 +1（minor），第一位仅在维护者要求时升级。

## [0.31.1] - 2026-11-20

### 新增

- **OpenRouter 内置汇总源**（迁移 0019）：公开 `models` 端点（无需认证），全球 69 家厂商、约 480 个模型的**托管平台转售价**（USD，自动 ×1M 折算），带缓存读取价、模态与推理标记；免费模型标注、计划下线模型标注到期日。这是多家比价站（gpuprice / aimap）的实际上游，转售价常低于官方价。设置 → 市场数据源中独立开关与抓取；启用后并入市场信息页与 apiprice / models.dev / 自定义源并排比价。映射纯函数配 2 个单测（价格折算 / 类型判定 / 免费与下线标注 / 厂商分组）。

## [0.31.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **市场数据源：apiprice.app 内置汇总源**（迁移 0018）：开放数据端点 `prices.json`（**CC BY 4.0**，需署名），覆盖 16 家厂商 119 条，**官方价 / 国内官方价（CNY）/ OpenRouter 三通道并列**，自带缓存价、分时段（低谷）价与核实时间。在设置 → 市场数据源中独立开关与抓取；启用的源并入市场信息页（各自成组、note 标注渠道与署名，不做黑盒合并取值）。同模型多源行可直接比价。
- **设置 → 市场数据源改三个分区**：①内置汇总源（models.dev / apiprice.app / 国内叠加层，apiprice 可开关可抓取，其余只读）②**国内厂商官网价明细**——叠加层每家厂商单独列出（名称 / 官网定价页链接 / 条目数，点击直达）③自定义源（NewAPI 模型广场，可增删改）。
- 数据源调研结论（konata9 / gpuprice / qust / aimap 均无开放端点或许可，暂不接入；apiprice 为唯一明确 CC BY 4.0 的开放汇总数据）记入 PLAN.md。

### 依赖

- 主页下载区（GitHub Pages）：平台选择（自动检测本机操作系统默认选中，含 macOS 架构区分）、按 Release 资产直链下载、macOS 首次运行 xattr 提示与一键复制。

## [0.30.4] - 2026-11-19

### 修复

- **检查更新 toast 位置异常**（WKWebView 特定环境下 toast 出现在视口底部并撑出页面滚动条）：Sonner Toaster 改为 `createPortal` 直接挂到 `document.body` 根部（隔离任何 transform / 滚动容器祖先对 `position: fixed` 的影响），并加全局 CSS 定位保险（`[data-sonner-toaster]` 强制 fixed + 限高，toast 限宽）。本地 Chrome 与 Tauri 环境实测 toast 均为顶部居中悬浮、不影响页面高度。
- **决策模型口径修正**：v0.30.3 前的分类把「纯推理模型」（OpenAI o 系、DeepSeek R 系、qwq 等，生成思考链）误标为「决策」。按 System 1 定义修正：**决策（decision）仅指 Jev 类单次前向输出候选概率的决策架构**（Jev / Chinese-Jev / LingDT / NeoHorse / Prism / Verdict 等名单匹配）；o 系 / R 系 / qwq 归入新类型**「推理」（reasoning）**，其余不变。旧抓取缓存在读取时自动纠正（decision 且不在 System 1 名单 → reasoning），内置快照数据同步修正（o3-mini、qwq-plus 等 3 条）。前端类型徽章补「推理」。
- **市场信息顶部文案**：「已抓取 models.dev」后不再重复显示抓取时间（右侧「抓取数据」按钮下方已有）。

## [0.30.3] - 2026-11-19

### 新增

- **项目主页**：[ahao430.github.io/LLM-Provider-Manager](https://ahao430.github.io/LLM-Provider-Manager/)——产品介绍 / 功能一览 / 设计原则 / 下载入口（`site/` 静态页，GitHub Pages 自动发布，README 已挂链接）。

### 变更

- **检测更新反馈统一为 toast**：设置 → 关于「检测更新」的结果此前以卡片内文字块展示，现与侧边栏一致弹 toast（发现新版本 / 已是最新 / 失败分色）。全局排查确认其余操作反馈均已是 toast（sonner 顶部居中悬浮，fixed 定位不影响页面高度）。
- **首页置顶渠道卡片**：移除卡片上的「取消置顶」按钮（置顶管理收敛到渠道卡片 / 详情页），卡片保留固定角标；新增余额刷新按钮（查询写快照，toast 反馈，转圈动画）。

## [0.30.2] - 2026-11-19

### 修复

- **检测更新 403（GitHub API 匿名限额）**：版本检测此前走 `api.github.com`（匿名 60 次/小时，共享出口网络下极易触顶，报 HTTP 403）。现检测与一键更新统一走 updater 清单 `latest.json`（release 资产下载，无 API 限额），Rust 侧 GitHub API 检测命令移除；「打开下载页」固定指向 releases/latest 页面。
- **CI clippy 失败**：`sort_by` 改 `sort_by_key`（CI 工具链升级后新增 lint；本地 Rust 已同步升级至 1.100.0 与 CI 对齐，消除「本地全绿、CI 红」的版本漂移）。

## [0.30.1] - 2026-11-19

### 说明

- **应用内一键更新链路实测版本**：v0.30.0 起升级走「应用内下载（进度条）→ minisign 验签 → 自动替换 → 自动重启」，本版本用于在 v0.30.0 上实测该链路——装好 v0.30.0 后点侧边栏「升级 v0.30.1」或设置 → 关于「一键更新」，应全程无需手动覆盖安装、自动重启后即为 v0.30.1。功能与修复见 [0.30.0]。

## [0.30.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **应用内一键更新**（tauri-plugin-updater + tauri-plugin-process）：检测到新版本后点「一键更新」——应用内下载（带进度条）→ minisign 验签 → 自动替换 → 自动重启生效，不再需要「下载完整包 → 手动退出 → 覆盖安装」。Windows 走 NSIS 静默安装；macOS 替换 .app；Linux AppImage 自替换（deb / rpm 安装不支持应用内更新，界面引导走下载页 / 包管理器）。侧边栏升级按钮与设置 → 关于同一流程。
- **更新通道签名验证**：Release workflow 注入 minisign 私钥（GitHub Actions Repository Secrets），tauri-action 自动对更新产物（.app.tar.gz / setup.exe / AppImage）生成 `.sig` 并聚合各平台签名上传 `latest.json` 清单；应用内置公钥校验，更新包被篡改无法通过验签。原「下载安装包到数据目录 + 手动运行安装器」流程移除；GitHub API 版本检测保留（版本号 / 发布说明 / 打开下载页，兼作清单异常时的降级路径）。

### 注意

- 本次 v0.29.x → v0.30.0 仍需手动覆盖安装一次（旧版本内没有更新插件，这是最后一次手动安装），此后发布的新版本均可应用内一键更新。
- Linux 以 deb / rpm 安装的用户不适用应用内更新，请继续用包管理器或下载页。

## [0.29.1] - 2026-11-19

### 新增

- **NewAPI 余额币种可选**：余额查询此前对 NewAPI 方式强制按 USD 展示；部分站点（如设置了 1 ¥ = $1 显示口径的易准大模型）实际以人民币结算，现币种下拉对所有查询方式可见（NewAPI 默认 USD，可切 CNY 展示人民币），折算口径不变（$1 = 500,000 quota），余额快照按所选币种落库。

### 修复

- **余额查询结果改用 toast 反馈**：渠道详情 → 余额查询弹窗，「立即查询」的结果此前塞在弹窗底部的信息块里，现统一为 toast（成功 / 未提取到 / 失败分色，长内容 8 秒驻留）。排查确认其余操作（资金 Tab、市场数据源、快速测试等）已全部使用 toast。
- **渠道卡片视图补余额查询按钮**：卡片形式此前仅在已有余额记录时才显示查询按钮，「无余额记录」的渠道无法发起查询；现与表格视图一致，任何卡片都可查询（写快照），并修复查询成功后卡片余额不刷新的问题（缓存未失效）。

## [0.29.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **多层网关错误归因**（规则式，本地特征匹配，不调 AI）：错误诊断新增「链路层归因」块——判定错误出自**中转网关层**（NewAPI / OneAPI 系特有文案：无可用渠道 / 当前分组 / 令牌额度 / distributor 等）还是**上游厂商**（OpenAI / Anthropic 标准错误结构：insufficient_quota / invalid_request_error / model_not_found / context_length_exceeded / overloaded_error 等），上游特异特征优先于宽泛网关词。严格红线：事实（命中特征串、上游请求 ID 有无）与推测分开输出，置信度 confirmed（特异命中）/ probable（宽泛命中）/ unknown（证据不足不硬猜）。测试详情「错误诊断」Tab 直接展示；MCP `diagnose_request_error` 输出同字段（外部 AI 可据此推理）；单测 6 例覆盖网关 / 上游 / 优先级 / 宽泛 / 无证据 / 空消息。

## [0.28.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **供应商账单 CSV / Excel 导入**（Phase 8 清单项落地）：渠道详情 → 资金 → 「导入 CSV/Excel」按钮选文件，列序为账期 YYYY-MM、金额、币种、备注（首行表头）。来源按扩展名标记 `csv_import` / `excel_import`（与手工录入分开统计）；同渠道同账期同来源重复的行自动跳过；逐行校验（账期格式 / 金额数字 / 币种非空），失败行如实报告行号与原因、不中断其余行。Excel 数字单元格无浮点尾巴；Rust 侧 calamine（读取）+ rust_xlsxwriter（既有导出）闭环。

## [0.27.1] - 2026-11-19

### 修复

- **市场信息「比价」入口常驻可见**：此前比价开关仅在搜索框有内容时才渲染，不搜索时完全看不到入口。现改为常驻显示在筛选行（带边框强调样式，开启时高亮）；未输入搜索词时置灰禁用，悬浮提示「先在搜索框输入模型关键字」。

## [0.27.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **测试记录类型列与类型筛选**：列表新增「类型」徽章列（快速测试 / API 测试 / Agent 测试 / 画图 / 画图编辑 / 图像理解），顶部类型下拉筛选（筛选状态进详情返回保留，Agent 会话组行同样带类型徽章）。
  - 快速连通性测试此前与工作台 API 测试混用同一类型（`api_test`），现以 `quick_test` 独立标记（`ApiTestRequest.test_kind`）。
  - **修复图像理解记录类型误标**：画图工作台的图像理解（Vision）记录此前 `request_type` 误写为协议名（如 openai_chat），修复为 `image_understanding`（历史记录不受影响，Raw 归档原样保留）。

## [0.26.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **渠道主地址语义升级**（迁移 0017 `chat_completions_url`）：主地址只填**基础域名、不带 /v1**（如 `https://api.example.com`）；表单展开可编辑 **Chat Completions / Anthropic / Responses 三个专用地址**。留空时 Chat Completions 与 Responses（含模型获取、API 测试工作台、Codex 启动）自动拼 `/v1`（地址已以 /v数字 结尾的旧渠道不重复拼）；Anthropic 不自动拼（Claude Code SDK 自行拼接）。Rust 侧新增 `ensure_v1` 纯函数并配单测。
- **应用图标修复**：macOS Dock 图标此前满幅无透明导致黑底方块观感；app-icon 重做为 macOS 风格（内容 82.4% + 22.5% 圆角 + 四周透明余白），全套 icon（icns / ico / png / iOS / Android）重新生成。

### 变更

- **模型列表测试结果**：失败摘要不再以截断文本直接展示（撑宽「最近测试」列），改为 ⚠ 图标 + 悬浮 tooltip 查看完整错误；点击仍跳转测试记录。

## [0.25.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **市场数据源板块**（设置 → 市场数据源，迁移 0016）：支持添加 NewAPI 类站点——填「模型广场」页面地址（如易准大模型 https://yiz.bjkhdf.cn/pricing），抓取站点 `/api/pricing` 按倍率折算为 USD 估算价（1 倍率 = $2/百万 token；输出另乘 completion_ratio；分组倍率取 enable_groups 最优；note 标注折算口径），顺带抓站点 favicon 作源图标；源可启用 / 停用 / 编辑 / 删除，启用的源并入市场信息页展示（厂商列链接即源站价格页）。内置源（models.dev / 国内厂商官网价）只读展示；**Sub2API 类型预留置灰（TODO）**。
- **市场信息页**：
  - 顶部文案去括号（「已抓取 models.dev · 时间」），「抓取数据」按钮下方显示抓取时间，底部来源说明带 models.dev 链接；
  - 常用模型快捷筛选按钮（glm / gpt / deepseek / claude / gemini / kimi / qwen / minimax，点击模糊搜索、再点取消）；
  - 价格排序方向切换（低 → 高 / 高 → 低；排序键 = max(单一价, 低谷价, 阶梯最高档) 折算人民币，跨币种按实时汇率、无价垫底）；
  - **比价模式**：搜索特定模型时开启「比价」，模型列表的渠道标注行插入市场行后并排比价（厂商列展示「模型列表 · 渠道名」，价格为标注实际价——原价 × 倍率、阶梯 / 低谷最高档，悬浮明细）；市场侧无此模型时单独展示标注行（自建渠道独有模型也能比价）。

## [0.24.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **渠道标注价格与市场价统一格式**（迁移 0015，`channel_models` 新增倍率 / 阶梯 / 分时段三列；依旧仅展示比较，不参与费用估算）：
  - **三种价格形态**：单一价（输入 / 输出每百万）+ 阶梯价（按累计输入 token 上限分档，单位百万，可增删档）+ 分时段（低谷）价（时段描述 + 低谷输入 / 输出），三者可组合配置。
  - **倍率**：实际价 = 原价 × 倍率（0.8 = 八折），作用于单一价 / 阶梯各档 / 低谷全部项；列表与详情展示计算后的实际价，倍率 ≠ 1 或有阶梯 / 分时段时带标记，**悬浮显示明细**（原价 × 倍率 = 实际、阶梯各档、低谷时段与价）。
  - **比价 / 排序按最高实际价**：max(单一价, 阶梯最高档, 低谷价) × 倍率（输入 / 输出独立）；模型列表新增「实际价从高到低 / 从低到高」排序（跨币种按实时汇率折算，无标注垫底），标注实际价范围列同步改口径。
  - **市场比价列**：市场信息页新增「渠道标注（实际价）」列——同名模型各渠道的实际价并排展示（`list_channel_price_annotations` 首次接入前端），悬浮看标注明细；市场列表新增输入 / 输出价排序（键 = max(单一, 低谷) 市场价折算）。
  - **查市场价参考**：标注弹窗新增「查市场价」子弹窗——按模型 ID 在市场快照精确 / 包含匹配，展示各厂商单一价 / 缓存 / 输出 / 低谷 / 备注（含阶梯说明），一键回填原价与币种（倍率自行配置）。

## [0.23.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **测试详情「对话看板」**（Overview 之后新 Tab）：以聊天气泡展示该次请求的完整交互——SYSTEM 全宽灰卡（anthropic 顶层 system / instructions 也在内）、USER 右对齐主色气泡（vision 的 content blocks 提取文本并标注「[N 张图片已省略]」）、ASSISTANT 左对齐卡片走 Markdown 渲染（复用 ResponseText 双模式）、THINKING 可折叠浅色块、TOOL 调用气泡（名称 + 参数 JSON 美化）。数据零后端改动：请求归档前端解析（openai_chat / anthropic_messages / openai_responses 三协议 + Raw JSON 容错提示），助手回复走现成 `reparse_test_response`（流式归档重放 delta）；agent_probe 记录展示 prompt → 输出单轮对话。解析失败时引导至 Raw 页。

## [0.22.0] - 2026-11-19

### 修复

- **市场信息决策模型误判**：此前 models.dev 的 `reasoning=true` 一律归为「决策」，导致 glm 全系 / qwen3 系 / MiniMax-M 系等 46 个混合思考模型被误标（它们只是支持思考模式，不是纯推理模型）。改为仅按模型名识别纯推理系列（OpenAI o1/o3/o4/o5 系、DeepSeek R 系、qwq），混合思考模型按模态归文本 / 多模态；修复后「决策」仅剩 o3-mini、qwq-plus 等真纯推理模型。`data.json` / `data_cn.json` 已重新生成（classify 双份实现 Rust + 脚本同步修改）。

### 新增

- **画图历史面板**（测试中心 → 画图）：生成 Tab 新增「历史记录」卡片，展示最近的生成 / 编辑记录（缩略图懒加载 + 提示词 + 模型 + 状态 + 时间）；点击任意一条**回填表单**（渠道 / 模型 / 提示词 / 尺寸 / 数量 / 返回格式），右上角按钮进完整记录详情。后端 `list_image_history` 从请求归档回读 prompt 等字段、附件元数据取首图。
- **版本号点击检查更新**：侧边栏左下角版本号变为可点击（悬浮提示「点击检查更新」），手动触发 GitHub Release 检查并以 toast 反馈结果（已是最新 / 发现新版本 / 无已发布版本 / 网络失败）。

## [0.21.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **凭证一览**（渠道管理「凭证一览」按钮，用户显式触发）：弹窗以明文列表展示全部渠道主凭证（渠道 / 服务商 / Base URL / Token），支持 CSV 一键复制（剪贴板，含表头，可粘贴进 Excel）与导出 CSV / Excel 文件（save 对话框选路径；CSV 带 UTF-8 BOM，Excel 直接打开不乱码；xlsx 由 rust_xlsxwriter 生成、表头加粗自动列宽）。明文仅进剪贴板 / 用户指定路径，不落日志 / DB / 归档；UI 持续提示导出文件自行保管。

### 布局

- 应用内容区自适应放宽：默认 max-w-6xl，xl 起放宽到 max-w-7xl，2xl（≥1536px）完全铺满——大屏不再两侧大片留白。

## [0.20.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **Agent 测试多轮会话**：不再每轮都是新会话——claude 用上一轮提取的 session_id 加 `--resume` 在同一会话继续（结果卡显示「会话 xxx · 第 N 轮」，sessionStorage 会话级保存）；codex 提供「续接最近线程（实验）」开关（`exec resume --last`，失败可关闭重试）；「新会话」按钮随时回到单轮模式。每轮 session_id 回填 `request_records.session_id`（迁移 0014）。
- **测试记录按会话合并**：同一会话的多轮 agent 探针在测试记录列表合并为一行（渠道 / 模型 / 「Agent 会话 · N 轮」/ 最新状态 / 累计耗时 / 累计 Tokens），点击展开逐轮详情（时间 / 轮次 / 状态 / 耗时 / Tokens / 详情入口），分页按合并后行数计数。
- **复制 Claude Code 终端命令**：Agent 测试页新按钮——把渠道 env 注入（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 等）转成单行 shell 命令复制到剪贴板，粘贴终端即可启动 claude；POSIX 单引号转义复用 curl 复制实现；**凭证仅进剪贴板**（不落日志 / DB / 归档）。Codex 依赖 CODEX_HOME 配置目录，不做单行命令。

### 变更

- Agent 测试页移除「最近运行」卡片（该信息已由测试记录页承载）。

## [0.19.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **国内厂商人民币官价**：新增国内价快照层 `data_cn.json`（读取时叠加在 models.dev 数据之上，抓取缓存不覆盖国内价）。DeepSeek / 阿里云百炼（qwen）/ Kimi / 火山方舟（豆包）/ MiniMax 国内 / 硅基流动 6 家由官网价格页实抓（`pnpm market:cn-refresh` 维护者脚本，解析失败保留旧值或按汇率折算兜底并在 note 标注）；智谱国内 / 千问平台 / 阶跃 / 小米暂按实时汇率折算 models.dev 价并标注「折算价」。
- **双定价厂商拆分**：智谱（Z.ai 海外 USD + 智谱 AI 国内 CNY）、MiniMax（海外 + 国内）拆为独立条目相邻展示；新增「通义千问（千问平台）」「硅基流动（聚合中转）」两个独立条目。
- **低谷分时段计费**：`MarketModel` 新增 `offPeak`（时段窗口 + 低谷输入/缓存/输出价，旧快照向后兼容）；DeepSeek（工作日高峰外半价）、硅基流动（2-8 点低谷）已在数据中体现，市场表格主价下方小字展示低谷价，悬浮显示时段定义。
- **币种切换**：市场页新增「默认 / $ 美元 / ¥ 人民币」三段切换（偏好持久化）；美元/人民币视图按实时汇率折算（frankfurter 主源 + open.er-api.com 回退，「抓取数据」时顺带更新，迁移 0013 `market_fx` 表缓存；从未获取过时兜底 7.20），折算值带 ≈ 前缀、页脚标注汇率来源与时间——满足「估算必须标注」红线。
- MCP `search_market_prices` 输出补充 `offPeak` 字段（无敏感信息）。

### 修复（并入本版）

- 首页仪表盘：置顶渠道卡片不再强制另起一行，与统计卡并入同一网格流式排布。

## [0.18.1] - 2026-11-19

### 修复

- 首页仪表盘：置顶渠道卡片不再强制另起一行，与「渠道 / 模型 / 测试」统计卡并入同一网格流式排布（前面有空位即接排）。

## [0.18.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **布局与全局体验**：移除右侧顶栏（内容直达顶部）；版本号移至侧边栏底部；所有页面标题滚动吸顶；应用启动增加 splash 加载画面（深浅色自适应，React 挂载后移除）；`<main>` 滚动位置按路由记忆与恢复。
- **应用内更新**：启动自动检测 GitHub 最新 Release；侧边栏版本旁出现「升级 vX.Y.Z」按钮——点击下载对应平台安装包到 `<数据目录>/updates/`，下载完成确认后运行安装器引导覆盖安装；设置「关于」页提供同一流程（含打开下载页回退）。资产按平台挑选（macOS dmg by arch / Windows NSIS setup.exe / Linux AppImage），纯函数挑选逻辑带单测。
- **设置页重组**：常规（外观）/ **数据库**（独立 Tab）/ **MCP 接入**（独立 Tab）/ 数据 / **关于**（应用信息 + 检测更新与下载安装，最后一个 Tab）。
- **厂商品牌图标**：市场信息（筛选下拉 + 表格厂商列）与渠道管理（服务商下拉 / 列表列 / 卡片徽章）显示品牌 SVG 图标；数据构建期从 simple-icons 导出为静态 TS（运行时零依赖），缺失品牌（OpenAI / xAI / Cohere / 智谱 / 火山 / 阶跃 / 硅基流动等）回退字母块，不远程加载。
- **测试返回与状态保持**：测试记录 / 渠道详情的「返回」改为回到来源页（navigate(-1)，无历史回退列表页）；滚动高度按路由恢复；渠道列表（展开行 / 分页 / 分组筛选 / 排序）、模型列表（搜索 / 类型筛选 / 分页）、测试记录（分页）、API 测试表单、Agent 测试表单的状态经 sessionStorage 会话级持久化。

### 安全

- **归档 Header 掩码加宽**：header 名含 authorization / auth / token / key / secret 任一子串即掩码（此前仅 3 个精确名），覆盖 api-key / x-goog-api-key 等自定义凭证 Header；新归档即生效。
- **MCP 输出统一二次脱敏**：所有工具返回的 notes / 错误消息 / 事件描述 / Raw 归档原文在输出前再做令牌样式脱敏（`sk-*` / `LTAI*`（百炼 AccessKey）/ `AKLT*`（火山）/ `Bearer *` / URL query 中 key/token/api_key/access_key/secret/signature/access_token 值）；历史归档在 MCP 读取时 headers 实时再掩码。令牌与百炼 AccessKey/Secret 不出现在 MCP 回答中（单测覆盖）。

### 变更

- Agent 测试工作目录留空 = 默认使用数据目录 `agent/` 子目录（自动创建），不再强制手填。

## [0.17.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **画图工作台**：结果区新增计时器（生成中按秒跳动，结束后冻结为总耗时）；生成返回的归档图片**自动加载**，不再需要手动点击（读取失败保留重试入口）；生成 / 编辑面板状态与结果迁移到 localStorage 持久化的 store——测试中心内切 Tab（keep-alive，四个 Tab 常驻不卸载）乃至整段路由切换都不再丢失进行中 / 已完成的请求。
- **响应 Markdown / 文本切换**：图像理解、API 测试（文本块）、Agent 测试三处响应区支持 Markdown 渲染与纯文本切换，偏好全局共用（react-markdown + remark-gfm，组件映射样式，默认跳过原始 HTML）。
- **渠道分组**：新增 `channel_groups` 表（迁移 0012），渠道可归属命名分组（如「上游百炼 / 上游中转站 / 自建聚合中转」）；列表页「管理分组」支持新建 / 行内重命名 / 删除（渠道回到未分组）；渠道表单可选分组；列表视图新增分组列与分组筛选。
- **渠道卡片视图**：渠道管理支持列表 / 卡片双视图切换（偏好持久化）；卡片视图按分组分区展示，卡片含服务商、凭证状态、余额（可刷新）、启用开关、编辑与**仪表盘置顶**操作。
- **首页仪表盘渠道卡片**：渠道管理里置顶（Pin）的渠道常驻展示在仪表盘（名称 / 服务商 / 启用状态 / 凭证 / 最近余额），点击进详情，可就地取消置顶；无置顶渠道时整段隐藏。
- MCP `list_channels` 白名单补充 `groupName`（非敏感，供外部 Agent 分组查询）。

## [0.16.1] - 2026-11-19

### 修复

- `pnpm tauri dev` 启动失败（`cargo run` 无法在 `lcm` / `lcm-mcp` 两个 bin 目标间选择）：Cargo.toml 增加 `default-run = "lcm"`。

## [0.16.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **错误知识库 + 诊断引擎**（Phase 8 核心项）：迁移 0011 内置 15 条常见错误知识（401 认证 / 402·403 额度权限 / 404 模型与路径 / 429 限频 / 5xx 网关 / 协议解析失败 / 流中断 / 探针超时 / 连接拒绝等），事实（facts / evidence）与建议（advice）分开、置信度三档——`confirmed`（错误码精确命中）/ `probable`（HTTP 状态或消息关键词命中）/ `unknown`（证据不足给通用排查建议）；诊断只读，不自动执行任何建议。
- **测试详情页「错误诊断」Tab 上线**：自动展示命中条目、事实、建议与失败的处理事件（此前为占位符）。
- **MCP 新增 3 个诊断工具**（现共 12 个）：`diagnose_request_error`（对失败记录做知识库诊断）/ `search_error_docs`（检索知识库）/ `get_error_chain`（错误链路事实：错误字段 + 全部处理事件，不含推测）。
- 多层网关归因（跨中转层自动定位）仍属后续；内置知识条目现阶段只读（人工维护将在后续版本开放）。

## [0.15.0] - 2026-11-19

### 新增（较大改动，第二位 +1）

- **提供只读 MCP 服务器 `lcm-mcp`**（stdio JSON-RPC，零新增依赖）：外部 AI Agent（Claude Code / Codex 等）可查询 LCM 数据。9 个只读工具——`list_channels`（含最近余额）/ `list_models`（模型 + 标注价）/ `search_request_records` / `get_request_record`（含处理事件）/ `get_request_error` / `get_request_raw`（归档原文，Header 已脱敏）/ `list_balances` / `list_funds`（账单 + 充值）/ `search_market_prices`（models.dev 快照）。
- **安全边界**：数据库以 `SQLITE_OPEN_READ_ONLY` 打开（WAL 多进程并发），不读取 credentials.json，**任何工具输出零凭证**（白名单序列化）；App 无需常驻。注册方式见设置页「MCP」卡片（`claude mcp add lcm -- ...` / Codex config.toml 片段，一键复制）；`cargo build --release --bin lcm-mcp` 构建产物。
- `diagnose_request_error` / `search_error_docs` / `get_error_chain` 依赖错误知识库，仍属 Phase 8 后续。
- Release 工作流随版本发布各平台 `lcm-mcp` 二进制（macOS arm64/x86_64、Linux、Windows），安装包之外可直接下载注册。

## [0.14.1] - 2026-11-19

### 新增

- **真实 Agent 探针现在会写入测试记录**：每次调用写入一条 `request_records`（`request_type=agent_probe`，协议标记 `agent_cli`），完成时回填状态（success / failed）、总耗时、token 用量（claude）与失败原因（PROBE_TIMEOUT / PROBE_EXIT_NONZERO / PROBE_SPAWN_ERROR + stderr 摘要）。Raw 归档为 CLI 调用参数（请求侧）与捕获的 stdout / stderr（响应侧）——记录的是 **LCM 亲自观测到的探针运行**，Agent 进程自行发出的原生 HTTP 请求依然不归档、不声称已被观测。测试记录列表以「Agent 探针」徽章区分；结果卡片新增「测试记录 →」跳转；模型列表「最近测试」不统计探针记录。

## [0.14.0] - 2026-11-19

### 变更（较大改动，第二位 +1）

- **Agent 测试改为真实调用 Claude Code / Codex CLI**（此前为 LCM 自行按协议发请求的「内嵌对话」，非真实 Agent）：
  - 新增探针（`agent/probe.rs`）：选渠道 + 工作目录，发一条 prompt——Claude Code 走 `-p` print 模式（JSON 输出解析回复正文 / session / 成本 / token 用量），Codex 走 `exec` 非交互模式（stdout 原样展示）；凭证经 launcher 同一套 env 注入（ANTHROPIC_BASE_URL + AUTH_TOKEN/API_KEY、CODEX_HOME + LCM_CODEX_API_KEY），LCM 不自己发请求。
  - **无凭证快速失败**：渠道未配置主凭证时本地直接报错，不再发出无鉴权请求导致误导性远端 401。
  - 结果卡片展示状态 / 耗时 / 回复 / stderr / 警告 / 日志路径；「最近运行」历史首次接入（agent_launches）。
  - 支持自定义 CLI 可执行文件路径（GUI 环境 PATH 可能与终端不同）。
  - 请求只写 agent_launches 快照（脱敏），**不归档为 LCM 测试记录**；超时 10 分钟自动 kill。
- **移除内嵌对话**：删除 `workbenches/assistant` 与相关命令（会话/消息数据保留在库中）；`quick_test_channel` 移至 workbench 命令（行为不变）。
- **无凭证预警**：API 测试 / Agent 探针在渠道无凭证时写 warning ProcessingEvent；渠道选择器标注「（未配置凭证）」。
- **测试记录新增「复制 curl」**（单行可执行，凭证经当前渠道配置重建，只进剪贴板）；最近测试结果扩展总耗时与失败摘要，渠道管理逐模型行内展示；类型默认推断扩展（claude / gemini / gpt-4o·4.1·5 / o 系 → 多模态，迁移 0010）；画图 / 图片编辑模型候选仅显示图像模型。

## [0.13.8] - 2026-11-19

### 新增

- **测试记录详情页新增「复制 curl」**：以单行可执行 curl 命令复制请求（`curl -X POST '<url>' -H '<header>' … --data '<body>'`）。URL / Header 按当前渠道配置重建（含真实凭证，与重放同一逻辑），凭证只进剪贴板（用户主动操作，与「复制凭证」同一安全级别），不落库、不进日志、不产生新测试记录。
- curl 文本经 POSIX shell 单引号转义（`'` → `'\''`），URL / Header / body 含特殊字符也能原样还原；仅支持 API 测试工作台的记录（画图 / 图像理解归档 body 为摘要或 multipart 二进制，重建会失真，明确报错）。

## [0.13.7] - 2026-11-19

### 变更

- **类型默认推断扩展到天生多模态家族**：`claude`（3+ 全系）、`gemini`（全系）、`gpt-4o` / `gpt-4.1` / `gpt-4-turbo` / `gpt-5` 系、OpenAI `o1` / `o3` / `o4` 前缀 → **多模态**（此前默认文本）。`gpt-3.5-turbo` 等纯文本模型仍默认文本；决策类型不做推断。
- **迁移 0010**：对已导入且仍为 text 的渠道模型按同一名称规则补标 multimodal（与 0009 同一原则——只纠正默认值，不覆盖人工标记的其他类型）。
- 新导入 / 手动添加即时生效；已标为多模态 / 图像 / 决策的行不受影响。

## [0.13.6] - 2026-11-19

### 变更

- **画图 / 图片编辑的模型候选只显示已启用的「图像」类型模型**（按渠道模型的人工标记 + 名称默认推断筛选）；选渠道后自动预填第一个图像模型；渠道没有图像模型时给出标记指引。图像理解页保持展示全部模型。

## [0.13.5] - 2026-11-19

### 新增

- **渠道添加模型时按名称推断默认类型**：`gpt-image` 等图像生成命名（image / dall-e / seedream / cogview / wanx / flux / stable-diffusion）→ **图像**；`deepseek-v4.1-flash`、`glm-5.3-flash` 及视觉命名（omni / vision / -vl / qvq / 4o）→ **多模态**；其余默认**文本**。批量导入与手动添加均生效，人工选择后不再被覆盖，仍可随时手动改。

## [0.13.4] - 2026-11-19

### 新增

- **渠道管理逐模型测试结果展示**：渠道列表展开的模型行、渠道详情「模型」页签每个模型旁展示**最近一次测试结果**（状态徽章、首字时间、总耗时、失败原因摘要、测试时间），点击跳转对应测试记录；测试完成后行内结果自动刷新。渠道详情「模型」页签每行新增「测试」按钮，与渠道列表展开行一致（按模型标记的接口类型发送最小请求）。
- 最近测试结果行新增**总耗时**展示（此前模型列表仅有首字时间）；模型列表页与详情弹窗改用同一结果展示组件。

## [0.13.3] - 2026-11-19

### 移除

- 渠道详情「模型」页签不再显示「全局模型」卡片（其创建入口保留在手动添加模型的流程中；全局模型作为统一身份仍在后端维护）。

## [0.13.2] - 2026-11-19

### 变更

- 市场信息表格列调整：**模型列移到最前**、厂商列随后；厂商**每行都显示**（去掉同厂商仅首行显示的合并视觉）；移除「备注」列。

## [0.13.1] - 2026-11-19

### 变更

- **查询方式不再手选**：由渠道已选的服务商自动派生（后端 `derive_balance_mode` 单一事实来源）——NewAPI → 用户额度方式，阿里云百炼 → 费用中心方式，其他 → 通用 HTTP。余额查询弹窗改为只读展示当前方式。
- **NewAPI 余额查询改为用户 ID + 系统访问令牌**（参照 new-api）：`GET {Base URL}/api/user/self`，`Authorization` = 系统访问令牌（原样，无 Bearer）、`New-Api-User` = 用户 ID，`data.quota ÷ 500,000`（$1 = 500,000 quota）折算 USD 写余额快照；失败时如实展示 message（令牌过期 / 用户 ID 不匹配等提示）。系统访问令牌存本地凭证文件（新凭证 kind `billing_system_token`，留空 = 保持不变）；用户 ID 非敏感存配置。

## [0.13.0] - 2026-11-19

百炼（阿里云）按 AccessKey 查询余额与账单（参照 workspace/new-api 实现）。

### 新增

- **阿里云费用中心（BssOpenApi）接入**（`billing/aliyun.rs`）：RPC V1 签名（HMAC-SHA1，RFC3986 编码），端点 business.aliyuncs.com。
  - **余额**：QueryAccountBalance（Code=200；金额支持千分位逗号；币种取 Data.Currency）；渠道列表 🔄 与详情「立即查询」均可触发，写余额快照。
  - **账单**：QueryAccountTransactionDetails（Code=Success；NextToken 翻页；兼容数组直返与对象包裹两种列表形态）；「资金 → 拉取百炼账单」弹窗按日期范围查询、加载更多、按月汇总（净额=充值−消费），一键导入供应商账单（source=aliyun_bss，同渠道同账期覆盖替换，人工录入不受影响）。
- **余额查询双模式**：渠道详情「余额查询」新增查询方式选择——通用 HTTP（原 Bearer GET + JSON 路径）或**阿里云费用中心**；后者填写 AccessKey ID（secretId）/ Secret（secretKey），存本地凭证文件（新凭证 kind：billing_access_key_id / _secret，掩码不回显，留空=保持不变）。需 RAM 账号具备费用中心读权限（bss:DescribeAccount / bssapi:QueryAccountTransactionDetails）。
- 单测 5 项：RPC V1 待签名串对照官方文档向量（与 new-api 同参）、百分号编码规则、余额解析（千分位/业务错误码）、明细双形态解析、按月汇总。

### 说明

- 百炼模型调用的 API Key 仍走渠道「凭证」；AccessKey 对仅用于费用查询，两者互不影响。
- 业务错误（密钥无效/无权限）从 4xx JSON body 提取 Code/Message 如实展示。

## [0.12.5] - 2026-11-19

### 变更

- 测试记录分页（复用 `Pagination`：每页 10/20/50/100，总数 ≤ 10 不渲染；改每页数量回第一页）。加载条数从 100 提升到后端上限 1000，满 1000 条时页脚注明「仅加载最近 1000 条，更早记录可备份或清理」。

## [0.12.4] - 2026-11-19

### 变更

- 渠道列表点击**名称**改为打开该渠道官网（系统浏览器；`ChannelRow` 新增 `officialUrl`，从 config_json 的 official 外链提取）；已配置官网的名称旁显示 🔗 小图标。未配置官网时提示去编辑表单填写；进详情仍点击行任意位置或 ✏️ 按钮。

## [0.12.3] - 2026-11-19

### 变更

- 菜单「Dashboard」更名为「仪表盘」（导航、面包屑、PLAN / README 同步；代码标识符与路由 /dashboard 不变）。

## [0.12.2] - 2026-11-19

### 新增

- **Light / Dark 主题切换**：三态主题（浅色 / 深色 / 跟随系统）。侧边栏底部快捷按钮循环切换（Sun / Moon / Monitor 图标）；设置 → 常规新增「外观」卡片三选一。选择经 localStorage 持久化（zustand persist）；「跟随系统」监听 `prefers-color-scheme` 实时生效（落 `<html class="dark">`，Tailwind v4 `@custom-variant dark` 已就绪）。默认跟随系统。

## [0.12.1] - 2026-11-18

### 新增

- **设置页分 Tab**：常规（应用信息 + 数据库状态）/ 数据（加密备份·恢复、归档一致性检查、数据清理）/ 更新（检测更新）。
- **检测更新**：查询 GitHub 最新已发布 Release（`check_for_updates` 命令，需联网），与当前版本按数值段比较；有新版时展示版本号、发布日期与更新说明摘要，并可跳转下载页（系统浏览器）；404 视为「尚无已发布版本」。只检查不自动更新（发布流程为草稿→人工确认）。

## [0.12.0] - 2026-11-18

凭证存储从系统凭证库改为独立凭证文件（消除 macOS 钥匙串反复弹窗）。

### 变更

- **背景**：macOS 上开发期二进制每次重编译，ad-hoc 签名（cdhash）随之变化，Keychain ACL 无法识别为同一应用——每次读写凭证（复制 / 明文查看 / 发请求注入认证 / Agent 启动 / 余额查询）都弹「允许 App 访问你的钥匙串」，点「始终允许」也在下次编译后失效。
- **新方案**：凭证存应用数据目录下独立文件 `credentials.json`（Unix 0600 权限、原子写入：临时文件 + rename），与 ~/.aws/credentials 同类做法。明文仍不进 SQLite、不进日志 / 诊断 / 普通导出；UI 仍默认掩码，明文读取走受控命令。
- **自动迁移**：首次启动把各渠道 Keychain 主凭证复制进凭证文件（一次性，不删除 Keychain 旧条目以免再弹窗；旧条目可在「钥匙串访问」中手动清理 `com.wanghao.lcm`）。
- 备份加密段 / Agent 启动注入 / 余额查询等全部调用方无感切换（统一走 credentials 模块）。

## [0.11.4] - 2026-11-18

### 修复

- **Agent 测试发送必现「FOREIGN KEY constraint failed」**：`prepare` 曾把会话 ID 当作 `parent_trace_id` 传入 `request_records`（该列外键指向 `request_records.trace_id`，仅供重放链路使用），插入即违反外键。修复为 NULL——会话与请求的关联由 `agent_messages.trace_id` 表达；另对陈旧 `channel_model_id` 做降级保护（查不到即 NULL）。
- 新增两个回归测试：prepare+finalize 全链路（外键约束下落记录与消息）、陈旧 channel_model_id 降级。
- Agent 页面首条消息原先需点击两次（先建会话再发送），现在一次点击完成；发送 mutation 改为显式传会话 ID，避免新建后闭包状态过期。

## [0.11.3] - 2026-11-18

### 新增

- 市场信息按**模型行**分页（复用 `Pagination`：每页 10/20/50/100，筛选 / 搜索变化回第一页，总数 ≤ 10 不渲染）。分页按模型计数而非厂商；厂商列在其每页首行显示（跨页续显）。

## [0.11.2] - 2026-11-18

### 新增

- **分页展示**（通用 `Pagination` 组件）：渠道列表、模型列表、渠道展开的模型清单三处接入——上一页 / 下一页 + 每页数量可选 10 / 20 / 50 / 100；总数 ≤ 10 时不渲染分页条；模型列表搜索或类型筛选变化自动回第一页；切换每页数量回第一页。

## [0.11.1] - 2026-11-18

### 变更

- API 测试工作台**默认勾选流式**（流式才能测出真实首字时间）。
- Preview 页签头部新增**首字时间（TTFT）**与总耗时徽章（原 Timeline 页签保留完整 TTFB/TTFT/耗时/TPS）。
- 模型列表「最近测试」展示首字时间：行内为 `状态 · 首字 xxx ms · 时间`，详情弹窗逐渠道显示；`list_latest_model_tests` 返回 `ttftMs`。

## [0.11.0] - 2026-11-18

模型最近测试结果、渠道余额展示与一键查询、模型接口类型标记。

### 新增

- **模型最近测试**：模型列表新增「最近测试」列（组内跨渠道取最新，状态徽章 + 时间，点击跳测试记录）；详情弹窗逐渠道显示最近结果与记录链接。后端 `list_latest_model_tests`（窗口函数取每 (渠道, 模型) 最新一条）；测试按钮完成后自动刷新。
- **渠道余额**：渠道列表新增「余额」列（最近快照金额 + 币种 + 快照时间提示），旁有 🔄 查询按钮——`refresh_channel_balance` 实时查询并写余额快照（数值可解析才落库），`list_latest_balances` 取各渠道最新快照。余额查询配置新增**币种**字段（详情页设置弹窗可选 CNY / USD，旧配置默认 CNY）。
- **模型接口类型标记**：模型名含 `claude` 默认 Anthropic Messages，否则默认 Chat Completions；手动添加弹窗按名称自动推断（可选改），导入按名称逐个默认；渠道详情模型列表行内 Select 可随时改。测试（渠道列表展开行 / 模型列表）均按模型自身接口类型调用。

### 变更

- 渠道列表「编辑」按钮改为进入渠道详情页（不再弹出编辑框）。
- `import_channel_models` 去掉 protocol 参数（逐项按名称默认）；前端 `importChannelModels(channelId, items)`。

### 数据库迁移 0009

- 存量数据落地默认规则：`openai_chat` 且模型名含 claude 的渠道模型改为 `anthropic_messages`（不动人工已标记的值）。

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
