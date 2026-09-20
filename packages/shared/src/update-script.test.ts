import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_LISTEN_PORT } from "./app.js";
import { HEALTH_STATUS_OK } from "./health.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const UPDATE_SH = path.join(repoRoot, "scripts/update.sh");
const ROLLBACK_SH = path.join(repoRoot, "scripts/rollback.sh");
const INSTALL_SH = path.join(repoRoot, "scripts/install.sh");
const BACKUP_SH = path.join(repoRoot, "scripts/backup.sh");
const COMPOSE_YML = path.join(repoRoot, "docker-compose.yml");
const README = path.join(repoRoot, "README.md");
const IMAGE_WORKFLOW = path.join(repoRoot, ".github/workflows/publish-image.yml");
const HEALTH_PROBE_LIB = path.join(repoRoot, "scripts/lib/health-probe.sh");
const RELEASE_IMAGE_LIB = path.join(repoRoot, "scripts/lib/release-image.sh");

const TUNNEL_PRODUCT = /cloudflared|CLOUDFLARE_TUNNEL|TUNNEL_TOKEN|TUNNEL_HOSTNAME/i;
const DATA_WIPE =
  /rm\s+(-[a-zA-Z]*\s+)*(\.\/)?data\b|rm\s+[^\n]*data\/(keypage\.db|setup-token)|compose\s+down\s+[^\n]*-v/;
const TEST_TEMP_DIRS = new Set<string>();

afterEach(() => {
  for (const dir of TEST_TEMP_DIRS) fs.rmSync(dir, { recursive: true, force: true });
  TEST_TEMP_DIRS.clear();
});

function makeTrackedTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEST_TEMP_DIRS.add(dir);
  return dir;
}

function readUpdateScript(): string {
  return fs.readFileSync(UPDATE_SH, "utf8");
}

function readInstallScript(): string {
  return fs.readFileSync(INSTALL_SH, "utf8");
}

function readmeUpdatesSection(): string {
  const readme = fs.readFileSync(README, "utf8");
  const match = readme.match(/### Updates\n([\s\S]*?)(?=\n### |\n## )/);
  assert.ok(match, "README must have an ### Updates section");
  return match[1];
}

function writeExecutable(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

// update.sh and install.sh source their shared libraries from the install
// tree, because a real install is a clone of this repo. An install fixture
// without scripts/ is not a shape that can exist, so every fixture here
// carries both libraries.
function copySharedLibs(destRoot: string): void {
  for (const lib of [HEALTH_PROBE_LIB, RELEASE_IMAGE_LIB]) {
    const dest = path.join(destRoot, "scripts/lib", path.basename(lib));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(lib, dest);
  }
}

function makeInstallTree(): { root: string; dataDir: string; envPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "keypage.db"), "vault-bytes");
  fs.writeFileSync(path.join(dataDir, "setup-token"), "setup-secret", { mode: 0o600 });
  const envPath = path.join(root, ".env");
  fs.writeFileSync(envPath, `PORT=${DEFAULT_LISTEN_PORT}\nKEYPAGE_WEB_DIR=/app/apps/web/dist\n`);
  fs.copyFileSync(COMPOSE_YML, path.join(root, "docker-compose.yml"));
  copySharedLibs(root);
  return { root, dataDir, envPath };
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "user.email=test@keypage.local", "-c", "user.name=KeyPage Test", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function makeStubBin(
  binDir: string,
  opts: {
    healthOk: boolean;
    publishedPort?: number | null;
    stubGit?: boolean;
    pullOk?: boolean;
    existingContainer?: boolean;
    healthFailuresBeforeSuccess?: number;
    candidateIsRunning?: boolean;
    stopFails?: boolean;
    versionLabel?: string;
  },
): void {
  if (opts.stubGit !== false) {
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
if printf '%s' "$*" | grep -q 'rev-parse HEAD'; then
  printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fi
exit 0
`,
    );
  }
  const portLine =
    opts.publishedPort === null
      ? `if [ "$1" = "compose" ] && [ "$2" = "port" ]; then
  exit 1
fi`
      : `if [ "$1" = "compose" ] && [ "$2" = "port" ]; then
  printf '%s\\n' "0.0.0.0:${opts.publishedPort ?? DEFAULT_LISTEN_PORT}"
  exit 0
fi`;
  writeExecutable(
    path.join(binDir, "docker"),
    `#!/bin/sh
echo "docker $*" >> "${binDir}/calls.log"
${portLine}
last=""
for arg in "$@"; do last="$arg"; done
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  if printf '%s' "$*" | grep -q 'RepoDigests'; then
    repo=$(printf '%s' "$last" | sed 's/:[^:]*$//')
    printf '%s\n' "$repo@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  elif printf '%s' "$*" | grep -q 'org.opencontainers.image.revision'; then
    # A bare-SHA image tag carries its own commit as the revision label; a
    # release-tagged image was built from the commit the updater selected
    # (the fixed aaaa… answer, which is what the git stub's rev-parse says).
    ref=$(printf '%s\\n' "$last" | sed 's/^.*://')
    case "$ref" in
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) printf '%s\\n' "$ref";;
      *) printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';;
    esac
  elif printf '%s' "$*" | grep -q 'org.opencontainers.image.version'; then
    ${opts.versionLabel === undefined
      ? `case "$last" in
    *:v[0-9]*) printf '%s\\n' "$last" | sed 's/^.*://';;
    *) ref=$(printf '%s\\n' "$last" | sed 's/^.*://'); printf '%s\\n' "main-$ref";;
  esac`
      : `printf '%s\\n' '${opts.versionLabel}'`}
  elif printf '%s' "$*" | grep -q '{{.Id}}'; then
    printf '%s\n' 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  fi
  exit 0
fi
if [ "$1" = "pull" ] && [ "${opts.pullOk === false ? "0" : "1"}" = "0" ]; then
  exit 1
fi
if [ "$1" = "inspect" ] && printf '%s' "$*" | grep -q '{{.Image}}'; then
  printf '%s\n' '${opts.candidateIsRunning ? "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" : "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}'
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "ps" ] && [ "$3" = "-q" ]; then
  ${opts.existingContainer ? "printf '%s\\n' 'container-old'" : ":"}
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "stop" ] && [ "${opts.stopFails ? "1" : "0"}" = "1" ]; then
  exit 1
fi
if [ "$1" = "info" ] || [ "$1" = "compose" ]; then
  exit 0
fi
exit 0
`,
  );
  writeExecutable(
    path.join(binDir, "curl"),
    `#!/bin/sh
echo "curl $*" >> "${binDir}/calls.log"
if printf '%s' "$*" | grep -q '/api/health'; then
  count_file="${binDir}/health-count"
  count=0
  [ ! -f "$count_file" ] || count=$(cat "$count_file")
  count=$((count + 1))
  printf '%s\n' "$count" > "$count_file"
  if [ "$count" -le "${opts.healthFailuresBeforeSuccess ?? 0}" ]; then
    exit 22
  fi
  if [ "${opts.healthOk ? "1" : "0"}" = "1" ]; then
    printf '%s\\n' '{"status":"${HEALTH_STATUS_OK}","app":"KeyPage"}'
    exit 0
  fi
  exit 22
