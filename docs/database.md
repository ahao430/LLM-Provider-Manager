# 数据库与存储

## 总览

- 元数据存 SQLite（`database/lcm.sqlite`，WAL 模式，外键开启）。
- 大对象存本地文件（Raw 请求 / 响应 / SSE / 图片 / 备份），数据库只存引用路径与 checksum。
- 数据目录 = Tauri App Data Directory，不写死用户目录：

```text
app-data/
├── database/
│   └── lcm.sqlite
├── archives/
│   ├── requests/       # Raw 请求
│   ├── responses/      # Raw 响应
│   ├── streams/        # SSE 流原始内容
│   └── images/         # 图片归档（YYYY/MM/trace-id/）
├── backups/
└── logs/
```

目录布局由 `storage/paths::ensure_layout` 保证（幂等创建）。

## 迁移规则

- 迁移文件位于 `src-tauri/migrations/`，命名 `NNNN_description.sql`。
- 在 `src-tauri/src/storage/migrations.rs` 的 `MIGRATIONS` 常量中按顺序注册。
- **一经发布只追加，不修改、不删除已有迁移**（发布 = 进入任何已分发的构建）。
- 执行记录保存在 `_migrations` 表（name + applied_at），重复执行自动跳过（幂等）。
- 迁移内使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 以增强幂等性。

## 表结构（0001_init）

通用约定：主键 TEXT（UUID v4，应用层生成）；时间戳 TEXT（RFC 3339，UTC）；布尔用 INTEGER 0/1。

后续迁移：

- `0002_agent_launches.sql` — Agent 启动快照表。
- `0003_seed_providers.sql` — 内置服务商种子（bailian / newapi / volcano / siliconflow / custom，固定 ID + `INSERT OR IGNORE` 幂等）。

| 表 | 用途 | 关键点 |
|---|---|---|
| `providers` | 服务商（百炼 / NewAPI / 火山方舟 / 硅基流动 / 自定义） | `code` 唯一 |
| `channels` | 渠道实例（同服务商可多个） | `config_json` 存连接配置，**不含明文凭证** |
| `models` | 全局模型（统一身份） | |
| `channel_models` | 渠道模型 | `UNIQUE(channel_id, actual_model_id)`；`capabilities_json` 的值只能是 `supported / unsupported / unknown`；标注价格列（0007 单一价 + 0015 倍率 / 阶梯 `price_tiers_json` / 低谷 `price_off_peak_json`）仅展示比较，不参与费用估算 |
| `model_prices` | 价格（以 ChannelModel 为维度） | **历史追加式**，按 `effective_date` 排序，不覆盖 |
| `channel_recharges` | 充值记录 | 每笔单独保存 |
| `channel_bills` | 供应商账单 | `UNIQUE(channel_id, billing_period, source)`；`source`：manual / csv_import / excel_import |
| `channel_balance_snapshots` | 人工抄录余额快照 | 非自动同步 |
| `agent_compatibility` | Agent 兼容性 | status：`supported / unsupported / unverified`；必须有证据 |
| `agent_launches` | Agent 启动快照（Agent Launcher） | `launch_method`：`env_injection / codex_home / profile / native_config`；仅存 `credential_ref`，**不存 Token 明文**；`config_snapshot_json` 为脱敏快照 |
| `request_records` | 请求记录索引 | `trace_id` 主键；`request_ref` / `response_ref` 指向文件；`ttft_ms` 未产生首 Token 时为 NULL |
| `processing_events` | 处理透明度事件 | status：`ok / changed / failed / skipped`；`changed=1` 表示改变了请求/响应语义 |
| `request_attachments` | 图片等附件元数据 | 文件路径 + checksum |
| `error_diagnoses` | 错误诊断 | source 与 confidence 都是 CHECK 约束枚举 |
| `settings` | 键值设置 | `value_json` |

### request_records.status 枚举

`pending / success / http_error / protocol_error / stream_error / storage_error / failed`

状态区分体现「失败归因准确」：HTTP 200 但 SSE 解析失败 → `protocol_error`，不是渠道请求失败；渠道成功但 Raw 保存失败 → `storage_error`，不能算渠道 API 失败。

### error_diagnoses 枚举

- `source`：`client / gateway / upstream_gateway / nested_gateway / provider / local_tool / unknown`
- `confidence`：`confirmed / probable / unknown`

## 文件归档一致性

写入归档文件的流程（Phase 3 实现，先在此约定）：

1. 写入临时文件；
2. 校验完整性并计算 checksum；
3. 原子重命名到正式路径；
4. 提交 SQLite 元数据；
5. 失败时清理临时文件与孤儿文件。

## 数据保留

默认长期保留。用户可按日期 / 渠道 / 模型清理历史数据，清理时数据库记录与对应文件必须同时处理。
