//! Agent Launcher：启动式渠道切换（PLAN.md「Agent 启动器」/ docs/agent-launcher.md）。
//!
//! 核心语义：
//! - 渠道切换只改变 Agent 下一次启动的进程配置，不改变 Agent 发出的请求。
//! - 不修改用户已有 Agent 配置文件（Claude Code 环境变量注入 / Codex 独立 CODEX_HOME）。
//! - 不引入本地网关；子进程直接请求渠道。
//! - 每次启动写入 agent_launches 快照（不含 Token 明文）。
//! - 不中断、不修改已运行的 Agent 进程。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::channels::{repo as channel_repo, service as channel_service};
use crate::credentials::{self, CredentialKind};
use crate::error::{AppError, AppResult};
use crate::storage;
use crate::util::now_rfc3339;

pub const AGENT_CLAUDE_CODE_CLI: &str = "claude_code_cli";
pub const AGENT_CODEX_CLI: &str = "codex_cli";

/// 启动计划：(二进制, 启动方式, 注入的环境变量, 附属文件)。
pub(crate) type LaunchPlan = (
    &'static str,
    &'static str,
    Vec<(String, String)>,
    Option<PathBuf>,
);

/// 支持的 Agent 类型（Phase 1：两个）。
pub const SUPPORTED_AGENTS: &[&str] = &[AGENT_CLAUDE_CODE_CLI, AGENT_CODEX_CLI];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub agent_type: String,
    pub channel_id: String,
    pub model: Option<String>,
    pub working_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOutcome {
    pub launch_id: String,
    pub agent_type: String,
    pub launch_method: String,
    pub base_url: String,
    pub model: Option<String>,
    pub process_id: u32,
    pub log_file: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchRow {
    pub launch_id: String,
    pub agent_type: String,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub working_directory: Option<String>,
    pub launch_method: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub process_id: Option<i64>,
    pub started_at: String,
    pub exited_at: Option<String>,
}

/// 启动 Agent。凭证从系统凭证库受控读取后注入子进程环境，不落任何持久化明文。
pub fn launch(conn: &Connection, data_dir: &Path, req: &LaunchRequest) -> AppResult<LaunchOutcome> {
    if !SUPPORTED_AGENTS.contains(&req.agent_type.as_str()) {
        return Err(AppError::Invalid(format!(
            "暂不支持的 Agent 类型: {}（当前支持: {}）",
            req.agent_type,
            SUPPORTED_AGENTS.join(", ")
        )));
    }

    let row = channel_repo::find_row(conn, &req.channel_id)?
        .ok_or_else(|| AppError::Invalid("渠道不存在".into()))?;
    if !row.enabled {
        return Err(AppError::Invalid(format!("渠道「{}」已禁用", row.name)));
    }

    let working_dir = PathBuf::from(req.working_directory.trim());
    if !working_dir.is_dir() {
        return Err(AppError::Invalid(format!(
            "工作目录不存在: {}",
            working_dir.display()
        )));
    }

    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_owned);
    let mut warnings = Vec::new();

    // 主凭证（受控读取，仅注入子进程环境）
    let primary_token = channel_service::resolve_primary_credential(&req.channel_id);
    if primary_token.is_none() {
        warnings.push("渠道未配置主凭证，Agent 可能无法通过认证".into());
    }

    let launch_id = uuid::Uuid::new_v4().to_string();
    let (bin, launch_method, envs, extra_files) = match req.agent_type.as_str() {
        AGENT_CLAUDE_CODE_CLI => build_claude_launch(
            &req.channel_id,
            &row,
            &model,
            primary_token.as_deref(),
            &mut warnings,
        )?,
        AGENT_CODEX_CLI => build_codex_launch(
            data_dir,
            &req.channel_id,
            &row,
            &model,
            primary_token.as_deref(),
            &mut warnings,
        )?,
        _ => unreachable!("已在上方校验"),
    };
    let _ = extra_files; // codex 配置目录在 build 内已物化

    // 日志文件（子进程 stdout/stderr；凭证不会出现在命令行参数中）
    let log_dir = data_dir.join("logs").join("agent-launches");
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join(format!("{launch_id}.log"));
    let log_file = fs::File::create(&log_path)?;

    // 启动配置快照（脱敏：只记录变量名与敏感值的存在性，不记录值）
    let snapshot = serde_json::json!({
        "agentType": req.agent_type,
        "launchMethod": launch_method,
        "model": model,
        "authType": "protocol_derived",
        "envNames": envs.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>(),
        "channelUpdatedAt": row.updated_at,
    });

    let child = spawn_process(bin, &working_dir, &envs, log_file)?;
    let process_id = child.id();

    // 快照落库（失败不影响启动本身，但必须如实报错）
    conn.execute(
        "INSERT INTO agent_launches \
         (launch_id, agent_type, channel_id, working_directory, launch_method, base_url, model, \
          credential_ref, config_snapshot_json, process_id, started_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
        params![
            launch_id,
            req.agent_type,
            req.channel_id,
            working_dir.to_string_lossy(),
            launch_method,
            model,
            credentials::entry_name(&req.channel_id, &CredentialKind::Primary),
            snapshot.to_string(),
            i64::from(process_id),
            now_rfc3339()
        ],
    )?;

    watch_exit(child, launch_id.clone(), data_dir);

    Ok(LaunchOutcome {
        launch_id,
        agent_type: req.agent_type.clone(),
        launch_method: launch_method.to_string(),
        base_url: String::new(),
        model,
        process_id,
        log_file: log_path.to_string_lossy().into_owned(),
        warnings,
    })
}

