import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cn } from "./cn.js";

describe("cn", () => {
  it("joins class names", () => {
    assert.equal(cn("a", "b"), "a b");
  });

  it("drops falsy values", () => {
    assert.equal(cn("keep", false, null, undefined, "also"), "keep also");
  });

  it("merges conflicting tailwind classes", () => {
    assert.equal(cn("p-2", "p-4"), "p-4");
  });
});
