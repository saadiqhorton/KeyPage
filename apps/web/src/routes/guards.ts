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
  wizardKind: WizardState["kind"],
): GuardDecision {
  // Freshly issued codes exist only in wizard state, so /recovery-codes owns
  // them until the user acknowledges them. Every other route defers, unlocked
  // or not: otherwise a back navigation or a remount would drop the only copy
  // the user has. This outranks loading/unavailable so a failed refreshStatus
  // cannot hide codes or drop beforeunload protection.
  if (wizardKind === "codes") {
    return guard === "recovery-codes" ? RENDER : redirect("/recovery-codes");
  }

  if (phase === "loading" || phase === "unavailable") {
    return WAIT;
  }

  if (guard === "recovery-codes") {
    // Codes are only ever issued from Settings, so that is where Done lands.
    return redirect("/settings");
  }

  if (guard === "unlocked") {
    if (phase === "unlocked" && wizardKind === "none") {
      return RENDER;
    }
    if (wizardKind === "setup") {
      return redirect("/setup");
    }
    if (wizardKind === "recovery") {
      return redirect("/recover");
    }
    if (phase === "setup_required") {
      return redirect("/setup");
    }
    return redirect("/unlock");
  }

  if (guard === "setup-wizard") {
    if (phase === "setup_required" || wizardKind === "setup") {
      return RENDER;
    }
    if (phase === "unlocked" && wizardKind === "none") {
      return redirect("/");
    }
    return redirect("/unlock");
  }

  if (guard === "recovery-wizard") {
    if (phase === "locked" || wizardKind === "recovery") {
      return RENDER;
    }
    if (phase === "unlocked" && wizardKind === "none") {
      return redirect("/");
    }
    return redirect("/setup");
  }

  if ((phase === "locked" || phase === "working") && wizardKind === "none") {
    return RENDER;
  }
  if (wizardKind === "setup") {
    return redirect("/setup");
  }
  if (wizardKind === "recovery") {
    return redirect("/recover");
  }
  if (phase === "unlocked") {
    return redirect("/");
  }
  return redirect("/setup");
}
