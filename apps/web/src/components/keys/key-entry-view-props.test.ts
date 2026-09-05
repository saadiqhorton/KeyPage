import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as viewProps from "./key-entry-view-props.ts";

describe("key-entry view prop types", () => {
  it("erases reveal/action prop types so the runtime export surface is empty", () => {
    assert.equal(typeof viewProps, "object");
    assert.deepEqual(Object.keys(viewProps), []);
  });
});
