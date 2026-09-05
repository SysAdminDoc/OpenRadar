import crypto from "node:crypto";
import fs from "node:fs";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeBase64(value, label) {
  const text = String(value).trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(text, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  if (canonical !== text.replace(/=+$/, "")) {
    throw new Error(`${label} is not canonical base64.`);
  }
  return decoded;
}

function publicPacket(encoded) {
  const text = decodeBase64(encoded, "the updater public key").toString("utf8");
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment: ")) {
    throw new Error("The updater public key has an invalid minisign envelope.");
  }
  const packet = decodeBase64(lines[1], "the updater public-key packet");
  if (
    packet.length !== 42 ||
    !["Ed", "ED"].includes(packet.subarray(0, 2).toString())
  ) {
    throw new Error("The updater public key has an unsupported packet.");
  }
  return packet;
}

function signaturePacket(encoded) {
  const text = decodeBase64(encoded, "the updater signature").toString("utf8");
  const lines = text.trim().split(/\r?\n/);
  if (
    lines.length !== 4 ||
    !lines[0].startsWith("untrusted comment: ") ||
    !lines[2].startsWith("trusted comment: ")
  ) {
    throw new Error("The updater signature has an invalid minisign envelope.");
  }
  const packet = decodeBase64(lines[1], "the updater signature packet");
  const global = decodeBase64(lines[3], "the updater global signature");
  if (packet.length !== 74 || packet.subarray(0, 2).toString() !== "ED") {
    throw new Error(
      "The updater signature is not a prehashed Ed25519 signature.",
    );
  }
  if (global.length !== 64) {
    throw new Error("The updater global signature has the wrong length.");
  }
  return {
    packet,
    global,
    trustedComment: lines[2].slice("trusted comment: ".length),
  };
}

