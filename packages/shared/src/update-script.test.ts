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
const DATA_WIPE = /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+.*\bdata\b|compose\s+down\s+[^\n]*-v/;

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

function makeStubBin(binDir: string, healthOk: boolean): void {
  writeExecutable(
    path.join(binDir, "git"),
    `#!/bin/sh
echo "git $*" >> "${binDir}/calls.log"
exit 0
`,
  );
  writeExecutable(
    path.join(binDir, "docker"),
    `#!/bin/sh
echo "docker $*" >> "${binDir}/calls.log"
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
  if [ "${healthOk ? "1" : "0"}" = "1" ]; then
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
  keypageDir: string;
  binDir: string;
  extraEnv?: NodeJS.ProcessEnv;
}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [UPDATE_SH], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${opts.binDir}:${process.env.PATH ?? "/usr/bin"}`,
      KEYPAGE_DIR: opts.keypageDir,
      KEYPAGE_SKIP_GIT: "1",
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
    assert.match(src, /compose up -d --build/);
    assert.doesNotMatch(src, /(?:^|[^A-Z_])PORT=/m);
    assert.doesNotMatch(src, /sed[^\n]*PORT/);
    assert.doesNotMatch(src, /(?:sed|tee|printf|cat\s*>)[^\n]*docker-compose\.yml/);
  });

  it("does not wipe the data dir or ship Tunnel product tooling", () => {
    const src = readUpdateScript();
    assert.doesNotMatch(src, DATA_WIPE);
    assert.doesNotMatch(src, TUNNEL_PRODUCT);
    assert.match(src, /mkdir -p data/);
    assert.match(src, /docker compose logs/);

    const compose = fs.readFileSync(COMPOSE_YML, "utf8");
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
  });
});

describe("scripts/update.sh behavior", () => {
  it("rebuilds the container, preserves vault files, and leaves PORT alone", () => {
    const { root, dataDir, envPath } = makeInstallTree();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-update-bin-"));
    makeStubBin(binDir, true);
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
    makeStubBin(binDir, false);

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
});