fi
exit 0
`,
  );
}

function runUpdate(opts: {
  keypageDir?: string;
  binDir: string;
  extraEnv?: NodeJS.ProcessEnv;
  viaStdin?: boolean;
  cwd?: string;
}): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${opts.binDir}:${process.env.PATH ?? "/usr/bin"}`,
    KEYPAGE_SKIP_GIT: "1",
    TERM: "dumb",
    ...opts.extraEnv,
  };
  if (opts.keypageDir !== undefined) {
    env.KEYPAGE_DIR = opts.keypageDir;
  } else if (!opts.extraEnv || !("KEYPAGE_DIR" in opts.extraEnv)) {
    delete env.KEYPAGE_DIR;
  }
  const result = opts.viaStdin
    ? spawnSync("bash", [], {
        encoding: "utf8",
        input: fs.readFileSync(UPDATE_SH),
        cwd: opts.cwd,
        env,
      })
    : spawnSync("bash", [UPDATE_SH], {
        encoding: "utf8",
        cwd: opts.cwd,
        env,
      });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function seedRemoteAndShallowClone(opts?: { trackData?: boolean }): {
  remoteWork: string;
  bare: string;
  install: string;
} {
  const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-remote-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bare-"));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-clone-"));
  git(remoteWork, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(remoteWork, "docker-compose.yml"), fs.readFileSync(COMPOSE_YML, "utf8"));
  fs.writeFileSync(path.join(remoteWork, ".env"), `PORT=${DEFAULT_LISTEN_PORT}\n`);
  fs.mkdirSync(path.join(remoteWork, "data"));
  fs.writeFileSync(path.join(remoteWork, "data/keypage.db"), "vault-bytes");
  copySharedLibs(remoteWork);
  if (opts?.trackData) {
    git(remoteWork, ["add", "docker-compose.yml", ".env", "data/keypage.db", "scripts"]);
  } else {
    fs.writeFileSync(path.join(remoteWork, ".gitignore"), "data/\n.env\n");
    git(remoteWork, ["add", "docker-compose.yml", ".gitignore", "scripts"]);
  }
  git(remoteWork, ["commit", "-m", "initial"]);
  git(remoteWork, ["clone", "--bare", remoteWork, bare]);
  git(remoteWork, ["clone", "--depth", "1", bare, install]);
  fs.mkdirSync(path.join(install, "data"), { recursive: true });
  fs.writeFileSync(path.join(install, "data/keypage.db"), "vault-bytes");
  return { remoteWork, bare, install };
}

// install.sh reaches git itself (origin verification plus a best-effort
// refresh) before it hands off to update.sh, so its git stub must answer
// `remote get-url` and must be able to fail the fetch. Everything else reuses
// the update.sh stubs.
function makeInstallStubBin(
  binDir: string,
  opts: { healthOk: boolean; publishedPort?: number | null; gitFetchOk?: boolean },
): void {
  makeStubBin(binDir, {
    healthOk: opts.healthOk,
    publishedPort: opts.publishedPort === undefined ? DEFAULT_LISTEN_PORT : opts.publishedPort,
    stubGit: false,
  });
  writeExecutable(
    path.join(binDir, "git"),
    `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
if printf '%s' "$*" | grep -q 'remote get-url'; then
  printf '%s\\n' 'https://github.com/saadiqhorton/KeyPage.git'
  exit 0
fi
if printf '%s' "$*" | grep -q 'fetch'; then
  exit ${opts.gitFetchOk === false ? "1" : "0"}
fi
if printf '%s' "$*" | grep -q 'rev-parse'; then
  printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fi
exit 0
`,
  );
  // open_url would otherwise launch a real browser on the test machine.
  for (const opener of ["xdg-open", "open", "wslview", "explorer.exe"]) {
    writeExecutable(
      path.join(binDir, opener),
      `#!/bin/sh\necho "open $*" >> "${binDir}/calls.log"\nexit 0\n`,
    );
  }
}

// A checkout shape install.sh accepts: git metadata, the compose file, the
// .env it reads the probe URL from, a live ./data, and the two files it shells
// out to — update.sh and the shared probe it sources.
function makeInstallScriptTree(opts?: { envExtra?: string }): { root: string; dataDir: string } {
  const root = makeTrackedTempDir("keypage-install-");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "keypage.db"), "vault-bytes");
  fs.writeFileSync(path.join(dataDir, "setup-token"), "setup-secret", { mode: 0o600 });
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(
    path.join(root, ".env"),
    `PORT=${DEFAULT_LISTEN_PORT}\nKEYPAGE_WEB_DIR=/app/apps/web/dist\n${opts?.envExtra ?? ""}`,
  );
  fs.copyFileSync(COMPOSE_YML, path.join(root, "docker-compose.yml"));
  copySharedLibs(root);
  fs.copyFileSync(UPDATE_SH, path.join(root, "scripts/update.sh"));
  return { root, dataDir };
}

