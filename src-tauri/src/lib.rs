// The network boundary every Rust-side fetch goes through.
mod http;

mod bundles;
mod cache;
mod chunks;
/// The colour-vision measurement the ramps are held to. Only the tests reach
/// for it: what ships is the ramps it vouches for, not the arithmetic.
#[cfg(test)]
mod contrast;
mod cross_section;
mod data_export;
mod dealias;
mod exports;
#[cfg(test)]
mod fixture;
mod geotiff;
mod gfs;
mod glance;
mod hrrr;
mod incident_packs;
mod journal;
mod level2;
mod level3;
mod lightning;
mod mrms;
mod palette;
mod probsevere;
mod sound;
mod tdwr;
mod tiles;
mod tray;
mod vad;
mod wallpaper;

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
                        // The content type is whatever the upstream service
                        // said, and this handler serves it back on an origin
                        // the page can reach. Nothing navigates to that origin
                        // today, so these two are insurance rather than a
                        // hole being closed: the type is not guessed at, and
                        // anything that did open one of these gets a document
                        // that can do nothing at all.
                        .header("X-Content-Type-Options", "nosniff")
                        .header("Content-Security-Policy", "sandbox")
                        // Read by the page so it can say how old the picture
                        // is rather than passing stale tiles off as live.
                        .header("X-OpenRadar-Age", served.age.as_secs().to_string())
                        // And which replay bundle it came out of, when one did.
                        .header("X-OpenRadar-Bundle", served.bundle.unwrap_or_default())
                        .header(
                            "Access-Control-Expose-Headers",
                            "X-OpenRadar-Age, X-OpenRadar-Bundle",
                        )
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
            level2::level2_gate,
            journal::journal_append,
            journal::journal_rows,
            journal::journal_clear,
            journal::journal_path,
            journal::journal_note,
            journal::journal_restore,
            journal::journal_remove,
            journal::journal_thumb,
            journal::journal_thumb_data,
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
            hrrr::hrrr_smoke,
            data_export::export_sweep_data,
            data_export::export_grid_data,
            bundles::replay_bundle_capture,
            bundles::replay_bundle_open,
            bundles::replay_bundle_close,
            glance::glance_write,
            glance::glance_read,
            tray::tray_hazard,
            tray::tray_copy,
            tray::tray_close_behaviour,
            tray::glance_on_top,
            tray::glance_showing,
            tray::glance_open,
            wallpaper::wallpaper_available,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_restore,
            sound::alert_sound_bytes,
            tray::tray_enabled
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
                Ok(dir) => {
                    incident_packs::init(&dir);
                    // The journal is the reader's own record, not a cache
                    // entry, so it lives beside the packs rather than
                    // anywhere a cache clear can reach.
                    journal::init(&dir);
                    // The wallpaper picture is written here too, one file
                    // overwritten each time rather than a growing folder of
                    // yesterdays somewhere the reader has to find.
                    wallpaper::init(&dir);
                }
                Err(error) => {
                    log::warn!("OpenRadar has nowhere to keep incident packs: {error}");
                }
            }

            // The tray is built here and nowhere else. Declaring one in the
            // config as well gives two icons, one of which nothing is
            // listening to.
            if let Err(error) = tray::init(_app.handle()) {
                log::warn!("OpenRadar could not put an icon in the tray: {error}");
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The main window only. Closing the small one closes the
                // small one, whatever this is set to.
                if window.label() != "main" || !tray::closes_to_tray() {
                    // And the icon goes with the app, explicitly: Windows
                    // leaves a ghost of it behind otherwise.
                    if window.label() == "main" {
                        let app = window.app_handle();
                        tray::drop_tray(app);
                        // Said rather than left to the last window closing.
                        // With the glance window open, closing the main one
                        // took the workspace away and left the process
                        // running with no way back to it.
                        app.exit(0);
                    }
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("OpenRadar could not start");
}
