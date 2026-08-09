import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isRecoveryCodesMintInFlight,
  isRecoveryCodesParked,
  recoveryCodesExposurePending,
} from "./recovery-codes-pending.ts";

describe("recovery-codes-pending", () => {
  it("isRecoveryCodesParked is true only for kind codes", () => {
    assert.equal(
      isRecoveryCodesParked({
        kind: "codes",
        codes: ["a"],
        reason: "setup",
      }),
      true,
    );
    assert.equal(isRecoveryCodesParked({ kind: "none" }), false);
    assert.equal(isRecoveryCodesParked({ kind: "setup", step: 1 }), false);
    assert.equal(isRecoveryCodesParked({ kind: "recovery", step: 2 }), false);
  });

  it("isRecoveryCodesMintInFlight mirrors the issuing flag", () => {
    assert.equal(isRecoveryCodesMintInFlight(true), true);
    assert.equal(isRecoveryCodesMintInFlight(false), false);
  });

  it("recoveryCodesExposurePending covers parked codes and mint in flight", () => {
    const parked = {
      kind: "codes" as const,
      codes: ["a"],
      reason: "regen" as const,
    };
    assert.equal(recoveryCodesExposurePending(parked, false), true);
    assert.equal(recoveryCodesExposurePending({ kind: "none" }, true), true);
    assert.equal(recoveryCodesExposurePending({ kind: "none" }, false), false);
    assert.equal(
      recoveryCodesExposurePending({ kind: "setup", step: 1 }, false),
      false,
    );
  });
});
