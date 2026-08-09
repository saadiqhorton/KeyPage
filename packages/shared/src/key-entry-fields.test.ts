import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "./key-entries.js";
import {
  KeyEntryFieldError,
  collectKeyEntryFieldIssues,
  isKnownServiceId,
  normalizeDescription,
  normalizeKeyEntryWriteFields,
  normalizeLabel,
  normalizeTags,
  normalizeTagsCapped,
  resolveServiceForImport,
  validateService,
} from "./key-entry-fields.js";

function assertFieldError(fn: () => void, field: string): void {
  try {
    fn();
    assert.fail("expected KeyEntryFieldError");
  } catch (error) {
    assert.ok(error instanceof KeyEntryFieldError);
    assert.ok(
      error.details.some((detail) => detail.field === field),
      `expected detail for ${field}`,
    );
  }
}

describe("normalizeLabel", () => {
  it("trims and accepts a valid label", () => {
    assert.equal(normalizeLabel("  Production  "), "Production");
  });

  it("rejects empty and oversized labels", () => {
    assertFieldError(() => normalizeLabel("   "), "label");
    assertFieldError(
      () => normalizeLabel("x".repeat(KEY_ENTRY_LABEL_MAX + 1)),
      "label",
    );
  });
});

describe("normalizeDescription", () => {
  it("maps undefined and blank to null", () => {
    assert.equal(normalizeDescription(undefined), null);
    assert.equal(normalizeDescription("   "), null);
  });

  it("trims a non-empty description", () => {
    assert.equal(normalizeDescription("  hello  "), "hello");
  });

  it("rejects oversized descriptions", () => {
    assertFieldError(
      () => normalizeDescription("x".repeat(KEY_ENTRY_DESCRIPTION_MAX + 1)),
      "description",
    );
  });
});

describe("normalizeTags", () => {
  it("dedupes case-insensitively and preserves first casing", () => {
    assert.deepEqual(normalizeTags([" alpha ", "Alpha", "beta"]), [
      "alpha",
      "beta",
    ]);
  });

  it("caps unique count and rejects oversize tags", () => {
    const tags = normalizeTags([
      "alpha",
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

    assertFieldError(
      () =>
        normalizeTags([
          ...tags,
          "overflow",
        ]),
      "tags",
    );

    assertFieldError(
      () => normalizeTags(["x".repeat(KEY_ENTRY_TAG_MAX + 1)]),
      "tags",
    );
  });
});

describe("normalizeTagsCapped", () => {
  it("caps count instead of throwing", () => {
    const tags = normalizeTagsCapped(["a", "b", "c", "d"], 3);
    assert.deepEqual(tags, ["a", "b", "c"]);
  });

  it("rejects oversized tags instead of silently dropping them", () => {
    assertFieldError(
      () =>
        normalizeTagsCapped([
          "ok",
          "x".repeat(KEY_ENTRY_TAG_MAX + 1),
        ]),
      "tags",
    );
  });
});

describe("validateService", () => {
  it("rejects unknown service ids", () => {
    assert.equal(isKnownServiceId("openai"), true);
    assert.equal(isKnownServiceId("not-a-service"), false);
    assertFieldError(
      () => validateService("not-a-service", undefined),
      "serviceId",
    );
  });

  it("requires a non-blank custom name for custom", () => {
    assertFieldError(() => validateService("custom", "   "), "customServiceName");
    assert.equal(
      validateService("custom", "  Acme  ").customServiceName,
      "Acme",
    );
  });

  it("rejects customServiceName on catalog services", () => {
    assertFieldError(
      () => validateService("openai", "nope"),
      "customServiceName",
    );
  });

  it("rejects oversized custom names", () => {
    assertFieldError(
      () =>
        validateService(
          "custom",
          "x".repeat(KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX + 1),
        ),
      "customServiceName",
    );
  });
});

describe("resolveServiceForImport", () => {
  it("keeps known catalog ids", () => {
    assert.deepEqual(resolveServiceForImport("openai", null), {
      serviceId: "openai",
    });
    assert.deepEqual(resolveServiceForImport("custom", "Acme"), {
      serviceId: "custom",
      customServiceName: "Acme",
    });
  });

  it("remaps unknown ids to custom", () => {
    assert.deepEqual(resolveServiceForImport("legacy-provider", null), {
      serviceId: "custom",
      customServiceName: "legacy-provider",
    });
    assert.deepEqual(
      resolveServiceForImport("legacy-provider", "  Friendly  "),
      {
        serviceId: "custom",
        customServiceName: "Friendly",
      },
    );
  });
});

describe("collectKeyEntryFieldIssues", () => {
  it("returns every issue for multi-bad input", () => {
    const issues = collectKeyEntryFieldIssues({
      label: "   ",
      serviceId: "not-a-service",
      customServiceName: "nope",
      description: "x".repeat(KEY_ENTRY_DESCRIPTION_MAX + 1),
      tags: [
        "x".repeat(KEY_ENTRY_TAG_MAX + 1),
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
      ],
    });

    const codes = new Set(issues.map((issue) => issue.code));
    assert.deepEqual(codes, new Set([
      "label.required",
      "description.too_long",
      "tag.too_long",
      "tags.too_many",
      "service.unknown",
    ]));
  });

  it("normalizeKeyEntryWriteFields throws with the same details", () => {
    const input = {
      label: "   ",
      serviceId: "not-a-service",
      description: "x".repeat(KEY_ENTRY_DESCRIPTION_MAX + 1),
      tags: ["x".repeat(KEY_ENTRY_TAG_MAX + 1)],
    };
    const collected = collectKeyEntryFieldIssues(input);

    try {
      normalizeKeyEntryWriteFields(input);
      assert.fail("expected KeyEntryFieldError");
    } catch (error) {
      assert.ok(error instanceof KeyEntryFieldError);
      assert.deepEqual(
        new Set(error.details.map((detail) => detail.code)),
        new Set(collected.map((detail) => detail.code)),
      );
    }
  });
});

describe("normalizeKeyEntryWriteFields", () => {
  it("normalizes the full write payload once", () => {
    const fields = normalizeKeyEntryWriteFields({
      label: "  Label  ",
      serviceId: "custom",
      customServiceName: "  Acme  ",
      description: "  desc  ",
      tags: [" Prod ", "prod", "staging"],
    });

    assert.deepEqual(fields, {
      label: "Label",
      serviceId: "custom",
      customServiceName: "Acme",
      description: "desc",
      tags: ["Prod", "staging"],
    });
  });

  it("agrees with resolveServiceForImport + validateService for unknowns", () => {
    const resolved = resolveServiceForImport("old-vendor", "Old Vendor");
    const fields = normalizeKeyEntryWriteFields({
      label: "Key",
      serviceId: resolved.serviceId,
      customServiceName: resolved.customServiceName,
      tags: [],
    });
    assert.equal(fields.serviceId, "custom");
    assert.equal(fields.customServiceName, "Old Vendor");
  });
});
