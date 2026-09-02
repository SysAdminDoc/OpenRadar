// Builds, verifies, stages, and optionally publishes a Windows release.
//
//   node scripts/release.mjs            build and stage the artifacts
//   node scripts/release.mjs --publish  tag, push, and create the release
//   node scripts/release.mjs --skip-build --publish
//                                      publish a proved build from this commit
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertReleaseAssetNames,
  cargoVersion,
  releaseAssetNames,
  sha256File,
  sourceVersion,
  supportedMinor,
  validateReleaseProof,
  verifyUpdaterSignature,
} from "./release-lib.mjs";

const root = process.cwd();
const tauriDir = path.join(root, "src-tauri");
const bundleDir = path.join(tauriDir, "target", "release", "bundle", "nsis");
const stageDir = path.join(root, "artifacts");
const keyPath = path.join(os.homedir(), ".tauri", "openradar_updater.key");
const proofPath = path.join(bundleDir, "openradar-release-proof.json");
const publish = process.argv.includes("--publish");
const skipBuild = process.argv.includes("--skip-build");

function executable(command) {
  return process.platform === "win32" && /^(npm|npx|gh)$/.test(command)
    ? { file: "cmd", prefix: ["/d", "/s", "/c", command] }
    : { file: command, prefix: [] };
}

