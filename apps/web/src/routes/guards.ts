import { isRecoveryCodesParked } from "@/vault/recovery-codes-pending.js";
import type { VaultState, WizardState } from "@/vault/useVault.js";

export type RouteGuard =
  | "unlocked"
  | "recovery-codes"
  | "setup-wizard"
  | "recovery-wizard"
  | "locked";

export type GuardDecision =
  | { kind: "render" }
  | { kind: "wait" }
  | { kind: "redirect"; to: string };

const RENDER: GuardDecision = { kind: "render" };
const WAIT: GuardDecision = { kind: "wait" };

function redirect(to: string): GuardDecision {
  return { kind: "redirect", to };
}

/**
 * Decides what a route should do for a given vault phase and wizard state.
 *
 * Kept free of React so the routing invariants — above all "freshly issued
 * recovery codes outrank loading/unavailable" — can be asserted directly in
 * tests.
 */
export function resolveGuard(
  guard: RouteGuard,
  phase: VaultState["phase"],
  wizard: WizardState,
): GuardDecision {
  if (isRecoveryCodesParked(wizard)) {
    return guard === "recovery-codes" ? RENDER : redirect("/recovery-codes");
  }

  if (phase === "loading" || phase === "unavailable") {
    return WAIT;
  }

  if (guard === "recovery-codes") {
    // Fallback when nothing parked (stale URL / post-ack race)
    if (wizard.kind === "setup" && wizard.step === 3) {
      return redirect("/setup");
    }
    if (phase === "unlocked") {
      return redirect("/settings");
    }
    return redirect("/unlock");
  }

  if (guard === "unlocked") {
    if (phase === "unlocked" && wizard.kind === "none") {
      return RENDER;
    }
    if (wizard.kind === "setup") {
      return redirect("/setup");
    }
    if (wizard.kind === "recovery") {
      return redirect("/recover");
    }
    if (phase === "setup_required") {
      return redirect("/setup");
    }
    return redirect("/unlock");
  }

  if (guard === "setup-wizard") {
    if (phase === "setup_required" || wizard.kind === "setup") {
      return RENDER;
    }
    if (phase === "unlocked" && wizard.kind === "none") {
      return redirect("/");
    }
    return redirect("/unlock");
  }

  if (guard === "recovery-wizard") {
    if (phase === "locked" || wizard.kind === "recovery") {
      return RENDER;
    }
    if (phase === "unlocked" && wizard.kind === "none") {
      return redirect("/");
    }
    return redirect("/setup");
  }

  if ((phase === "locked" || phase === "working") && wizard.kind === "none") {
    return RENDER;
  }
  if (wizard.kind === "setup") {
    return redirect("/setup");
  }
  if (wizard.kind === "recovery") {
    return redirect("/recover");
  }
  if (phase === "unlocked") {
    return redirect("/");
  }
  return redirect("/setup");
}
