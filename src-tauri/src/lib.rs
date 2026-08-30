// The network boundary every Rust-side fetch goes through.
mod http;

mod exports;
mod level2;
mod mrms;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const LOG_MAX_FILE_SIZE_BYTES: u128 = 2_000_000;
const LOG_ROTATED_FILE_COUNT: usize = 3;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        log::error!("OpenRadar panic: {panic_info}");
    }));

    tauri::Builder::default()
        // A second launch, including one from an openradar:// link, hands its
        // arguments to the window that is already open instead of starting
        // another one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("openradar".into()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .rotation_strategy(RotationStrategy::KeepSome(LOG_ROTATED_FILE_COUNT))
                .max_file_size(LOG_MAX_FILE_SIZE_BYTES)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // MRMS grids are decoded here and handed to the map as ordinary tiles,
        // so the timeline, scrubbing, and export all work on them unchanged.
        .register_asynchronous_uri_scheme_protocol("mrms", |_app, request, responder| {
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let body = mrms::serve_tile(&path).await;
                responder.respond(
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", "image/png")
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "public, max-age=300")
                        .body(body)
                        .expect("a tile response is well formed"),
                );
            });
        })
        .invoke_handler(tauri::generate_handler![
            exports::save_export,
            level2::level2_sweep,
            level2::level2_nearest_site,
            mrms::mrms_frames,
            mrms::mrms_products
        ])
        .setup(|_app| {
            // Development builds are not installed, so the scheme has to be
            // claimed at runtime for a link to reach the app at all.
            #[cfg(all(desktop, debug_assertions))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = _app.deep_link().register_all() {
                    log::warn!("OpenRadar could not register its link scheme: {error}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("OpenRadar could not start");
}
