//! 真实 Agent 探针：单次调用真实 claude / codex CLI（测试中心「Agent 测试」）。
//!
//! 与 launcher.rs（启动交互式进程交给用户）的区别：探针是一次非交互调用——
//! 发一条 prompt，收集输出后返回。安全边界与 launcher 一致：凭证只注入子进程环境，
//! 不落库、不进日志；Agent 原生请求不归档为 LCM 测试记录（只写 agent_launches 快照）。
//! 渠道未配置凭证时快速失败——无凭证的真实 Agent 测试没有意义，且会得到误导性的远端 401。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::agent::launcher::{
    build_claude_launch, build_codex_launch, AGENT_CLAUDE_CODE_CLI, AGENT_CODEX_CLI,
    SUPPORTED_AGENTS,
};
use crate::channels::{repo as channel_repo, service as channel_service};
use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

/// 单次调用超时：编码 Agent 可能较慢，默认 10 分钟。
const PROBE_TIMEOUT: Duration = Duration::from_secs(600);
/// stdout / stderr 捕获上限（超出截断，防止超长输出撑爆内存）。
const OUTPUT_CAP_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRequest {
    pub agent_type: String,
    pub channel_id: String,
    pub model: Option<String>,
    pub working_directory: String,
    pub prompt: String,
    /// CLI 可执行文件路径覆盖（默认按 PATH 查找 claude / codex；GUI 环境 PATH 可能不同）
    pub binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutcome {
    pub launch_id: String,
    pub agent_type: String,
    pub launch_method: String,
    /// success / exit_error / timeout / spawn_error
    pub status: String,
    pub exit_code: Option<i32>,
    /// Agent 回复正文（claude 取 JSON 输出的 result 字段；codex 取 stdout 原文）
    pub result: String,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: i64,
    pub warnings: Vec<String>,
    pub log_file: String,
    /// claude --output-format json 的补充信息（解析失败时为 null）
    pub session_id: Option<String>,
    pub agent_duration_ms: Option<i64>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// 测试记录 Raw 归档（CLI 调用参数），相对 data_dir 路径
    pub request_ref: String,
    /// 测试记录 Raw 归档（捕获的 stdout / stderr），相对 data_dir 路径
    pub response_ref: String,
    pub model: Option<String>,
}

/// 已 spawn、待等待完成的探针（运行阶段不持有数据库锁）。
pub struct PreparedProbe {
    child: Child,
    pub launch_id: String,
    pub agent_type: String,
    pub launch_method: String,
    pub warnings: Vec<String>,
    pub model: Option<String>,
    pub data_dir: PathBuf,
    pub request_ref: String,
    stdout_pipe: Option<std::process::ChildStdout>,
    stderr_pipe: Option<std::process::ChildStderr>,
    log_path: PathBuf,
}

/// 阶段一（锁内）：校验请求、构建注入环境、spawn 进程、落 agent_launches 快照。
pub fn prepare(conn: &Connection, data_dir: &Path, req: &ProbeRequest) -> AppResult<PreparedProbe> {
    if req.prompt.trim().is_empty() {
        return Err(AppError::Invalid("Prompt 不能为空".into()));
    }
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

    // 无凭证快速失败（本地免鉴权网关如需测试，改用「API 测试」页签）
    let token = channel_service::resolve_primary_credential(&req.channel_id).ok_or_else(|| {
        AppError::Invalid(format!(
            "渠道「{}」未配置主凭证，请先在渠道管理配置凭证，再进行真实 Agent 测试",
            row.name
        ))
    })?;

    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_owned);
    let mut warnings = Vec::new();
    let launch_id = uuid::Uuid::new_v4().to_string();
    let (default_bin, launch_method, envs, extra_files) = match req.agent_type.as_str() {
        AGENT_CLAUDE_CODE_CLI => {
            build_claude_launch(&req.channel_id, &row, &model, Some(&token), &mut warnings)?
        }
        AGENT_CODEX_CLI => build_codex_launch(
            data_dir,
            &req.channel_id,
            &row,
            &model,
            Some(&token),
            &mut warnings,
        )?,
        _ => unreachable!("已在上方校验"),
    };
    let _ = extra_files; // codex 配置目录在 build 内已物化

    // 二进制路径覆盖（GUI 环境 PATH 与终端可能不同）
    let bin = req
        .binary_path
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or(default_bin);

    let args = build_cli_args(req.agent_type.as_str(), model.as_deref(), req.prompt.trim());

    let log_dir = data_dir.join("logs").join("agent-launches");
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join(format!("{launch_id}.log"));

    // 脱敏快照（与 launcher 同形：只记录变量名；binary 路径非敏感）
    let snapshot = serde_json::json!({
        "agentType": req.agent_type,
        "launchMethod": launch_method,
        "model": model.clone(),
        "authType": "protocol_derived",
        "kind": "probe",
        "binary": bin,
        "promptChars": req.prompt.chars().count(),
        "envNames": envs.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>(),
    });

    // Raw 请求归档（spawn 前写好，内容为 CLI 调用参数；不含凭证值）
    let raw_request = serde_json::json!({
        "traceId": launch_id,
        "kind": "agent_probe",
        "agentType": req.agent_type,
        "binary": bin,
        "model": model.clone(),
        "workingDirectory": working_dir.to_string_lossy(),
        "prompt": req.prompt.trim(),
        "envNames": envs.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>(),
    });
    let request_path = crate::storage::paths::write_archive_atomic(
        &crate::storage::paths::archive_requests_dir(data_dir),
        &format!("{launch_id}.json"),
        &serde_json::to_string_pretty(&raw_request)
            .map_err(|e| AppError::Invalid(format!("Raw 请求序列化失败: {e}")))?,
    )?;
    let request_ref = rel_path(data_dir, &request_path);

    let mut child = Command::new(bin)
        .args(&args)
        .current_dir(&working_dir)
        .envs(envs.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::Invalid(format!(
                "无法启动 {bin}（请确认 CLI 已安装，或在页面指定可执行文件路径）: {e}"
            ))
        })?;
    let process_id = child.id();
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

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
            crate::credentials::entry_name(
                &req.channel_id,
                &crate::credentials::CredentialKind::Primary
            ),
            snapshot.to_string(),
            i64::from(process_id),
            now_rfc3339()
        ],
    )?;

    // 测试记录（request_type=agent_probe）：完成阶段回填状态与归档引用
    crate::requests::repo::insert_pending(
        conn,
        &launch_id,
        &req.channel_id,
        None,
        None,
        "agent_cli",
        "agent_probe",
    )?;

    Ok(PreparedProbe {
        child,
        launch_id,
        agent_type: req.agent_type.clone(),
        launch_method: launch_method.to_string(),
        warnings,
        model,
        data_dir: data_dir.to_path_buf(),
        request_ref,
        stdout_pipe,
        stderr_pipe,
        log_path,
    })
}

