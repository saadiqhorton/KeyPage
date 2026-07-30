import { createContext, useContext } from "react";

import type { KdfParams, LockoutState } from "@keypage/shared";

export type LockReason = "initial" | "idle" | "manual" | "session_expired";

export type VaultState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "setup_required" }
  | {
      phase: "locked";
      reason: LockReason;
      idleTimeoutSeconds: number;
      kdf: KdfParams;
      lockout: LockoutState;
      recoveryCodesRemaining: number;
      recoveryLockout: LockoutState;
    }
  | { phase: "working"; label: string }
  | { phase: "unlocked"; idleTimeoutSeconds: number };

export type WizardState =
  | { kind: "none" }
  | { kind: "setup"; step: 1 | 2 | 3; codes: string[] | null }
  | { kind: "recovery"; step: 1 | 2 | 3; codes: string[] | null };

export type VaultActions = {
  refreshStatus(): Promise<void>;
  startSetup(): void;
  submitSetup(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(reason: LockReason): Promise<void>;
  startRecovery(): void;
  claimRecoveryCode(code: string): Promise<void>;
  completeRecovery(newPassword: string): Promise<void>;
  finishWizard(): void;
  cancelRecovery(): void;
};

export type VaultContextValue = {
  state: VaultState;
  wizard: WizardState;
  actions: VaultActions;
};

export const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return value;
}
