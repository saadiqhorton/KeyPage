import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE, APP_NAME, APP_TAGLINE, APP_VERSION } from "./app.js";

describe("app constants", () => {
  it("exports product metadata", () => {
    assert.equal(APP_NAME, "KeyPage");
    assert.equal(APP_TAGLINE, "Self-hosted API key vault");
    assert.equal(APP_VERSION, "0.1.0");
    assert.equal(API_BASE, "/api");
  });
});
