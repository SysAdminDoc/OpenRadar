/**
 * Just enough Matroska to write one video track into a WebM file.
 *
 * The loop export used to be a screen recording: play the timeline at its real
 * speed with a MediaRecorder attached, which meant a twenty-second loop cost
 * twenty seconds and held the workspace for all of them. WebCodecs encodes a
 * frame the moment it is drawn, as fast as the map can draw one, but it hands
 * back naked compressed frames and nothing to put them in.
 *
 * So this puts them in a file. It is deliberately the smallest Matroska that
 * is still a valid WebM: an EBML header, one segment, one video track, frames
 * in clusters, and a cue index so the result can be scrubbed. No lacing, no
 * seek head, no tags, no audio. Everything is buffered, so every element's
 * length is known before it is written and nothing has to be patched back.
 */

/** Milliseconds per Matroska tick, as nanoseconds. One tick is one ms. */
const TIMECODE_SCALE_NS = 1_000_000;

/**
 * How far a frame may sit from the start of its cluster.
 *
 * A block's timecode is a signed 16-bit offset from its cluster, so a cluster
 * cannot span more than about 32 seconds. Half of that leaves room and keeps
 * clusters small enough to be a useful seek target.
 */
const MAX_CLUSTER_MS = 16_000;

type Bytes = Uint8Array;

function bytes(...values: number[]): Bytes {
  return new Uint8Array(values);
}

/**
 * An unsigned integer in the fewest bytes that hold it.
 *
 * Matroska integers carry their own length, so there is no padding to a fixed
 * width, and zero is one byte rather than none.
 */
function uint(value: number): Bytes {
  const out: number[] = [];
  let left = Math.max(0, Math.round(value));
  do {
    out.unshift(left % 256);
    left = Math.floor(left / 256);
  } while (left > 0);
  return new Uint8Array(out);
}

/**
 * A length, in the variable-width form Matroska writes lengths in.
 *
 * The width is announced by the position of the first set bit, and the value
 * fills the rest. A value of all ones at a given width means "unknown", so a
 * length that would land there takes the next width up instead.
 */
function vint(value: number): Bytes {
  for (let width = 1; width <= 8; width += 1) {
    const limit = 2 ** (7 * width) - 1;
    if (value >= limit) continue;
    const out = new Uint8Array(width);
    let left = value;
    for (let at = width - 1; at >= 0; at -= 1) {
      out[at] = left % 256;
      left = Math.floor(left / 256);
    }
    out[0] |= 1 << (8 - width);
    return out;
  }
  throw new Error("vint cannot encode a length this large.");
}

