import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const INSTALLER_TOKEN_CAT = "cat ~/keypage/data/setup-token";
const CLONE_TOKEN_CAT = "cat ./data/setup-token";
const IN_CONTAINER_TOKEN_CAT = "docker compose exec keypage cat /app/data/setup-token";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fencedBlockAfter(source: string, heading: RegExp): string | undefined {
  const headingMatch = heading.exec(source);
  if (!headingMatch) {
    return undefined;
  }
  const fromHeading = source.slice(headingMatch.index);
  return fromHeading.match(/```bash\n([\s\S]*?)```/)?.[1];
}

describe("setup-token operator copy (SAA-225)", () => {
  it("splits installer vs clone retrieval paths", () => {
    const readme = readRepoFile("README.md");
    const setupScreen = readRepoFile("apps/web/src/screens/SetupScreen.tsx");
    const vaultProvider = readRepoFile("apps/web/src/vault/VaultProvider.tsx");
    const install = readRepoFile("scripts/install.sh");

    const checkoutBlock = fencedBlockAfter(
      readme,
      /Already have the repo checked out\?/,
    );
    assert.ok(checkoutBlock, "README must have a clone/checkout compose snippet");
    assert.match(
      checkoutBlock,
      new RegExp(CLONE_TOKEN_CAT.replaceAll("/", "\\/")),
      "clone/checkout snippet must cat ./data/setup-token",
    );
    assert.equal(
      checkoutBlock.includes(INSTALLER_TOKEN_CAT),
      false,
      "clone/checkout snippet must not use the installer ~/keypage path",
    );
    assert.doesNotMatch(checkoutBlock, /^cd ~\/keypage$/m);

    assert.match(
      readme,
      /Setup token after the one-line installer: `cat ~\/keypage\/data\/setup-token`/,
    );
    assert.match(readme, /cat \$\{KEYPAGE_DIR\}\/data\/setup-token/);
    assert.match(
      readme,
      /installer default `~\/keypage\/data\/setup-token`/,
    );
    assert.match(
      readme,
      /Repo checkout \/ `docker compose` from the clone: `cat \.\/data\/setup-token`/,
    );
    assert.match(
      readme,
      new RegExp(IN_CONTAINER_TOKEN_CAT.replaceAll("/", "\\/")),
    );

    assert.match(
      setupScreen,
      new RegExp(INSTALLER_TOKEN_CAT.replaceAll("/", "\\/")),
    );
    assert.match(setupScreen, /installer default/);
    assert.match(
      setupScreen,
      new RegExp(IN_CONTAINER_TOKEN_CAT.replaceAll("/", "\\/")),
    );
    assert.match(
      vaultProvider,
      /~\/keypage\/data\/setup-token \(installer default\)/,
    );
    assert.match(
      vaultProvider,
      new RegExp(IN_CONTAINER_TOKEN_CAT.replaceAll("/", "\\/")),
    );

    assert.match(
      install,
      /^KEYPAGE_DIR="\$\{KEYPAGE_DIR:-\$HOME\/keypage\}"$/m,
      "installer default must be ~/keypage",
    );
    assert.match(install, /\$\{KEYPAGE_DIR\}\/data\/setup-token/);
  });

  it("does not tell operators to grep logs for the setup token", () => {
    for (const relativePath of walkOperatorFiles(repoRoot)) {
      const text = fs.readFileSync(relativePath, "utf8");
      const label = path.relative(repoRoot, relativePath);
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
