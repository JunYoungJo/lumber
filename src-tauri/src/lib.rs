mod aggregate;
mod commands;
mod index;
mod query;
mod tab;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // 업데이터와 재시작은 데스크톱 전용이다.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::close_file,
            commands::get_lines,
            commands::set_filter,
            commands::search,
            commands::get_overview,
            commands::get_line_detail,
            commands::jump,
            commands::match_nav,
            commands::match_from_row,
            commands::lines_to_rows,
            commands::row_for_ts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
