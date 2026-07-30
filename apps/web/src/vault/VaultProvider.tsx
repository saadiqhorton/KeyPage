import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { deriveVaultKeys, pickKdfParams } from "@/crypto/derive.js";
import {
  buildRecoveryCodeEnvelopes,
  buildRecoveryCodesFileText,
  computeLookupHash,
  unwrapMasterKey,
} from "@/crypto/recovery.js";
import { zeroize } from "@/crypto/provider.js";
import { ApiError, getVaultStatus, postRecoveryClaim, postRecoveryReset, postVaultLock, postVaultLogin, postVaultSetup } from "@/lib/api.js";
import { downloadTextFile } from "@/lib/download.js";
import { normalizeRecoveryCode } from "@keypage/shared";

import {
  VaultContext,
  type LockReason,
  type VaultActions,
  type VaultContextValue,
  type VaultState,
  type WizardState,
} from "./useVault.js";
import {
  broadcastLock,
  clearEncryptionKey,
  clearRecoveredMasterKey,
  getEncryptionKey,
  setEncryptionKey,
  setRecoveredMasterKey,
  subscribeLockBroadcast,
} from "./session-keys.js";

let recoveryTicket: string | null = null;

function clearRecoveryTicket(): void {
  recoveryTicket = null;
}

function downloadRecoveryCodes(codes: string[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const text = buildRecoveryCodesFileText(codes);
  downloadTextFile(`keypage-recovery-codes-${date}.txt`, text);
}

function isUnlocked(): boolean {
  return getEncryptionKey() !== null;
}

type VaultProviderProps = {
  children: ReactNode;
};

export function VaultProvider({ children }: VaultProviderProps) {
  const [state, setState] = useState<VaultState>({ phase: "loading" });
  const [wizard, setWizard] = useState<WizardState>({ kind: "none" });
  const lockReasonRef = useRef<LockReason>("initial");
  const mountedRef = useRef(true);

  const applyStatus = useCallback((status: Awaited<ReturnType<typeof getVaultStatus>>) => {
    if (status.state === "setup_required") {
      setState({ phase: "setup_required" });
      return;
    }

    if (!status.kdf) {
      setState({
        phase: "unavailable",
        message: "Vault status is inconsistent. Try refreshing the page.",
      });
      return;
    }

    if (isUnlocked() && status.session.authenticated) {
      setState({
        phase: "unlocked",
        idleTimeoutSeconds: status.session.idleTimeoutSeconds,
      });
      return;
    }

    setState({
      phase: "locked",
      reason: lockReasonRef.current,
      idleTimeoutSeconds: status.session.idleTimeoutSeconds,
      kdf: status.kdf,
      lockout: status.lockout,
      recoveryCodesRemaining: status.recoveryCodesRemaining,
      recoveryLockout: status.recoveryLockout,
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getVaultStatus();
      if (!mountedRef.current) return;
      applyStatus(status);
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError) {
        setState({
          phase: "unavailable",
          message: error.message,
        });
        return;
      }
      setState({
        phase: "unavailable",
        message: "Unable to reach the KeyPage server.",
      });
    }
  }, [applyStatus]);

  useEffect(() => {
    mountedRef.current = true;

    if (!globalThis.crypto?.getRandomValues) {
      setState({
        phase: "unavailable",
        message:
          "This browser cannot provide secure randomness. KeyPage cannot run here.",
      });
      return () => {
        mountedRef.current = false;
      };
    }

    void refreshStatus();

    const unsubscribe = subscribeLockBroadcast((reason) => {
      lockReasonRef.current = reason as LockReason;
      void refreshStatus();
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      clearRecoveredMasterKey();
      clearRecoveryTicket();
    };
  }, [refreshStatus]);

  const startSetup = useCallback(() => {
    setWizard({ kind: "setup", step: 1, codes: null });
  }, []);

  const submitSetup = useCallback(async (password: string) => {
    setState({ phase: "working", label: "Deriving your encryption key…" });
    try {
      const kdf = await pickKdfParams();
      const derived = await deriveVaultKeys(password, kdf);
      const { codes, envelopes } = await buildRecoveryCodeEnvelopes(derived.masterKey);
      zeroize(derived.masterKey);

      const response = await postVaultSetup({
        kdf,
        authKeyB64: derived.authKeyB64,
        recoveryCodes: envelopes,
      });

      setEncryptionKey(derived.encryptionKey);
      downloadRecoveryCodes(codes);
      setWizard({ kind: "setup", step: 2, codes });
      setState({
        phase: "unlocked",
        idleTimeoutSeconds: response.session.idleTimeoutSeconds,
      });
    } catch (error) {
      await refreshStatus();
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        error: "internal_error",
        message: "Setup failed. Please try again.",
      });
    }
  }, [refreshStatus]);

  const unlock = useCallback(async (password: string) => {
    const current = state;
    if (current.phase !== "locked") {
      throw new ApiError({
        error: "invalid_request",
        message: "Vault is not locked.",
      });
    }

    setState({ phase: "working", label: "Deriving your encryption key…" });
    try {
      const derived = await deriveVaultKeys(password, current.kdf);
      zeroize(derived.masterKey);

      const response = await postVaultLogin({ authKeyB64: derived.authKeyB64 });
      setEncryptionKey(derived.encryptionKey);
      lockReasonRef.current = "initial";
      setState({
        phase: "unlocked",
        idleTimeoutSeconds: response.session.idleTimeoutSeconds,
      });
    } catch (error) {
      await refreshStatus();
      throw error;
    }
  }, [refreshStatus, state]);

  const lock = useCallback(async (reason: LockReason) => {
    clearEncryptionKey();
    clearRecoveredMasterKey();
    clearRecoveryTicket();
    lockReasonRef.current = reason;
    broadcastLock(reason);
    void postVaultLock().catch(() => {});
    await refreshStatus();
  }, [refreshStatus]);

  const startRecovery = useCallback(() => {
    setWizard({ kind: "recovery", step: 1, codes: null });
  }, []);

  const claimRecoveryCode = useCallback(async (code: string) => {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) {
      throw new ApiError({
        error: "invalid_recovery_code",
        message: "That recovery code is not valid.",
      });
    }

    setState({ phase: "working", label: "Verifying recovery code…" });
    try {
      const lookupHash = await computeLookupHash(normalized);
      const claim = await postRecoveryClaim({ lookupHash });

      const masterKey = await unwrapMasterKey(
        {
          label: "",
          lookupHash,
          kdf: claim.kdf,
          wrappedMasterKeyB64: claim.wrappedMasterKeyB64,
        },
        normalized,
      );
      setRecoveredMasterKey(masterKey);
      recoveryTicket = claim.recoveryTicket;
      setWizard({ kind: "recovery", step: 2, codes: null });
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      throw error;
    }
  }, [refreshStatus]);

  const completeRecovery = useCallback(async (newPassword: string) => {
    if (!recoveryTicket) {
      throw new ApiError({
        error: "invalid_recovery_ticket",
        message: "Recovery session expired. Start again with a recovery code.",
      });
    }

    clearRecoveredMasterKey();

    setState({ phase: "working", label: "Setting up your new Master Password…" });
    try {
      const kdf = await pickKdfParams();
      const derived = await deriveVaultKeys(newPassword, kdf);
      const { codes, envelopes } = await buildRecoveryCodeEnvelopes(derived.masterKey);
      zeroize(derived.masterKey);

      const response = await postRecoveryReset({
        recoveryTicket,
        kdf,
        authKeyB64: derived.authKeyB64,
        recoveryCodes: envelopes,
      });

      clearRecoveryTicket();
      setEncryptionKey(derived.encryptionKey);
      downloadRecoveryCodes(codes);
      setWizard({ kind: "recovery", step: 3, codes });
      lockReasonRef.current = "initial";
      setState({
        phase: "unlocked",
        idleTimeoutSeconds: response.session.idleTimeoutSeconds,
      });
    } catch (error) {
      await refreshStatus();
      throw error;
    }
  }, [refreshStatus]);

  const finishWizard = useCallback(() => {
    setWizard({ kind: "none" });
  }, []);

  const cancelRecovery = useCallback(() => {
    clearRecoveredMasterKey();
    clearRecoveryTicket();
    setWizard({ kind: "none" });
    void refreshStatus();
  }, [refreshStatus]);

  const actions = useMemo<VaultActions>(
    () => ({
      refreshStatus,
      startSetup,
      submitSetup,
      unlock,
      lock,
      startRecovery,
      claimRecoveryCode,
      completeRecovery,
      finishWizard,
      cancelRecovery,
    }),
    [
      refreshStatus,
      startSetup,
      submitSetup,
      unlock,
      lock,
      startRecovery,
      claimRecoveryCode,
      completeRecovery,
      finishWizard,
      cancelRecovery,
    ],
  );

  const value = useMemo<VaultContextValue>(
    () => ({ state, wizard, actions }),
    [state, wizard, actions],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
