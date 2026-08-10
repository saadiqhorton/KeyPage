import { createContext, useContext } from "react";

import type { KdfParams, LockoutState } from "@keypage/shared";

export type LockReason =
  | "initial"
  | "idle"
  | "manual"
  | "session_expired"
  /** The vault was re-keyed elsewhere, so this tab's key can no longer be used. */
  | "rekeyed";

export type VaultState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "setup_required" }
  | {
      phase: "locked";
      reason: LockReason;
      idleTimeoutSeconds: number;
      kdf: KdfParams;
      keyVersion: number;
      lockout: LockoutState;
      recoveryCodesRemaining: number;
      recoveryLockout: LockoutState;
    }
  | { phase: "working"; label: string }
  | { phase: "unlocked"; idleTimeoutSeconds: number };

export type RecoveryCodesReason =
  | "setup"
  | "recovery"
  | "password_change"
  | "regen";

export type WizardState =
  | { kind: "none" }
  | { kind: "setup"; step: 1 | 3 }
  | { kind: "recovery"; step: 1 | 2 }
  | { kind: "codes"; codes: string[]; reason: RecoveryCodesReason };

export type RecoveryCodesAckOutcome = {
  navigateTo: "/setup" | "/" | "/settings";
};

export type VaultActions = {
  refreshStatus(): Promise<void>;
  startSetup(): void;
  submitSetup(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(reason: LockReason): Promise<void>;
  /** Lock this tab only — does not broadcast to other tabs or revoke the session. */
  lockLocal(reason: LockReason): Promise<void>;
  startRecovery(): void;
  claimRecoveryCode(code: string): Promise<void>;
  completeRecovery(newPassword: string): Promise<void>;
  changeMasterPassword(
    currentPassword: string,
    newPassword: string,
    onProgress?: (label: string) => void,
  ): Promise<void>;
  regenerateRecoveryCodes(
    password: string,
    onProgress?: (label: string) => void,
  ): Promise<void>;
  acknowledgeRecoveryCodes(): RecoveryCodesAckOutcome;
  finishWizard(): void;
  cancelRecovery(): void;
};

export type VaultContextValue = {
  state: VaultState;
  wizard: WizardState;
  actions: VaultActions;
  /** True while a mint that will issue recovery codes is in flight. */
  issuingRecoveryCodes: boolean;
};

export const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return value;
}
