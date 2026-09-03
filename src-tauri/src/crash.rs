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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;

/// The first argument that turns a launch into a dump monitor rather than the
/// app. Checked before anything else, so the monitor never builds a window
/// and never registers as a second instance.
pub const MONITOR_ARG: &str = "--openradar-crash-monitor";

/// How many dumps to keep. Each is a few megabytes and the interesting one is
/// almost always the newest; a directory that grows without bound is its own
/// bug report.
const KEEP_DUMPS: usize = 5;

/// How long the monitor waits for the app to connect before giving up.
///
/// Only for a monitor nobody is watching: one whose parent died between the
/// spawn and the connect. Once the app has connected, what ends the monitor
/// is the app going, which arrives as a disconnect.
const CONNECT_WITHIN: Duration = Duration::from_secs(30);

/// A dump smaller than this is a write that failed, not a crash to look at.
///
/// The file is created before the dump is written into it, so a failure part
/// way leaves something on disk that is not evidence of anything.
const SMALLEST_DUMP: u64 = 1024;

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
    match monitor_args(std::env::args().skip(1)) {
        MonitorArgs::NotAMonitor => false,
        MonitorArgs::Incomplete => true,
        MonitorArgs::Watch { socket, dumps } => {
            let shutdown = AtomicBool::new(false);
            serve(Path::new(&socket), Path::new(&dumps), &shutdown);
            true
        }
    }
}

/// What a launch's arguments say about whether it is a monitor.
///
/// Split out from the launch so both answers can be checked. Asserting only
/// that an ordinary launch is left alone passes just as well with the monitor
/// branch removed altogether, and then `install` starts a second copy of the
/// app rather than a monitor and no crash is ever written.
#[derive(Debug, PartialEq, Eq)]
pub enum MonitorArgs {
    NotAMonitor,
    /// Carrying the flag with nothing to watch. Still not the app.
    Incomplete,
    Watch {
        socket: String,
        dumps: String,
    },
}

pub fn monitor_args(mut args: impl Iterator<Item = String>) -> MonitorArgs {
    if args.next().as_deref() != Some(MONITOR_ARG) {
        return MonitorArgs::NotAMonitor;
    }
    match (args.next(), args.next()) {
        (Some(socket), Some(dumps)) => MonitorArgs::Watch { socket, dumps },
        _ => MonitorArgs::Incomplete,
    }
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
    let connected = Arc::new(AtomicBool::new(false));
    let handler = Writer {
        dumps: dumps.to_path_buf(),
        connected: connected.clone(),
    };
    std::thread::scope(|scope| {
        // A monitor nobody connects to is a process nobody will ever end.
        scope.spawn(|| {
            let until = Instant::now() + CONNECT_WITHIN;
            while Instant::now() < until {
                if connected.load(Ordering::SeqCst) || shutdown.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            shutdown.store(true, Ordering::SeqCst);
        });
        // No stale timeout. It reaps a client that has not SENT anything, and
        // this one sends exactly once, when it dies: at twelve hours the
        // server dropped a live app and every crash after that went into a
        // closed socket.
        let _ = server.run(Box::new(handler), shutdown, None);
        // So the watchdog stops waiting rather than sleeping out its half
        // second after the loop has already finished.
        shutdown.store(true, Ordering::SeqCst);
    });
}

struct Writer {
    dumps: PathBuf,
    connected: Arc<AtomicBool>,
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
        match result {
            Ok(binary) => {
                // Flushed here rather than left to the drop, so the file is
                // complete before the loop ends and the process goes.
                let _ = binary.file.sync_all();
            }
            Err(_) => {
                // The file is created before the dump is written into it, so
                // a write that failed leaves something on disk that is not
                // evidence of anything. Reported as a crash it gives a reader
                // an empty file to send.
                prune_empty(&self.dumps);
            }
        }
        prune(&self.dumps, KEEP_DUMPS);
        // One crash is all this process was started for.
        minidumper::LoopAction::Exit
    }

    fn on_message(&self, _kind: u32, _buffer: Vec<u8>) {}

    fn on_client_connected(&self, _clients: usize) -> minidumper::LoopAction {
        self.connected.store(true, Ordering::SeqCst);
        minidumper::LoopAction::Continue
    }

    /// The app has gone, so there is nothing left to watch.
    ///
    /// Without this the default is to carry on, and the monitor outlives every
    /// clean shutdown: ten launches leaves ten headless copies of the app
    /// spinning on a ten millisecond poll.
    fn on_client_disconnected(&self, remaining: usize) -> minidumper::LoopAction {
        if remaining == 0 {
            minidumper::LoopAction::Exit
        } else {
            minidumper::LoopAction::Continue
        }
    }
}

