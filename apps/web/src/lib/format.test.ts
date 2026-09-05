import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatKeyCount } from "./format.js";

describe("formatKeyCount", () => {
  it("uses singular copy for one key", () => {
    assert.equal(formatKeyCount(1), "1 key");
  });

  it("uses plural copy for zero keys", () => {
    assert.equal(formatKeyCount(0), "0 keys");
  });

  it("uses plural copy for multiple keys", () => {
    assert.equal(formatKeyCount(4), "4 keys");
  });
});
