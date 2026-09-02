import type { AlertSeverity } from "./overlays/alerts";

/**
 * A short sound for an alert reaching the place somebody is watching.
 *
 * Synthesised rather than shipped, so nothing has to be fetched or decoded and
 * there is no way for it to fail silently because an asset went missing. Off
 * until somebody asks for it, because a weather app that makes a noise on its
 * own is a weather app people close.
 *
 * A tornado warning and a special weather statement do not sound the same. The
 * kit is four short patterns built from the same voice, told apart by how many
 * notes there are and which way they go, which is what somebody can actually
 * recognise from the next room.
 *
 * ## What this must never sound like
 *
 * The Emergency Alert System attention signal is 853 Hz and 960 Hz sounded
 * together for eight to twenty-five seconds. Transmitting it, or a simulation
 * of it, outside an actual alert is prohibited by 47 CFR 11.45, and the FCC
 * has a $1M consent decree on record against tones that tripped downstream
 * receivers. The Wireless Emergency Alert attention signal (47 CFR 10.520(d))
 * and the 1050 Hz tone that opens NOAA Weather Radio carry the same problem:
 * a receiver hearing one does not know it came out of somebody's laptop.
 *
 * So none of these tones goes near those frequencies, none of them sounds two
 * tones together, and none of them lasts anything like long enough to be
 * mistaken for a real signal. `FORBIDDEN_HZ` and the tests beside it hold that
 * against a future edit, because "we would never do that" is not a control.
 */

/**
 * Frequencies this app will not produce, and how far away it stays.
 *
 * Not a style rule. 853 and 960 are the two halves of the EAS attention
 * signal, 1050 is the NOAA Weather Radio alarm, and 2083 is close enough to
 * the WEA attention signal's upper tone to be worth avoiding.
 */
export const FORBIDDEN_HZ = [853, 960, 1050, 2083] as const;

/** How far every tone stays from those, in hertz. */
export const FORBIDDEN_MARGIN_HZ = 40;

/** The longest any one sound may run, in seconds. */
export const MAX_SECONDS = 1.2;

export interface Tone {
  /** The notes, in order. One sound, several notes, never two at once. */
  notes: number[];
  /** How long each note lasts, in seconds. */
  each: number;
}

/**
 * One pattern per severity, told apart by shape rather than by pitch alone.
 *
 * Rising and more of them as it gets worse, which is the only ordering
 * somebody hears without being taught it.
 */
export const TONES: Record<AlertSeverity, Tone> = {
  extreme: { notes: [523.25, 659.25, 783.99, 659.25], each: 0.16 },
  severe: { notes: [523.25, 659.25], each: 0.2 },
  moderate: { notes: [587.33], each: 0.3 },
  minor: { notes: [493.88], each: 0.25 },
};

/** Whether a tone keeps clear of everything it has to keep clear of. */
export function toneIsSafe(tone: Tone): boolean {
  if (tone.notes.length * tone.each > MAX_SECONDS) return false;
  return tone.notes.every((note) =>
    FORBIDDEN_HZ.every(
      (banned) => Math.abs(note - banned) > FORBIDDEN_MARGIN_HZ,
    ),
  );
}

let context: AudioContext | null = null;

/**
 * When the last sound finishes, in the context's own clock.
 *
 * One sound at a time. The context is module-level and every call read
 * `currentTime` fresh, so pressing a preview twice in a second put two
 * oscillators on the output together: a chord, which is the one shape this
 * must never make. A second sound now waits for the first to finish rather
 * than joining it.
 */
let quietAgain = 0;

/** Nought to one. The reader's, so it is asked for rather than assumed. */
let volume = 0.18;

export function setAlertVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
}

/**
 * Plays the sound for a severity, and answers whether it actually did.
 *
 * A browser refuses to make a sound before the reader has interacted with the
 * page, and a machine can have no audio at all. Neither is a failure worth
 * reporting: the notification still arrives, and this was only ever the
 * quicker half of it.
 */
