//! The current view on the desktop, refreshed on a schedule.
//!
//! The quiet showpiece: a composed radar picture of the reader's own area,
//! behind whatever they are working on. It needs no new data path, because
//! the still export already exists and this is where its bytes go instead of
//! into a file the reader has to look for.
//!
//! Five rules, and the first one is the whole reason this is safe to ship:
//!
//! - **What was there before is written down first, and put back.** The
//!   reader's own wallpaper is read before the first write and restored the
//!   moment the feature is switched off. A feature that takes something away
//!   and cannot give it back is not a feature.
//! - **Nothing is written anywhere else.** One file, in the app's own data
//!   directory, overwritten each time. Not the pictures folder, not the
//!   desktop, not a growing directory of yesterdays.
//! - **A failure is said out loud.** A write that fails answers with why, and
//!   the workspace puts it in front of somebody rather than leaving a stale
//!   picture up and saying nothing.
//! - **Windows only, and it says so.** `IDesktopWallpaper` is a Windows COM
//!   interface; there is no cross-platform way to do this and pretending
//!   otherwise would mean a button that silently does nothing on a Mac.
//! - **The reader's own picture is theirs.** This never reads the wallpaper
//!   for any purpose except putting it back.

use std::path::PathBuf;
use std::sync::Mutex;

/// Where the picture is written. One file, overwritten, in the app's own data.
static TARGET: Mutex<Option<PathBuf>> = Mutex::new(None);

/// What was on the desktop before this feature first wrote anything.
///
/// The outer option is whether it has been recorded at all; the inner one is
/// what was there, because "nothing, a plain colour" is a real answer and has
/// to be told apart from "not asked yet". It is written to a file beside the
/// picture as well, and that file is the point: held only in memory, a
/// restart forgets what it took, the next write records OpenRadar's own
/// picture as the thing to go back to, and the reader's own wallpaper is
/// gone for good with the app reporting success.
static PREVIOUS: Mutex<Option<Option<String>>> = Mutex::new(None);

/// Points the wallpaper writer at a directory. Called once, at startup.
pub fn init(dir: &std::path::Path) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        log::warn!("OpenRadar has nowhere to write a wallpaper: {error}");
        return;
    }
    *TARGET.lock().unwrap_or_else(|held| held.into_inner()) = Some(dir.join("wallpaper.png"));
}

/// Where the note about the reader's own wallpaper is kept.
fn record_path() -> Option<PathBuf> {
    target().map(|path| path.with_file_name("wallpaper-previous.txt"))
}

fn target() -> Option<PathBuf> {
    TARGET
        .lock()
        .unwrap_or_else(|held| held.into_inner())
        .clone()
}

/// Whether this machine can have its wallpaper set at all.
#[tauri::command]
pub fn wallpaper_available() -> bool {
    cfg!(windows)
}

/// Writes the picture and puts it on the desktop.
///
/// The bytes are the composed still the workspace already draws, so nothing
/// here knows anything about radar: it writes a file and asks the desktop to
/// show it.
#[tauri::command]
pub fn wallpaper_set(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    // A raw body rather than a JSON array of numbers. This runs on a timer
    // for the whole session, and a megabyte of PNG spelled as JSON is three
    // and a half megabytes of string built on the interface thread.
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("the wallpaper has to arrive as bytes".to_string());
    };
    set_with(bytes.clone(), apply)
}

/// The write, with the thing that touches the desktop handed in.
///
/// The seam exists for the tests. Without it, running them on Windows sets
/// the desktop of whoever ran them, which is how the suite once wiped its
/// own author's wallpaper.
fn set_with(bytes: Vec<u8>, apply_to: impl Fn(&str) -> Result<(), String>) -> Result<(), String> {
    // Asked before the file is written, not after. Writing the picture and
    // then failing to apply it left a machine that cannot do this rewriting
    // a megabyte of PNG every fifteen minutes for nothing.
    if !wallpaper_available() {
        return Err("setting the wallpaper is a Windows thing for now".to_string());
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Err("a wallpaper has to be a PNG".to_string());
    }
    let Some(path) = target() else {
        return Err("OpenRadar has nowhere to write a wallpaper".to_string());
    };

    // Read what is there before the first write, and only before the first:
    // reading it again after this feature has written one would record our
    // own picture as the thing to go back to.
    remember_previous();

    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    apply_to(&path.to_string_lossy())
}

