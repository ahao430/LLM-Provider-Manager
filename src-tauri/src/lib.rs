//! LCM — Local Channel Manager（Rust 核心）。
//!
//! 架构总览见 `docs/architecture.md`，模块边界见 `docs/adapter-boundaries.md`。
//!
//! 两条铁律（来自 PLAN.md）：
//! 1. Agent 原生调用路径不经过任何 Adapter。
//! 2. 工作台路径允许 Adapter，但所有可能影响请求语义的处理必须记录 ProcessingEvent。

mod adapters;
mod agent;
mod backup;
mod billing;
mod channels;
mod commands;
mod credentials;
pub mod diagnostics;
mod error;
mod market;
// MCP 只读服务器（bin/lcm-mcp 使用；App 内不调用）
pub mod mcp;
mod models;
mod processing;
mod requests;
mod services;
mod storage;
mod util;
mod workbenches;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use crate::commands::agent::{
    launch_agent, list_agent_compat, list_agent_launches, run_agent_probe, upsert_agent_compat,
};
use crate::commands::app::{get_app_info, get_database_stats};
use crate::commands::backup::{
    check_archive_consistency, cleanup_old_data, create_backup, restore_backup,
};
use crate::commands::balance::{
    import_bailian_bills, list_latest_balances, query_bailian_transactions, query_channel_balance,
    refresh_channel_balance, set_balance_query,
};
use crate::commands::billing::{
    add_balance_snapshot, add_bill, add_recharge, delete_balance_snapshot, delete_bill,
    delete_recharge, get_channel_funds, list_balance_snapshots, list_bills, list_recharges,
    update_bill, update_recharge,
};
use crate::commands::channels::{
    create_channel, create_channel_group, delete_channel, delete_channel_group, get_channel,
    list_channel_groups, list_channels, list_providers, provider_templates, rename_channel_group,
    set_channel_dashboard_pinned, set_channel_enabled, update_channel,
};
use crate::commands::credentials::{
    clear_channel_credential, copy_channel_credential, reveal_channel_credential,
    set_channel_credential,
};
use crate::commands::dashboard::get_dashboard_stats;
use crate::commands::diagnostics::diagnose_request;
use crate::commands::image::{
    edit_image, generate_image, read_archived_image, send_vision_request,
};
use crate::commands::market::{
    fetch_market_prices, get_market_fx, list_channel_price_annotations, list_market_prices,
};
use crate::commands::models::{
    add_model_price, create_global_model, delete_channel_model, delete_global_model,
    delete_model_price, fetch_channel_model_list, get_effective_price, import_channel_models,
    list_all_channel_models, list_channel_models, list_global_models, list_model_prices,
    rename_global_model, upsert_channel_model,
};
use crate::commands::update::{check_for_updates, download_update, install_update};
use crate::commands::workbench::replay_test_request;
use crate::commands::workbench::{
    copy_test_curl, get_test_raw, get_test_record, list_latest_model_tests, list_test_records,
    quick_test_channel, reparse_test_response, send_test_request, send_test_stream,
};

/// 全局应用状态（Tauri managed state）。
pub struct AppState {
    /// SQLite 连接。rusqlite 的 Connection 不是 Sync，用 Mutex 包裹。
    pub db: Mutex<Connection>,
    /// 应用数据目录（Tauri App Data Directory）。
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = storage::paths::resolve_data_dir(app.handle())?;
            let conn = storage::database::init(&data_dir)?;
            // 凭证文件初始化 + 一次性 Keychain 迁移（消除 macOS 每次访问弹窗）
            credentials::init(&data_dir, &conn)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_database_stats,
            list_providers,
            provider_templates,
            list_channels,
            get_channel,
            create_channel,
            update_channel,
            delete_channel,
            set_channel_enabled,
            list_channel_groups,
            create_channel_group,
            rename_channel_group,
            delete_channel_group,
            set_channel_dashboard_pinned,
            set_channel_credential,
            reveal_channel_credential,
            copy_channel_credential,
            clear_channel_credential,
            list_agent_compat,
            upsert_agent_compat,
            launch_agent,
            list_agent_launches,
            run_agent_probe,
            list_global_models,
            create_global_model,
            rename_global_model,
            delete_global_model,
            list_channel_models,
            list_all_channel_models,
            upsert_channel_model,
            delete_channel_model,
            fetch_channel_model_list,
            import_channel_models,
            list_model_prices,
            get_effective_price,
            add_model_price,
            delete_model_price,
            send_test_request,
            send_test_stream,
            generate_image,
            send_vision_request,
            read_archived_image,
            list_test_records,
            get_test_record,
            get_test_raw,
            reparse_test_response,
            replay_test_request,
            get_dashboard_stats,
            diagnose_request,
            list_recharges,
            add_recharge,
            update_recharge,
            delete_recharge,
            list_bills,
            add_bill,
            update_bill,
            delete_bill,
            list_balance_snapshots,
            add_balance_snapshot,
            delete_balance_snapshot,
            get_channel_funds,
            create_backup,
            restore_backup,
            check_archive_consistency,
            cleanup_old_data,
            quick_test_channel,
            edit_image,
            set_balance_query,
            query_channel_balance,
            refresh_channel_balance,
            query_bailian_transactions,
            import_bailian_bills,
            list_latest_balances,
            list_latest_model_tests,
            copy_test_curl,
            list_market_prices,
            fetch_market_prices,
            get_market_fx,
            list_channel_price_annotations,
            check_for_updates,
            download_update,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
