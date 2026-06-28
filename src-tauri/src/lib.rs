mod proxy;
mod sse;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sse::SseState::default())
        .invoke_handler(tauri::generate_handler![
            sse::sse_connect,
            sse::sse_disconnect
        ]);

    let builder = proxy::register_proxy_protocol(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
