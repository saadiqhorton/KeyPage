import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGuard, type RouteGuard } from "./guards.ts";

const ALL_GUARDS: RouteGuard[] = [
  "unlocked",
  "recovery-codes",
  "setup-wizard",
  "recovery-wizard",
  "locked",
];

describe("resolveGuard", () => {
  it("waits while the vault status is unknown", () => {
    for (const guard of ALL_GUARDS) {
      assert.deepEqual(resolveGuard(guard, "loading", "none"), {
        kind: "wait",
      });
      assert.deepEqual(resolveGuard(guard, "unavailable", "codes"), {
        kind: "wait",
      });
    }
  });

  it("sends every other route to /recovery-codes while codes are pending", () => {
    const phases = ["unlocked", "locked", "working", "setup_required"] as const;

    for (const guard of ALL_GUARDS.filter((it) => it !== "recovery-codes")) {
      for (const phase of phases) {
        assert.deepEqual(
          resolveGuard(guard, phase, "codes"),
          { kind: "redirect", to: "/recovery-codes" },
          `${guard} while ${phase}`,
        );
      }
    }
  });

  it("renders pending codes even when the vault locked underneath them", () => {
    assert.deepEqual(resolveGuard("recovery-codes", "unlocked", "codes"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-codes", "locked", "codes"), {
      kind: "render",
    });
  });

  it("returns to Settings once the codes are acknowledged", () => {
    assert.deepEqual(resolveGuard("recovery-codes", "unlocked", "none"), {
      kind: "redirect",
      to: "/settings",
    });
  });

  it("only renders authenticated routes when unlocked and wizard-free", () => {
    assert.deepEqual(resolveGuard("unlocked", "unlocked", "none"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("unlocked", "locked", "none"), {
      kind: "redirect",
      to: "/unlock",
    });
    assert.deepEqual(resolveGuard("unlocked", "setup_required", "none"), {
      kind: "redirect",
      to: "/setup",
    });
    assert.deepEqual(resolveGuard("unlocked", "unlocked", "setup"), {
      kind: "redirect",
      to: "/setup",
    });
    assert.deepEqual(resolveGuard("unlocked", "unlocked", "recovery"), {
      kind: "redirect",
      to: "/recover",
    });
  });

  it("keeps the setup and recovery wizards on their own routes", () => {
    assert.deepEqual(resolveGuard("setup-wizard", "setup_required", "none"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("setup-wizard", "unlocked", "setup"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("setup-wizard", "unlocked", "none"), {
      kind: "redirect",
      to: "/",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "locked", "none"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "unlocked", "recovery"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("recovery-wizard", "unlocked", "none"), {
      kind: "redirect",
      to: "/",
    });
  });

  it("shows the unlock screen only while locked or working", () => {
    assert.deepEqual(resolveGuard("locked", "locked", "none"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("locked", "working", "none"), {
      kind: "render",
    });
    assert.deepEqual(resolveGuard("locked", "unlocked", "none"), {
      kind: "redirect",
      to: "/",
    });
    assert.deepEqual(resolveGuard("locked", "setup_required", "none"), {
      kind: "redirect",
      to: "/setup",
    });
  });
});
