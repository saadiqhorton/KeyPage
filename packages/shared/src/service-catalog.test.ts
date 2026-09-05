import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SERVICE_CATALOG, getService } from "./service-catalog.js";

describe("SERVICE_CATALOG", () => {
  it("includes unique ids with display metadata", () => {
    const ids = SERVICE_CATALOG.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(SERVICE_CATALOG.some((entry) => entry.id === "openai"));
    assert.ok(SERVICE_CATALOG.some((entry) => entry.id === "custom"));
  });
});

describe("getService", () => {
  it("returns the catalog entry for a known id", () => {
    assert.deepEqual(getService("stripe"), {
      id: "stripe",
      displayName: "Stripe",
      accent: "#635BFF",
    });
  });

  it("falls back to custom for unknown ids", () => {
    assert.deepEqual(getService("not-in-catalog"), {
      id: "custom",
      displayName: "Custom",
      accent: "#6B7280",
    });
  });
});
