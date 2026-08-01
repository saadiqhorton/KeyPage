import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  resolveClipboardClearMs,
} from "./clipboard-timeout.ts";

describe("resolveClipboardClearMs", () => {
  it("defaults for undefined and null", () => {
    assert.equal(
      resolveClipboardClearMs(undefined),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS * 1000,
    );
    assert.equal(
      resolveClipboardClearMs(null),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS * 1000,
    );
  });

  it("clamps below the minimum", () => {
    assert.equal(
      resolveClipboardClearMs(CLIPBOARD_CLEAR_SECONDS_MIN - 1),
      CLIPBOARD_CLEAR_SECONDS_MIN * 1000,
    );
  });

  it("clamps above the maximum", () => {
    assert.equal(
      resolveClipboardClearMs(CLIPBOARD_CLEAR_SECONDS_MAX + 100),
      CLIPBOARD_CLEAR_SECONDS_MAX * 1000,
    );
  });

  it("passes through a valid value as milliseconds", () => {
    assert.equal(resolveClipboardClearMs(45), 45_000);
  });
});