/// 归档相对路径（与 engine::rel_path 同规则）。
fn rel_path(data_dir: &Path, file: &Path) -> String {
    file.strip_prefix(data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}

/// 阶段二（锁外，阻塞）：等待进程结束（超时 kill），收集输出。
pub fn run_to_completion(prepared: PreparedProbe) -> ProbeOutcome {
    let started = Instant::now();
    let PreparedProbe {
        mut child,
        launch_id,
        agent_type,
        launch_method: prepared_launch_method,
        warnings: prepared_warnings,
        model: prepared_model,
        data_dir: prepared_data_dir,
        request_ref: prepared_request_ref,
        stdout_pipe,
        stderr_pipe,
        log_path,
    } = prepared;
    let prepared_log_file = log_path.to_string_lossy().into_owned();

    // 管道必须持续排空，否则子进程写满缓冲区会整体卡死
    let out_handle = thread::spawn(move || read_capped(stdout_pipe));
    let err_handle = thread::spawn(move || read_capped(stderr_pipe));

    // 轮询等待；超时 kill（kill 后管道 EOF，读取线程自然结束）
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let mut status_kind = "spawn_error";
    let mut exit_code: Option<i32> = None;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                status_kind = if status.success() {
                    "success"
                } else {
                    "exit_error"
                };
                exit_code = status.code();
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    status_kind = "timeout";
                    break;
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break, // 等待异常：保持 spawn_error
        }
    }

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();
    let duration_ms = started.elapsed().as_millis() as i64;

    // claude print 模式 JSON：取 result 字段为回复正文；解析失败回退原始 stdout
    let mut result = stdout.clone();
    let mut session_id = None;
    let mut agent_duration_ms = None;
    let mut cost_usd = None;
    let mut input_tokens = None;
    let mut output_tokens = None;
    if agent_type == AGENT_CLAUDE_CODE_CLI && status_kind == "success" {
        if let Some(parsed) = parse_claude_json(&stdout) {
            result = parsed.result;
            session_id = parsed.session_id;
            agent_duration_ms = parsed.duration_ms;
            cost_usd = parsed.cost_usd;
            input_tokens = parsed.input_tokens;
            output_tokens = parsed.output_tokens;
        }
    }

    let log_text = format!(
        "# agent probe {launch_id}\n# status: {status_kind}  exit_code: {exit_code:?}  duration_ms: {duration_ms}\n\n--- stdout ---\n{stdout}\n\n--- stderr ---\n{stderr}\n"
    );
    let _ = fs::write(&log_path, &log_text);

    // Raw 响应归档：捕获到的 stdout / stderr 是 LCM 真实观测到的证据
    let raw_response = serde_json::json!({
        "kind": "agent_probe",
        "status": status_kind,
        "exitCode": exit_code,
        "durationMs": duration_ms,
        "result": result,
        "stdout": stdout,
        "stderr": stderr,
        "sessionId": session_id,
        "agentDurationMs": agent_duration_ms,
        "costUsd": cost_usd,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
    });
    // 归档失败不阻断结果：留痕日志、把告警带给前端，记录仍会落库（response_ref 为空）
    let raw_response_text = serde_json::to_string_pretty(&raw_response).unwrap_or_default();
    let (response_ref, archive_note) = if raw_response_text.is_empty() {
        (String::new(), Some("响应归档失败（序列化）".to_string()))
    } else {
        match crate::storage::paths::write_archive_atomic(
            &crate::storage::paths::archive_responses_dir(&prepared_data_dir),
            &format!("{launch_id}.json"),
            &raw_response_text,
        ) {
            Ok(path) => (rel_path(&prepared_data_dir, &path), None),
            Err(e) => {
                let _ = fs::write(
                    &log_path,
                    format!("{log_text}\n# response archive failed: {e}\n"),
                );
                (String::new(), Some(format!("响应归档失败: {e}")))
            }
        }
    };
    let mut final_warnings = prepared_warnings;
    if let Some(note) = archive_note {
        final_warnings.push(note);
    }

    ProbeOutcome {
        launch_id,
        agent_type,
        launch_method: prepared_launch_method,
        status: status_kind.to_string(),
        exit_code,
        result,
        stdout,
        stderr,
        duration_ms,
        warnings: final_warnings,
        log_file: prepared_log_file,
        session_id,
        agent_duration_ms,
        cost_usd,
        input_tokens,
        output_tokens,
        request_ref: prepared_request_ref,
        response_ref,
        model: prepared_model,
    }
}

