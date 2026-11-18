# Adapter 边界

Adapter 是 LCM 中唯一允许「适配差异」的地方，其可用范围被严格限定，这是项目的架构级约束。

## 允许调用 Adapter 的模块

| 调用方 | 是否允许 | 说明 |
|---|---|---|
| `workbenches/api_testing/` | ✅ 允许 | 协议与供应商适配，用于测试不同渠道 API |
| `workbenches/image/` | ✅ 允许 | 图片供应商适配 |
| `agent/` | ❌ **禁止** | Agent 原生调用路径，自动化测试强制 |
| `channels/` `models/` `billing/` 等 | ❌ 禁止 | 管理域不做请求适配 |

## Adapter 的行为约束

1. **透明记录**：任何可能改变请求语义的操作（字段补全、格式转换、Header 处理）必须生成 ProcessingEvent（`changed=1`），说明改了什么、为什么。
2. **不掩盖**：Adapter 不能隐藏渠道实际返回的错误和不兼容行为；不能将某个协议的响应伪装成另一个协议的原始响应。
3. **四层分离**：必须区分用户填写的请求 / Adapter 处理后的请求 / 实际 HTTP 请求 / 渠道原始响应 / Adapter 处理后的展示结果。
4. **临时性**：工作台的临时修改默认不写回正式渠道配置。

## 强制执行

### 1. 自动化测试

`src-tauri/tests/architecture_boundaries.rs` 扫描 `src/agent/` 全部源文件，出现以下任何模式即测试失败：

- `crate::adapters`
- `adapters::`
- `super::adapters`

该测试随 `cargo test` 与 CI 运行。

### 2. 目录约定

Adapter 实现只能放在 `src-tauri/src/adapters/`（`providers/` 服务商差异、`protocols/` 协议适配），调用方只能是 `workbenches/`。

### 3. 评审检查清单

涉及 `adapters/` 的改动必须确认：

- [ ] 新增的处理是否记录 ProcessingEvent？
- [ ] 是否可能改变请求语义而未标记 `changed`？
- [ ] 是否把工具生成的内容伪装成供应商原始内容？
- [ ] 原始请求 / 响应是否仍然完整保留？

## 违规示例

```rust
// ❌ agent/ 模块中：为 Claude Code 转换协议 —— 违反架构铁律
use crate::adapters::protocols::anthropic_to_openai;

// ❌ 工作台中：改写响应让渠道看起来兼容 —— 违反透明原则
fn fix_broken_stream(response: &mut Response) { ... } // 且未记录任何处理事件
```
