// Builds a release locally and lays out everything a GitHub release needs.
//
//   node scripts/release.mjs            build and stage the artifacts
//   node scripts/release.mjs --publish  and create the release with gh
//
// Builds happen on this machine, never on a runner. The updater manifest is a
// static file published beside the installer, so nothing has to stay running
// for an update check to work.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const bundleDir = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const stageDir = path.join(root, "artifacts");
const keyPath = path.join(os.homedir(), ".tauri", "openradar_updater.key");
const publish = process.argv.includes("--publish");
const skipBuild = process.argv.includes("--skip-build");

function run(command, args, options = {}) {
  // npm and gh are batch files on Windows, which execFile cannot start.
  const viaShell = /^(npm|npx|gh)$/.test(command);
  return execFileSync(
    viaShell ? "cmd" : command,
    viaShell ? ["/c", command, ...args] : args,
    {
      cwd: root,
      stdio: "inherit",
      ...options,
    },
  );
}

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const tag = `v${version}`;

if (!fs.existsSync(keyPath)) {
  console.error(
    `No updater signing key at ${keyPath}.\n` +
      'Generate one with: npx tauri signer generate --ci --password "" --write-keys ' +
      keyPath,
  );
  process.exit(1);
}

if (!skipBuild) {
  console.log(`Building OpenRadar ${tag}`);
  // Yesterday's installer is still in the bundle directory, and the check
  // below wants exactly one. Clearing it beats stopping after a build that
  // already succeeded.
  if (fs.existsSync(bundleDir)) {
    for (const name of fs.readdirSync(bundleDir)) {
      if (name.endsWith("-setup.exe") || name.endsWith("-setup.exe.sig")) {
        fs.rmSync(path.join(bundleDir, name));
      }
    }
  }
  run("npm", ["run", "check"]);
  run("npm", ["run", "tauri", "--", "build", "--bundles", "nsis"], {
    env: {
      ...process.env,
      // The CLI wants the key itself, not a path to it.
      TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyPath, "utf8").trim(),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    },
  });
}

const installers = fs
  .readdirSync(bundleDir)
  .filter((name) => name.endsWith("-setup.exe"))
  .map((name) => path.join(bundleDir, name));
if (installers.length !== 1) {
  console.error(
    `Expected exactly one installer in ${bundleDir}, found ${installers.length}.`,
  );
  process.exit(1);
}
const installer = installers[0];
const signaturePath = `${installer}.sig`;
if (!fs.existsSync(signaturePath)) {
  console.error(
    `No updater signature beside ${path.basename(installer)}.\n` +
      "The build did not sign it, so an update would be refused by every client.",
  );
  process.exit(1);
}

// A clean stage, so nothing from a previous version is published by accident.
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

const installerName = path.basename(installer);
fs.copyFileSync(installer, path.join(stageDir, installerName));
fs.copyFileSync(signaturePath, path.join(stageDir, `${installerName}.sig`));

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
  .map((name) => {
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(stageDir, name)))
      .digest("hex");
    return `${digest}  ${name}`;
  })
  .join("\n");
fs.writeFileSync(path.join(stageDir, "SHA256SUMS"), `${sums}\n`);

console.log(`\nStaged in ${stageDir}:`);
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

const assets = fs
  .readdirSync(stageDir)
  .map((name) => path.join(stageDir, name));
// cmd.exe reads only the first line of a command, and gh is a batch file on
// Windows, so multi-line notes passed as an argument are silently cut after
// the first bullet. A file has no such problem.
const notesPath = path.join(stageDir, "release-notes.md");
fs.writeFileSync(notesPath, `${notes}\n`);
run("gh", [
  "release",
  "create",
  tag,
  ...assets.filter((asset) => asset !== notesPath),
  "--title",
  `OpenRadar ${tag}`,
  "--notes-file",
  notesPath,
]);
console.log(`\nPublished ${tag}.`);

/** The changelog section for this version, which is what the notes should be. */
function releaseNotes(forVersion) {
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const heading = new RegExp(`^## OpenRadar v${forVersion}\\b.*$`, "m");
  const start = changelog.search(heading);
  if (start < 0) return `OpenRadar v${forVersion}`;
  const rest = changelog.slice(start);
  const end = rest.indexOf("\n## ", 1);
  const section = end < 0 ? rest : rest.slice(0, end);
  return section.split("\n").slice(1).join("\n").trim();
}
