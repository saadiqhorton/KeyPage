import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_GROUPS,
} from "@keypage/shared";

const VALID_NORMALIZED = "3F7KQ9MTXB2WVHD8ZCRN";

describe("recovery code helpers", () => {
  it("normalizes lowercase input with dashes and whitespace", () => {
    assert.equal(
      normalizeRecoveryCode("  3f7kq-9mtxb-2wvhd-8zcrn  "),
      VALID_NORMALIZED,
    );
  });

  it("maps Crockford ambiguous letters O, I, and L", () => {
    assert.equal(
      normalizeRecoveryCode("3F7KQ9MTXB2WVHD8ZCRN".replace("0", "O")),
      VALID_NORMALIZED,
    );
    assert.equal(
      normalizeRecoveryCode("3F7KQ9MTXB2WVHD8ZCRN".replace("1", "I")),
      VALID_NORMALIZED,
    );
    assert.equal(
      normalizeRecoveryCode("3F7KQ9MTXB2WVHD8ZCRN".replace("1", "L")),
      VALID_NORMALIZED,
    );
  });

  it("formats a normalized code into grouped segments", () => {
    assert.equal(formatRecoveryCode(VALID_NORMALIZED), "3F7KQ-9MTXB-2WVHD-8ZCRN");
  });

  it("rejects codes with the wrong length", () => {
    const tooShort = "A".repeat(
      RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH - 1,
    );
    const tooLong = "A".repeat(
      RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH + 1,
    );

    assert.equal(normalizeRecoveryCode(tooShort), null);
    assert.equal(normalizeRecoveryCode(tooLong), null);
  });

  it("rejects excluded alphabet letters such as U", () => {
    const withExcluded = `${"0".repeat(RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH - 1)}U`;
    assert.equal(normalizeRecoveryCode(withExcluded), null);
  });
});
