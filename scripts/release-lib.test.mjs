import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cargoVersion,
  sha256File,
  sourceVersion,
  validateReleaseProof,
  verifyUpdaterSignature,
} from "./release-lib.mjs";

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "openradar-release-test-"),
);

afterEach(() => {
  for (const name of fs.readdirSync(scratch)) {
    fs.rmSync(path.join(scratch, name), { force: true, recursive: true });
  }
});

function signedFixture(fileName, bytes) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPublic = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const keyId = crypto.randomBytes(8);
  const publicPacket = Buffer.concat([Buffer.from("Ed"), keyId, rawPublic]);
  const publicText = `untrusted comment: test key\n${publicPacket.toString("base64")}\n`;
  const publicEnvelope = Buffer.from(publicText).toString("base64");

  const digest = crypto.createHash("blake2b512").update(bytes).digest();
  const signatureBytes = crypto.sign(null, digest, privateKey);
  const signaturePacket = Buffer.concat([
    Buffer.from("ED"),
    keyId,
    signatureBytes,
  ]);
  const trustedComment = `timestamp:1\tfile:${fileName}`;
  const global = crypto.sign(
    null,
    Buffer.concat([signatureBytes, Buffer.from(trustedComment)]),
    privateKey,
  );
  const signatureText = [
    "untrusted comment: test signature",
    signaturePacket.toString("base64"),
    `trusted comment: ${trustedComment}`,
    global.toString("base64"),
  ].join("\n");
  return {
    publicEnvelope,
    signatureEnvelope: Buffer.from(`${signatureText}\n`).toString("base64"),
  };
}

describe("release integrity", () => {
  it("verifies the installer, key, trusted filename, and global signature", () => {
    const fileName = "OpenRadar_0.3.1_x64-setup.exe";
    const installerPath = path.join(scratch, fileName);
    const signaturePath = `${installerPath}.sig`;
    const bytes = Buffer.from("installer bytes");
    const signed = signedFixture(fileName, bytes);
    fs.writeFileSync(installerPath, bytes);
    fs.writeFileSync(signaturePath, signed.signatureEnvelope);

    expect(() =>
      verifyUpdaterSignature({
        installerPath,
        signaturePath,
        publicKey: signed.publicEnvelope,
        expectedFileName: fileName,
      }),
    ).not.toThrow();

    fs.appendFileSync(installerPath, "tampered");
    expect(() =>
      verifyUpdaterSignature({
        installerPath,
        signaturePath,
        publicKey: signed.publicEnvelope,
        expectedFileName: fileName,
      }),
    ).toThrow(/does not match/);
  });

  it("refuses a trusted comment for a different artifact", () => {
    const installerPath = path.join(scratch, "right.exe");
    const signaturePath = `${installerPath}.sig`;
    const bytes = Buffer.from("installer bytes");
    const signed = signedFixture("wrong.exe", bytes);
    fs.writeFileSync(installerPath, bytes);
    fs.writeFileSync(signaturePath, signed.signatureEnvelope);
    expect(() =>
      verifyUpdaterSignature({
        installerPath,
        signaturePath,
        publicKey: signed.publicEnvelope,
        expectedFileName: "right.exe",
      }),
    ).toThrow(/not right\.exe/);
  });

  it("binds a skipped build to every expected field", () => {
    const expected = {
      version: "0.3.1",
      tag: "v0.3.1",
      commit: "abc123",
      installer: "OpenRadar_0.3.1_x64-setup.exe",
      installerSha256: "a".repeat(64),
      signatureSha256: "b".repeat(64),
    };
    expect(() => validateReleaseProof({ ...expected }, expected)).not.toThrow();
    expect(() =>
      validateReleaseProof({ ...expected, commit: "stale" }, expected),
    ).toThrow(/commit=stale/);
  });

  it("reads versions and hashes without accepting missing fields", () => {
    expect(cargoVersion('[package]\nversion = "0.3.1"')).toBe("0.3.1");
    expect(sourceVersion('export const APP_VERSION = "0.3.1";')).toBe("0.3.1");
    expect(() => cargoVersion("[package]")).toThrow();
    const file = path.join(scratch, "hash-me");
    fs.writeFileSync(file, "hello");
    expect(sha256File(file)).toBe(
      crypto.createHash("sha256").update("hello").digest("hex"),
    );
  });
});
