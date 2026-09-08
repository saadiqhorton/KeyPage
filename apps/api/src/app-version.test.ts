import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { APP_PACKAGE_VERSION, readAppVersion } from "./app-version.js";

const apiPackageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../package.json",
);

function versionFromApiPackageJson(): string {
  const pkg = JSON.parse(fs.readFileSync(apiPackageJsonPath, "utf8")) as {
    version?: unknown;
  };
  assert.equal(typeof pkg.version, "string");
  assert.notEqual(pkg.version, "");
  return pkg.version as string;
}

describe("readAppVersion", () => {
  it("returns the version field from @keypage/api package.json", () => {
    const fromPackage = versionFromApiPackageJson();
    assert.equal(APP_PACKAGE_VERSION, fromPackage);
    assert.equal(readAppVersion(), APP_PACKAGE_VERSION);
  });
});
