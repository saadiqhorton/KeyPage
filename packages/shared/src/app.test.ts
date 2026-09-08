import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE, APP_NAME, APP_TAGLINE, DEFAULT_LISTEN_PORT } from "./app.js";

describe("app constants", () => {
  it("exports product metadata", () => {
    assert.equal(APP_NAME, "KeyPage");
    assert.equal(APP_TAGLINE, "Self-hosted API key vault");
    assert.equal(API_BASE, "/api");
    assert.equal(DEFAULT_LISTEN_PORT, 9090);
  });
});
