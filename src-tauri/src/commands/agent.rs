//! Agent 命令：兼容性记录、Launcher 启动与启动历史、真实 Agent 单次调用探针。

use tauri::State;

use crate::agent::compat::{self, AgentCompatRow};
use crate::agent::launcher::{self, AgentLaunchRow, LaunchOutcome, LaunchRequest};
use crate::agent::probe::{self, ProbeOutcome, ProbeRequest};
use crate::error::AppResult;
use crate::AppState;

#[tauri::command]
pub fn list_agent_compat(
    state: State<'_, AppState>,
    channel_id: String,
) -> AppResult<Vec<AgentCompatRow>> {
    let conn = lock_db(&state)?;
    compat::list(&conn, &channel_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn upsert_agent_compat(
    state: State<'_, AppState>,
    channel_id: String,
    agent: String,
    status: String,
    evidence: Option<String>,
    notes: Option<String>,
) -> AppResult<AgentCompatRow> {
    let conn = lock_db(&state)?;
    compat::upsert(
        &conn,
        &channel_id,
        &agent,
        &status,
        evidence.as_deref(),
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn launch_agent(state: State<'_, AppState>, req: LaunchRequest) -> AppResult<LaunchOutcome> {
    // 注意：启动期间持有 db 锁，但子进程 spawn 后立即释放，不会阻塞 UI
    let conn = lock_db(&state)?;
    launcher::launch(&conn, &state.data_dir, &req)
}

#[tauri::command]
pub fn list_agent_launches(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> AppResult<Vec<AgentLaunchRow>> {
    let conn = lock_db(&state)?;
    launcher::list_launches(&conn, limit.unwrap_or(50).min(500))
}

/// 复制 Claude Code 终端启动命令（渠道 env 注入转成单行 shell 命令，仅进剪贴板）。
/// Codex 不支持：其启动依赖 CODEX_HOME 配置目录与 config.toml，无法用单行命令表达。
#[tauri::command]
pub fn copy_agent_cli_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
    model: Option<String>,
) -> AppResult<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let envs = {
        let conn = lock_db(&state)?;
        let row = crate::channels::repo::find_row(&conn, &channel_id)?
            .ok_or_else(|| crate::error::AppError::Invalid("渠道不存在".into()))?;
        let token = crate::channels::service::resolve_primary_credential(&channel_id);
        let mut warnings = Vec::new();
        let (_bin, _method, envs, _extra) = launcher::build_claude_launch(
            &channel_id,
            &row,
            &model,
            token.as_deref(),
            &mut warnings,
        )?;
        envs
    };
    // 单行命令：KEY='value' KEY2='value2' claude（POSIX 单引号转义，同 curl 复制）
    let quote = crate::workbenches::api_testing::curl::quote;
    let mut parts: Vec<String> = envs
        .iter()
        .map(|(k, v)| format!("{}={}", k, quote(v)))
        .collect();
    parts.push("claude".into());
    let command = parts.join(" ");

    app.clipboard()
        .write_text(&command)
        .map_err(|e| crate::error::AppError::Invalid(format!("写入剪贴板失败: {e}")))?;
    Ok(command)
}

/// 真实 Agent 单次调用探针：spawn 真实 claude / codex CLI 收集输出。
/// 三阶段：锁内校验 + spawn + 落快照 → 锁外阻塞等待（最长 10 分钟）→ 锁内回填 exited_at。
#[tauri::command]
pub async fn run_agent_probe(
    state: State<'_, AppState>,
    mut req: ProbeRequest,
) -> AppResult<ProbeOutcome> {
    // 工作目录留空 = 默认数据目录的 agent 子目录（v0.18.0）
    if req.working_directory.trim().is_empty() {
        let default_dir = state.data_dir.join("agent");
        std::fs::create_dir_all(&default_dir)
            .map_err(|e| crate::error::AppError::Invalid(format!("创建默认工作目录失败: {e}")))?;
        req.working_directory = default_dir.to_string_lossy().into_owned();
    }
    let prepared = {
        let conn = lock_db(&state)?;
        probe::prepare(&conn, &state.data_dir, &req)?
    }; // 锁释放后再等待进程结束

    let outcome = tauri::async_runtime::spawn_blocking(move || probe::run_to_completion(prepared))
        .await
        .map_err(|e| crate::error::AppError::Invalid(format!("探针任务失败: {e}")))?;

    let conn = lock_db(&state)?;
    probe::finish(&conn, &outcome)?;
    Ok(outcome)
}

fn lock_db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}
