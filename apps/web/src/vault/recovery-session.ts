import type { KeyEntry } from "@keypage/shared";

import { zeroize } from "@/crypto/provider.js";

import { onKeyCleared } from "./session-keys.js";
import type { WizardState } from "./useVault.js";

export type RecoverySessionStart = {
  ticket: string;
  challengeNonceB64: string;
  entries: KeyEntry[];
  masterKey: Uint8Array;
};

export type RecoveryAttempt = {
  readonly ticket: string;
  readonly challengeNonceB64: string;
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
  /** Zeroize local state and return the open ticket (if any) for server cancel. */
  takeTicketForCancel(): string | null;
  clear(): void;
};

export function createRecoverySession(): RecoverySession {
  let held: {
    ticket: string;
    challengeNonceB64: string;
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
        challengeNonceB64: input.challengeNonceB64,
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
      const challengeNonceB64 = held.challengeNonceB64;
      const entries = held.entries;
      const masterKey = held.masterKey;
      held = null;

      let settled = false;

      return {
        ticket,
        challengeNonceB64,
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
            held = { ticket, challengeNonceB64, entries, masterKey };
          } else {
            zeroize(masterKey);
          }
        },
      };
    },

    takeTicketForCancel(): string | null {
      if (!held) {
        return null;
      }
      const ticket = held.ticket;
      zeroize(held.masterKey);
      held = null;
      epoch += 1;
      return ticket;
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
