import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_GROUPS,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-code.js";

describe("recovery code constants", () => {
  it("uses Crockford-style alphabet and grouping", () => {
    assert.equal(RECOVERY_CODE_GROUPS, 4);
    assert.equal(RECOVERY_CODE_GROUP_LENGTH, 5);
    assert.ok(!RECOVERY_CODE_ALPHABET.includes("I"));
    assert.ok(!RECOVERY_CODE_ALPHABET.includes("L"));
    assert.ok(!RECOVERY_CODE_ALPHABET.includes("O"));
  });
});

describe("normalizeRecoveryCode", () => {
  it("uppercases, strips separators, and Crockford-maps ambiguous chars", () => {
    assert.equal(
      normalizeRecoveryCode("3f7kq-9mtxb-2wvhd-8zcrn"),
      "3F7KQ9MTXB2WVHD8ZCRN",
    );
    assert.equal(
      normalizeRecoveryCode("3F7KO9MTIB2WVHD8ZCRN"),
      "3F7K09MT1B2WVHD8ZCRN",
    );
  });

  it("returns null for wrong length or invalid characters", () => {
    assert.equal(normalizeRecoveryCode("short"), null);
    assert.equal(normalizeRecoveryCode("3F7KQ9MTXB2WVHD8ZCRNU"), null);
    assert.equal(normalizeRecoveryCode("3F7KQ9MTXB2WVHD8ZCR!"), null);
  });
});

describe("formatRecoveryCode", () => {
  it("inserts dashes between fixed-width groups", () => {
    assert.equal(
      formatRecoveryCode("3F7KQ9MTXB2WVHD8ZCRN"),
      "3F7KQ-9MTXB-2WVHD-8ZCRN",
    );
  });
});