export async function playAlertTone(
  severity: AlertSeverity = "severe",
): Promise<boolean> {
  const tone = TONES[severity] ?? TONES.severe;
  // Checked here rather than trusted from the table, so a tone edited into
  // something prohibited is refused at the point it would have been played.
  if (!toneIsSafe(tone)) return false;
  try {
    if (typeof AudioContext === "undefined") return false;
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;

    // The reader's own sound when they chose one and it decoded. A file that
    // was refused leaves this null, and the kit answers instead, so the
    // warning still makes a noise.
    if (ownPath && own) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const from = Math.max(context.currentTime, quietAgain);
      // Cut off rather than refused: the reader chose the file, and the first
      // few seconds are what they will recognise. Something several minutes
      // long arriving at four in the morning is not a sound, it is an alarm
      // nobody can stop.
      const seconds = Math.min(own.duration, MAX_SOUND_SECONDS);
      quietAgain = from + seconds;
      source.buffer = own;
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(volume, from + 0.02);
      gain.gain.setValueAtTime(volume, from + Math.max(0.03, seconds - 0.08));
      gain.gain.linearRampToValueAtTime(0, from + seconds);
      source.connect(gain).connect(context.destination);
      source.start(from);
      source.stop(from + seconds);
      return true;
    }

    // After whatever is still sounding, so two of these never overlap.
    const start = Math.max(context.currentTime, quietAgain);
    quietAgain = start + tone.notes.length * tone.each;
    tone.notes.forEach((note, at) => {
      const held = context as AudioContext;
      const from = start + at * tone.each;
      const oscillator = held.createOscillator();
      const gain = held.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note, from);
      // Faded in and out rather than switched, because a square edge on a
      // sine is a click, and a click is what a broken speaker sounds like.
      gain.gain.setValueAtTime(0, from);
      gain.gain.linearRampToValueAtTime(volume, from + 0.02);
      gain.gain.linearRampToValueAtTime(0, from + tone.each * 0.92);
      oscillator.connect(gain).connect(held.destination);
      oscillator.start(from);
      oscillator.stop(from + tone.each);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The most a reader's own sound file may weigh.
 *
 * A short alert sound is tens of kilobytes. Two megabytes is a generous
 * ceiling for a lossless one and small enough that decoding it cannot become
 * the reason a warning was slow.
 */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/**
 * The longest a reader's own sound is allowed to play, in seconds.
 *
 * Two megabytes of a low bit rate is several minutes, and a warning arriving
 * at four in the morning must not start something nobody can stop. The file
 * is cut off rather than refused, because the reader chose it and the first
 * few seconds of it are what they will recognise.
 */
export const MAX_SOUND_SECONDS = 6;

/** The kinds this will try to decode. Anything else is refused by name. */
export const SOUND_EXTENSIONS = ["wav", "mp3", "ogg", "oga", "flac", "m4a"];

/**
 * The reader's own sound, held by path rather than by its bytes.
 *
 * A workspace backup carries settings, so it carries this path and not two
 * megabytes of audio: a backup that swallowed the file would be a backup that
 * quietly became the only copy of it.
 */
let ownPath: string | null = null;
let own: AudioBuffer | null = null;
let ownFor: string | null = null;

export function setAlertSound(path: string | null): void {
  ownPath = path;
  if (path !== ownFor) {
    own = null;
    ownFor = null;
  }
}

/** Whether a name is one this will even try to open. */
export function soundNameAllowed(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return SOUND_EXTENSIONS.includes(extension);
}

/**
 * Reads and decodes the reader's own sound, or says why it will not.
 *
 * Refused rather than half-played: a file that is too big, that is not audio,
 * or that the browser cannot decode is reported now, in the settings panel
 * where the reader chose it, rather than making an unexplained silence during
 * a warning.
 */
export async function loadAlertSound(
  path: string,
): Promise<
  { ok: true } | { ok: false; reason: "name" | "size" | "decode" | "noAudio" }
> {
  if (!soundNameAllowed(path)) return { ok: false, reason: "name" };
  try {
    // A machine with no audio at all is not a bad file, and telling somebody
    // their sound could not be read when the sound is fine is worse than
    // saying nothing.
    if (typeof AudioContext === "undefined")
      return { ok: false, reason: "noAudio" };
    // Through the native side when there is one. A browser preview has none,
    // and the fetch below then simply fails, which is the same answer.
    let url = path;
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      url = convertFileSrc(path);
    } catch {
      url = path;
    }
    const response = await fetch(url);
    if (!response.ok) return { ok: false, reason: "decode" };
    // Asked before it is read. Reading four gigabytes into memory and then
    // deciding it was too big is the check happening after the damage.
    const said = Number(response.headers.get("content-length"));
    if (Number.isFinite(said) && said > MAX_SOUND_BYTES) {
      return { ok: false, reason: "size" };
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_SOUND_BYTES)
      return { ok: false, reason: "size" };
    context ??= new AudioContext();
    own = await context.decodeAudioData(bytes.slice(0));
    ownFor = path;
    ownPath = path;
    return { ok: true };
  } catch {
    own = null;
    ownFor = null;
    return { ok: false, reason: "decode" };
  }
}

/** Forgets the audio context, so a test does not carry one between cases. */
export function resetSound() {
  void context?.close();
  context = null;
  quietAgain = 0;
  volume = 0.18;
  own = null;
  ownFor = null;
  ownPath = null;
}
