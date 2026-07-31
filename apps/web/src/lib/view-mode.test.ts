import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_KEY_ENTRY_VIEW,
  KEY_ENTRY_VIEW_STORAGE_KEY,
  KEY_ENTRY_VIEWS,
  parseKeyEntryView,
} from "./view-mode.ts";

describe("view-mode constants", () => {
  it("exposes the supported views and defaults", () => {
    assert.deepEqual(KEY_ENTRY_VIEWS, ["grid", "table", "list"]);
    assert.equal(DEFAULT_KEY_ENTRY_VIEW, "grid");
    assert.equal(KEY_ENTRY_VIEW_STORAGE_KEY, "keypage:v1:dashboard-view");
  });
});

describe("parseKeyEntryView", () => {
  it("accepts exact view members", () => {
    assert.equal(parseKeyEntryView("grid"), "grid");
    assert.equal(parseKeyEntryView("table"), "table");
    assert.equal(parseKeyEntryView("list"), "list");
  });

  it("rejects unknown, null, and undefined values", () => {
    assert.equal(parseKeyEntryView("cards"), null);
    assert.equal(parseKeyEntryView(""), null);
    assert.equal(parseKeyEntryView(null), null);
    assert.equal(parseKeyEntryView(undefined), null);
  });
});
