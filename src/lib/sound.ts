/**
 * One short tone, for an alert reaching the place somebody is watching.
 *
 * Deliberately small: a synthesised note rather than a sound file, so nothing
 * has to be shipped, fetched or decoded, and there is no way for it to fail
 * silently because an asset went missing. It is off until somebody asks for it,
 * because a weather app that makes a noise on its own is a weather app people
 * close.
 */

let context: AudioContext | null = null;

/** The tone, in hertz, and how long it lasts. */
const PITCH_HZ = 660;
const SECONDS = 0.35;

/**
 * Plays the tone, and answers whether it actually did.
 *
 * A browser refuses to make a sound before the reader has interacted with the
 * page, and a machine can have no audio at all. Neither is a failure worth
 * reporting: the notification still arrives, and this was only ever the
 * quicker half of it.
 */
export async function playAlertTone(): Promise<boolean> {
  try {
    if (typeof AudioContext === "undefined") return false;
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(PITCH_HZ, now);
    // Faded in and out rather than switched, because a square edge on a sine
    // is a click, and a click is what a broken speaker sounds like.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + SECONDS);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + SECONDS);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the audio context, so a test does not carry one between cases. */
export function resetSound() {
  void context?.close();
  context = null;
}
