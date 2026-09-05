import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as rows from "./rows.ts";

describe("db row module", () => {
  it("erases TypeScript row types so the runtime export surface is empty", () => {
    assert.equal(typeof rows, "object");
    assert.deepEqual(Object.keys(rows), []);
  });
});