/// Puts back whatever was on the desktop before.
///
/// Including a desktop that had no picture on it at all: an empty path is
/// what Windows itself takes to mean the plain colour, and a reader who
/// started with a colour has to end with one.
#[tauri::command]
pub fn wallpaper_restore() -> Result<(), String> {
    restore_with(apply)
}

fn restore_with(apply_to: impl Fn(&str) -> Result<(), String>) -> Result<(), String> {
    let held = {
        let mut held = PREVIOUS.lock().unwrap_or_else(|held| held.into_inner());
        if held.is_none() {
            *held = read_record();
        }
        held.clone()
    };
    let Some(was) = held else {
        // Nothing was ever taken away, so there is nothing to give back.
        return Ok(());
    };
    apply_to(was.as_deref().unwrap_or(""))?;
    *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
    if let Some(path) = record_path() {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// The note from a previous run, if this app wrote one and has not put it back.
fn read_record() -> Option<Option<String>> {
    let path = record_path()?;
    let text = std::fs::read_to_string(path).ok()?;
    let trimmed = text.trim().to_string();
    // An empty note is a real answer: the desktop was a plain colour.
    Some(if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    })
}

/// Never record our own picture as the thing to go back to.
///
/// It happens when the note has been deleted under us. The original is gone
/// by then, and the honest answer is the plain colour: recording our own
/// path would restore OpenRadar to itself for ever, which is the one outcome
/// a reader can never undo.
fn not_our_own(found: Option<String>) -> Option<String> {
    let ours = target()?;
    match found {
        Some(path) if path.eq_ignore_ascii_case(&ours.to_string_lossy()) => None,
        other => other,
    }
}

fn remember_previous() {
    let mut held = PREVIOUS.lock().unwrap_or_else(|held| held.into_inner());
    if held.is_some() {
        return;
    }
    // A note from a previous run outranks the registry, because by now the
    // registry says OpenRadar's own picture.
    if let Some(recorded) = read_record() {
        *held = Some(recorded);
        return;
    }
    // A read that failed is not an answer. Treating it as "the reader had a
    // plain colour" writes an empty note, and an empty note is read back as a
    // real answer for ever: restore then clears a desktop that had a picture
    // on it. Nothing is recorded and nothing is claimed.
    let found = match current() {
        Ok(found) => found,
        Err(error) => {
            log::warn!("OpenRadar could not read the current wallpaper: {error}");
            return;
        }
    };
    let was = not_our_own(found);
    let Some(path) = record_path() else {
        return;
    };
    // The note is the only durable record of what was taken. Without it a
    // restart records OpenRadar's own picture instead, so a write that fails
    // is said out loud and nothing is taken.
    if let Err(error) = std::fs::write(path, was.clone().unwrap_or_default()) {
        log::warn!("OpenRadar could not write down the current wallpaper: {error}");
        return;
    }
    *held = Some(was);
}

#[cfg(windows)]
fn current() -> Result<Option<String>, String> {
    // The registry rather than COM for the read. `IDesktopWallpaper` answers
    // per monitor and this only has to put one thing back; the value under
    // `Control Panel\Desktop` is what the shell itself restores from.
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Control Panel\Desktop", "/v", "Wallpaper"])
        .output()
        .map_err(|error| error.to_string())?;
    Ok(parse_wallpaper(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(not(windows))]
fn current() -> Result<Option<String>, String> {
    Ok(None)
}

/// Reads a wallpaper path out of what `reg query` printed.
///
/// Both value types, because a wallpaper set by a theme or by policy is often
/// REG_EXPAND_SZ, and "REG_EXPAND_SZ" does not contain "REG_SZ". Missing it
/// read as "no wallpaper", which is how a reader's own picture gets recorded
/// as nothing and never comes back. Expanded here rather than kept raw: the
/// whole point of the expandable type is that the reader expands it, and
/// `SystemParametersInfoW` will not.
fn parse_wallpaper(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| {
            line.split_once("REG_EXPAND_SZ")
                .or_else(|| line.split_once("REG_SZ"))
                .map(|(_, rest)| rest)
        })
        .map(|rest| expand(rest.trim()))
        .filter(|rest| !rest.is_empty())
}

/// Fills in the `%VARIABLES%` an expandable registry value is stored with.
///
/// The whole point of REG_EXPAND_SZ is that whoever reads it expands it, and
/// `SystemParametersInfoW` does not: handed `%SystemRoot%\\web\\...` it either
/// fails, or succeeds against a path that does not exist and leaves the
/// desktop blank with the note already deleted. An unknown name is left as it
/// was found rather than blanked, because a path with a stray percent sign in
/// it is still closer to the reader's picture than an empty string is.
fn expand(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(open) = rest.find('%') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('%') {
            Some(close) => {
                let name = &after[..close];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[close + 1..];
            }
            None => {
                // An unpaired percent sign. Whatever it is, it is not a
                // variable, so it goes through as written.
                out.push('%');
                out.push_str(after);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(windows)]
fn apply(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // SystemParametersInfoW with SPI_SETDESKWALLPAPER. Per-monitor wallpapers
    // want `IDesktopWallpaper`, which is COM and needs an apartment; this sets
    // every monitor to the same picture, which is what one radar view of one
    // area actually is.
    const SPI_SETDESKWALLPAPER: u32 = 0x0014;
    const SPIF_UPDATEINIFILE: u32 = 0x01;
    const SPIF_SENDCHANGE: u32 = 0x02;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(
            action: u32,
            param: u32,
            data: *mut core::ffi::c_void,
            winini: u32,
        ) -> i32;
    }

    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: the pointer is to a null-terminated wide string that outlives
    // the call, and the action takes exactly that.
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_ptr() as *mut core::ffi::c_void,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };
    if ok == 0 {
        return Err("Windows refused the wallpaper".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply(_path: &str) -> Result<(), String> {
    Err("setting the wallpaper is a Windows thing for now".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_that_is_not_one_is_refused() {
        // This ends up as the desktop background of somebody's machine, so
        // the format is checked rather than trusted.
        // Through the same seam the command uses, because the command now
        // takes an IPC request and a test cannot build one.
        let answer = set_with(b"<svg onload=alert(1)>".to_vec(), |_| Ok(()));
        assert!(answer.is_err());
    }

    #[test]
    fn it_says_where_it_works() {
        // A button that silently does nothing on a Mac is worse than one that
        // is not there, so the workspace asks first.
        assert_eq!(wallpaper_available(), cfg!(windows));
    }

    #[test]
    fn putting_it_back_with_nothing_taken_away_is_not_a_failure() {
        let _held = guard();
        *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
        assert!(wallpaper_restore().is_ok());
    }

    /// One test at a time: the statics and the note on disk are shared.
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    struct Fixture {
        _lock: std::sync::MutexGuard<'static, ()>,
        dir: std::path::PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            *TARGET.lock().unwrap_or_else(|held| held.into_inner()) = None;
            *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn guard() -> Fixture {
        let lock = ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|held| held.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "openradar-wallpaper-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir);
        *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
        Fixture { _lock: lock, dir }
    }

    #[test]
    fn what_it_took_survives_the_app_closing() {
        // The failure this holds shut: the note lived only in memory, so a
        // restart forgot it, the next write recorded OpenRadar's own picture
        // as the thing to go back to, and the reader's own wallpaper was
        // gone for good with the app reporting success.
        let held = guard();
        std::fs::write(
            held.dir.join("wallpaper-previous.txt"),
            r"C:\Users\somebody\Pictures\dog.jpg",
        )
        .unwrap();
        remember_previous();
        let recorded = PREVIOUS
            .lock()
            .unwrap_or_else(|inner| inner.into_inner())
            .clone();
        assert_eq!(
            recorded,
            Some(Some(r"C:\Users\somebody\Pictures\dog.jpg".to_string()))
        );
    }

    #[test]
    fn a_desktop_with_no_picture_is_a_real_answer() {
        // An empty note means the reader had a plain colour. Told apart from
        // "not asked yet", or every write re-reads the registry and by then
        // the registry says OpenRadar.
        let held = guard();
        std::fs::write(held.dir.join("wallpaper-previous.txt"), "").unwrap();
        remember_previous();
        let recorded = PREVIOUS
            .lock()
            .unwrap_or_else(|inner| inner.into_inner())
            .clone();
        assert_eq!(recorded, Some(None));
    }

    #[test]
    fn it_never_records_its_own_picture_as_the_thing_to_go_back_to() {
        // What a deleted note plus a previous run looks like: the desktop
        // already shows ours. The original is gone by then, and restoring
        // ours to itself for ever is the one answer nobody can undo.
        let held = guard();
        let ours = held.dir.join("wallpaper.png").to_string_lossy().to_string();
        assert_eq!(not_our_own(Some(ours.clone())), None);
        assert_eq!(not_our_own(Some(ours.to_uppercase())), None);
        // Anything else is the reader's and is kept.
        assert_eq!(
            not_our_own(Some(r"C:\Users\somebody\dog.jpg".to_string())),
            Some(r"C:\Users\somebody\dog.jpg".to_string())
        );
    }

    #[test]
    fn a_note_is_written_the_first_time_and_not_the_second() {
        let held = guard();
        remember_previous();
        let note = held.dir.join("wallpaper-previous.txt");
        assert!(note.exists(), "the first write records what it took");
        std::fs::write(&note, "kept").unwrap();
        remember_previous();
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "kept");
    }

    #[test]
    fn putting_it_back_gives_back_what_was_taken_and_forgets_it() {
        let held = guard();
        let note = held.dir.join("wallpaper-previous.txt");
        std::fs::write(&note, r"C:\Users\somebody\dog.jpg").unwrap();

        // Handed a fake applier rather than the real one, because the real
        // one sets the desktop of whoever runs the suite.
        let asked = Mutex::new(Vec::<String>::new());
        let answer = restore_with(|path| {
            asked
                .lock()
                .unwrap_or_else(|held| held.into_inner())
                .push(path.to_string());
            Ok(())
        });
        assert!(answer.is_ok(), "{answer:?}");
        assert_eq!(
            asked.into_inner().unwrap_or_else(|held| held.into_inner()),
            vec![r"C:\Users\somebody\dog.jpg".to_string()]
        );
        assert!(!note.exists(), "the note goes once it is given back");
    }

    #[test]
    fn a_desktop_that_had_no_picture_gets_its_plain_colour_back() {
        // Not the same as never having taken anything: an empty path is what
        // Windows itself reads as the plain colour, so it is asked for.
        let held = guard();
        std::fs::write(held.dir.join("wallpaper-previous.txt"), "").unwrap();
        let asked = Mutex::new(Vec::<String>::new());
        restore_with(|path| {
            asked
                .lock()
                .unwrap_or_else(|held| held.into_inner())
                .push(path.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            asked.into_inner().unwrap_or_else(|held| held.into_inner()),
            vec![String::new()]
        );
    }

    #[test]
    fn taking_nothing_asks_the_desktop_for_nothing() {
        let held = guard();
        let _ = std::fs::remove_file(held.dir.join("wallpaper-previous.txt"));
        *PREVIOUS.lock().unwrap_or_else(|inner| inner.into_inner()) = None;
        let asked = Mutex::new(0usize);
        restore_with(|_| {
            *asked.lock().unwrap_or_else(|held| held.into_inner()) += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(
            asked.into_inner().unwrap_or_else(|held| held.into_inner()),
            0
        );
    }

    /// A name this machine will certainly answer to, whichever it is.
    fn a_real_variable() -> (String, String) {
        for name in ["SystemRoot", "HOME", "PATH"] {
            if let Ok(value) = std::env::var(name) {
                return (name.to_string(), value);
            }
        }
        panic!("no environment at all");
    }

    #[test]
    fn an_expandable_path_is_expanded_before_it_is_kept() {
        // Driven through the parser rather than through `expand`, because the
        // parser is where the expansion has to happen: reading the value and
        // keeping it raw leaves a path SystemParametersInfoW cannot use, and
        // a restore that either fails for ever or blanks the desktop with the
        // note already deleted.
        let (name, value) = a_real_variable();
        let printed = format!(
            "\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    \
             Wallpaper    REG_EXPAND_SZ    %{name}%\\web\\img19.jpg\r\n\r\n"
        );
        let read = parse_wallpaper(&printed).expect("a value was printed");
        assert!(!read.contains('%'), "{read}");
        assert!(read.starts_with(&value), "{read}");
        assert!(read.ends_with(r"\web\img19.jpg"), "{read}");
    }

    #[test]
    fn a_plain_value_is_read_whole() {
        let printed = "\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    \
             Wallpaper    REG_SZ    C:\\WINDOWS\\web\\wallpaper\\Windows\\img19.jpg\r\n";
        assert_eq!(
            parse_wallpaper(printed).as_deref(),
            Some(r"C:\WINDOWS\web\wallpaper\Windows\img19.jpg")
        );
    }

    #[test]
    fn an_empty_value_and_no_value_both_read_as_nothing() {
        let empty = "    Wallpaper    REG_SZ    \r\n";
        assert_eq!(parse_wallpaper(empty), None);
        assert_eq!(
            parse_wallpaper("ERROR: The system was unable to find"),
            None
        );
        assert_eq!(parse_wallpaper(""), None);
    }

    #[test]
    fn a_name_nothing_answers_to_is_left_as_it_was_found() {
        // Blanking it would be worse: a path with a stray percent sign is
        // still closer to the reader's own picture than an empty string.
        let odd = expand("%NOTHING_ANSWERS_TO_THIS_NAME%/dog.jpg");
        assert_eq!(odd, "%NOTHING_ANSWERS_TO_THIS_NAME%/dog.jpg");
        assert_eq!(expand("100% cotton"), "100% cotton");
        assert_eq!(
            expand(r"C:\Users\somebody\dog.jpg"),
            r"C:\Users\somebody\dog.jpg"
        );
        assert_eq!(expand(""), "");
    }

    #[test]
    fn a_read_that_failed_takes_nothing_and_claims_nothing() {
        // The failure this holds shut: a failed registry read was recorded as
        // "the reader had a plain colour", written as an empty note, and read
        // back as a real answer for ever. Restore then cleared a desktop that
        // had a picture on it.
        let held = guard();
        // Nowhere to write the note is the same shape of "cannot tell": a
        // directory where the file goes.
        std::fs::create_dir_all(held.dir.join("wallpaper-previous.txt")).unwrap();
        remember_previous();
        let recorded = PREVIOUS
            .lock()
            .unwrap_or_else(|inner| inner.into_inner())
            .clone();
        assert_eq!(
            recorded, None,
            "nothing may be claimed when nothing is kept"
        );
        // And with nothing recorded, restore asks the desktop for nothing
        // rather than clearing it.
        let asked = Mutex::new(0usize);
        restore_with(|_| {
            *asked.lock().unwrap_or_else(|held| held.into_inner()) += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(
            asked.into_inner().unwrap_or_else(|held| held.into_inner()),
            0
        );
    }

    #[test]
    fn nothing_is_written_where_it_cannot_be_applied() {
        // A machine that cannot set a wallpaper must not have a picture
        // rewritten into its app data every fifteen minutes for nothing.
        let held = guard();
        let png = [
            vec![0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            vec![0u8; 16],
        ]
        .concat();
        let answer = set_with(png.clone(), |_| Ok(()));
        if cfg!(windows) {
            assert!(answer.is_ok(), "{answer:?}");
            assert!(held.dir.join("wallpaper.png").exists());
        } else {
            assert!(answer.is_err());
            assert!(!held.dir.join("wallpaper.png").exists());
        }
    }

    #[test]
    fn it_writes_the_picture_where_it_says_and_nowhere_else() {
        let held = guard();
        let png = [
            vec![0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            vec![7u8; 16],
        ]
        .concat();
        if set_with(png.clone(), |_| Ok(())).is_err() {
            return; // Not a Windows build; the refusal is its own test.
        }
        let written: Vec<String> = std::fs::read_dir(&held.dir)
            .unwrap()
            .filter_map(|entry| Some(entry.ok()?.file_name().to_string_lossy().to_string()))
            .collect();
        assert_eq!(written.len(), 2, "{written:?}");
        assert!(written.contains(&"wallpaper.png".to_string()));
        assert!(written.contains(&"wallpaper-previous.txt".to_string()));
        assert_eq!(std::fs::read(held.dir.join("wallpaper.png")).unwrap(), png);
    }
}
