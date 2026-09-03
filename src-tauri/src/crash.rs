//! What is left behind when the window vanishes.
//!
//! The panic hook writes a line to the log, which covers a Rust panic and
//! nothing else. A decoder that walks off the end of a buffer takes the
//! process down with an access violation: no panic, no line, no window, and
//! nothing on the next launch to say it happened. There is a committed file
//! in `fuzz/reproducers` that does exactly that today.
//!
//! So a minidump is written instead, by a small second process that is
//! watching this one. Writing it from inside the process that has just
//! faulted is the thing this arrangement exists to avoid: its heap and its
//! stack are the evidence, and asking it to allocate is asking the evidence
//! to change under the pen.
//!
//! **Nothing leaves the machine.** The dump is a file in the app's own data
//! directory, the newest five are kept, and the app says where it is. There
//! is no uploader here and no host for one in the allowlist.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime};

use serde::Serialize;

/// The first argument that turns a launch into a dump monitor rather than the
/// app. Checked before anything else, so the monitor never builds a window
/// and never registers as a second instance.
pub const MONITOR_ARG: &str = "--openradar-crash-monitor";

/// How many dumps to keep. Each is a few megabytes and the interesting one is
/// almost always the newest; a directory that grows without bound is its own
/// bug report.
const KEEP_DUMPS: usize = 5;

/// How long the monitor waits with nothing connected before giving up.
///
/// It is started by the app and outlives it only long enough to write what
/// the app was carrying when it died. A monitor whose parent never connected
/// is a monitor nobody is watching.
const STALE_AFTER: Duration = Duration::from_secs(60 * 60 * 12);

/// What the last run left behind, for the panel that offers to show it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecord {
    /// Where the file is, so a reader can find it without being told how.
    pub path: String,
    pub bytes: u64,
    /// When it was written, as RFC 3339.
    pub at: String,
}

/// The dumps this build writes, under the directory the app was given.
pub fn dumps_dir(app_data: &Path) -> PathBuf {
    app_data.join("crashes")
}

/// Runs the monitor loop when this process was started as one.
///
/// Returns true when it did, and the caller must return without building
/// anything: this process is not the app.
pub fn ran_as_monitor() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(MONITOR_ARG) {
        return false;
    }
    let (Some(socket), Some(dumps)) = (args.next(), args.next()) else {
        // Started as a monitor with nothing to monitor. Still not the app.
        return true;
    };
    let shutdown = AtomicBool::new(false);
    serve(Path::new(&socket), Path::new(&dumps), &shutdown);
    true
}

/// Listens for a crash from the process that started this one and writes it.
///
/// Public so a test can run it on a thread and point a child process at it,
/// which is the same arrangement the app uses with the parts swapped round.
pub fn serve(socket: &Path, dumps: &Path, shutdown: &AtomicBool) {
    if fs::create_dir_all(dumps).is_err() {
        return;
    }
    let Ok(mut server) = minidumper::Server::with_name(minidumper::SocketName::Path(socket)) else {
        return;
    };
    let handler = Writer {
        dumps: dumps.to_path_buf(),
    };
    let _ = server.run(Box::new(handler), shutdown, Some(STALE_AFTER));
}

struct Writer {
    dumps: PathBuf,
}

impl minidumper::ServerHandler for Writer {
    fn create_minidump_file(&self) -> Result<(File, PathBuf), std::io::Error> {
        fs::create_dir_all(&self.dumps)?;
        // Named for when it happened, because that is the only thing a reader
        // has to match it against: "the window went at about four o'clock".
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        let path = self.dumps.join(format!("openradar-{stamp}.dmp"));
        Ok((File::create(&path)?, path))
    }

    fn on_minidump_created(
        &self,
        result: Result<minidumper::MinidumpBinary, minidumper::Error>,
    ) -> minidumper::LoopAction {
        if let Ok(binary) = result {
            // Flushed here rather than left to the drop, so the file is
            // complete before the loop ends and the process goes.
            let _ = binary.file.sync_all();
        }
        prune(&self.dumps, KEEP_DUMPS);
        // One crash is all this process was started for.
        minidumper::LoopAction::Exit
    }

    fn on_message(&self, _kind: u32, _buffer: Vec<u8>) {}
}

/// Keeps the newest `keep` dumps and removes the rest.
pub fn prune(dumps: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dumps) else {
        return;
    };
    let mut found: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|kind| kind == "dmp"))
        .filter_map(|entry| {
            let at = entry.metadata().ok()?.modified().ok()?;
            Some((at, entry.path()))
        })
        .collect();
    if found.len() <= keep {
        return;
    }
    found.sort_by(|left, right| left.0.cmp(&right.0));
    for (_, path) in found.iter().take(found.len() - keep) {
        let _ = fs::remove_file(path);
    }
}

