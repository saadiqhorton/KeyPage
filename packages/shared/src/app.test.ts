import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  API_BASE,
  API_NOT_FOUND_ERROR,
  APP_NAME,
  APP_TAGLINE,
  DEFAULT_LISTEN_HOST,
  DEFAULT_LISTEN_PORT,
} from "./app.js";
import { HEALTH_STATUS_OK } from "./health.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("app constants", () => {
  it("exports product metadata", () => {
    assert.equal(APP_NAME, "KeyPage");
    assert.equal(APP_TAGLINE, "Self-hosted API key vault");
    assert.equal(API_BASE, "/api");
    assert.equal(DEFAULT_LISTEN_PORT, 9090);
    assert.equal(DEFAULT_LISTEN_HOST, "0.0.0.0");
    assert.equal(API_NOT_FOUND_ERROR, "Not Found");
    assert.equal(HEALTH_STATUS_OK, "ok");
  });

  it("keeps packaging listen-port defaults aligned with DEFAULT_LISTEN_PORT", () => {
    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    assert.match(envExample, new RegExp(`^PORT=${DEFAULT_LISTEN_PORT}$`, "m"));

    const compose = fs.readFileSync(
      path.join(repoRoot, "docker-compose.yml"),
      "utf8",
    );
    assert.match(
      compose,
      new RegExp(`["']${DEFAULT_LISTEN_PORT}:${DEFAULT_LISTEN_PORT}["']`),
    );

    const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
    assert.match(dockerfile, new RegExp(`\\bPORT=${DEFAULT_LISTEN_PORT}\\b`));
    assert.match(
      dockerfile,
      new RegExp(`\\bHOST=${DEFAULT_LISTEN_HOST.replaceAll(".", "\\.")}\\b`),
    );
    assert.match(dockerfile, /EXPOSE \$\{PORT\}/);

    const install = fs.readFileSync(
      path.join(repoRoot, "scripts/install.sh"),
      "utf8",
    );
    assert.match(
      install,
      new RegExp(`^DEFAULT_LISTEN_PORT=${DEFAULT_LISTEN_PORT}$`, "m"),
    );

    const smoke = fs.readFileSync(
      path.join(repoRoot, "scripts/ci-docker-smoke.sh"),
      "utf8",
    );
    assert.match(
      smoke,
      new RegExp(`^DEFAULT_LISTEN_PORT=${DEFAULT_LISTEN_PORT}$`, "m"),
    );
    assert.match(smoke, new RegExp(`^HEALTH_STATUS_OK=${HEALTH_STATUS_OK}$`, "m"));

    const update = fs.readFileSync(
      path.join(repoRoot, "scripts/update.sh"),
      "utf8",
    );
    assert.match(
      update,
      new RegExp(`^DEFAULT_LISTEN_PORT=${DEFAULT_LISTEN_PORT}$`, "m"),
    );
  });
});
