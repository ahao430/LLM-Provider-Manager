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

/// 真实 Agent 单次调用探针：spawn 真实 claude / codex CLI 收集输出。
/// 三阶段：锁内校验 + spawn + 落快照 → 锁外阻塞等待（最长 10 分钟）→ 锁内回填 exited_at。
#[tauri::command]
pub async fn run_agent_probe(
    state: State<'_, AppState>,
    req: ProbeRequest,
) -> AppResult<ProbeOutcome> {
    let prepared = {
        let conn = lock_db(&state)?;
        probe::prepare(&conn, &state.data_dir, &req)?
    }; // 锁释放后再等待进程结束

    let (outcome, launch_id) = tauri::async_runtime::spawn_blocking(move || {
        let outcome = probe::run_to_completion(prepared);
        let launch_id = outcome.launch_id.clone();
        (outcome, launch_id)
    })
    .await
    .map_err(|e| crate::error::AppError::Invalid(format!("探针任务失败: {e}")))?;

    let conn = lock_db(&state)?;
    probe::finish(&conn, &launch_id)?;
    Ok(outcome)
}

fn lock_db(state: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))
}
