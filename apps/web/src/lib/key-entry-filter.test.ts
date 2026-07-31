import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntry } from "@keypage/shared";

import {
  collectTagFacets,
  filterByQuery,
  filterByTags,
  queryTokens,
  serviceDisplayName,
  toTagKey,
  toggleTagKey,
} from "./key-entry-filter.ts";

const CIPHER = {
  algorithm: "aes-256-gcm" as const,
  ivB64: "AAAAAAAAAAAAAAAA",
  ciphertextB64: "BBBBBBBBBBBBBBBBBBBB",
  keyVersion: 1,
};

function makeEntry(overrides: Partial<KeyEntry> = {}): KeyEntry {
  return {
    id: "entry-1",
    label: "Production API",
    serviceId: "openai",
    customServiceName: null,
    description: "Main billing account",
    tags: ["prod"],
    cipher: CIPHER,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

describe("serviceDisplayName", () => {
  it("uses catalog display name for known services", () => {
    assert.equal(
      serviceDisplayName({ serviceId: "github", customServiceName: null }),
      "GitHub",
    );
  });

  it("uses customServiceName when serviceId is custom and name is set", () => {
    assert.equal(
      serviceDisplayName({
        serviceId: "custom",
        customServiceName: "Internal CRM",
      }),
      "Internal CRM",
    );
  });

  it("falls back to catalog display name for custom without a name", () => {
    assert.equal(
      serviceDisplayName({ serviceId: "custom", customServiceName: null }),
      "Custom",
    );
  });
});

describe("toTagKey", () => {
  it("trims and lowercases tags", () => {
    assert.equal(toTagKey("  Prod "), "prod");
  });
});

describe("queryTokens", () => {
  it("returns no tokens for blank input", () => {
    assert.deepEqual(queryTokens(""), []);
    assert.deepEqual(queryTokens("   "), []);
  });

  it("splits on whitespace after trimming", () => {
    assert.deepEqual(queryTokens("  foo   bar  "), ["foo", "bar"]);
  });
});

describe("filterByQuery", () => {
  const entries = [
    makeEntry({
      id: "a",
      label: "Prod OpenAI",
      serviceId: "openai",
      description: "Primary",
      tags: ["billing"],
    }),
    makeEntry({
      id: "b",
      label: "Staging",
      serviceId: "custom",
      customServiceName: "Legacy Gateway",
      description: "Fallback",
      tags: ["staging"],
    }),
    makeEntry({
      id: "c",
      label: "GitHub deploy",
      serviceId: "github",
      description: null,
      tags: ["ci"],
    }),
  ];

  it("returns all entries when the query is empty", () => {
    assert.deepEqual(filterByQuery(entries, ""), entries);
    assert.deepEqual(filterByQuery(entries, "   "), entries);
  });

  it("matches case-insensitively across label, service, serviceId, and description", () => {
    assert.deepEqual(
      filterByQuery(entries, "openai").map((entry) => entry.id),
      ["a"],
    );
    assert.deepEqual(
      filterByQuery(entries, "LEGACY").map((entry) => entry.id),
      ["b"],
    );
    assert.deepEqual(
      filterByQuery(entries, "github").map((entry) => entry.id),
      ["c"],
    );
    assert.deepEqual(
      filterByQuery(entries, "primary").map((entry) => entry.id),
      ["a"],
    );
  });

  it("requires every token to match", () => {
    assert.deepEqual(
      filterByQuery(entries, "prod openai").map((entry) => entry.id),
      ["a"],
    );
    assert.deepEqual(filterByQuery(entries, "prod github"), []);
  });

  it("does not search tags", () => {
    assert.deepEqual(filterByQuery(entries, "billing"), []);
    assert.deepEqual(filterByQuery(entries, "ci"), []);
  });
});

describe("filterByTags", () => {
  const entries = [
    makeEntry({ id: "a", tags: ["prod", "billing"] }),
    makeEntry({ id: "b", tags: ["prod", "ops"] }),
    makeEntry({ id: "c", tags: ["staging"] }),
  ];

  it("returns all entries when no tags are selected", () => {
    assert.deepEqual(filterByTags(entries, []), entries);
  });

  it("filters by a single tag using case-insensitive keys", () => {
    assert.deepEqual(
      filterByTags(entries, ["prod"]).map((entry) => entry.id),
      ["a", "b"],
    );
    assert.deepEqual(
      filterByTags(entries, [toTagKey("PROD")]).map((entry) => entry.id),
      ["a", "b"],
    );
  });

  it("requires every selected tag (AND semantics)", () => {
    assert.deepEqual(
      filterByTags(entries, ["prod", "billing"]).map((entry) => entry.id),
      ["a"],
    );
    assert.deepEqual(filterByTags(entries, ["prod", "staging"]), []);
  });
});

describe("collectTagFacets", () => {
  it("groups tags case-insensitively and keeps first-seen label casing", () => {
    const facets = collectTagFacets([
      makeEntry({ tags: ["Prod", "Billing"] }),
      makeEntry({ tags: ["prod", "ops"] }),
      makeEntry({ tags: ["Staging"] }),
    ]);

    assert.deepEqual(facets, [
      { key: "billing", label: "Billing", count: 1 },
      { key: "ops", label: "ops", count: 1 },
      { key: "prod", label: "Prod", count: 2 },
      { key: "staging", label: "Staging", count: 1 },
    ]);
  });

  it("counts each tag once per entry", () => {
    const facets = collectTagFacets([
      makeEntry({ tags: ["prod", "Prod", "PROD"] }),
    ]);

    assert.deepEqual(facets, [{ key: "prod", label: "prod", count: 1 }]);
  });
});

describe("toggleTagKey", () => {
  it("adds a key when it is not selected", () => {
    assert.deepEqual(toggleTagKey(["prod"], "billing"), ["prod", "billing"]);
  });

  it("removes a key when it is already selected", () => {
    assert.deepEqual(toggleTagKey(["prod", "billing"], "prod"), ["billing"]);
  });
});