function runInstall(opts: {
  keypageDir: string;
  binDir: string;
  extraEnv?: NodeJS.ProcessEnv;
}): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${opts.binDir}:${process.env.PATH ?? "/usr/bin"}`,
    KEYPAGE_DIR: opts.keypageDir,
    TERM: "dumb",
    ...opts.extraEnv,
  };
  const result = spawnSync("bash", [INSTALL_SH], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runPiped(
  script: string,
  opts: { binDir: string; extraEnv?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Callers that mean to hand a directory over set it in extraEnv; the default
  // has to stay unset, because "no directory to derive" is itself under test.
  delete env.KEYPAGE_DIR;
  const result = spawnSync("bash", [], {
    encoding: "utf8",
    input: fs.readFileSync(script, "utf8"),
    cwd: os.tmpdir(),
    env: {
      ...env,
      PATH: `${opts.binDir}:${process.env.PATH ?? "/usr/bin"}`,
      TERM: "dumb",
      ...opts.extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("scripts/update.sh contract", () => {
  it("exists as an executable bash script", () => {
    const stat = fs.statSync(UPDATE_SH);
    assert.ok(stat.isFile());
    assert.ok((stat.mode & 0o111) !== 0, "update.sh must be executable");
    const src = readUpdateScript();
    assert.match(src, /^#!/);
    assert.match(src, /KEYPAGE_SKIP_GIT/);
  });

  it("keeps DEFAULT_LISTEN_PORT aligned and does not rewrite PORT or compose ports", () => {
    const src = readUpdateScript();
    assert.match(src, new RegExp(`^DEFAULT_LISTEN_PORT=${DEFAULT_LISTEN_PORT}$`, "m"));
    assert.match(src, /\/api\/health/);
    assert.match(src, /docker pull --quiet/);
    assert.match(src, /compose up -d --no-build --pull never keypage/);
    assert.match(src, /KEYPAGE_BUILD_LOCAL/);
    assert.match(src, /rev-parse FETCH_HEAD/);
    assert.match(src, /--source="\$\{wanted\}"/);
    assert.doesNotMatch(src, /--source="\$\{reset_to\}"/);
    assert.doesNotMatch(src, /reset --hard/);
    assert.doesNotMatch(src, /reset --soft /);
    assert.doesNotMatch(src, /checkout -q -B/);
    assert.match(src, /update-ref/);
    assert.match(src, /:\(exclude\)data/);
    assert.match(src, /comm -23/);
    assert.match(src, /rm -f --ignore-unmatch/);
    assert.doesNotMatch(src, /^\s*PORT=/m);
    assert.doesNotMatch(src, /sed[^\n]*PORT/);
    assert.doesNotMatch(src, /(?:sed|tee|printf|cat\s*>)[^\n]*docker-compose\.yml/);
    assert.match(
      src,
      /sed 's\|\^KEYPAGE_WEB_DIR=\/app\/web\$\|KEYPAGE_WEB_DIR=\/app\/apps\/web\/dist\|'/,
    );
    // The EXIT trap restores .env unconditionally (it is installed before the
    // .env backup decision) and also removes the ls-files/ls-tree temp files,
    // so a mid-update failure never leaves a stale backup or temp files behind.
    assert.match(src, /trap cleanup_update_temps EXIT/);
    assert.match(src, /cleanup_update_temps\(\) \{/);
    assert.match(src, /cp -p "\$\{env_backup\}" "\$\{KEYPAGE_DIR\}\/\.env"/);
    assert.match(src, /rm -f "\$\{tracked_paths\}" "\$\{incoming_paths\}"/);
  });

  it("resolves a piped self path safely and never treats stdin as the install dir", () => {
    const src = readUpdateScript();
    assert.match(src, /BASH_SOURCE\[0\]:-/);
    assert.match(src, /\/dev\/fd/);
    assert.match(src, /\/dev\/stdin|\/proc\/self\/fd/);
    assert.match(src, /HOME\}\/keypage/);
    assert.doesNotMatch(src, /Stash or discard/);
    assert.doesNotMatch(src, /git clean/);
  });

  it("does not wipe the data dir or ship Tunnel product tooling", () => {
    const src = readUpdateScript();
    assert.doesNotMatch(src, DATA_WIPE);
    assert.doesNotMatch(src, TUNNEL_PRODUCT);
    assert.match(src, /mkdir -p data/);
    assert.match(src, /docker compose logs/);
    assert.match(src, /ls-files -- "data"/);
    assert.match(src, /ls-tree -r --name-only/);
    assert.match(src, /bind-mount, outside source control/);
    // Restore stages the snapshot copy before it moves live data aside. Moving
    // first is what left a bootable-but-empty ./data after a copy failure, and
    // the documented remedy (re-run the updater) would then boot a blank vault
    // over the operator's data.
    assert.match(src, /if ! cp -a "\$\{snapshot_dir\}\/data\/\." "\$\{stage_data\}\/"/);
    const stagedCopy = src.indexOf('if ! cp -a "${snapshot_dir}/data/." "${stage_data}/"');
    const liveMove = src.indexOf('if [[ -d data ]] && ! mv data "${failed_data}"');
    assert.ok(stagedCopy >= 0, "restore must copy the snapshot into a staging dir");
    assert.ok(liveMove > stagedCopy, "live data must move aside only after the copy succeeds");
    assert.match(src, /old image was not started/);
    assert.match(src, /old_stop_started=1/);
    assert.match(src, /compose start keypage/);

    const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^data\/$/m);
    assert.match(gitignore, /^\*\.db$/m);

    const compose = fs.readFileSync(COMPOSE_YML, "utf8");
    assert.match(compose, /^\s+-\s+\.\/data:\/app\/data$/m);
    assert.match(compose, /ghcr\.io\/saadiqhorton\/keypage:v1/);
    assert.doesNotMatch(compose, /^\s+build:/m);
    assert.doesNotMatch(compose, TUNNEL_PRODUCT);
    assert.doesNotMatch(compose, /^\s+cloudflared:/m);

    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    assert.doesNotMatch(envExample, TUNNEL_PRODUCT);
  });

  it("publishes tested multi-architecture images with pinned actions", () => {
    const workflow = fs.readFileSync(IMAGE_WORKFLOW, "utf8");
    assert.match(workflow, /workflow_run:/);
    assert.match(workflow, /workflow_run\.conclusion == 'success'/);
    assert.match(workflow, /linux\/amd64,linux\/arm64/);
    assert.match(workflow, /org\.opencontainers\.image\.revision/);
    assert.match(workflow, /type=raw,value=v1/);
    assert.match(workflow, /group: publish-image-main/);
    assert.match(workflow, /provenance: mode=max/);
    assert.match(workflow, /sbom: true/);
    assert.doesNotMatch(workflow, /uses:\s+[^\n]+@v\d+\s*$/m);
  });

  it("publishes a semver-tagged image with matching runtime version metadata", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/release-artifacts.yml"),
      "utf8",
    );
    const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

    assert.match(workflow, /publish-image:/);
    assert.match(workflow, /type=raw,value=\$\{\{ github\.ref_name \}\}/);
    assert.match(workflow, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
    assert.match(workflow, /org\.opencontainers\.image\.version=\$\{\{ github\.ref_name \}\}/);
    assert.match(workflow, /KEYPAGE_VERSION=\$\{\{ github\.ref_name \}\}/);
    assert.match(dockerfile, /ARG KEYPAGE_VERSION=dev/);
    assert.match(dockerfile, /KEYPAGE_VERSION=\$\{KEYPAGE_VERSION\}/);
  });

  it("provides a quiesced, checksummed off-box backup path", () => {
    const src = fs.readFileSync(BACKUP_SH, "utf8");
    const docs = fs.readFileSync(path.join(repoRoot, "docs/backups.md"), "utf8");

    assert.equal(fs.statSync(BACKUP_SH).mode & 0o111, 0o111);
    assert.match(src, /compose .*stop keypage/);
    assert.match(src, /compose .*start keypage/);
    assert.match(src, /tar -C "\$\{DATA_DIR\}" -czf/);
    assert.match(src, /sha256sum "\$\{ARCHIVE\}"/);
    assert.match(src, /chmod 600 "\$\{ARCHIVE\}"/);
    assert.match(docs, /off-box/i);
    assert.match(docs, /sha256sum --check/);
    assert.doesNotMatch(src, /compose down[^\n]*-v/);
  });

  it("writes a restorable archive and verifies its checksum", () => {
    const root = makeTrackedTempDir("keypage-backup-root-");
    const destination = makeTrackedTempDir("keypage-backup-destination-");
    const binDir = makeTrackedTempDir("keypage-backup-bin-");
    fs.mkdirSync(path.join(root, "data"));
    fs.writeFileSync(path.join(root, "docker-compose.yml"), "services:\n  keypage:\n");
    fs.writeFileSync(path.join(root, "data", "keypage.db"), "encrypted-vault");
    writeExecutable(
      path.join(binDir, "docker"),
      "#!/bin/sh\nif [ \"$1\" = compose ]; then exit 0; fi\nexit 0\n",
    );

    const result = spawnSync("bash", [BACKUP_SH, destination], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        KEYPAGE_DIR: root,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin"}`,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const archive = fs
      .readdirSync(destination)
      .find((name) => name.endsWith(".tar.gz"));
    assert.ok(archive, "backup archive must be written");
    const archivePath = path.join(destination, archive);
    const checksum = `${archivePath}.sha256`;
    assert.equal(spawnSync("sha256sum", ["--check", checksum], { encoding: "utf8" }).status, 0);
    const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /keypage\.db/);
    assert.equal(fs.readFileSync(path.join(root, "data", "keypage.db"), "utf8"), "encrypted-vault");
  });
});

