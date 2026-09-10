import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_LISTEN_PORT } from "./app.js";
import { HEALTH_STATUS_OK } from "./health.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const UPDATE_SH = path.join(repoRoot, "scripts/update.sh");
const COMPOSE_YML = path.join(repoRoot, "docker-compose.yml");
const README = path.join(repoRoot, "README.md");

const TUNNEL_PRODUCT = /cloudflared|CLOUDFLARE_TUNNEL|TUNNEL_TOKEN|TUNNEL_HOSTNAME/i;
const DATA_WIPE =
  /rm\s+(-[a-zA-Z]*\s+)*(\.\/)?data\b|rm\s+[^\n]*data\/(keypage\.db|setup-token)|compose\s+down\s+[^\n]*-v/;

function readUpdateScript(): string {
  return fs.readFileSync(UPDATE_SH, "utf8");
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

function makeInstallTree(): { root: string; dataDir: string; envPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "keypage.db"), "vault-bytes");
  fs.writeFileSync(path.join(dataDir, "setup-token"), "setup-secret", { mode: 0o600 });
  const envPath = path.join(root, ".env");
  fs.writeFileSync(envPath, `PORT=${DEFAULT_LISTEN_PORT}\nKEYPAGE_WEB_DIR=/app/apps/web/dist\n`);
  fs.copyFileSync(COMPOSE_YML, path.join(root, "docker-compose.yml"));
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
  },
): void {
  if (opts.stubGit !== false) {
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
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
  if (opts?.trackData) {
    git(remoteWork, ["add", "docker-compose.yml", ".env", "data/keypage.db"]);
  } else {
    fs.writeFileSync(path.join(remoteWork, ".gitignore"), "data/\n.env\n");
    git(remoteWork, ["add", "docker-compose.yml", ".gitignore"]);
  }
  git(remoteWork, ["commit", "-m", "initial"]);
  git(remoteWork, ["clone", "--bare", remoteWork, bare]);
  git(remoteWork, ["clone", "--depth", "1", bare, install]);
  fs.mkdirSync(path.join(install, "data"), { recursive: true });
  fs.writeFileSync(path.join(install, "data/keypage.db"), "vault-bytes");
  return { remoteWork, bare, install };
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
    assert.match(src, /compose up -d --build/);
    assert.match(src, /rev-parse FETCH_HEAD/);
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
    assert.match(src, /trap restore_env_backup EXIT/);
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

    const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^data\/$/m);
    assert.match(gitignore, /^\*\.db$/m);

    const compose = fs.readFileSync(COMPOSE_YML, "utf8");
    assert.match(compose, /^\s+-\s+\.\/data:\/app\/data$/m);
    assert.doesNotMatch(compose, TUNNEL_PRODUCT);
    assert.doesNotMatch(compose, /^\s+cloudflared:/m);

    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    assert.doesNotMatch(envExample, TUNNEL_PRODUCT);
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
  it("rebuilds the container, preserves vault files, and leaves PORT alone", () => {
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
    assert.match(calls, /compose up -d --build/);
    assert.match(calls, /\/api\/health/);
    assert.match(result.stdout, /preserved/i);
    assert.match(result.stdout, new RegExp(String(DEFAULT_LISTEN_PORT)));
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
    assert.match(calls, /curl -fsS http:\/\/127\.0\.0\.1:18080\/api\/health/);
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

  it("auto-resets dirty tracked files, leaves untracked ./data and .env, and rebuilds", () => {
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
    assert.match(fs.readFileSync(path.join(binDir, "calls.log"), "utf8"), /compose up -d --build/);
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
    assert.match(calls, /curl -fsS http:\/\/127\.0\.0\.1:18081\/api\/health/);
    assert.equal(fs.readFileSync(path.join(dataDir, "keypage.db"), "utf8"), "vault-bytes");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });
});