function join(parts: Bytes[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One element: its id, its length, and its content. */
function element(id: Bytes, content: Bytes): Bytes {
  return join([id, vint(content.length), content]);
}

/** An element holding a single unsigned integer. */
function uintElement(id: Bytes, value: number): Bytes {
  return element(id, uint(value));
}

function stringElement(id: Bytes, value: string): Bytes {
  return element(id, new TextEncoder().encode(value));
}

/** Duration is the one field Matroska keeps as a float. */
function floatElement(id: Bytes, value: number): Bytes {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return element(id, out);
}

const ID = {
  ebml: bytes(0x1a, 0x45, 0xdf, 0xa3),
  ebmlVersion: bytes(0x42, 0x86),
  ebmlReadVersion: bytes(0x42, 0xf7),
  ebmlMaxIdLength: bytes(0x42, 0xf2),
  ebmlMaxSizeLength: bytes(0x42, 0xf3),
  docType: bytes(0x42, 0x82),
  docTypeVersion: bytes(0x42, 0x87),
  docTypeReadVersion: bytes(0x42, 0x85),
  segment: bytes(0x18, 0x53, 0x80, 0x67),
  info: bytes(0x15, 0x49, 0xa9, 0x66),
  timecodeScale: bytes(0x2a, 0xd7, 0xb1),
  muxingApp: bytes(0x4d, 0x80),
  writingApp: bytes(0x57, 0x41),
  duration: bytes(0x44, 0x89),
  tracks: bytes(0x16, 0x54, 0xae, 0x6b),
  trackEntry: bytes(0xae),
  trackNumber: bytes(0xd7),
  trackUid: bytes(0x73, 0xc5),
  trackType: bytes(0x83),
  flagLacing: bytes(0x9c),
  codecId: bytes(0x86),
  video: bytes(0xe0),
  pixelWidth: bytes(0xb0),
  pixelHeight: bytes(0xba),
  cluster: bytes(0x1f, 0x43, 0xb6, 0x75),
  timecode: bytes(0xe7),
  simpleBlock: bytes(0xa3),
  cues: bytes(0x1c, 0x53, 0xbb, 0x6b),
  cuePoint: bytes(0xbb),
  cueTime: bytes(0xb3),
  cueTrackPositions: bytes(0xb7),
  cueTrack: bytes(0xf7),
  cueClusterPosition: bytes(0xf1),
} as const;

/** One compressed frame on its way into the file. */
export interface WebmFrame {
  /** When it is shown, in milliseconds from the start. */
  timeMs: number;
  /** Whether it stands on its own, which is what a seek can land on. */
  keyFrame: boolean;
  data: Bytes;
}

export interface WebmOptions {
  width: number;
  height: number;
  /** The Matroska name for the codec: `V_VP9` or `V_VP8`. */
  codecId: string;
  /** How long the last frame is held, so the file's duration is honest. */
  lastFrameMs: number;
}

/**
 * Every frame as a WebM file.
 *
 * The two refusals below are programmer errors rather than copy: nothing a
 * reader does reaches them, and the loop export catches everything this throws
 * and records the loop the slow way instead.
 *
 * Frames must arrive in the order they are shown, and the first must be a key
 * frame, because a file that opens on a difference from a picture nobody has
 * is not a file that opens.
 */
export function writeWebm(frames: WebmFrame[], options: WebmOptions): Bytes {
  if (!frames.length) throw new Error("writeWebm needs at least one frame.");
  if (!frames[0].keyFrame) {
    throw new Error("writeWebm needs a key frame first.");
  }

  const header = element(
    ID.ebml,
    join([
      uintElement(ID.ebmlVersion, 1),
      uintElement(ID.ebmlReadVersion, 1),
      uintElement(ID.ebmlMaxIdLength, 4),
      uintElement(ID.ebmlMaxSizeLength, 8),
      stringElement(ID.docType, "webm"),
      uintElement(ID.docTypeVersion, 2),
      uintElement(ID.docTypeReadVersion, 2),
    ]),
  );

  const last = frames[frames.length - 1];
  const info = element(
    ID.info,
    join([
      uintElement(ID.timecodeScale, TIMECODE_SCALE_NS),
      stringElement(ID.muxingApp, "OpenRadar"),
      stringElement(ID.writingApp, "OpenRadar"),
      floatElement(ID.duration, last.timeMs + options.lastFrameMs),
    ]),
  );

  const tracks = element(
    ID.tracks,
    element(
      ID.trackEntry,
      join([
        uintElement(ID.trackNumber, 1),
        uintElement(ID.trackUid, 1),
        uintElement(ID.trackType, 1),
        uintElement(ID.flagLacing, 0),
        stringElement(ID.codecId, options.codecId),
        element(
          ID.video,
          join([
            uintElement(ID.pixelWidth, options.width),
            uintElement(ID.pixelHeight, options.height),
          ]),
        ),
      ]),
    ),
  );

  // A cluster closes when the next frame would sit too far from its start for
  // a signed 16-bit offset to reach. Preferably on a key frame, since that is
  // what a seek can land on, but the split is not optional: an encoder is
  // under no obligation to produce a second key frame, and a long loop that
  // stayed in one cluster would wrap its offsets negative and play backwards.
  const clusters: Bytes[] = [];
  const cuePoints: Array<{ timeMs: number; cluster: number }> = [];
  let open: { timeMs: number; blocks: Bytes[] } | null = null;

  const close = () => {
    if (!open) return;
    clusters.push(
      element(
        ID.cluster,
        join([uintElement(ID.timecode, open.timeMs), ...open.blocks]),
      ),
    );
    open = null;
  };

  for (const frame of frames) {
    const since = open ? frame.timeMs - open.timeMs : 0;
    const wanted = open !== null && since > MAX_CLUSTER_MS && frame.keyFrame;
    const forced = open !== null && since >= 32_767;
    if (!open || wanted || forced) {
      close();
      open = { timeMs: frame.timeMs, blocks: [] };
      // Only a cluster that opens on a key frame is somewhere to seek to.
      if (frame.keyFrame) {
        cuePoints.push({ timeMs: frame.timeMs, cluster: clusters.length });
      }
    }
    const relative = frame.timeMs - open.timeMs;
    const head = new Uint8Array(3);
    new DataView(head.buffer).setInt16(0, relative, false);
    head[2] = frame.keyFrame ? 0x80 : 0x00;
    open.blocks.push(
      element(ID.simpleBlock, join([vint(1), head, frame.data])),
    );
  }
  close();

  // Where each cluster starts, counted from the first byte inside the segment,
  // which is what a cue position means.
  const before = info.length + tracks.length;
  const starts: number[] = [];
  let at = before;
  for (const cluster of clusters) {
    starts.push(at);
    at += cluster.length;
  }

  const cues = element(
    ID.cues,
    join(
      cuePoints.map((point) =>
        element(
          ID.cuePoint,
          join([
            uintElement(ID.cueTime, point.timeMs),
            element(
              ID.cueTrackPositions,
              join([
                uintElement(ID.cueTrack, 1),
                uintElement(ID.cueClusterPosition, starts[point.cluster]),
              ]),
            ),
          ]),
        ),
      ),
    ),
  );

  return join([
    header,
    element(ID.segment, join([info, tracks, ...clusters, cues])),
  ]);
}