describe("scripts/rollback.sh safety contract", () => {
  it("validates and stages the snapshot before replacing live data", () => {
    const src = fs.readFileSync(ROLLBACK_SH, "utf8");
    const validation = src.indexOf('archive_entries=$(tar -tzf "$SNAPSHOT")');
    const staging = src.indexOf('tar -xzf "$SNAPSHOT" --no-same-owner');
    const liveMove = src.indexOf('mv -- "$DATA_DIR" "$FAILED_DATA_DIR"');

    assert.ok(validation >= 0);
    assert.ok(staging > validation);
    assert.ok(liveMove > staging);
    assert.match(src, /snapshot contains an unsafe path/);
    assert.match(src, /snapshot contains links or special files/);
    assert.doesNotMatch(src, /find data[^\n]*rm -rf/);
  });

  it("uses candidate forward recovery for target build and health failures", () => {
    const src = fs.readFileSync(ROLLBACK_SH, "utf8");
    assert.match(src, /forward_recover "rollback target build\/start failed"/);
    assert.match(src, /forward_recover "rollback target failed health validation/);
    assert.match(src, /start_revision "\$CANDIDATE" "\$CANDIDATE_IMAGE_REF"/);
    assert.match(src, /candidate forward-recovery start also failed/);
  });

  it("reports a precondition when piped instead of dying on an unbound BASH_SOURCE", () => {
    const binDir = makeTrackedTempDir("keypage-rollback-bin-");
    makeStubBin(binDir, { healthOk: true });

    // `curl | bash` leaves BASH_SOURCE unset (set -u) or pointing at /dev/fd/63,
    // where dirname/.. resolves to /dev. Either way the script must name the
    // real precondition, and must never guess at the install dir.
    const noDir = runPiped(ROLLBACK_SH, { binDir });
    assert.notEqual(noDir.status, 0);
    assert.doesNotMatch(noDir.stderr, /unbound variable/);
    assert.match(noDir.stderr, /is not a git checkout/);

    // With a dir given, it gets past the dir and the shared probe, and stops on
    // the next real precondition — no vault data touched either way.
    const tree = makeInstallScriptTree();
    const withDir = runPiped(ROLLBACK_SH, { binDir, extraEnv: { KEYPAGE_DIR: tree.root } });
    assert.notEqual(withDir.status, 0);
    assert.doesNotMatch(withDir.stderr, /unbound variable/);
    assert.match(withDir.stderr, /KEYPAGE_ROLLBACK_TARGET must be a full 40-character commit SHA/);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
  });

  it("probes health through the same shared library as the updater", () => {
    for (const file of [UPDATE_SH, ROLLBACK_SH, INSTALL_SH]) {
      const name = path.basename(file);
      const src = fs.readFileSync(file, "utf8");
      assert.match(src, /scripts\/lib\/health-probe\.sh/, `${name} must load the shared probe`);
      assert.match(src, /keypage_resolve_health_urls/, `${name} must resolve probe URLs`);
      assert.match(src, /keypage_wait_for_health/, `${name} must poll through the shared probe`);
      // A local reimplementation is how the two scripts drifted apart: the
      // rollback path polled loopback only, so a healthy target failed
      // validation and forward_recover reinstated the candidate being rolled
      // away from.
      assert.doesNotMatch(src, /^wait_for_health\(\)/m, `${name} must not define its own probe`);
    }
  });
});

describe("release-image selection", () => {
  const ROLLBACK_SRC = () => fs.readFileSync(ROLLBACK_SH, "utf8");

  it("all three operators resolve images through the shared selector", () => {
    for (const [name, src] of [
      ["scripts/update.sh", readUpdateScript()],
      ["scripts/install.sh", readInstallScript()],
      ["scripts/rollback.sh", ROLLBACK_SRC()],
    ] as const) {
      assert.match(src, /scripts\/lib\/release-image\.sh/, `${name} must load the shared release-image selector`);
      assert.match(src, /keypage_select_image_tag/, `${name} must resolve the image through the shared selector`);
      assert.match(src, /org\.opencontainers\.image\.version/, `${name} must verify the baked release version`);
    }
  });

  it("update.sh and install.sh sync release tags best-effort; rollback never fetches", () => {
    const fetchPattern = /fetch --quiet --force origin 'refs\/tags\/v\[0-9\]\*:refs\/tags\/v\[0-9\]\*'\s*>\/dev\/null 2>&1 \|\| true/;
    for (const src of [readUpdateScript(), readInstallScript()]) {
      // The bare-SHA image tag is shared with main-branch builds, so the
      // updater must bring release tags along; a single-branch fetch does not
      // reliably do that. Best-effort: without a tag the bare-SHA fallback
      // still resolves the same commit.
      assert.match(src, fetchPattern, "release-tag sync must exist and never be fatal");
    }
    // Recovery must not gain a network dependency: rollback uses whatever
    // tags the checkout already carries.
    assert.doesNotMatch(ROLLBACK_SRC(), /git .*fetch .*refs\/tags/);
  });

  it("selector prefers the SemVer release tag and falls back to the commit", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-release-image-"));
    git(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "f"), "one");
    git(repo, ["add", "f"]);
    git(repo, ["commit", "-m", "one"]);
    const sha1 = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    git(repo, ["tag", "v1.2.3", sha1]);
    fs.writeFileSync(path.join(repo, "f"), "two");
    git(repo, ["add", "f"]);
    git(repo, ["commit", "-m", "two"]);
    const sha2 = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    git(repo, ["tag", "keypage-rollback-not-semver", sha2]);

    const select = (sha: string) =>
      spawnSync(
        "bash",
        ["-c", `. '${RELEASE_IMAGE_LIB}'; keypage_select_image_tag "$1" "$2"`, "select", repo, sha],
        { encoding: "utf8" },
      );
    assert.equal(select(sha1).status, 0);
    assert.equal(select(sha1).stdout.trim(), "v1.2.3", "must prefer the release tag pointing at the commit");
    assert.equal(select(sha2).stdout.trim(), sha2, "non-SemVer tags must not win; fall back to the commit");
    assert.equal(select("not-a-sha").stdout.trim(), "not-a-sha", "non-commit input passes through");
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("update.sh pulls the release image when a release tag points at the checkout", () => {
    const { root } = makeInstallTree();
    const binDir = makeTrackedTempDir("keypage-update-bin-");
    makeStubBin(binDir, { healthOk: true });
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
if printf '%s' "$*" | grep -q 'rev-parse HEAD'; then
  printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fi
if printf '%s' "$*" | grep -q 'tag --points-at'; then
  printf '%s\\n' 'v1.0.2'
fi
exit 0
`,
    );

    const result = runUpdate({ keypageDir: root, binDir });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /git -C \S+ fetch --quiet --force origin refs\/tags\/v\[0-9\]\*:refs\/tags\/v\[0-9\]\*/);
    const tagFetchAt = calls.indexOf("fetch --quiet --force origin refs/tags/");
    const pullAt = calls.indexOf("pull --quiet");
    assert.ok(tagFetchAt >= 0 && tagFetchAt < pullAt, "release tags must be synced before the image is pulled");
    // The release image carries the attested v1.0.2 identity; the bare-SHA
    // image of the same commit may have been overwritten by a main-branch
    // build (this exact collision shipped v1.0.2 as main-<sha> on 2026-09-20).
    assert.match(calls, /pull --quiet ghcr\.io\/saadiqhorton\/keypage:v1\.0\.2/);
    assert.doesNotMatch(calls, /pull --quiet ghcr\.io\/saadiqhorton\/keypage:aaaaaa/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("update.sh refuses a republished release tag whose baked version disagrees", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = makeTrackedTempDir("keypage-update-bin-");
    makeStubBin(binDir, { healthOk: true, versionLabel: "main-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
if printf '%s' "$*" | grep -q 'rev-parse HEAD'; then
  printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fi
if printf '%s' "$*" | grep -q 'tag --points-at'; then
  printf '%s\\n' 'v1.0.2'
fi
exit 0
`,
    );

    const result = runUpdate({ keypageDir: root, binDir });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /reports version/);
    assert.match(`${result.stdout}\n${result.stderr}`, /existing KeyPage was not stopped/);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.doesNotMatch(calls, /compose stop|compose up/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });
});

