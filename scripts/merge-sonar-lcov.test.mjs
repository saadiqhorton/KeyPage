import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCoverageSource, mergeLcovReports, rewriteSfPath } from "./merge-sonar-lcov.mjs";

describe("rewriteSfPath", () => {
  it("prefixes a package-relative src path with the package root", () => {
    assert.equal(rewriteSfPath("src/auth/vault-repo.ts", "apps/api"), "apps/api/src/auth/vault-repo.ts");
  });

  it("keeps a path that is already repo-relative", () => {
    assert.equal(
      rewriteSfPath("apps/api/src/auth/vault-repo.ts", "apps/api"),
      "apps/api/src/auth/vault-repo.ts",
    );
  });

  it("strips an absolute prefix down to the package root", () => {
    assert.equal(
      rewriteSfPath("/home/runner/work/KeyPage/KeyPage/apps/api/src/auth/vault-repo.ts", "apps/api"),
      "apps/api/src/auth/vault-repo.ts",
    );
  });
});

describe("isCoverageSource", () => {
  it("drops test files that Sonar excludes from sources", () => {
    assert.equal(isCoverageSource("apps/api/src/auth/vault-request.test.ts"), false);
    assert.equal(isCoverageSource("apps/web/src/lib/api.test.ts"), false);
    assert.equal(isCoverageSource("apps/web/src/components/StatusPanel.test.tsx"), false);
  });

  it("keeps production sources", () => {
    assert.equal(isCoverageSource("apps/api/src/auth/vault-repo.ts"), true);
  });

  it("drops compiled workspace dist and parent-traversal coverage paths", () => {
    assert.equal(isCoverageSource("apps/api/../../packages/shared/dist/app.js"), false);
    assert.equal(isCoverageSource("packages/shared/dist/index.js"), false);
  });
});

describe("mergeLcovReports", () => {
  it("rewrites SF paths, drops tests, and concatenates package reports", () => {
    const api = [
      "TN:",
      "SF:src/auth/vault-request.test.ts",
      "DA:1,1",
      "end_of_record",
      "TN:",
      "SF:src/auth/vault-repo.ts",
      "DA:10,1",
      "end_of_record",
      "",
    ].join("\n");
    const web = ["TN:", "SF:src/lib/api.ts", "DA:2,0", "end_of_record", ""].join("\n");

    const merged = mergeLcovReports([
      { packageRoot: "apps/api", lcov: api },
      { packageRoot: "apps/web", lcov: web },
    ]);

    assert.match(merged, /SF:apps\/api\/src\/auth\/vault-repo\.ts/);
    assert.match(merged, /SF:apps\/web\/src\/lib\/api\.ts/);
    assert.doesNotMatch(merged, /vault-request\.test\.ts/);
    assert.doesNotMatch(merged, /^SF:src\//m);
  });
});
