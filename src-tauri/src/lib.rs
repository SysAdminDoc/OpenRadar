use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const LOG_MAX_FILE_SIZE_BYTES: u128 = 2_000_000;
const LOG_ROTATED_FILE_COUNT: usize = 3;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        log::error!("OpenRadar panic: {panic_info}");
    }));

    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("OpenRadar could not start");
}

