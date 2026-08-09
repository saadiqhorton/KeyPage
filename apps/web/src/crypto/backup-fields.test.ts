import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAGS_MAX,
  normalizeKeyEntryWriteFields,
  normalizeTags,
  resolveServiceForImport,
  validateService,
} from "@keypage/shared";

describe("backup field rules agree with shared write rules", () => {
  it("accepts the same tag normalization the server uses", () => {
    const tags = normalizeTags([
      " alpha ",
      "Alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
    ]);
    assert.equal(tags.length, KEY_ENTRY_TAGS_MAX);
    assert.deepEqual(tags.slice(0, 3), ["alpha", "beta", "gamma"]);
  });

  it("remaps unknown backup service ids then validates like the server", () => {
    const resolved = resolveServiceForImport("legacy-vendor", null);
    const fields = normalizeKeyEntryWriteFields({
      label: "Legacy",
      serviceId: resolved.serviceId,
      customServiceName: resolved.customServiceName,
      tags: ["prod"],
    });
    assert.equal(fields.serviceId, "custom");
    assert.equal(fields.customServiceName, "legacy-vendor");
    assert.deepEqual(
      validateService(fields.serviceId, fields.customServiceName ?? undefined),
      { customServiceName: "legacy-vendor" },
    );
  });

  it("rejects oversized labels the same way as shared write fields", () => {
    assert.throws(() =>
      normalizeKeyEntryWriteFields({
        label: "x".repeat(KEY_ENTRY_LABEL_MAX + 1),
        serviceId: "openai",
        tags: [],
      }),
    );
  });
});