function run(command, args, options = {}) {
  const target = executable(command);
  return execFileSync(target.file, [...target.prefix, ...args], {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function output(command, args) {
  const target = executable(command);
  return execFileSync(target.file, [...target.prefix, ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function succeeds(command, args) {
  const target = executable(command);
  return (
    spawnSync(target.file, [...target.prefix, ...args], {
      cwd: root,
      stdio: "ignore",
    }).status === 0
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertClean() {
  const changed = output("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (changed) fail(`Release worktree is not clean:\n${changed}`);
}

function assertVersions(version, conf) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  const cargoText = fs.readFileSync(path.join(tauriDir, "Cargo.toml"), "utf8");
  const settingsText = fs.readFileSync(
    path.join(root, "src", "lib", "settings.ts"),
    "utf8",
  );
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const security = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
  const found = {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock root": packageLock.packages?.[""]?.version,
    "Cargo.toml": cargoVersion(cargoText),
    "settings.ts": sourceVersion(settingsText),
  };
  for (const [file, value] of Object.entries(found)) {
    if (value !== version) {
      fail(`${file} says ${value}; tauri.conf.json says ${version}.`);
    }
  }
  if (!cargoText.includes(`OpenRadar v${version} desktop weather radar`)) {
    fail(
      "Cargo.toml's package description does not match the release version.",
    );
  }
  if (!readme.includes(`version-${version}-`)) {
    fail("The README version badge does not match the release version.");
  }
  if (!readme.includes(`OpenRadar_${version}_x64-setup.exe`)) {
    fail("The README checksum example does not match the release version.");
  }
  if (!new RegExp(`^## OpenRadar v${version}\\s*$`, "m").test(changelog)) {
    fail(`CHANGELOG.md has no OpenRadar v${version} section.`);
  }
  const supported = supportedMinor(security);
  const line = version.split(".").slice(0, 2).join(".");
  if (supported !== line) {
    fail(
      `SECURITY.md says ${supported}.x gets fixes; this release is ${version}.`,
    );
  }
  if (conf.bundle?.createUpdaterArtifacts !== true) {
    fail("tauri.conf.json is not configured to create updater artifacts.");
  }
}

function installerPaths(version) {
  // The one place the name is written is `releaseAssetNames`, so the check on
  // what the bundler actually built and the check on what is published cannot
  // drift into agreeing with each other while both being wrong.
  const [installerName] = releaseAssetNames(version);
  const installer = path.join(bundleDir, installerName);
  const signaturePath = `${installer}.sig`;
  if (!fs.existsSync(installer))
    fail(`Expected ${installerName} in ${bundleDir}.`);
  if (!fs.existsSync(signaturePath)) {
    fail(`No updater signature beside ${installerName}.`);
  }
  const extras = fs
    .readdirSync(bundleDir)
    .filter((name) => name.endsWith("-setup.exe") && name !== installerName);
  if (extras.length) {
    fail(`Stale installers remain in ${bundleDir}: ${extras.join(", ")}`);
  }
  return { installerName, installer, signaturePath };
}

const conf = JSON.parse(
  fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const tag = `v${version}`;
assertVersions(version, conf);
assertClean();

if (!fs.existsSync(keyPath)) {
  fail(
    `No updater signing key at ${keyPath}.\n` +
      'Generate one with: npx tauri signer generate --ci --password "" --write-keys ' +
      keyPath,
  );
}

run("git", ["fetch", "origin", "main", "--tags"]);
const branch = output("git", ["branch", "--show-current"]);
const commit = output("git", ["rev-parse", "HEAD"]);
const remoteMain = output("git", ["rev-parse", "origin/main"]);
if (branch !== "main") {
  fail(`Release must run from main, not ${branch || "detached HEAD"}.`);
}
if (commit !== remoteMain) fail("HEAD does not match origin/main after fetch.");

if (!skipBuild) {
  console.log(`Building OpenRadar ${tag} from ${commit.slice(0, 12)}`);
  fs.rmSync(bundleDir, { recursive: true, force: true });
  run("npm", ["run", "check"]);
  run("cargo", ["fmt", "--check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("cargo", [
    "clippy",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--all-targets",
    "--",
    "-D",
    "warnings",
  ]);
  run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"]);
  run("npm", ["run", "test:e2e"]);
  run("npm", ["run", "tauri", "--", "build", "--bundles", "nsis"], {
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyPath, "utf8").trim(),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    },
  });
}

const { installerName, installer, signaturePath } = installerPaths(version);
verifyUpdaterSignature({
  installerPath: installer,
  signaturePath,
  publicKey: conf.plugins?.updater?.pubkey,
  expectedFileName: installerName,
});
const proof = {
  schemaVersion: 1,
  version,
  tag,
  commit,
  installer: installerName,
  installerSha256: sha256File(installer),
  signatureSha256: sha256File(signaturePath),
};

if (skipBuild) {
  if (!fs.existsSync(proofPath)) {
    fail("--skip-build requires a release proof produced by this script.");
  }
  validateReleaseProof(JSON.parse(fs.readFileSync(proofPath, "utf8")), proof);
} else {
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
fs.copyFileSync(installer, path.join(stageDir, installerName));
fs.copyFileSync(signaturePath, path.join(stageDir, `${installerName}.sig`));
fs.writeFileSync(
  path.join(stageDir, "release-metadata.json"),
  `${JSON.stringify(proof, null, 2)}\n`,
);

const signature = fs.readFileSync(signaturePath, "utf8").trim();
const notes = releaseNotes(version);
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/SysAdminDoc/OpenRadar/releases/download/${tag}/${installerName}`,
    },
  },
};
fs.writeFileSync(
  path.join(stageDir, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const sums = fs
  .readdirSync(stageDir)
  .filter((name) => name !== "SHA256SUMS")
  .sort()
  .map((name) => `${sha256File(path.join(stageDir, name))}  ${name}`)
  .join("\n");
fs.writeFileSync(path.join(stageDir, "SHA256SUMS"), `${sums}\n`);

// These names are what anybody packaging OpenRadar outside this repository
// builds on, so a release that would publish a different set stops here
// rather than breaking them quietly.
function assertAssetNames(names) {
  try {
    assertReleaseAssetNames(names, version);
  } catch (error) {
    fail(error.message);
  }
}

assertAssetNames(fs.readdirSync(stageDir));

console.log(`\nVerified and staged in ${stageDir}:`);
for (const name of fs.readdirSync(stageDir)) {
  const bytes = fs.statSync(path.join(stageDir, name)).size;
  console.log(`  ${name}  ${(bytes / 1024).toFixed(1)} kB`);
}

if (!publish) {
  console.log(
    `\nNot published. Run with --publish to create ${tag} on GitHub.`,
  );
  process.exit(0);
}

assertClean();
if (output("git", ["rev-parse", "HEAD"]) !== commit) {
  fail("HEAD changed after the installer was built.");
}
if (succeeds("gh", ["release", "view", tag])) {
  fail(`GitHub release ${tag} already exists.`);
}
const tagRef = `refs/tags/${tag}`;
if (succeeds("git", ["show-ref", "--verify", "--quiet", tagRef])) {
  const tagged = output("git", ["rev-list", "-n", "1", tagRef]);
  if (tagged !== commit) fail(`${tag} points to ${tagged}, not ${commit}.`);
} else {
  run("git", ["tag", "-a", tag, "-m", `OpenRadar ${tag}`]);
}
run("git", ["push", "origin", tag]);

// Checked again on the way out rather than trusting the check above. The tag
// has been pushed and the notes file is about to be written into the same
// directory between the two, so what is uploaded is what is asserted.
const assetNames = fs.readdirSync(stageDir);
assertAssetNames(assetNames);
const assets = assetNames.map((name) => path.join(stageDir, name));
const notesPath = path.join(stageDir, "release-notes.md");
fs.writeFileSync(notesPath, `${notes}\n`);
run("gh", [
  "release",
  "create",
  tag,
  ...assets,
  "--verify-tag",
  "--title",
  `OpenRadar ${tag}`,
  "--notes-file",
  notesPath,
]);
run("gh", ["release", "view", tag, "--json", "url,assets"]);
console.log(`\nPublished ${tag} from ${commit}.`);

function releaseNotes(forVersion) {
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const heading = new RegExp(`^## OpenRadar v${forVersion}\\s*$`, "m");
  const match = heading.exec(changelog);
  if (!match) fail(`CHANGELOG.md has no notes for ${forVersion}.`);
  const rest = changelog
    .slice(match.index + match[0].length)
    .replace(/^\r?\n/, "");
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}
