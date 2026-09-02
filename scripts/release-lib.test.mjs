import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReleaseAssetNames,
  cargoVersion,
  publishedLag,
  publishedLagLine,
  supportedMinor,
  releaseAssetNames,
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

  it("holds a release to the asset names outside packaging depends on", () => {
    const staged = releaseAssetNames("0.6.0");
    expect(staged).toContain("OpenRadar_0.6.0_x64-setup.exe");
    // Order is not part of the promise; the set is.
    expect(() =>
      assertReleaseAssetNames([...staged].reverse(), "0.6.0"),
    ).not.toThrow();

    // The three ways a release can break a Scoop manifest that autoupdates
    // from it: a renamed asset, a dropped one, and a stray one.
    expect(() =>
      assertReleaseAssetNames(
        staged.map((name) => (name === "SHA256SUMS" ? "checksums.txt" : name)),
        "0.6.0",
      ),
    ).toThrow(/missing SHA256SUMS.*unexpected checksums\.txt/s);
    expect(() =>
      assertReleaseAssetNames(
        staged.filter((name) => name !== "latest.json"),
        "0.6.0",
      ),
    ).toThrow(/missing latest\.json/);
    expect(() =>
      assertReleaseAssetNames([...staged, "notes.txt"], "0.6.0"),
    ).toThrow(/unexpected notes\.txt/);

    // And the version really does travel through the name, or the pattern
    // would be pinned to whatever shipped first.
    expect(() => assertReleaseAssetNames(staged, "0.7.0")).toThrow(
      /OpenRadar_0\.7\.0_x64-setup\.exe/,
    );
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

describe("the release line the security policy names", () => {
  const root = path.join(import.meta.dirname, "..");

  it("reads the line marked as getting fixes", () => {
    const table = [
      "| Version | Fixes |",
      "| ------- | ----- |",
      "| 0.7.x   | Yes   |",
      "| 0.6.x and earlier | No |",
    ].join("\n");
    expect(supportedMinor(table)).toBe("0.7");
  });

  it("matches the version this repository actually ships", () => {
    // The table said 0.6.x for the whole of 0.7.0, which read as the shipped
    // release being unsupported. It had been fixed once already and missed on
    // the next bump, because nothing checked it.
    const security = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
    const conf = JSON.parse(
      fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    expect(supportedMinor(security)).toBe(
      conf.version.split(".").slice(0, 2).join("."),
    );
  });

  it("refuses a table that names nothing", () => {
    expect(() => supportedMinor("# Security\n\nNo table here.\n")).toThrow();
  });
});

describe("how far behind the published updater manifest is", () => {
  it("counts releases, not patches", () => {
    // A patch behind is a build staged and not pushed yet, which is ordinary.
    // Two releases behind is a channel that has stopped.
    expect(publishedLag("0.7.0", "0.7.1").stalled).toBe(false);
    expect(publishedLag("0.7.0", "0.8.0").behind).toBe(1);
    expect(publishedLag("0.7.0", "0.8.0").stalled).toBe(false);
    expect(publishedLag("0.6.0", "0.8.0").stalled).toBe(true);
  });

  it("calls the state it was actually found in stalled", () => {
    // Live on 2026-09-02: the manifest an installed copy reads said 0.4.0
    // while every manifest in the tree said 0.7.0, so three releases of fixes
    // had been staged and never offered to anybody.
    const lag = publishedLag("0.4.0", "0.7.0");
    expect(lag.behind).toBe(3);
    expect(lag.stalled).toBe(true);
    expect(publishedLagLine(lag)).toContain("3 releases behind");
  });

  it("counts the first release after a major bump as one", () => {
    // 0.9.0 published against 1.0.0 here is one release, and the first
    // version of this said a thousand and refused the 1.0.0 release outright.
    expect(publishedLag("0.9.0", "1.0.0").behind).toBe(1);
    expect(publishedLag("0.9.0", "1.0.0").stalled).toBe(false);
    // Further across a major there is no honest count, and every answer over
    // one is the same answer.
    expect(publishedLag("1.9.0", "2.1.0").stalled).toBe(true);
    expect(publishedLag("0.9.0", "2.0.0").stalled).toBe(true);
  });

  it("says so when the published version is ahead of the tree", () => {
    // Somebody released from another machine. Reading that as zero behind
    // and saying nothing is how two people publish over each other.
    const ahead = publishedLag("0.8.0", "0.7.0");
    expect(ahead.ahead).toBe(true);
    expect(ahead.stalled).toBe(false);
    expect(publishedLagLine(ahead)).toContain("AHEAD");
  });

  it("does not call an unreadable manifest a lag", () => {
    // A first release has no manifest at all, and a machine with no route to
    // GitHub can still stage a build. Neither is a channel that has stopped.
    const lag = publishedLag(null, "0.8.0");
    expect(lag.stalled).toBe(false);
    expect(lag.published).toBe(null);
    expect(publishedLagLine(lag)).toContain("could not be read");
  });

  it("refuses a repository version it cannot read", () => {
    expect(() => publishedLag("0.7.0", "not a version")).toThrow();
  });
});