/// The newest dump, or nothing when the last run ended the way it should.
pub fn latest(dumps: &Path) -> Option<CrashRecord> {
    let entries = fs::read_dir(dumps).ok()?;
    let mut newest: Option<(SystemTime, PathBuf, u64)> = None;
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.extension().is_none_or(|kind| kind != "dmp") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(at) = meta.modified() else { continue };
        if newest.as_ref().is_none_or(|(held, _, _)| at > *held) {
            newest = Some((at, path, meta.len()));
        }
    }
    let (at, path, bytes) = newest?;
    Some(CrashRecord {
        path: path.to_string_lossy().to_string(),
        bytes,
        at: chrono::DateTime::<chrono::Utc>::from(at).to_rfc3339(),
    })
}

/// What the last run left behind, or nothing when it ended the way it should.
#[tauri::command]
pub fn crash_last_dump(app: tauri::AppHandle) -> Option<CrashRecord> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().ok()?;
    latest(&dumps_dir(&dir))
}

/// Connects to a monitor already listening and catches this process's crashes.
///
/// Separate from `install` so a test can stand the monitor up itself.
pub fn attach_to(socket: &Path) -> Option<crash_handler::CrashHandler> {
    let client = minidumper::Client::with_name(minidumper::SocketName::Path(socket)).ok()?;
    // Safety: the closure does no allocation and touches nothing but the
    // socket, which is what the contract asks of a handler running on a
    // faulted thread.
    let handler = unsafe {
        crash_handler::CrashHandler::attach(crash_handler::make_crash_event(
            move |context: &crash_handler::CrashContext| {
                crash_handler::CrashEventResult::Handled(client.request_dump(context).is_ok())
            },
        ))
    };
    handler.ok()
}

/// Starts a monitor for this process and points a handler at it.
///
/// Every step is allowed to fail: without a monitor the app runs exactly as it
/// did before this existed, which is what it must do rather than refusing to
/// start because a diagnostic could not be set up.
pub fn install(app_data: &Path) -> Option<crash_handler::CrashHandler> {
    let dumps = dumps_dir(app_data);
    fs::create_dir_all(&dumps).ok()?;
    prune(&dumps, KEEP_DUMPS);

    let exe = std::env::current_exe().ok()?;
    let socket = app_data.join(format!("crash-{}.sock", std::process::id()));
    let _ = fs::remove_file(&socket);
    std::process::Command::new(exe)
        .arg(MONITOR_ARG)
        .arg(&socket)
        .arg(&dumps)
        .spawn()
        .ok()?;

    // The monitor has to be listening before a client can connect, and it has
    // just been started. A short wait rather than a handshake, because the
    // only thing lost by giving up is the dump.
    for _ in 0..100 {
        if let Some(handler) = attach_to(&socket) {
            return Some(handler);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str, at: SystemTime) {
        let path = dir.join(name);
        fs::write(&path, b"dump").expect("a file");
        let file = File::options().write(true).open(&path).expect("the file");
        file.set_modified(at).expect("a time");
    }

    #[test]
    fn keeps_the_newest_five_and_no_more() {
        // Each of these is a few megabytes, and the interesting one is almost
        // always the newest. A directory that grows without bound is its own
        // bug report.
        let dir = std::env::temp_dir().join(format!("openradar-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("a directory");
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_788_000_000);
        for minute in 0..8u64 {
            touch(
                &dir,
                &format!("openradar-{minute}.dmp"),
                base + Duration::from_secs(minute * 60),
            );
        }
        // And something that is not a dump, which is not this function's to
        // remove however old it is.
        touch(&dir, "notes.txt", base);

        prune(&dir, 5);
        let mut left: Vec<String> = fs::read_dir(&dir)
            .expect("the directory")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                "notes.txt".to_string(),
                "openradar-3.dmp".to_string(),
                "openradar-4.dmp".to_string(),
                "openradar-5.dmp".to_string(),
                "openradar-6.dmp".to_string(),
                "openradar-7.dmp".to_string(),
            ]
        );

        let newest = latest(&dir).expect("a record");
        assert!(newest.path.ends_with("openradar-7.dmp"), "{}", newest.path);
        assert_eq!(newest.bytes, 4);
        assert!(newest.at.starts_with("2026-"), "{}", newest.at);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_with_nothing_in_it_reports_nothing() {
        let dir = std::env::temp_dir().join(format!("openradar-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("a directory");
        assert_eq!(latest(&dir), None);
        // And a directory that is not there at all is not a failure either:
        // the ordinary case is a machine that has never crashed.
        assert_eq!(latest(&dir.join("missing")), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_launch_that_is_not_a_monitor_is_left_alone() {
        // The app's own launch, which must not be diverted by anything a
        // deep link or a second instance passes it.
        assert!(!ran_as_monitor());
    }
}
