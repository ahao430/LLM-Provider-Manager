//! 架构边界自动化测试。
//!
//! 强制执行 PLAN.md 的核心约束：Agent 原生调用路径与 Adapter 严格隔离。
//! `agent/` 模块的任何源文件都不得引用适配器模块。

use std::fs;
use std::path::{Path, PathBuf};

/// 被禁止出现在 agent/ 源码中的引用模式。
const FORBIDDEN_PATTERNS: &[&str] = &["crate::adapters", "adapters::", "super::adapters"];

#[test]
fn agent_module_must_not_reference_adapters() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let agent_dir = manifest_dir.join("src").join("agent");
    assert!(agent_dir.is_dir(), "src/agent 目录应存在");

    let mut rust_files = Vec::new();
    collect_rust_files(&agent_dir, &mut rust_files);
    assert!(!rust_files.is_empty(), "src/agent 下应至少有一个 .rs 文件");

    for file in &rust_files {
        let content = fs::read_to_string(file).expect("读取源文件失败");
        for pattern in FORBIDDEN_PATTERNS {
            assert!(
                !content.contains(pattern),
                "架构边界违规：{} 引用了被禁止的模式 `{pattern}`。\n\
                 Agent 原生调用路径不得依赖适配器模块（见 PLAN.md 与 docs/adapter-boundaries.md）",
                file.display()
            );
        }
    }
}

fn collect_rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).expect("读取目录失败");
    for entry in entries {
        let path = entry.expect("读取目录项失败").path();
        if path.is_dir() {
            collect_rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}
