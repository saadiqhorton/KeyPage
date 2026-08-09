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
  succeeded(): void;
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
        succeeded(): void {
          if (settled) {
            return;
          }
          settled = true;
          zeroize(masterKey);
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
  if (wizard.kind === "recovery" && wizard.codes === null) {
    return { kind: "none" };
  }
  return wizard;
}
