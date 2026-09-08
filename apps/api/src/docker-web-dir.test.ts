import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const DOCKER_WEB_DIR = "/app/apps/web/dist";

function readAssignedValue(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`^\\s*${name}=(\\S+)`, "m"));
  return match?.[1];
}

function readDockerfile(): string {
  return fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
}

describe("Docker KEYPAGE_WEB_DIR packaging", () => {
  it("points .env.example at the same path as the image ENV", () => {
    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    const dockerfile = readDockerfile();

    const fromEnv = readAssignedValue(envExample, "KEYPAGE_WEB_DIR");
    const fromImage = readAssignedValue(dockerfile, "KEYPAGE_WEB_DIR");

    assert.equal(fromImage, DOCKER_WEB_DIR);
    assert.equal(
      fromEnv,
      fromImage,
      "install.sh copies .env.example to .env; compose env_file overrides image ENV",
    );
  });

  it("rewrites a leftover KEYPAGE_WEB_DIR=/app/web sentinel in existing .env", () => {
    const install = fs.readFileSync(path.join(repoRoot, "scripts/install.sh"), "utf8");

    assert.match(
      install,
      /KEYPAGE_WEB_DIR=\/app\/web/,
      "installer must detect the pre-simplify path that no longer exists in the image",
    );
    assert.match(
      install,
      /s\|\\?\^?KEYPAGE_WEB_DIR=\/app\/web\$?\|KEYPAGE_WEB_DIR=\/app\/apps\/web\/dist\|/,
      "installer must rewrite only that sentinel to the image layout",
    );
  });
});

describe("Docker slim runtime packaging", () => {
  it("uses a fresh alpine runtime instead of FROM build", () => {
    const dockerfile = readDockerfile();

    assert.match(
      dockerfile,
      /^FROM node:22-alpine AS runtime$/m,
      "runtime must start from alpine so gcc/pnpm/workspace are not in the pulled image",
    );
    assert.doesNotMatch(
      dockerfile,
      /^FROM build AS runtime$/m,
      "FROM build ships the full workspace (~973 MB)",
    );
  });

  it("deploys production @keypage/api instead of shipping the workspace", () => {
    const dockerfile = readDockerfile();

    assert.match(
      dockerfile,
      /pnpm deploy --filter=@keypage\/api --prod \S+/,
      "runtime deps must come from pnpm deploy --prod",
    );
    assert.match(
      dockerfile,
      /COPY --from=deploy \/out\/api \/app/,
      "runtime must copy only the deploy directory, not the build workspace",
    );
    assert.doesNotMatch(
      dockerfile,
      /COPY --from=build \/app\/? \/app/,
      "copying /app from build reintroduces the fat workspace",
    );
  });

  it("copies the built web UI to the KEYPAGE_WEB_DIR contract path", () => {
    const dockerfile = readDockerfile();

    assert.match(
      dockerfile,
      new RegExp(
        `COPY --from=build ${DOCKER_WEB_DIR.replace(/\//g, "\\/")} ${DOCKER_WEB_DIR.replace(/\//g, "\\/")}`,
      ),
    );
  });

  it("starts the deployed API entrypoint", () => {
    const dockerfile = readDockerfile();

    assert.match(
      dockerfile,
      /CMD \["node", "dist\/main\.js"\]/,
      "pnpm deploy flattens @keypage/api to /app, so the entry is dist/main.js",
    );
  });

  it("does not recursively chown the whole /app tree into a fat layer", () => {
    const dockerfile = readDockerfile();

    assert.doesNotMatch(
      dockerfile,
      /chown\s+-R\s+node:node\s+\/app(?:\s|$)/,
    );
  });

  it("entrypoint only chowns KEYPAGE_DATA_DIR then drops to node", () => {
    const entrypoint = fs.readFileSync(
      path.join(repoRoot, "docker-entrypoint.sh"),
      "utf8",
    );

    assert.match(entrypoint, /chown -R node:node "\$KEYPAGE_DATA_DIR"/);
    assert.match(entrypoint, /exec su-exec node "\$@"/);
    assert.doesNotMatch(entrypoint, /chown -R node:node \/app(?:\s|$)/);
  });
});
