//! 只读 MCP 服务器（stdio，newline-delimited JSON-RPC 2.0）。
//!
//! 让外部 AI Agent（Claude Code / Codex 等）查询 LCM 数据：渠道 / 模型 / 测试记录 /
//! 余额 / 账单 / 市场行情。安全边界（PLAN.md「MCP 集成」）：
//! - 只读：DB 以 READ_ONLY 打开，不提供任何变更工具；
//! - 凭证零输出：白名单序列化，任何工具不返回 API Key / Token / AccessKey Secret；
//! - 不读取 credentials.json；Agent 原生流量与凭证文件完全隔离。
//!
//! 协议面刻意保持最小（initialize / tools/list / tools/call / ping），
//! 手写 JSON-RPC 不引入新依赖。

pub mod redact;
pub mod tools;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use tools::ToolContext;

/// MCP 协议版本（客户端会协商，我们声明支持的版本）。
const PROTOCOL_VERSION: &str = "2024-11-05";
/// 服务器名（注册后客户端列表里显示）。
pub const SERVER_NAME: &str = "lcm-mcp";
pub const SERVER_VERSION: &str = "0.16.0";

/// MCP 服务器运行状态：只读连接 + 数据目录。
pub struct McpState {
    data_dir: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl McpState {
    fn open_conn(&self) -> Result<Connection, String> {
        let db_path = self.data_dir.join("database").join("lcm.sqlite");
        if !db_path.exists() {
            return Err(format!(
                "未找到 LCM 数据库：{}（请确认 --data-dir 指向 LCM 应用数据目录）",
                db_path.display()
            ));
        }
        Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("数据库打开失败（只读）: {e}"))
    }

    /// 借出只读连接（懒加载，进程内复用）。
    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| "内部状态锁已失效".to_string())?;
        if guard.is_none() {
            *guard = Some(self.open_conn()?);
        }
        f(guard.as_ref().expect("已在上方填充"))
    }
}

/// 单行 dispatch：返回 Some(响应 JSON 行) 或 None（通知 / 非法行不响应）。
pub fn handle_line(state: &McpState, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return None,
    };
    let id = msg.get("id").cloned();
    // 通知（无 id）不响应
    let id = id?;
    let method = msg.get("method").and_then(Value::as_str)?.to_string();
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    let result = match method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
        })),
        "notifications/initialized" => return None,
        "notifications/cancelled" => return None,
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::tool_descriptors() })),
        "tools/call" => handle_tools_call(state, &params),
        other => Err(format!(
            "未知方法: {other}（本服务器只支持 initialize / tools/list / tools/call / ping）"
        )),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }).to_string(),
        Err(message) => json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32603, "message": message }
        })
        .to_string(),
    })
}

/// tools/call：解析 name / arguments，调用工具层，包成 MCP content。
fn handle_tools_call(state: &McpState, params: &Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "tools/call 缺少 name".to_string())?
        .to_string();
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);
    let ctx = ToolContext {
        data_dir: state.data_dir.clone(),
    };
    let output = state.with_conn(|conn| tools::call_tool(conn, &ctx, &name, &args));
    let (text, is_error) = match output {
        Ok(text) => (text, false),
        Err(message) => (message, true),
    };
    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error,
    }))
}

/// 事件循环：逐行读取 stdin，逐行写 stdout（MCP stdio 传输）。
pub fn run_stdio(data_dir: &Path) -> Result<(), String> {
    let state = McpState {
        data_dir: data_dir.to_path_buf(),
        conn: Mutex::new(None),
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let reader = stdin.lock();
    for line in reader.lines() {
        match line {
            Ok(line) => {
                if let Some(response) = handle_line(&state, &line) {
                    writeln!(stdout, "{response}").map_err(|e| format!("stdout 写入失败: {e}"))?;
                }
            }
            Err(e) => return Err(format!("stdin 读取失败: {e}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (PathBuf, McpState) {
        let dir = std::env::temp_dir().join(format!("lcm-mcp-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("database")).unwrap();
        let conn = Connection::open(dir.join("database").join("lcm.sqlite")).unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        drop(conn);
        let state = McpState {
            data_dir: dir.clone(),
            conn: Mutex::new(None),
        };
        (dir, state)
    }

    #[test]
    fn initialize_and_tools_list_flow() {
        let (_dir, state) = setup();
        let init_resp = handle_line(
            &state,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
        )
        .expect("initialize 应有响应");
        assert!(init_resp.contains("\"protocolVersion\":\"2024-11-05\""));
        assert!(init_resp.contains("lcm-mcp"));

        // 通知不响应
        assert!(handle_line(
            &state,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
        )
        .is_none());

        let list_resp = handle_line(
            &state,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
        )
        .expect("tools/list 应有响应");
        assert!(list_resp.contains("list_channels"));
        assert!(list_resp.contains("get_request_record"));
        assert!(!list_resp.contains("sk-"));
    }

    #[test]
    fn unknown_method_returns_error() {
        let (_dir, state) = setup();
        let resp = handle_line(
            &state,
            r#"{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}"#,
        )
        .expect("未知方法应有错误响应");
        assert!(resp.contains("-32603"));
        assert!(resp.contains("未知方法"));
    }

    #[test]
    fn tools_call_unknown_tool_is_error() {
        let (_dir, state) = setup();
        let resp = handle_line(
            &state,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope","arguments":{}}}"#,
        )
        .expect("tools/call 应有响应");
        assert!(resp.contains("\"isError\":true"));
    }
}