describe("README update path", () => {
  it("documents scripts/update.sh and a short same-port compatibility note", () => {
    const section = readmeUpdatesSection();
    assert.match(section, /scripts\/update\.sh/);
    assert.match(section, /same host port/i);
    assert.match(section, /brief downtime/i);
    assert.doesNotMatch(section, /cloudflared/i);
    assert.doesNotMatch(section, /install[^\n]*tunnel/i);
    assert.match(
      section,
      /curl -fsSL https:\/\/raw\.githubusercontent\.com\/saadiqhorton\/KeyPage\/main\/scripts\/update\.sh/,
      "first update from a pre-update.sh install must fetch the script from the remote",
    );
    assert.match(section, /tracked/i);
    assert.match(section, /\.\/data/);
    assert.match(section, /gitignore/i);
    assert.match(section, /bind-mount/i);
    assert.doesNotMatch(section, /^\s*git reset --hard/m);
    assert.doesNotMatch(section, /stash or discard/i);
  });
});

describe("scripts/update.sh behavior", () => {
  it("pulls a prebuilt image, preserves vault files, and leaves PORT alone", () => {
    const { root, dataDir, envPath } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true });
    const envBefore = fs.readFileSync(envPath, "utf8");
    const composeBefore = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");

    const result = runUpdate({ keypageDir: root, binDir });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.equal(fs.readFileSync(path.join(dataDir, "setup-token"), "utf8"), "setup-secret");
    assert.equal(fs.readFileSync(envPath, "utf8"), envBefore);
    assert.equal(fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8"), composeBefore);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /pull --quiet ghcr\.io\/saadiqhorton\/keypage:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.match(calls, /compose up -d --no-build --pull never keypage/);
    assert.doesNotMatch(calls, /compose up -d --build/);
    assert.match(calls, /\/api\/health/);
    assert.match(result.stdout, /preserved/i);
    assert.match(result.stdout, new RegExp(String(DEFAULT_LISTEN_PORT)));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("leaves the running service and vault untouched when image download fails", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, pullOk: false, existingContainer: true });

    const result = runUpdate({ keypageDir: root, binDir });

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /pull --quiet/);
    assert.doesNotMatch(calls, /compose stop|compose up/);
    assert.match(`${result.stdout}\n${result.stderr}`, /existing container is still running/i);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("restores the stopped data snapshot and previous image after failed health", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    fs.writeFileSync(path.join(dataDir, "keypage.db-wal"), "wal-bytes");
    fs.writeFileSync(path.join(dataDir, "keypage.db-shm"), "shm-bytes");
    makeStubBin(binDir, {
      healthOk: true,
      healthFailuresBeforeSuccess: 1,
      existingContainer: true,
    });

    const result = runUpdate({
      keypageDir: root,
      binDir,
      extraEnv: { KEYPAGE_HEALTH_ATTEMPTS: "1", KEYPAGE_HEALTH_SLEEP_SECS: "0" },
    });

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db-wal"), "utf8"), "wal-bytes");
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db-shm"), "utf8"), "shm-bytes");
    assert.equal(fs.readFileSync(path.join(dataDir, "setup-token"), "utf8"), "setup-secret");
    assert.match(
      fs.readFileSync(path.join(root, "docker-compose.override.yml"), "utf8"),
      /keypage-rollback:/,
    );
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    const pullAt = calls.indexOf("pull --quiet");
    const stopAt = calls.indexOf("compose stop");
    assert.notEqual(pullAt, -1, "expected a registry pull");
    assert.notEqual(stopAt, -1, "expected a container stop");
    assert.ok(pullAt < stopAt);
    assert.match(calls, /image tag sha256:d{64} keypage-rollback:/);
    assert.match(calls, /compose up -d --no-build --pull never keypage/);
    assert.match(`${result.stdout}\n${result.stderr}`, /previous healthy version and matching data were restored/i);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("never starts the old image when restoring the complete snapshot fails", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: false, existingContainer: true });
    writeExecutable(
      path.join(binDir, "cp"),
      `#!/bin/sh
count_file="${binDir}/cp-count"
count=0
[ ! -f "$count_file" ] || count=$(cat "$count_file")
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
if [ "$count" -eq 1 ]; then exec /bin/cp "$@"; fi
exit 1
`,
    );

    const result = runUpdate({
      keypageDir: root,
      binDir,
      extraEnv: { KEYPAGE_HEALTH_ATTEMPTS: "1", KEYPAGE_HEALTH_SLEEP_SECS: "0" },
    });

    assert.notEqual(result.status, 0);
    // The failed restore must leave the live vault where it is. Live data used
    // to be moved aside before the copy was attempted, so a copy failure left
    // an empty but perfectly bootable ./data — and the documented remedy,
    // re-running the updater, would then boot a blank vault over real data.
    assert.equal(fs.existsSync(path.join(dataDir, "keypage.db")), true);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.equal(fs.readFileSync(path.join(dataDir, "setup-token"), "utf8"), "setup-secret");
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.equal(calls.match(/compose up -d --no-build --pull never keypage/g)?.length, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /old image was not started/i);
    assert.match(`${result.stdout}\n${result.stderr}`, /live data was left untouched/i);
    assert.match(
      fs.readFileSync(path.join(root, "docker-compose.override.yml"), "utf8"),
      /@sha256:bbbb/,
    );
    assert.ok(fs.readdirSync(path.join(root, ".keypage", "snapshots")).length > 0);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("exits non-zero when health fails and tells the operator how to read logs", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: false });

    const result = runUpdate({
      keypageDir: root,
      binDir,
      extraEnv: { KEYPAGE_HEALTH_ATTEMPTS: "2", KEYPAGE_HEALTH_SLEEP_SECS: "0" },
    });

    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /\/api\/health|health/i);
    assert.match(output, /docker compose logs/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("polls /api/health on the published host port", () => {
    const { root } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, publishedPort: 18080 });

    const result = runUpdate({ keypageDir: root, binDir });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /compose port keypage /);
    assert.match(
      calls,
      /curl -fsS --connect-timeout 3 --max-time 5 http:\/\/127\.0\.0\.1:18080\/api\/health/,
    );
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("probes the public origin first and falls back to loopback", () => {
    const { root, envPath } = makeInstallTree();
    fs.appendFileSync(
      envPath,
      "KEYPAGE_PUBLIC_ORIGIN=https://keypage.example.com\nKEYPAGE_TRUSTED_PROXIES=192.0.2.10\n",
    );
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    // The public origin fails its first probe. A hostname that resolves but is
    // not reachable from the box is the shape that made the old single-URL
    // probe declare a healthy vault dead — and a rollback reinstates the
    // candidate, so that recovery never converged.
    makeStubBin(binDir, {
      healthOk: true,
      publishedPort: 18080,
      healthFailuresBeforeSuccess: 1,
    });

    const result = runUpdate({ keypageDir: root, binDir });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(
      calls,
      /curl -fsS --connect-timeout 3 --max-time 5 https:\/\/keypage\.example\.com\/api\/health/,
    );
    assert.match(
      calls,
      /curl -fsS --connect-timeout 3 --max-time 5 http:\/\/127\.0\.0\.1:18080\/api\/health/,
    );
    assert.ok(
      calls.indexOf("https://keypage.example.com/api/health") <
        calls.indexOf("http://127.0.0.1:18080/api/health"),
      "the public origin must be probed before the loopback fallback",
    );
    assert.match(result.stdout, /Check health at https:\/\/keypage\.example\.com\/api\/health/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("does not stop a container it did not restart when the running image is already current", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    // Already on the candidate image: the updater writes the override and
    // restarts nothing, so the container it probes is the pre-existing healthy
    // one. Failing the probe must not take the vault offline.
    makeStubBin(binDir, {
      healthOk: false,
      existingContainer: true,
      candidateIsRunning: true,
    });

    const result = runUpdate({
      keypageDir: root,
      binDir,
      extraEnv: { KEYPAGE_HEALTH_ATTEMPTS: "1", KEYPAGE_HEALTH_SLEEP_SECS: "0" },
    });

    assert.notEqual(result.status, 0);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    // `restart: unless-stopped` does not revive a container stopped by hand,
    // and the message this path used to print never said it had stopped one.
    assert.doesNotMatch(calls, /compose stop/);
    assert.doesNotMatch(calls, /compose up/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.match(`${result.stdout}\n${result.stderr}`, /restarted nothing/i);
    assert.match(`${result.stdout}\n${result.stderr}`, /left untouched/i);
    assert.doesNotMatch(result.stdout, /container restarted/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("says the container may still be running when a stop it attempted fails", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    // Local-build path: this run started the container and there is no cutover,
    // so failing health reaches the "stop what we started" branch. `compose
    // stop` then fails, which used to fall through to the already-current
    // branch's copy — telling the operator the running container "was left
    // untouched, because this update did not restart it" when the run had in
    // fact restarted it and failed to stop it.
    makeStubBin(binDir, { healthOk: false, stopFails: true });

    const result = runUpdate({
      keypageDir: root,
      binDir,
      extraEnv: {
        KEYPAGE_BUILD_LOCAL: "1",
        KEYPAGE_HEALTH_ATTEMPTS: "1",
        KEYPAGE_HEALTH_SLEEP_SECS: "0",
      },
    });

    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /compose stop/, "the branch under test must attempt a stop");
    assert.match(output, /could not stop it/i);
    assert.doesNotMatch(output, /left untouched/i);
    assert.doesNotMatch(output, /did not restart it/i);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("fails closed before any cutover when the shared probe is missing", () => {
    const { root, dataDir } = makeInstallTree();
    fs.rmSync(path.join(root, "scripts"), { recursive: true, force: true });
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, existingContainer: true });

    const result = runUpdate({ keypageDir: root, binDir });

    assert.notEqual(result.status, 0);
    const calls = fs.existsSync(path.join(binDir, "calls.log"))
      ? fs.readFileSync(path.join(binDir, "calls.log"), "utf8")
      : "";
    assert.doesNotMatch(calls, /compose stop|compose up|pull --quiet/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.match(`${result.stdout}\n${result.stderr}`, /health check cannot run/i);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("moves a clean shallow clone to origin/KEYPAGE_REF when the remote advances", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });

    fs.writeFileSync(path.join(remoteWork, "release-marker"), "v-next");
    git(remoteWork, ["add", "release-marker"]);
    git(remoteWork, ["commit", "-m", "advance"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(install, "release-marker"), "utf8"), "v-next");
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    const wanted = spawnSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" });
    const actual = spawnSync("git", ["-C", install, "rev-parse", "HEAD"], { encoding: "utf8" });
    assert.equal(wanted.status, 0);
    assert.equal(actual.status, 0);
    assert.equal(actual.stdout.trim(), wanted.stdout.trim());
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("removes tracked source files deleted on KEYPAGE_REF and leaves ./data", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    fs.writeFileSync(path.join(remoteWork, "stale-source.txt"), "gone-soon");
    git(remoteWork, ["add", "stale-source.txt"]);
    git(remoteWork, ["commit", "-m", "add stale"]);
    git(remoteWork, ["push", bare, "main"]);
    git(install, ["fetch", "--depth", "1", "origin", "main"]);
    git(install, ["reset", "--hard", "FETCH_HEAD"]);
    fs.writeFileSync(path.join(install, "data/keypage.db"), "vault-bytes");
    git(remoteWork, ["rm", "stale-source.txt"]);
    git(remoteWork, ["commit", "-m", "drop stale"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(install, "stale-source.txt")), false);
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("removes the old path of a renamed source file and leaves ./data", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    fs.writeFileSync(path.join(remoteWork, "old-name.txt"), "rename-me");
    git(remoteWork, ["add", "old-name.txt"]);
    git(remoteWork, ["commit", "-m", "add old name"]);
    git(remoteWork, ["push", bare, "main"]);
    git(install, ["fetch", "--depth", "1", "origin", "main"]);
    git(install, ["reset", "--hard", "FETCH_HEAD"]);
    fs.writeFileSync(path.join(install, "data/keypage.db"), "vault-bytes");
    git(remoteWork, ["mv", "old-name.txt", "new-name.txt"]);
    git(remoteWork, ["commit", "-m", "rename source"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(install, "old-name.txt")), false);
    assert.equal(fs.readFileSync(path.join(install, "new-name.txt"), "utf8"), "rename-me");
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("advances KEYPAGE_REF without rewriting a different checked-out branch", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    const otherBefore = spawnSync("git", ["-C", install, "rev-parse", "HEAD"], { encoding: "utf8" });
    assert.equal(otherBefore.status, 0);
    git(install, ["checkout", "-b", "other"]);
    fs.writeFileSync(path.join(remoteWork, "release-marker"), "v-next");
    git(remoteWork, ["add", "release-marker"]);
    git(remoteWork, ["commit", "-m", "advance"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const otherAfter = spawnSync("git", ["-C", install, "rev-parse", "other"], { encoding: "utf8" });
    const headName = spawnSync("git", ["-C", install, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
    const headSha = spawnSync("git", ["-C", install, "rev-parse", "HEAD"], { encoding: "utf8" });
    const wanted = spawnSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" });
    assert.equal(otherAfter.stdout.trim(), otherBefore.stdout.trim());
    assert.equal(headName.stdout.trim(), "main");
    assert.equal(headSha.stdout.trim(), wanted.stdout.trim());
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("auto-resets dirty tracked files, leaves untracked ./data and .env, and pulls", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });

    fs.writeFileSync(
      path.join(install, ".env"),
      `PORT=18081\nKEYPAGE_WEB_DIR=/app/apps/web/dist\n`,
    );
    fs.appendFileSync(path.join(install, "docker-compose.yml"), "\n# dirty\n");
    fs.writeFileSync(path.join(remoteWork, "release-marker"), "v-next");
    git(remoteWork, ["add", "release-marker"]);
    git(remoteWork, ["commit", "-m", "advance"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /resetting tracked files to origin\/main; leaving \.\/data alone/);
    assert.doesNotMatch(output, /stash or discard/i);
    assert.doesNotMatch(output, /git reset --hard origin\//);
    assert.doesNotMatch(fs.readFileSync(path.join(install, "docker-compose.yml"), "utf8"), /# dirty/);
    assert.equal(fs.readFileSync(path.join(install, "release-marker"), "utf8"), "v-next");
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    assert.match(fs.readFileSync(path.join(install, ".env"), "utf8"), /^PORT=18081$/m);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(calls, /pull --quiet ghcr\.io\/saadiqhorton\/keypage:[0-9a-f]{40}/);
    assert.match(calls, /compose up -d --no-build --pull never keypage/);
    assert.doesNotMatch(calls, /compose up -d --build/);
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("runs via stdin without BASH_SOURCE and still uses KEYPAGE_DIR", () => {
    const { root, dataDir } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true });

    const result = runUpdate({
      keypageDir: root,
      binDir,
      viaStdin: true,
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /BASH_SOURCE|unbound variable/);
    assert.doesNotMatch(output, /\/dev\/fd|\/dev\/stdin|\/proc\/self\/fd/);
    assert.match(result.stdout, new RegExp(`install dir ${root}`));
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("piped bootstrap without KEYPAGE_DIR uses ~/keypage, not cwd or a fake parent checkout", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-home-"));
    const install = path.join(home, "keypage");
    fs.mkdirSync(install);
    const dataDir = path.join(install, "data");
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, "keypage.db"), "vault-bytes");
    fs.writeFileSync(path.join(install, ".env"), `PORT=${DEFAULT_LISTEN_PORT}\n`);
    fs.copyFileSync(COMPOSE_YML, path.join(install, "docker-compose.yml"));
    copySharedLibs(install);

    const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-fake-"));
    fs.copyFileSync(COMPOSE_YML, path.join(fakeRepo, "docker-compose.yml"));
    const nestedCwd = path.join(fakeRepo, "nested");
    fs.mkdirSync(nestedCwd);

    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true });

    const result = runUpdate({
      binDir,
      viaStdin: true,
      cwd: nestedCwd,
      extraEnv: {
        HOME: home,
        KEYPAGE_SKIP_GIT: "1",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(result.stdout, new RegExp(`install dir ${install}`));
    assert.doesNotMatch(output, new RegExp(`install dir ${fakeRepo}`));
    assert.doesNotMatch(output, /\/dev\/fd|\/dev\/stdin|\/proc\/self\/fd/);
    assert.doesNotMatch(output, /BASH_SOURCE|unbound variable/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fakeRepo, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("fails closed when origin is not the expected KeyPage repo", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    git(install, ["remote", "set-url", "origin", "https://example.com/not-keypage.git"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: "https://github.com/saadiqhorton/KeyPage.git",
        KEYPAGE_REF: "main",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /origin is .*expected/);
    assert.doesNotMatch(fs.readFileSync(path.join(binDir, "calls.log"), "utf8"), /compose up /);
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("fails closed when the fetched tip newly tracks ./data", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    fs.writeFileSync(path.join(install, "data/keypage.db"), "vault-bytes");
    fs.writeFileSync(path.join(remoteWork, ".gitignore"), ".env\n");
    fs.mkdirSync(path.join(remoteWork, "data"), { recursive: true });
    fs.writeFileSync(path.join(remoteWork, "data/keypage.db"), "evil-vault");
    git(remoteWork, ["add", "-f", ".gitignore", "data/keypage.db"]);
    git(remoteWork, ["commit", "-m", "accidentally track vault"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /data is tracked/i);
    assert.match(output, /bind-mount, outside source control/);
    assert.doesNotMatch(fs.readFileSync(path.join(binDir, "calls.log"), "utf8"), /compose up /);
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("fails closed when ./data is tracked so reset cannot overwrite vault files", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone({ trackData: true });
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    fs.appendFileSync(path.join(install, "docker-compose.yml"), "\n# dirty\n");

    const result = runUpdate({
      keypageDir: install,
      binDir,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /data is tracked/i);
    assert.match(output, /bind-mount, outside source control/);
    assert.doesNotMatch(fs.readFileSync(path.join(binDir, "calls.log"), "utf8"), /compose up /);
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("piped dirty tree auto-resets tracked files and preserves vault data", () => {
    const { remoteWork, bare, install } = seedRemoteAndShallowClone();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, stubGit: false });
    fs.appendFileSync(path.join(install, "docker-compose.yml"), "\n# dirty\n");
    fs.writeFileSync(path.join(remoteWork, "release-marker"), "v-next");
    git(remoteWork, ["add", "release-marker"]);
    git(remoteWork, ["commit", "-m", "advance"]);
    git(remoteWork, ["push", bare, "main"]);

    const result = runUpdate({
      keypageDir: install,
      binDir,
      viaStdin: true,
      extraEnv: {
        KEYPAGE_SKIP_GIT: "",
        KEYPAGE_REPO: bare,
        KEYPAGE_REF: "main",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /BASH_SOURCE|unbound variable/);
    assert.match(output, /resetting tracked files to origin\/main; leaving \.\/data alone/);
    assert.equal(fs.readFileSync(path.join(install, "release-marker"), "utf8"), "v-next");
    assert.equal(fs.readFileSync(path.join(install, "data/keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(remoteWork, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("falls back to .env PORT when compose does not report a published port", () => {
    const { root, envPath, dataDir } = makeInstallTree();
    fs.writeFileSync(envPath, "PORT=18081\nKEYPAGE_WEB_DIR=/app/apps/web/dist\n");
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, { healthOk: true, publishedPort: null });

    const result = runUpdate({ keypageDir: root, binDir });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    assert.match(
      calls,
      /curl -fsS --connect-timeout 3 --max-time 5 http:\/\/127\.0\.0\.1:18081\/api\/health/,
    );
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });
});

describe("scripts/install.sh behavior", () => {
  it("sources the shared probe and keeps no private health resolver", () => {
    const src = readInstallScript();
    assert.match(src, /scripts\/lib\/health-probe\.sh/);
    assert.match(src, /\. "\$\{HEALTH_PROBE_LIB\}"/);
    assert.match(src, /keypage_resolve_health_urls/);
    assert.match(src, /keypage_wait_for_health/);
    assert.match(src, new RegExp(`^DEFAULT_LISTEN_PORT=${DEFAULT_LISTEN_PORT}$`, "m"));
    // install.sh used to carry a third, loopback-only resolver and its own poll
    // loop, so a healthy install behind a public origin was stopped and
    // reported as a failed update. It must not know the health path at all.
    assert.doesNotMatch(src, /\/api\/health/);
    assert.doesNotMatch(src, /^resolve_health_url\(\) \{/m);
    // The only `curl` left is the usage line at the top; the probe itself lives
    // in the shared library.
    assert.equal((src.match(/curl/g) ?? []).length, 1);
    assert.doesNotMatch(src, /reset --hard/);
    assert.doesNotMatch(src, /git clean/);
  });

  it("probes the public origin before loopback and does not stop what it started healthy", () => {
    const binDir = makeTrackedTempDir("keypage-install-bin-");
    makeInstallStubBin(binDir, { healthOk: true });
    const tree = makeInstallScriptTree({
      envExtra: "KEYPAGE_PUBLIC_ORIGIN=https://keys.example\n",
    });

    const run = runInstall({
      keypageDir: tree.root,
      binDir,
      extraEnv: { KEYPAGE_BUILD_LOCAL: "1" },
    });

    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const calls = fs.readFileSync(path.join(binDir, "calls.log"), "utf8");
    const probes = calls.split("\n").filter((line) => line.includes("/api/health"));
    assert.ok(probes.length > 0, `expected a health probe in:\n${calls}`);
    assert.match(probes[0], /https:\/\/keys\.example\/api\/health/);
    assert.doesNotMatch(calls, /compose stop/);
    assert.match(run.stdout, /KeyPage is ready/);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
  });

  it("stops the container it started when nothing answers", () => {
    const binDir = makeTrackedTempDir("keypage-install-bin-");
    makeInstallStubBin(binDir, { healthOk: false });
    const tree = makeInstallScriptTree();

    const run = runInstall({
      keypageDir: tree.root,
      binDir,
      extraEnv: { KEYPAGE_BUILD_LOCAL: "1", KEYPAGE_HEALTH_ATTEMPTS: "2", KEYPAGE_HEALTH_SLEEP_SECS: "0" },
    });

    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /no healthy response from/);
    assert.match(fs.readFileSync(path.join(binDir, "calls.log"), "utf8"), /compose stop -t 20 keypage/);
    assert.doesNotMatch(run.stdout, /KeyPage is ready/);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
  });

  it("skips the updater's git step only after it refreshed the checkout itself", () => {
    const binDir = makeTrackedTempDir("keypage-install-bin-");
    makeInstallStubBin(binDir, { healthOk: true });
    const tree = makeInstallScriptTree();

    const run = runInstall({ keypageDir: tree.root, binDir });

    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /KEYPAGE_SKIP_GIT=1 — using current tree/);
    // The updater reported the only health result on this path; the installer
    // must not re-probe with the authority to stop a verified-healthy vault.
    assert.match(run.stdout, /health already verified by the updater/);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
  });

  it("fails with tracked-source-only recovery when it cannot refresh", () => {
    const binDir = makeTrackedTempDir("keypage-install-bin-");
    makeInstallStubBin(binDir, { healthOk: true, gitFetchOk: false });
    const tree = makeInstallScriptTree();

    const run = runInstall({ keypageDir: tree.root, binDir });

    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /checkout was not handed to the updater/);
    assert.match(run.stdout, /Recovery commands: cd .*git status --short; git fetch .*git restore .*\(exclude\)data/);
    assert.doesNotMatch(run.stdout, /KEYPAGE_SKIP_GIT=1 — using current tree/);
    assert.doesNotMatch(run.stdout, /reset --hard/);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "setup-token"), "utf8"), "setup-secret");
  });

  it("refuses a checkout older than the shared probe before touching .env or ./data", () => {
    const binDir = makeTrackedTempDir("keypage-install-bin-");
    makeInstallStubBin(binDir, { healthOk: true, gitFetchOk: true });
    const tree = makeInstallScriptTree();
    fs.rmSync(path.join(tree.root, "scripts/lib"), { recursive: true, force: true });
    const envBefore = fs.readFileSync(path.join(tree.root, ".env"), "utf8");

    const run = runInstall({ keypageDir: tree.root, binDir });

    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /installer cannot verify this checkout/);
    assert.match(run.stdout, /health-probe\.sh is missing/);
    assert.equal(fs.readFileSync(path.join(tree.root, ".env"), "utf8"), envBefore);
    assert.equal(fs.readFileSync(path.join(tree.dataDir, "keypage.db"), "utf8"), "vault-bytes");
  });
});