/// 阶段三（锁内）：回填 agent_launches.exited_at 与测试记录（request_records）状态。
///
/// 归档红线说明：这里记录的是 **LCM 亲自观测到的探针运行**（CLI 调用与捕获的
/// stdout / stderr），不是 Agent 进程自行发出的原生 HTTP 请求——后者依然不归档、
/// 不声称已被观测。
pub fn finish(conn: &Connection, outcome: &ProbeOutcome) -> AppResult<()> {
    // agent_launches 生命周期回填
    conn.execute(
        "UPDATE agent_launches SET exited_at = ?1 WHERE launch_id = ?2",
        params![now_rfc3339(), outcome.launch_id],
    )?;

    // 测试记录回填：状态映射到 CHECK 允许值（success / failed），
    // 失败原因放 error_code / error_message，正文与原始输出以归档为准。
    let (status, error_code, error_message) = match outcome.status.as_str() {
        "success" => ("success", None, None),
        "timeout" => (
            "failed",
            Some("PROBE_TIMEOUT"),
            Some("探针超时（10 分钟），进程已终止".to_string()),
        ),
        "spawn_error" => (
            "failed",
            Some("PROBE_SPAWN_ERROR"),
            Some("CLI 进程启动失败".to_string()),
        ),
        _ => (
            "failed",
            Some("PROBE_EXIT_NONZERO"),
            Some(
                outcome
                    .stderr
                    .chars()
                    .take(200)
                    .collect::<String>()
                    .trim()
                    .to_string(),
            ),
        ),
    };
    conn.execute(
        "UPDATE request_records \
         SET status = ?2, error_code = ?3, error_message = ?4, request_ref = ?5, \
             response_ref = ?6, duration_ms = ?7, input_tokens = ?8, output_tokens = ?9, \
             model = ?10, completed_at = ?11 \
         WHERE trace_id = ?1",
        params![
            outcome.launch_id,
            status,
            error_code,
            error_message,
            outcome.request_ref,
            outcome.response_ref,
            outcome.duration_ms,
            outcome.input_tokens,
            outcome.output_tokens,
            outcome.model,
            now_rfc3339()
        ],
    )?;
    Ok(())
}

