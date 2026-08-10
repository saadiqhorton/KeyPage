import type { KeyEntry } from "@keypage/shared";

import { zeroize } from "@/crypto/provider.js";

import { onKeyCleared } from "./session-keys.js";
import type { WizardState } from "./useVault.js";

export type RecoverySessionStart = {
  ticket: string;
  entries: KeyEntry[];
  masterKey: Uint8Array;
};

export type RecoveryAttempt = {
  readonly ticket: string;
  readonly entries: KeyEntry[];
  readonly masterKey: Uint8Array;
  /**
   * Settle a successful reset. Always zeroizes the recovered master key.
   * Returns true only when the session epoch is still the one captured at
   * checkout — false if a lock/clear/supersede invalidated the attempt while
   * the reset was in flight (caller must not leave the vault unlocked).
   */
  succeeded(): boolean;
  failed(): void;
};

export type RecoverySession = {
  start(input: RecoverySessionStart): void;
  isActive(): boolean;
  beginComplete(): RecoveryAttempt | null;
  clear(): void;
};

export function createRecoverySession(): RecoverySession {
  let held: {
    ticket: string;
    entries: KeyEntry[];
    masterKey: Uint8Array;
  } | null = null;
  /** Bumped on start/clear so an in-flight attempt cannot restore after supersede/lock. */
  let epoch = 0;

  return {
    start(input: RecoverySessionStart): void {
      if (held) {
        zeroize(held.masterKey);
      }
      epoch += 1;
      held = {
        ticket: input.ticket,
        entries: [...input.entries],
        masterKey: input.masterKey,
      };
    },

    isActive(): boolean {
      return held !== null;
    },

    beginComplete(): RecoveryAttempt | null {
      if (!held) {
        return null;
      }
      const capturedEpoch = epoch;
      const ticket = held.ticket;
      const entries = held.entries;
      const masterKey = held.masterKey;
      held = null;

      let settled = false;

      return {
        ticket,
        entries,
        masterKey,
        succeeded(): boolean {
          if (settled) {
            return false;
          }
          settled = true;
          zeroize(masterKey);
          return capturedEpoch === epoch;
        },
        failed(): void {
          if (settled) {
            return;
          }
          settled = true;
          if (capturedEpoch === epoch) {
            held = { ticket, entries, masterKey };
          } else {
            zeroize(masterKey);
          }
        },
      };
    },

    clear(): void {
      if (held) {
        zeroize(held.masterKey);
        held = null;
      }
      epoch += 1;
    },
  };
}

export const recoverySession = createRecoverySession();

export function attachRecoverySessionToKeyClear(
  session: RecoverySession = recoverySession,
): () => void {
  return onKeyCleared(() => {
    session.clear();
  });
}

export function recoveryWizardAfterKeyCleared(wizard: WizardState): WizardState {
  // Mid-recovery (no codes yet) must not leave orphaned wizard after lock.
  if (wizard.kind === "recovery") {
    return { kind: "none" };
  }
  // Parked codes must survive lock until ack.
  return wizard;
}
