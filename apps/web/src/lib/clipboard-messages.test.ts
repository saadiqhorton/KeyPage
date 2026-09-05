import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clipboardFailureMessage } from "./clipboard-messages.ts";

describe("clipboardFailureMessage", () => {
  it("returns secure-context guidance for unavailable key entry copy", () => {
    const message = clipboardFailureMessage("unavailable");
    assert.match(message, /HTTPS|localhost/i);
    assert.match(message, /reveal the key and copy it manually/i);
  });

  it("returns blocked guidance for denied key entry copy", () => {
    const message = clipboardFailureMessage("denied");
    assert.match(message, /blocked the clipboard/i);
    assert.match(message, /reveal the key and copy it manually/i);
  });

  it("returns secure-context guidance for unavailable recovery codes copy", () => {
    const message = clipboardFailureMessage("unavailable", "recoveryCodes");
    assert.match(message, /HTTPS|localhost/i);
    assert.match(message, /use Download again/i);
    assert.doesNotMatch(message, /reveal the key/i);
  });

  it("returns blocked guidance for denied recovery codes copy", () => {
    const message = clipboardFailureMessage("denied", "recoveryCodes");
    assert.match(message, /blocked the clipboard/i);
    assert.match(message, /use Download again/i);
    assert.doesNotMatch(message, /reveal the key/i);
  });
});
