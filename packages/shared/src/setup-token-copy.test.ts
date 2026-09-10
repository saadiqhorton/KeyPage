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

const OPERATOR_SOURCES = [
  "README.md",
  "scripts/install.sh",
  "apps/web/src/screens/SetupScreen.tsx",
  "apps/web/src/vault/VaultProvider.tsx",
] as const;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("setup-token operator copy (SAA-225)", () => {
  it("points operators at cat ~/keypage/data/setup-token", () => {
    const readme = readRepoFile("README.md");
    const setupScreen = readRepoFile("apps/web/src/screens/SetupScreen.tsx");
    const vaultProvider = readRepoFile("apps/web/src/vault/VaultProvider.tsx");
    const install = readRepoFile("scripts/install.sh");

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
    for (const relativePath of OPERATOR_SOURCES) {
      const text = readRepoFile(relativePath);
      assert.doesNotMatch(
        text,
        /\.\/data\/setup-token/,
        `${relativePath} still mentions ./data/setup-token`,
      );
      assert.doesNotMatch(
        text,
        /printed in the server log/i,
        `${relativePath} still claims the token is printed in the server log`,
      );
      assert.doesNotMatch(
        text,
        /docker compose logs[^\n]*\|\s*grep/,
        `${relativePath} still greps compose logs for the setup token`,
      );
      assert.doesNotMatch(
        text,
        /grep\s+-A4\s+['"]setup token['"]/,
        `${relativePath} still documents grep -A4 'setup token'`,
      );
    }
  });
});
