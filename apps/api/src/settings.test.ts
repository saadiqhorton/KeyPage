import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
} from "@keypage/shared";

import { clampClipboardClearSeconds } from "./settings.js";

describe("clampClipboardClearSeconds", () => {
  it("clamps below min", () => {
    assert.equal(clampClipboardClearSeconds(0), CLIPBOARD_CLEAR_SECONDS_MIN);
    assert.equal(clampClipboardClearSeconds(4), CLIPBOARD_CLEAR_SECONDS_MIN);
  });

  it("clamps above max", () => {
    assert.equal(clampClipboardClearSeconds(301), CLIPBOARD_CLEAR_SECONDS_MAX);
    assert.equal(clampClipboardClearSeconds(1000), CLIPBOARD_CLEAR_SECONDS_MAX);
  });

  it("rounds non-integer values", () => {
    assert.equal(clampClipboardClearSeconds(29.4), 29);
    assert.equal(clampClipboardClearSeconds(29.6), 30);
  });

  it("passes exact default through", () => {
    assert.equal(
      clampClipboardClearSeconds(DEFAULT_CLIPBOARD_CLEAR_SECONDS),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    );
  });
});
