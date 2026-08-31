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

export function sourceVersion(settingsText) {
  const found = /APP_VERSION\s*=\s*"([^"]+)"/.exec(settingsText)?.[1];
  if (!found) throw new Error("settings.ts has no APP_VERSION.");
  return found;
}
