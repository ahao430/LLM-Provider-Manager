//! 诊断命令：对测试记录做知识库诊断（只读，不修改数据）。

use tauri::State;

use crate::diagnostics::engine::{self, Diagnosis};
use crate::error::AppResult;
use crate::AppState;

#[tauri::command]
pub fn diagnose_request(state: State<'_, AppState>, trace_id: String) -> AppResult<Diagnosis> {
    let conn = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Invalid("数据库连接锁已失效".into()))?;
    engine::diagnose(&conn, &trace_id)
}