/// 近期启动记录。
pub fn list_launches(conn: &Connection, limit: u32) -> AppResult<Vec<AgentLaunchRow>> {
    let mut stmt = conn.prepare(
        "SELECT l.launch_id, l.agent_type, l.channel_id, c.name, l.working_directory, \
         l.launch_method, l.base_url, l.model, l.process_id, l.started_at, l.exited_at \
         FROM agent_launches l LEFT JOIN channels c ON l.channel_id = c.id \
         ORDER BY l.started_at DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(AgentLaunchRow {
                launch_id: row.get(0)?,
                agent_type: row.get(1)?,
                channel_id: row.get(2)?,
                channel_name: row.get(3)?,
                working_directory: row.get(4)?,
                launch_method: row.get(5)?,
                base_url: row.get(6)?,
                model: row.get(7)?,
                process_id: row.get(8)?,
                started_at: row.get(9)?,
                exited_at: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ------------------------------------------------------------------
// Claude Code CLI：环境变量注入
// ------------------------------------------------------------------

pub(crate) fn build_claude_launch(
    channel_id: &str,
    row: &crate::channels::domain::ChannelRow,
    model: &Option<String>,
    token: Option<&str>,
    warnings: &mut Vec<String>,
) -> AppResult<LaunchPlan> {
    let base_url = row.base_url_for("anthropic_messages");
    if base_url.is_empty() {
        return Err(AppError::Invalid(
            "该渠道未配置 Anthropic Base URL（Claude Code 需要）".into(),
        ));
    }
    let mut envs: Vec<(String, String)> = vec![("ANTHROPIC_BASE_URL".into(), base_url)];

    // 认证：默认 ANTHROPIC_AUTH_TOKEN（Bearer 语义）；令牌以 sk-ant- 开头时按 API Key 注入
    if let Some(token) = token {
        if token.starts_with("sk-ant-") {
            envs.push(("ANTHROPIC_API_KEY".into(), token.into()));
        } else {
            envs.push(("ANTHROPIC_AUTH_TOKEN".into(), token.into()));
        }
    }

    if let Some(model) = model {
        envs.push(("ANTHROPIC_MODEL".into(), model.clone()));
    }

    warnings.push(
        "提示：若本机已配置 OAuth 登录，环境变量认证与其可能冲突，请确认实际生效的认证方式".into(),
    );
    let _ = channel_id;

    Ok(("claude", "env_injection", envs, None))
}

// ------------------------------------------------------------------
// Codex CLI：独立 CODEX_HOME
// ------------------------------------------------------------------

pub(crate) fn build_codex_launch(
    data_dir: &Path,
    channel_id: &str,
    row: &crate::channels::domain::ChannelRow,
    model: &Option<String>,
    token: Option<&str>,
    warnings: &mut Vec<String>,
) -> AppResult<LaunchPlan> {
    let channel_name = &row.name;
    // Codex（wire_api=chat）在 base_url 后拼 /chat/completions，约定带 /v1；主地址不带时自动补
    let base_url = crate::channels::domain::ensure_v1(&row.base_url_for("openai_chat"));
    if base_url.is_empty() {
        return Err(AppError::Invalid(
            "该渠道未配置 Chat Base URL（Codex 需要）".into(),
        ));
    }
    let profile_dir = data_dir
        .join("agent-profiles")
        .join("codex")
        .join(channel_id);
    fs::create_dir_all(&profile_dir)?;

    let wire_api = "chat";

    let mut providers = BTreeMap::new();
    providers.insert(
        "lcm_channel".to_string(),
        CodexProvider {
            name: channel_name.to_string(),
            base_url: base_url.to_string(),
            env_key: "LCM_CODEX_API_KEY".to_string(),
            wire_api: wire_api.to_string(),
        },
    );
    let codex_config = CodexConfig {
        model: model.clone(),
        model_provider: "lcm_channel".to_string(),
        model_providers: providers,
    };
    let config_text = toml::to_string_pretty(&codex_config)
        .map_err(|e| AppError::Invalid(format!("Codex 配置生成失败: {e}")))?;
    fs::write(profile_dir.join("config.toml"), config_text)?;

    let mut envs: Vec<(String, String)> = vec![(
        "CODEX_HOME".into(),
        profile_dir.to_string_lossy().into_owned(),
    )];
    if let Some(token) = token {
        envs.push(("LCM_CODEX_API_KEY".into(), token.into()));
    } else {
        warnings.push("渠道未配置主凭证，LCM_CODEX_API_KEY 将为空".into());
    }

    Ok(("codex", "codex_home", envs, Some(profile_dir)))
}

#[derive(Serialize)]
struct CodexConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    model_provider: String,
    model_providers: BTreeMap<String, CodexProvider>,
}

#[derive(Serialize)]
struct CodexProvider {
    name: String,
    base_url: String,
    env_key: String,
    wire_api: String,
}

// ------------------------------------------------------------------
// 进程管理
// ------------------------------------------------------------------

fn spawn_process(
    bin: &str,
    working_dir: &Path,
    envs: &[(String, String)],
    log_file: fs::File,
) -> AppResult<Child> {
    let mut command = build_command(bin);
    command
        .current_dir(working_dir)
        .envs(envs.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file.try_clone()?))
        .stderr(Stdio::from(log_file));
    command
        .spawn()
        .map_err(|e| AppError::Invalid(format!("启动 {bin} 失败（请确认已安装并在 PATH 中）: {e}")))
}