/// 按 Agent 类型构建 CLI 参数（纯函数，单测覆盖）。
fn build_cli_args(agent_type: &str, model: Option<&str>, prompt: &str) -> Vec<String> {
    match agent_type {
        // print 模式单次调用，JSON 输出便于提取回复正文
        AGENT_CLAUDE_CODE_CLI => {
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "json".to_string(),
            ];
            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m.to_string());
            }
            args
        }
        // exec 非交互执行；工作目录可能不是 git 仓库，跳过检查
        AGENT_CODEX_CLI => {
            let mut args = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if let Some(m) = model {
                args.push("-m".to_string());
                args.push(m.to_string());
            }
            args.push(prompt.to_string());
            args
        }
        _ => vec![prompt.to_string()],
    }
}

#[derive(Debug)]
struct ParsedClaude {
    result: String,
    session_id: Option<String>,
    duration_ms: Option<i64>,
    cost_usd: Option<f64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
}

/// 解析 claude -p --output-format json 输出（防御式：字段缺失 / 非 JSON 均返回 None）。
fn parse_claude_json(text: &str) -> Option<ParsedClaude> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let obj = value.as_object()?;
    let result = obj.get("result").and_then(|v| v.as_str())?.to_string();
    Some(ParsedClaude {
        result,
        session_id: obj
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        duration_ms: obj.get("duration_ms").and_then(|v| v.as_i64()),
        cost_usd: obj.get("total_cost_usd").and_then(|v| v.as_f64()),
        input_tokens: obj
            .get("usage")
            .and_then(|u| u.get("input_tokens"))
            .and_then(|v| v.as_i64()),
        output_tokens: obj
            .get("usage")
            .and_then(|u| u.get("output_tokens"))
            .and_then(|v| v.as_i64()),
    })
}

/// 读取管道内容并截断到上限（持续排空到 EOF，超出部分丢弃）。
fn read_capped(pipe: Option<impl Read>) -> String {
    let mut buffer: Vec<u8> = Vec::new();
    if let Some(mut pipe) = pipe {
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let remaining = OUTPUT_CAP_BYTES.saturating_sub(buffer.len());
                    if remaining > 0 {
                        buffer.extend_from_slice(&chunk[..n.min(remaining)]);
                    }
                }
            }
        }
    }
    String::from_utf8_lossy(&buffer).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_args_include_print_and_json_flags() {
        let args = build_cli_args(AGENT_CLAUDE_CODE_CLI, Some("claude-sonnet-4-5"), "你好");
        assert_eq!(
            args,
            vec![
                "-p",
                "你好",
                "--output-format",
                "json",
                "--model",
                "claude-sonnet-4-5"
            ]
        );
    }

    #[test]
    fn codex_args_use_exec_mode() {
        let args = build_cli_args(AGENT_CODEX_CLI, None, "列出当前目录文件");
        assert_eq!(
            args,
            vec!["exec", "--skip-git-repo-check", "列出当前目录文件"]
        );
    }

    #[test]
    fn parses_claude_print_json() {
        let text = r#"{"type":"result","subtype":"success","result":"你好！","session_id":"abc","duration_ms":1234,"total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":5}}"#;
        let parsed = parse_claude_json(text).expect("应解析成功");
        assert_eq!(parsed.result, "你好！");
        assert_eq!(parsed.session_id.as_deref(), Some("abc"));
        assert_eq!(parsed.duration_ms, Some(1234));
        assert_eq!(parsed.cost_usd, Some(0.01));
        assert_eq!(parsed.input_tokens, Some(10));
        assert_eq!(parsed.output_tokens, Some(5));
    }

    #[test]
    fn non_json_stdout_returns_none() {
        assert!(parse_claude_json("普通文本输出").is_none());
    }
}