/// Removes dumps too small to be one.
fn prune_empty(dumps: &Path) {
    let Ok(entries) = fs::read_dir(dumps) else {
        return;
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.extension().is_none_or(|kind| kind != "dmp") {
            continue;
        }
        if entry
            .metadata()
            .is_ok_and(|meta| meta.len() < SMALLEST_DUMP)
        {
            let _ = fs::remove_file(&path);
        }
    }
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
    found.sort_by_key(|entry| entry.0);
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
        // A file too small to be a dump is a write that failed, and reporting
        // it hands a reader an empty file to send.
        if meta.len() < SMALLEST_DUMP {
            continue;
        }
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
    // Anything an earlier run left. The monitor unlinks its own on the way
    // out, and a run that was killed rather than closed leaves one behind;
    // without this they pile up in the roaming profile beside a crash
    // directory the app is careful to bound.
    if let Ok(entries) = fs::read_dir(app_data) {
        for entry in entries.filter_map(|entry| entry.ok()) {
            let path = entry.path();
            let stale = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("crash-") && name.ends_with(".sock"));
            if stale {
                let _ = fs::remove_file(&path);
            }
        }
    }
    let socket = app_data.join(format!("crash-{}.sock", std::process::id()));
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

    /// A file big enough to pass for a dump, since anything smaller is a
    /// write that failed and is skipped on purpose.
    fn touch(dir: &Path, name: &str, at: SystemTime) {
        let path = dir.join(name);
        fs::write(&path, vec![b'M'; 4096]).expect("a file");
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
        // The number itself, not a literal beside it: the constant is the
        // only thing that governs what is kept, and a test that repeats the
        // number passes with the constant set to five hundred.
        assert_eq!(KEEP_DUMPS, 5);
        // And something that is not a dump, which is not this function's to
        // remove however old it is.
        touch(&dir, "notes.txt", base);

        prune(&dir, KEEP_DUMPS);
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
        assert_eq!(newest.bytes, 4096);
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
        for argv in [
            vec![],
            vec!["openradar://storm/KDMX".to_string()],
            vec!["--some-other-flag".to_string(), "value".to_string()],
        ] {
            assert_eq!(
                monitor_args(argv.into_iter()),
                MonitorArgs::NotAMonitor,
                "an ordinary launch was taken for a monitor"
            );
        }
    }

    #[test]
    fn a_launch_carrying_the_flag_is_a_monitor_and_says_what_to_watch() {
        // The half that was missing. Asserting only that an ordinary launch
        // is left alone passes just as well with the whole monitor branch
        // removed, and then the app starts a second copy of itself instead of
        // a monitor and no crash is ever written.
        assert_eq!(
            monitor_args(
                [
                    MONITOR_ARG.to_string(),
                    "C:/data/crash.sock".to_string(),
                    "C:/data/crashes".to_string(),
                ]
                .into_iter()
            ),
            MonitorArgs::Watch {
                socket: "C:/data/crash.sock".to_string(),
                dumps: "C:/data/crashes".to_string(),
            }
        );
        // Carrying the flag with nothing to watch is still not the app: it
        // must not fall through and open a window.
        assert_eq!(
            monitor_args([MONITOR_ARG.to_string()].into_iter()),
            MonitorArgs::Incomplete
        );
        assert_eq!(
            monitor_args([MONITOR_ARG.to_string(), "only-one".to_string()].into_iter()),
            MonitorArgs::Incomplete
        );
    }

    #[test]
    fn a_write_that_failed_is_not_reported_as_a_crash() {
        // The file is created before the dump is written into it, so a write
        // that failed part way leaves something on disk that is evidence of
        // nothing. Reported, it hands a reader an empty file to send.
        let dir = std::env::temp_dir().join(format!("openradar-empty-dump-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("a directory");
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_788_000_000);

        fs::write(dir.join("openradar-failed.dmp"), b"").expect("an empty file");
        assert_eq!(latest(&dir), None, "an empty dump is not a crash");

        // A real one alongside it is still found, and is the one reported
        // even though the empty file is newer.
        let real = dir.join("openradar-real.dmp");
        fs::write(&real, vec![b'M'; 4096]).expect("a dump");
        File::options()
            .write(true)
            .open(&real)
            .expect("the file")
            .set_modified(base)
            .expect("a time");
        let found = latest(&dir).expect("a record");
        assert!(found.path.ends_with("openradar-real.dmp"), "{}", found.path);

        prune_empty(&dir);
        assert!(!dir.join("openradar-failed.dmp").exists());
        assert!(
            real.exists(),
            "a real dump was swept away with the empty one"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