/// Windows 上 npm 安装的 CLI 是 .cmd 脚本，需要经 cmd /C 启动。
fn build_command(bin: &str) -> Command {
    #[cfg(windows)]
    {
        if bin.contains('.') {
            let mut c = Command::new(bin);
            return c;
        }
        let mut c = Command::new("cmd");
        c.arg("/C").arg(bin);
        c
    }
    #[cfg(not(windows))]
    {
        Command::new(bin)
    }
}

/// 守护线程：等待子进程退出后回填 exited_at。
/// 应用退出时线程随之结束，此时记录保持「运行中」，不视为错误。
fn watch_exit(mut child: Child, launch_id: String, data_dir: &Path) {
    let db_path = storage::database::db_path(data_dir);
    std::thread::spawn(move || {
        let _ = child.wait();
        if let Ok(conn) = storage::database::open_connection(&db_path) {
            let _ = conn.execute(
                "UPDATE agent_launches SET exited_at = ?1 WHERE launch_id = ?2",
                params![now_rfc3339(), launch_id],
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_config_renders_toml() {
        let mut providers = BTreeMap::new();
        providers.insert(
            "lcm_channel".to_string(),
            CodexProvider {
                name: "测试渠道".into(),
                base_url: "https://api.x.com/v1".into(),
                env_key: "LCM_CODEX_API_KEY".into(),
                wire_api: "responses".into(),
            },
        );
        let text = toml::to_string_pretty(&CodexConfig {
            model: Some("gpt-test".into()),
            model_provider: "lcm_channel".into(),
            model_providers: providers,
        })
        .unwrap();
        assert!(text.contains("model_provider"));
        assert!(text.contains("wire_api = \"responses\""));
        assert!(text.contains("[model_providers.lcm_channel]"));
    }

    #[test]
    fn unsupported_agent_is_rejected() {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        let req = LaunchRequest {
            agent_type: "some_ide".into(),
            channel_id: "none".into(),
            model: None,
            working_directory: ".".into(),
        };
        let err = launch(&conn, std::path::Path::new("/tmp"), &req).unwrap_err();
        assert!(err.to_string().contains("暂不支持的 Agent 类型"));
    }
}
