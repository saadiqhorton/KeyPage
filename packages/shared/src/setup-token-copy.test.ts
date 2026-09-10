import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const HOST_TOKEN_CAT = "cat ~/keypage/data/setup-token";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("setup-token operator copy (SAA-225)", () => {
  it("points operators at cat ~/keypage/data/setup-token", () => {
    const readme = readRepoFile("README.md");
    const setupScreen = readRepoFile("apps/web/src/screens/SetupScreen.tsx");
    const vaultProvider = readRepoFile("apps/web/src/vault/VaultProvider.tsx");
    const install = readRepoFile("scripts/install.sh");

    assert.match(readme, /^cd ~\/keypage$/m);
    assert.match(readme, new RegExp(HOST_TOKEN_CAT.replaceAll("/", "\\/")));
    assert.match(setupScreen, new RegExp(HOST_TOKEN_CAT.replaceAll("/", "\\/")));
    assert.match(
      vaultProvider,
      /~\/keypage\/data\/setup-token/,
      "invalid-token copy must use the installer data path",
    );
    assert.match(
      install,
      /^KEYPAGE_DIR="\$\{KEYPAGE_DIR:-\$HOME\/keypage\}"$/m,
      "installer default must be ~/keypage",
    );
    assert.match(install, /\$\{KEYPAGE_DIR\}\/data\/setup-token/);
  });

  it("does not tell operators to grep logs or cat ./data/setup-token", () => {
    for (const relativePath of walkOperatorFiles(repoRoot)) {
      const text = fs.readFileSync(relativePath, "utf8");
      const label = path.relative(repoRoot, relativePath);
      assert.equal(
        text.includes("./data/setup-token"),
        false,
        `${label} still mentions ./data/setup-token`,
      );
      assert.doesNotMatch(
        text,
        /printed in the server log/i,
        `${label} still claims the token is printed in the server log`,
      );
      assert.doesNotMatch(
        text,
        /docker compose logs[^\n]*\|\s*grep/,
        `${label} still greps compose logs for the setup token`,
      );
      assert.doesNotMatch(
        text,
        /grep\s+-A4\s+['"]setup token['"]/,
        `${label} still documents grep -A4 'setup token'`,
      );
    }
  });
});

function* walkOperatorFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkOperatorFiles(full);
      continue;
    }
    if (/\.(md|tsx?|sh)$/.test(entry.name) && !entry.name.includes(".test.")) {
      yield full;
    }
  }
}
