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

describe("Docker KEYPAGE_WEB_DIR packaging", () => {
  it("points .env.example at the same path as the image ENV", () => {
    const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

    const fromEnv = readAssignedValue(envExample, "KEYPAGE_WEB_DIR");
    const fromImage = readAssignedValue(dockerfile, "KEYPAGE_WEB_DIR");

    assert.equal(fromImage, DOCKER_WEB_DIR);
    assert.equal(
      fromEnv,
      fromImage,
      "install.sh copies .env.example to .env; compose env_file overrides image ENV",
    );
  });
});
