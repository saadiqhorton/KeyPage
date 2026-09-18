import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { APP_PACKAGE_VERSION, readAppVersion, resolveAppVersion } from "./app-version.js";

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

  it("prefers the release version injected into a container image", () => {
    assert.equal(resolveAppVersion("1.0.0", "v1.0.2"), "v1.0.2");
    assert.equal(resolveAppVersion("1.0.0", "  v1.0.2  "), "v1.0.2");
    assert.equal(resolveAppVersion("1.0.0", ""), "1.0.0");
    assert.equal(resolveAppVersion("1.0.0", "operator-override", "v1.0.2"), "v1.0.2");
  });
});
