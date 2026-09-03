/**
 * Just enough ISO base media format to write one H.264 track into an MP4.
 *
 * The loop already had a container of its own: `webm.ts` writes the Matroska
 * that VP9 and VP8 go in. A WebM will not play in iMessage, in most email
 * clients or in a phone's gallery, which is where a shared loop actually
 * lands, so the same encoded-frames-into-a-file job is done a second time for
 * the format that will.
 *
 * It is deliberately the smallest MP4 that is still a valid file: a brand, one
 * media chunk holding every sample, and one movie box describing them. No
 * fragments, no edit lists, no audio, no composition offsets. Everything is
 * buffered, so every box's length is known before it is written and nothing
 * has to be patched back.
 *
 * The one thing that is not written here is the codec configuration. An avcC
 * record carries the sequence and picture parameter sets the decoder needs,
 * and only the encoder knows them; WebCodecs hands it over with the first
 * chunk as `decoderConfig.description`, and it is copied in whole.
 */

/** Ticks per second, for both the movie and the media. One tick is one ms. */
const TIMESCALE = 1000;

export interface Mp4Frame {
  timeMs: number;
  keyFrame: boolean;
  data: Uint8Array;
}

export interface Mp4Options {
  width: number;
  height: number;
  /** The avcC record the encoder handed back with its first chunk. */
  description: Uint8Array;
  /** How long the last frame is held, since nothing follows it to say. */
  lastFrameMs: number;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function fourcc(name: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let at = 0; at < 4; at += 1) out[at] = name.charCodeAt(at);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A box: its own length, its name, and whatever it holds. */
function box(name: string, ...parts: Uint8Array[]): Uint8Array {
  const body = join(parts);
  return join([u32(body.length + 8), fourcc(name), body]);
}

/** A box whose first four bytes are a version and three flag bytes. */
function fullBox(
  name: string,
  version: number,
  flags: number,
  ...parts: Uint8Array[]
): Uint8Array {
  return box(name, u32((version << 24) | flags), ...parts);
}

/** The identity transform, which is what every one of these tracks uses. */
const UNITY_MATRIX = join(
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32),
);

/** `und`, packed as three five-bit letters the way the format asks. */
const UNDETERMINED_LANGUAGE = 0x55c4;

/**
 * The durations of each sample, run-length encoded as the format wants them.
 *
 * A loop is one duration repeated, so this is almost always a single entry;
 * it is written generally because the last frame's duration is stated rather
 * than measured and need not match the rest.
 */
export function sampleDurations(
  frames: Mp4Frame[],
  lastFrameMs: number,
): number[] {
  return frames.map((frame, at) =>
    at + 1 < frames.length
      ? Math.max(0, frames[at + 1].timeMs - frame.timeMs)
      : Math.max(0, Math.round(lastFrameMs)),
  );
}

function timeToSample(durations: number[]): Uint8Array {
  const runs: Array<[count: number, delta: number]> = [];
  for (const duration of durations) {
    const last = runs[runs.length - 1];
    if (last && last[1] === duration) last[0] += 1;
    else runs.push([1, duration]);
  }
  return fullBox(
    "stts",
    0,
    0,
    u32(runs.length),
    ...runs.map(([count, delta]) => join([u32(count), u32(delta)])),
  );
}

/**
 * One video track's sample table.
 *
 * Every sample sits in one chunk, which is why the sample-to-chunk table is a
 * single entry and there is exactly one chunk offset to fill in.
 */
function sampleTable(
  frames: Mp4Frame[],
  options: Mp4Options,
  mediaStartsAt: number,
): Uint8Array {
  const name = "OpenRadar";
  const compressor = new Uint8Array(32);
  compressor[0] = name.length;
  for (let at = 0; at < name.length; at += 1) {
    compressor[at + 1] = name.charCodeAt(at);
  }

  const avc1 = box(
    "avc1",
    new Uint8Array(6), // reserved
    u16(1), // data reference index
    u16(0), // pre-defined
    u16(0), // reserved
    new Uint8Array(12), // pre-defined
    u16(options.width),
    u16(options.height),
    u32(0x00480000), // 72 dpi horizontally
    u32(0x00480000), // and vertically
    u32(0), // reserved
    u16(1), // one frame per sample
    compressor,
    u16(0x0018), // 24-bit colour
    u16(0xffff), // pre-defined
    box("avcC", options.description),
  );

  const keys = frames
    .map((frame, at) => (frame.keyFrame ? at + 1 : 0))
    .filter((at) => at > 0);

  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), avc1),
    timeToSample(sampleDurations(frames, options.lastFrameMs)),
    fullBox("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
    // First chunk 1, every sample in it, described by the first entry above.
    fullBox("stsc", 0, 0, u32(1), join([u32(1), u32(frames.length), u32(1)])),
    // A zero here means the sizes are listed one by one rather than shared.
    fullBox(
      "stsz",
      0,
      0,
      u32(0),
      u32(frames.length),
      ...frames.map((frame) => u32(frame.data.length)),
    ),
    fullBox("stco", 0, 0, u32(1), u32(mediaStartsAt)),
  );
}

