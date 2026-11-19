# 安全设计

LCM 是本地优先的管理工具，凭证管理是核心功能。本地数据不代表天然安全，以下是必须遵守的边界。

## 凭证存储

| 规则 | 说明 |
|---|---|
| 不明文入库 | 敏感凭证不存 SQLite，存独立凭证文件 credentials.json（应用数据目录，0600 权限，原子写入） |
| 引用分离 | SQLite 只保存 `credential_ref` |
| 凭证类型 | API Key、Bearer Token、x-api-key、NewAPI 管理 Token、AccessKey ID/Secret、自定义敏感 Header、用户标记 Sensitive 的字段 |
| 默认掩码 | 所有敏感字段默认 `sk-********************` 展示 |
| 主动查看 | 用户点击眼睛图标查看明文，再次点击恢复掩码；未修改的凭证不重新写入 |
| 受控读取 | 凭证读取通过受控的 Tauri Command 执行（Phase 1 实现） |

## 凭证泄露防护（红线）

凭证不得进入：

- 普通应用日志、调试输出
- AI 诊断上下文
- MCP 返回结果
- 普通配置导出（默认不含任何凭证）
- 非授权的错误报告

Raw 请求可能包含认证 Header：界面展示与导出时执行脱敏策略，同时保留受控的原始数据访问能力。

### MCP（v0.15.0 起）

`lcm-mcp`（stdio 独立命令）是上述红线的实现者与受益者：

- 数据库以 `SQLITE_OPEN_READ_ONLY` 打开，不提供任何变更工具；
- 不读取 credentials.json，凭证字段不进入任何工具输出（白名单序列化，单测断言）；
- `get_request_raw` 返回的归档原文本身已做 Header 脱敏；完整 Prompt / 图片仅在用户显式调用该工具时提供。

## 备份

- 完整备份使用 `.lcmbackup` 格式，用户密码加密。
- 可以由用户选择是否包含凭证；包含凭证时必须额外加密，不能把凭证文件明文直接写入普通备份文件。
- 恢复前进行完整性检查，覆盖当前数据前需要用户确认。

## 网络安全

- TLS 默认启用证书验证（Phase 3 引入 HTTP 客户端时落实）。
- HTTP 重定向时清除不应跨域传递的认证 Header。
- 图片 URL 下载（Phase 4）限制：文件大小、MIME 类型、请求超时、重定向次数、**禁止私网地址访问（SSRF 防护）**、不安全协议。

## Tauri 权限

- capabilities 采用最小权限配置（当前仅 `core:default`）。
- 新增系统权限时必须论证必要性。

## 安全边界（如实声明）

- 受控读取不承诺抵御本地管理员、恶意进程或已被攻陷的宿主。
- 前端内存中的明文无法做到绝对不可读取。
- 后续可增加系统生物识别 / 系统凭证验证作为额外解锁保护。

## 当前状态与待办

| 项 | 状态 | 计划 |
|---|---|---|
| 凭证存储 | ✅ v0.12.0 起为独立凭证文件（0600 + 原子写入 + 掩码 + 受控查看；Keychain 一次性迁移） | 涵盖 |
| 凭证批量导出 | ✅ v0.21.0 「凭证一览」弹窗（用户显式触发）：明文列表 + CSV 复制 + CSV/Excel 导出（用户选路径）；明文仅进剪贴板/指定文件，不落日志/DB/归档；导出文件由用户保管 | 导出文件风险由用户承担，UI 持续提示 |
| CSP | ✅ Phase 7 已收紧（self + data/blob 资源 + ipc；`ws://localhost:5173` 仅为开发 HMR 例外） | 随功能演进复查 |
| Tauri capabilities | ✅ 最小权限 `core:default` + `dialog:default` | 持续保持 |
| 加密备份 | ✅ Phase 7（.lcmbackup：AES-256-GCM + PBKDF2 计费凭证独立段） | 持续保持 |
| TLS 验证 | ✅ 默认启用（rustls），仅用户显式关闭时放宽 | 持续保持 |
| 跨域认证 Header | Phase 3 工作台按渠道固定渠道地址发起请求，不做跨域重定向跟随 | 保持现状 |
| 图片 URL 下载 / SSRF | 生成结果 url 形态不自动下载；一致性检查可发现孤儿文件 | Phase 8 完善下载防护 |
| 归档 Header 掩码 | ✅ v0.18.0 加宽：header 名含 authorization / auth / token / key / secret 子串即掩码 | 持续保持 |
| 出站请求清单 | 应用自身仅访问：models.dev（市场抓取）、frankfurter.app / open.er-api.com（USD→CNY 汇率，v0.19.0）、api.github.com / github.com（更新检测与更新包下载，v0.30.0 起 updater 走 `releases/latest/download/latest.json`）、用户配置的市场数据源站点（v0.25.0，仅 `{origin}/api/pricing` 与 `/favicon.ico`，源配置不含密钥）；其余请求均为用户配置的模型渠道地址 | 新增域名须在此登记 |
| MCP 输出脱敏 | ✅ v0.18.0 白名单序列化之外，notes / 错误消息 / 事件 / Raw 原文输出前统一做令牌样式二次脱敏（sk- / LTAI / AKLT / Bearer / 敏感 query 参数）；历史归档读取时 headers 实时再掩码 | 持续保持 |
| 应用内更新 | ✅ v0.30.0 一键更新（tauri-plugin-updater：下载 → minisign 验签 → 替换 → 自动重启）；更新包与 latest.json 由 Release workflow 用 minisign 私钥签名，应用内置公钥校验，防篡改。私钥仅存 GitHub Actions Repository Secrets 与维护者本机（~/.tauri/），不进仓库 / 日志 / 对话。v0.18.0 的「下载到 updates/ + 手动运行安装器」流程已移除；GitHub API 版本检测保留为降级路径 | 私钥泄露即更新通道失守：泄露时立即在源站重新生成密钥对并更新 Secrets 与应用公钥 |
