import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WizardState } from "@/vault/useVault.ts";

import { resolveGuard, type RouteGuard } from "./guards.ts";

const ALL_GUARDS: RouteGuard[] = [
  "unlocked",
  "recovery-codes",
  "setup-wizard",
  "recovery-wizard",
  "locked",
];

const NONE: WizardState = { kind: "none" };
const PARKED_CODES: WizardState = {
  kind: "codes",
  codes: ["code-a"],
  reason: "regen",
};

describe("resolveGuard", () => {
  it("waits while the vault status is unknown", () => {
    for (const guard of ALL_GUARDS) {
      assert.deepEqual(resolveGuard(guard, "loading", NONE), {
        kind: "wait",
      });
      assert.deepEqual(resolveGuard(guard, "unavailable", NONE), {
        kind: "wait",
      });
    }
  });

  it("renders pending codes even while loading or unavailable", () => {
    for (const phase of ["loading", "unavailable"] as const) {
      assert.deepEqual(resolveGuard("recovery-codes", phase, PARKED_CODES), {
        kind: "render",
      });
      for (const guard of ALL_GUARDS.filter((it) => it !== "recovery-codes")) {
        assert.deepEqual(
          resolveGuard(guard, phase, PARKED_CODES),
          { kind: "redirect", to: "/recovery-codes" },
          `${guard} while ${phase}`,
        );
      }
    }
  });

  it("sends every other route to /recovery-codes while codes are pending", () => {
    const phases = ["unlocked", "locked", "working", "setup_required"] as const;

    for (const guard of ALL_GUARDS.filter((it) => it !== "recovery-codes")) {
      for (const phase of phases) {
        assert.deepEqual(
          resolveGuard(guard, phase, PARKED_CODES),
          { kind: "redirect", to: "/recovery-codes" },
          `${guard} while ${phase}`,
        );
      }
    }
  });

  it("renders pending codes even when the vault locked underneath them", () => {
    assert.deepEqual(resolveGuard("recovery-codes", "unlocked", PARKED_CODES), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-codes", "locked", PARKED_CODES), {
      kind: "render",
    });
  });

  it("returns to Settings once the codes are acknowledged", () => {
    assert.deepEqual(resolveGuard("recovery-codes", "unlocked", NONE), {
      kind: "redirect",
      to: "/settings",
    });
  });

  it("returns to setup when setup wizard is on step 3 after ack", () => {
    assert.deepEqual(
      resolveGuard("recovery-codes", "unlocked", { kind: "setup", step: 3 }),
      { kind: "redirect", to: "/setup" },
    );
  });

  it("returns to unlock when recovery-codes has no parked codes and vault is locked", () => {
    assert.deepEqual(resolveGuard("recovery-codes", "locked", NONE), {
      kind: "redirect",
      to: "/unlock",
    });
  });

  it("only renders authenticated routes when unlocked and wizard-free", () => {
    assert.deepEqual(resolveGuard("unlocked", "unlocked", NONE), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("unlocked", "locked", NONE), {
      kind: "redirect",
      to: "/unlock",
    });
    assert.deepEqual(resolveGuard("unlocked", "setup_required", NONE), {
      kind: "redirect",
      to: "/setup",
    });
    assert.deepEqual(resolveGuard("unlocked", "unlocked", { kind: "setup", step: 1 }), {
      kind: "redirect",
      to: "/setup",
    });
    assert.deepEqual(resolveGuard("unlocked", "unlocked", { kind: "recovery", step: 1 }), {
      kind: "redirect",
      to: "/recover",
    });
  });

  it("keeps the setup and recovery wizards on their own routes", () => {
    assert.deepEqual(resolveGuard("setup-wizard", "setup_required", NONE), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("setup-wizard", "unlocked", { kind: "setup", step: 1 }), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("setup-wizard", "unlocked", NONE), {
      kind: "redirect",
      to: "/",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "locked", NONE), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "unlocked", { kind: "recovery", step: 2 }), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "unlocked", NONE), {
      kind: "redirect",
      to: "/",
    });
  });

  it("shows the unlock screen only while locked or working", () => {
    assert.deepEqual(resolveGuard("locked", "locked", NONE), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("locked", "working", NONE), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("locked", "unlocked", NONE), {
      kind: "redirect",
      to: "/",
    });
    assert.deepEqual(resolveGuard("locked", "setup_required", NONE), {
      kind: "redirect",
      to: "/setup",
    });
  });
});
