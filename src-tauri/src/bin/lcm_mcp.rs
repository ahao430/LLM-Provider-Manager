//! lcm-mcp：LCM 只读 MCP 服务器（stdio JSON-RPC）。
//!
//! 注册到 MCP 客户端（Claude Code / Codex 等）：
//!   claude mcp add lcm -- <本二进制路径> --data-dir <LCM 数据目录>
//!
//! 安全：只读打开数据库，不读取凭证文件；任何工具不返回凭证值。

use lcm_lib::mcp;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut data_dir: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--data-dir" => {
                i += 1;
                match args.get(i) {
                    Some(v) => data_dir = Some(v.clone()),
                    None => {
                        eprintln!("--data-dir 需要一个路径参数");
                        std::process::exit(2);
                    }
                }
            }
            "--help" | "-h" => {
                print_usage();
                return;
            }
            other => {
                eprintln!("未知参数: {other}（只支持 --data-dir / --help）");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    let dir = data_dir.map(PathBuf::from).unwrap_or_else(default_data_dir);
    if !dir.exists() {
        eprintln!(
            "LCM 数据目录不存在: {}\n用 --data-dir 指定（App 内「设置 → 常规」可见）",
            dir.display()
        );
        std::process::exit(2);
    }
    if let Err(e) = mcp::run_stdio(&dir) {
        eprintln!("lcm-mcp: {e}");
        std::process::exit(1);
    }
}

/// 按 OS 推导默认数据目录（与 Tauri app 数据目录一致）。
fn default_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support/com.wanghao.lcm")
    } else if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata).join("com.wanghao.lcm")
    } else {
        PathBuf::from(home).join(".local/share/com.wanghao.lcm")
    }
}

fn print_usage() {
    println!(
        "lcm-mcp — LCM 只读 MCP 服务器（stdio）\n\n用法: lcm-mcp [--data-dir <LCM 数据目录>]\n\n工具（全部只读）:\n  list_channels / list_models / search_request_records / get_request_record\n  get_request_error / get_request_raw / list_balances / list_funds / search_market_prices\n\n注册示例:\n  claude mcp add lcm -- /path/to/lcm-mcp --data-dir /path/to/app-data"
    );
}