function movie(
  frames: Mp4Frame[],
  options: Mp4Options,
  mediaStartsAt: number,
): Uint8Array {
  const durations = sampleDurations(frames, options.lastFrameMs);
  const total = durations.reduce((sum, each) => sum + each, 0);

  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    u32(0), // created: not stated, because it is not anybody's business
    u32(0), // modified
    u32(TIMESCALE),
    u32(total),
    u32(0x00010000), // played at its own speed
    u16(0x0100), // full volume, for a file with no sound in it
    u16(0), // reserved
    new Uint8Array(8), // reserved
    UNITY_MATRIX,
    new Uint8Array(24), // pre-defined
    u32(2), // the next track would be 2
  );

  const tkhd = fullBox(
    "tkhd",
    0,
    // Enabled, and part of the presentation.
    0x000003,
    u32(0),
    u32(0),
    u32(1), // track 1
    u32(0), // reserved
    u32(total),
    new Uint8Array(8), // reserved
    u16(0), // layer
    u16(0), // alternate group
    u16(0), // silent
    u16(0), // reserved
    UNITY_MATRIX,
    u32(options.width * 0x10000),
    u32(options.height * 0x10000),
  );

  const mdhd = fullBox(
    "mdhd",
    0,
    0,
    u32(0),
    u32(0),
    u32(TIMESCALE),
    u32(total),
    u16(UNDETERMINED_LANGUAGE),
    u16(0), // pre-defined
  );

  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    u32(0), // pre-defined
    fourcc("vide"),
    new Uint8Array(12), // reserved
    // The name is for a person reading the file, and is null-terminated.
    new Uint8Array([...new TextEncoder().encode("OpenRadar"), 0]),
  );

  const dinf = box(
    "dinf",
    // One entry, flagged as being in this same file, which is why there is
    // no address in it.
    fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)),
  );

  const minf = box(
    "minf",
    fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)),
    dinf,
    sampleTable(frames, options, mediaStartsAt),
  );

  return box("moov", mvhd, box("trak", tkhd, box("mdia", mdhd, hdlr, minf)));
}

/**
 * Whether the encoder handed its frames back in the order they are shown in.
 *
 * Nothing here writes composition offsets, so a stream whose frames are stored
 * out of presentation order cannot be described by it. Baseline H.264 has no
 * such frames, which is why it is the profile asked for first; a file written
 * anyway would play its loop backwards in places. Asked separately so the
 * caller can say something a reader can act on rather than passing this on.
 */
export function framesInOrder(frames: Mp4Frame[]): boolean {
  return frames.every(
    (frame, at) => at === 0 || frame.timeMs >= frames[at - 1].timeMs,
  );
}

/**
 * Encoded frames as an MP4 file.
 *
 * The layout is brand, media, movie: the movie box holds the position of the
 * first sample, so the media has to be laid out before it can be described.
 */
export function writeMp4(frames: Mp4Frame[], options: Mp4Options): Uint8Array {
  if (!frames.length) throw new Error("writeMp4 needs at least one frame.");
  if (!options.description.length) {
    throw new Error("writeMp4 needs the encoder's codec configuration.");
  }
  if (!framesInOrder(frames)) {
    throw new Error("writeMp4 cannot reorder frames.");
  }

  const ftyp = box(
    "ftyp",
    fourcc("isom"),
    u32(0x200),
    fourcc("isom"),
    fourcc("iso2"),
    fourcc("avc1"),
    fourcc("mp41"),
  );
  const media = join(frames.map((frame) => frame.data));
  const mdat = box("mdat", media);
  // Past the brand, past the media box's own header, is where sample one is.
  const mediaStartsAt = ftyp.length + 8;

  return join([ftyp, mdat, movie(frames, options, mediaStartsAt)]);
}
