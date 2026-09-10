import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntry } from "@keypage/shared";

import { filterByQuery, filterByTags } from "./key-entry-filter.ts";
import {
  applyVisibleReorder,
  dropVisibleEntry,
  moveVisibleEntry,
} from "./key-entry-order.ts";

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

describe("applyVisibleReorder", () => {
  it("reorders only visible slots and leaves hidden ids in place", () => {
    assert.deepEqual(
      applyVisibleReorder(["a", "b", "c", "d", "e"], ["a", "c", "e"], ["e", "a", "c"]),
      ["e", "b", "a", "d", "c"],
    );
  });

  it("returns the full list when every id is visible", () => {
    assert.deepEqual(
      applyVisibleReorder(["a", "b", "c"], ["a", "b", "c"], ["c", "a", "b"]),
      ["c", "a", "b"],
    );
  });
});

describe("moveVisibleEntry", () => {
  it("moves a visible id up or down and keeps hidden ids stable", () => {
    assert.deepEqual(
      moveVisibleEntry(["a", "b", "c", "d"], ["a", "b", "c", "d"], "c", -1),
      ["a", "c", "b", "d"],
    );
    assert.deepEqual(
      moveVisibleEntry(["a", "b", "c", "d"], ["a", "c"], "c", -1),
      ["c", "b", "a", "d"],
    );
    assert.deepEqual(
      moveVisibleEntry(["a", "b", "c"], ["a", "b", "c"], "a", 1),
      ["b", "a", "c"],
    );
  });

  it("no-ops at the ends of the visible list", () => {
    assert.deepEqual(
      moveVisibleEntry(["a", "b", "c"], ["a", "b", "c"], "a", -1),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      moveVisibleEntry(["a", "b", "c"], ["a", "b", "c"], "c", 1),
      ["a", "b", "c"],
    );
  });
});

describe("dropVisibleEntry", () => {
  it("moves the dragged visible id onto the target slot", () => {
    assert.deepEqual(
      dropVisibleEntry(["a", "b", "c", "d"], ["a", "c", "d"], "d", "a"),
      ["d", "b", "a", "c"],
    );
  });
});

describe("search and tag filters keep persisted order", () => {
  const entries = [
    makeEntry({ id: "z", label: "Zebra OpenAI", tags: ["prod"] }),
    makeEntry({ id: "a", label: "Alpha OpenAI", tags: ["prod", "ops"] }),
    makeEntry({ id: "m", label: "Middle Stripe", serviceId: "stripe", tags: ["ops"] }),
  ];

  it("does not re-sort query matches by name", () => {
    assert.deepEqual(
      filterByQuery(entries, "openai").map((entry) => entry.id),
      ["z", "a"],
    );
  });

  it("does not re-sort tag matches by name", () => {
    assert.deepEqual(
      filterByTags(entries, ["prod"]).map((entry) => entry.id),
      ["z", "a"],
    );
  });
});