export function sha256File(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/** Verifies both minisign signatures and binds the trusted filename. */
export function verifyUpdaterSignature({
  installerPath,
  signaturePath,
  publicKey,
  expectedFileName,
}) {
  const publicBytes = publicPacket(publicKey);
  const signature = signaturePacket(fs.readFileSync(signaturePath, "utf8"));
  if (!publicBytes.subarray(2, 10).equals(signature.packet.subarray(2, 10))) {
    throw new Error("The updater signature was made by a different key.");
  }
  const named = /(?:^|\t)file:([^\t]+)(?:\t|$)/.exec(
    signature.trustedComment,
  )?.[1];
  if (named !== expectedFileName) {
    throw new Error(
      `The updater signature names ${named ?? "no file"}, not ${expectedFileName}.`,
    );
  }

  const key = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicBytes.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const installer = fs.readFileSync(installerPath);
  const digest = crypto.createHash("blake2b512").update(installer).digest();
  if (!crypto.verify(null, digest, key, signature.packet.subarray(10))) {
    throw new Error("The updater signature does not match the installer.");
  }
  const globalMessage = Buffer.concat([
    signature.packet.subarray(10),
    Buffer.from(signature.trustedComment),
  ]);
  if (!crypto.verify(null, globalMessage, key, signature.global)) {
    throw new Error("The updater trusted comment has an invalid signature.");
  }
}

/**
 * What Windows Defender said about a file, read from what it printed.
 *
 * Two unsigned Rust weather apps have been flagged `Win32/Wacapew.A!ml` and
 * both publish a false-positive FAQ about it. An installer that trips the
 * machine-learning heuristic is not something to find out about from a
 * reader, so the release scans what it is about to publish.
 *
 * Three answers, and only one of them is a pass. A clean scan says so in
 * words as well as in its exit code, and a run that failed for any other
 * reason is reported as not having scanned rather than as having found
 * nothing: "Defender did not run" and "Defender found nothing" are the two
 * answers that must never be confused.
 */
export function defenderVerdict({ status, output }) {
  const said = String(output ?? "");
  if (/found no threats/i.test(said) && status === 0) {
    return { scanned: true, clean: true, detail: "found no threats" };
  }
  // The documented exit code for a detection is 2, and the line naming what
  // it found is the useful half: it is what a false-positive report to
  // Microsoft has to carry.
  const threat = /\bThreat(?:\s+Name)?\s*:\s*(\S+)/i.exec(said);
  if (status === 2 || threat || /found \d+ threats?/i.test(said)) {
    return {
      scanned: true,
      clean: false,
      detail: threat ? threat[1] : `exit ${status}`,
    };
  }
  return {
    scanned: false,
    clean: false,
    detail: `exit ${status}`,
  };
}

/**
 * What the release does about what Defender said.
 *
 * The half of the scan that matters, kept out of the script so it can be read
 * without a scanner on the machine: a detection stops the release, a scan that
 * did not happen does not, and only a clean scan is a pass. Separated because
 * the alternative was that "fails the release on a detection" was asserted by
 * nobody.
 */
export function defenderOutcome(verdict, { engine = null, file = "" } = {}) {
  const named = engine ? `Defender ${engine}` : "Defender";
  if (verdict.scanned && verdict.clean) {
    return { action: "pass", say: `${named}: ${verdict.detail}.` };
  }
  if (verdict.scanned) {
    return {
      action: "fail",
      say: `${named} flagged ${file}: ${verdict.detail}`,
    };
  }
  return { action: "skip", say: `${named} could not scan: ${verdict.detail}.` };
}

/**
 * The newest Defender platform's own scanner, or null where there is none.
 *
 * Defender keeps one directory per platform build and the newest is the one
 * in service. Sorted as text on purpose: the names are dotted version
 * numbers with a trailing revision, so a numeric sort would need a parser
 * for a string that is only ever compared with its own siblings.
 */
export function defenderScanner(platforms) {
  const newest = [...platforms].sort().pop();
  return newest ?? null;
}

export function validateReleaseProof(proof, expected) {
  if (!proof || typeof proof !== "object") {
    throw new Error("The release proof is missing or unreadable.");
  }
  for (const key of [
    "version",
    "tag",
    "commit",
    "installer",
    "installerSha256",
    "signatureSha256",
  ]) {
    if (proof[key] !== expected[key]) {
      throw new Error(
        `The release proof has ${key}=${String(proof[key])}; expected ${expected[key]}.`,
      );
    }
  }
}

export function cargoVersion(cargoText) {
  const found = /^version\s*=\s*"([^"]+)"/m.exec(cargoText)?.[1];
  if (!found) throw new Error("Cargo.toml has no package version.");
  return found;
}

/**
 * The release line SECURITY.md says gets fixes.
 *
 * Its own function so the release can hold it to the version being built.
 * The table said 0.6.x through the whole of 0.7.0, which read as the shipped
 * release being unsupported, and the same table had already been fixed once
 * for 0.6.0 and missed on the next bump. Nothing else in the parity check
 * looked at this file.
 */
export function supportedMinor(securityText) {
  const row = /^\|\s*(\d+)\.(\d+)\.x\s*\|\s*Yes\s*\|/m.exec(securityText);
  if (!row) {
    throw new Error("SECURITY.md names no supported release line.");
  }
  return `${row[1]}.${row[2]}`;
}

/**
 * How far behind the published updater manifest is.
 *
 * The updater is the only channel an installed copy has, and it reads one
 * file: `releases/latest/download/latest.json`. On 2026-09-02 that file said
 * 0.4.0 while every manifest in the tree said 0.7.0, so every installed copy
 * had been told it was up to date through three releases, including the one
 * that fixed every external link being dead in the packaged build. Nothing
 * anywhere compared the two numbers.
 *
 * Counted in releases rather than in patches: a patch behind is a release
 * staged and not yet pushed, which is ordinary and passes. Two minors behind
 * is a channel that has stopped.
 */
