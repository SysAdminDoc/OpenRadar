// The network boundary every Rust-side fetch goes through.
mod http;

mod cache;
mod chunks;
/// The colour-vision measurement the ramps are held to. Only the tests reach
/// for it: what ships is the ramps it vouches for, not the arithmetic.
#[cfg(test)]
mod contrast;
mod cross_section;
mod dealias;
mod exports;
#[cfg(test)]
mod fixture;
mod gfs;
mod hrrr;
mod incident_packs;
mod level2;
mod level3;
mod lightning;
mod mrms;
mod palette;
mod probsevere;
mod tiles;
mod vad;

/// The decoder entry points, for the fuzz targets and nothing else.
///
/// Every one of these reads bytes fetched from a public service, and none of
/// the modules holding them is public: the app is one binary and the decoders
/// are its internals. A fuzz target is a separate crate, though, so it can
/// only reach what the library exports.
///
/// Rather than making the modules public for the sake of a test, this facade
/// is behind a feature that nothing but the fuzz workspace turns on, so the
/// shipped library exports exactly what it did before.
#[cfg(feature = "fuzzing")]
pub mod fuzzing {
    pub use crate::gfs::{decode_complex, decode_message};
    pub use crate::hrrr::{parse_grid, read_message};
    pub use crate::level2::{scan_volume, Level2Error};
    pub use crate::level3::{read_mesocyclones, read_storm_cells};
    pub use crate::lightning::decode_flashes;
    pub use crate::mrms::decode_grib;
}

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const LOG_MAX_FILE_SIZE_BYTES: u128 = 2_000_000;
const LOG_ROTATED_FILE_COUNT: usize = 3;

/// Starts the application.
///
/// Left out of a fuzz build, which is the one place this feature is ever on.
/// `tauri::generate_context!` expands into code written by a proc macro
/// against the version of `tauri-utils` the macro itself was compiled with,
/// and building for an explicit `--target`, which every fuzz target does,
/// stops Cargo unifying features between the host and target graphs and can
/// leave the two sides looking at different versions of that type. A fuzz
/// target links the decoders and never starts a window, so the whole question
/// goes away by not compiling the entry point.
///
/// Enabling `fuzzing` on an ordinary build is therefore a mistake, and it is a
/// loud one: `main.rs` calls this and stops compiling without it.
#[cfg(not(feature = "fuzzing"))]
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        // Where the window was and how big it was, kept between launches. A
        // map is a thing people size to their screen and then leave alone, so
        // re-centring it at the configured size on every start throws away a
        // decision they made once and expect to hold.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Not the maximised or fullscreen state: a window that comes
                // back covering the screen because it was left that way once
                // is a surprise, and the map is usable at any size.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE,
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        // MRMS grids are decoded here and handed to the map as ordinary tiles,
        // so the timeline, scrubbing, and export all work on them unchanged.
        .register_asynchronous_uri_scheme_protocol("mrms", |_app, request, responder| {
            // Path and query together: the threshold the reader set rides
            // along as ?min= and has to reach the drawing.
            let path = request
                .uri()
                .path_and_query()
                .map(|both| both.as_str().to_string())
                .unwrap_or_else(|| request.uri().path().to_string());
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
        // Tiles and the small documents the overlays are drawn from, kept on
        // disk so a launch with no network opens on the last view rather than
        // an empty map.
        .register_asynchronous_uri_scheme_protocol("cached", |_app, request, responder| {
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let served = tiles::serve(&uri).await;
                responder.respond(
                    tauri::http::Response::builder()
                        .status(served.status)
                        .header("Content-Type", served.content_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "no-store")
                        // Read by the page so it can say how old the picture
                        // is rather than passing stale tiles off as live.
                        .header("X-OpenRadar-Age", served.age.as_secs().to_string())
                        .header("Access-Control-Expose-Headers", "X-OpenRadar-Age")
                        .body(served.body)
                        .expect("a cached response is well formed"),
                );
            });
        })
        // A completed incident pack is one PMTiles file. The webview asks for
        // ordinary Z/X/Y images and this handler reads only that local archive,
        // so selecting a pack never falls through to the network.
        .register_asynchronous_uri_scheme_protocol("incident", |_app, request, responder| {
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let served = incident_packs::serve_tile(&path).await;
                responder.respond(
                    tauri::http::Response::builder()
                        .status(served.status)
                        .header("Content-Type", "image/png")
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "public, max-age=31536000, immutable")
                        .body(served.body)
                        .expect("an incident tile response is well formed"),
                );
            });
        })
        .invoke_handler(tauri::generate_handler![
            exports::save_export,
            incident_packs::incident_pack_estimate,
            incident_packs::incident_pack_list,
            incident_packs::incident_pack_set_limit,
            incident_packs::incident_pack_create,
            incident_packs::incident_pack_pause,
            incident_packs::incident_pack_resume,
            incident_packs::incident_pack_cancel,
            incident_packs::incident_pack_delete,
            level2::level2_archive_sweep,
            level2::level2_local_sweep,
            level2::level2_sweep,
            level2::level2_nearest_site,
            level2::level2_cross_section,
            level3::level3_cells,
            level3::level3_classification,
            probsevere::probsevere_reading,
            mrms::mrms_frames,
            mrms::mrms_products,
            lightning::lightning_flashes,
            palette::set_palettes,
            gfs::gfs_wind,
            hrrr::hrrr_smoke
        ])
        .setup(|_app| {
            // The cache lives beside the logs rather than in the roaming
            // profile: it is rebuildable, and it can run to a few hundred
            // megabytes.
            match _app.path().app_cache_dir() {
                Ok(dir) => cache::init(&dir),
                Err(error) => {
                    log::warn!("OpenRadar has nowhere to keep its cache: {error}");
                }
            }

            // Packs are user-kept data rather than cache entries. They live in
            // app data so an ordinary cache clear cannot erase a prepared map.
            match _app.path().app_data_dir() {
                Ok(dir) => incident_packs::init(&dir),
                Err(error) => {
                    log::warn!("OpenRadar has nowhere to keep incident packs: {error}");
                }
            }

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