export function publishedLag(published, repo) {
  const parts = (value) => {
    const found = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ""));
    if (!found) return null;
    return found.slice(1, 4).map(Number);
  };
  const here = parts(repo);
  if (!here) throw new Error(`The repository version reads as ${repo}.`);
  const there = parts(published);
  if (!there) {
    // Unreadable is not the same as behind. A first release has no manifest
    // at all, and a machine with no route to GitHub can still stage a build;
    // failing either would be a gate that fires on the wrong thing.
    return { published: null, repo, behind: null, stalled: false };
  }

  const [major, minor] = there;
  const [ourMajor, ourMinor] = here;

  // Within a major, the count is the minors between them. Across one there is
  // no honest count, because nothing here knows how many minors the older
  // major ended up with, so the only case that can be answered is the one
  // that matters: 0.9.0 published against 1.0.0 here is the first release
  // after a major bump, which is one release, not a thousand. The first
  // version of this said a thousand and refused the 1.0.0 release.
  // Ahead is asked first and asked properly. Reading it off a negative count
  // worked within a major and not across one, where the count is an
  // unsigned "too far to say": a tree at 0.9.0 against a published 1.0.0 was
  // called a major version BEHIND and the staging run refused.
  const ahead = major > ourMajor || (major === ourMajor && minor > ourMinor);
  const behind = ahead
    ? 0
    : major === ourMajor
      ? ourMinor - minor
      : ourMajor - major === 1 && ourMinor === 0
        ? 1
        : Number.POSITIVE_INFINITY;

  return {
    published,
    repo,
    behind,
    // A published version AHEAD of this tree is not a lag, and it is worth
    // saying rather than reading as zero: somebody published from elsewhere.
    ahead,
    stalled: behind > 1,
  };
}

/** The line a release prints about it. */
export function publishedLagLine(lag) {
  if (lag.published === null) {
    return `The published updater manifest could not be read. The repository is at ${lag.repo}.`;
  }
  if (lag.ahead) {
    return `Published ${lag.published}, which is AHEAD of this repository at ${lag.repo}. Somebody released from somewhere else.`;
  }
  if (lag.behind <= 0) {
    return `Published ${lag.published}, repository ${lag.repo}.`;
  }
  if (!Number.isFinite(lag.behind)) {
    return `Published ${lag.published}, repository ${lag.repo}: a major version behind.`;
  }
  return `Published ${lag.published}, repository ${lag.repo}: ${lag.behind} release${lag.behind === 1 ? "" : "s"} behind.`;
}

export function sourceVersion(settingsText) {
  const found = /APP_VERSION\s*=\s*"([^"]+)"/.exec(settingsText)?.[1];
  if (!found) throw new Error("settings.ts has no APP_VERSION.");
  return found;
}

/**
 * The five files a release publishes, in the shape outside packaging expects.
 *
 * A community Scoop manifest autoupdates by substituting the new version into
 * a name it was given once, so a renamed, added or dropped asset silently
 * breaks every one of them and nobody here finds out. The set is written down
 * so a release can be held to it rather than described after the fact.
 */
export function releaseAssetNames(version) {
  const installer = `OpenRadar_${version}_x64-setup.exe`;
  return [
    installer,
    `${installer}.sig`,
    "SHA256SUMS",
    "latest.json",
    "release-metadata.json",
  ];
}

/** Throws unless the staged files are exactly those names. */
export function assertReleaseAssetNames(staged, version) {
  const expected = releaseAssetNames(version);
  const found = [...staged];
  const missing = expected.filter((name) => !found.includes(name));
  const extra = found.filter((name) => !expected.includes(name));
  if (!missing.length && !extra.length) return;
  const parts = [];
  if (missing.length) parts.push(`missing ${missing.join(", ")}`);
  if (extra.length) parts.push(`unexpected ${extra.join(", ")}`);
  throw new Error(
    `The staged release does not match the published asset names: ${parts.join("; ")}. ` +
      "The names are a promise to whoever packages this outside the repository; " +
      "changing one means changing README.md and releaseAssetNames together.",
  );
}
