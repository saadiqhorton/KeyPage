import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { proofKeysFromSecrets } from "@/crypto/auth-proof.js";
import { deriveVaultKeys, pickKdfParams } from "@/crypto/derive.js";
import {
  buildRecoveryCodeEnvelopes,
  computeLookupHash,
  unwrapMasterKey,
} from "@/crypto/recovery.js";
import { zeroize } from "@/crypto/provider.js";
import { ApiError, getVaultStatus, postRecoveryCancel, postRecoveryClaim, postVaultLock, postVaultLogin, postVaultLoginWithAuthKey, postVaultSetup } from "@/lib/api.js";
import { downloadRecoveryCodes } from "@/vault/recovery-download.js";
import { normalizeRecoveryCode, SETUP_TOKEN_PATTERN } from "@keypage/shared";

import {
  changeMasterPassword,
  completeVaultRecovery,
  formatPasswordError,
  regenerateRecoveryCodes,
} from "./master-password.js";
import {
  attachRecoverySessionToKeyClear,
  recoverySession,
  recoveryWizardAfterKeyCleared,
} from "./recovery-session.js";
import {
  VaultContext,
  type LockReason,
  type RecoveryCodesAckOutcome,
  type RecoveryCodesReason,
  type VaultActions,
  type VaultContextValue,
  type VaultState,
  type WizardState,
} from "./useVault.js";
import {
  broadcastLock,
  clearEncryptionKey,
  getEncryptionKey,
  onKeyCleared,
  setEncryptionKey,
  subscribeLockBroadcast,
} from "./session-keys.js";

function isUnlocked(): boolean {
  return getEncryptionKey() !== null;
}

type VaultProviderProps = {
  children: ReactNode;
};

export function VaultProvider({ children }: Readonly<VaultProviderProps>) {
  const [state, setState] = useState<VaultState>({ phase: "loading" });
  const [wizard, setWizard] = useState<WizardState>({ kind: "none" });
  const [issuingRecoveryCodes, setIssuingRecoveryCodes] = useState(false);
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
      keyVersion: status.keyVersion,
      lockout: status.lockout,
      recoveryCodesRemaining: status.recoveryCodesRemaining,
      recoveryLockout: status.recoveryLockout,
      proofReady: status.proofReady,
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

    const unsubscribeLock = subscribeLockBroadcast((reason) => {
      lockReasonRef.current = reason as LockReason;
      void refreshStatus();
    });
    const unsubscribeRecoveryClear = attachRecoverySessionToKeyClear();
    const unsubscribeWizardReset = onKeyCleared(() => {
      setWizard((w) => recoveryWizardAfterKeyCleared(w));
    });

    return () => {
      mountedRef.current = false;
      unsubscribeLock();
      unsubscribeRecoveryClear();
      unsubscribeWizardReset();
      recoverySession.clear();
    };
  }, [refreshStatus]);

  const parkRecoveryCodes = useCallback(
    (codes: string[], reason: RecoveryCodesReason) => {
      setWizard({ kind: "codes", codes, reason });
    },
    [],
  );

  const startSetup = useCallback(() => {
    setWizard({ kind: "setup", step: 1 });
  }, []);

  const submitSetup = useCallback(async (password: string, setupToken: string) => {
    if (!new RegExp(SETUP_TOKEN_PATTERN).test(setupToken)) {
      throw new ApiError({
        error: "invalid_setup_token",
        message:
          "That setup token doesn't look right. Copy it from the server log or ./data/setup-token.",
      });
    }

    setIssuingRecoveryCodes(true);
    setState({ phase: "working", label: "Deriving your encryption key…" });
    try {
      const kdf = await pickKdfParams();
      const derived = await deriveVaultKeys(password, kdf);
      const { codes, envelopes } = await buildRecoveryCodeEnvelopes(derived.masterKey);
      const proofKeys = proofKeysFromSecrets({
        authKeyB64: derived.authKeyB64,
        masterKey: derived.masterKey,
      });
      zeroize(derived.masterKey);

      const response = await postVaultSetup({
        setupToken,
        kdf,
        authStoredKeyHex: proofKeys.authStoredKeyHex,
        recoveryStoredKeyHex: proofKeys.recoveryStoredKeyHex,
        recoveryCodes: envelopes,
      });

      setEncryptionKey(
        derived.encryptionKey,
        response.keyVersion,
        derived.authKeyB64,
      );
      downloadRecoveryCodes(codes);
      parkRecoveryCodes(codes, "setup");
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
    } finally {
      setIssuingRecoveryCodes(false);
    }
  }, [parkRecoveryCodes, refreshStatus]);

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

      const response = current.proofReady
        ? await postVaultLoginWithAuthKey(derived.authKeyB64)
        : await postVaultLogin({ authKeyB64: derived.authKeyB64 });
      setEncryptionKey(
        derived.encryptionKey,
        response.keyVersion,
        derived.authKeyB64,
      );
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
    lockReasonRef.current = reason;
    broadcastLock(reason);
    void postVaultLock().catch(() => {});
    await refreshStatus();
  }, [refreshStatus]);

  const lockLocal = useCallback(async (reason: LockReason) => {
    clearEncryptionKey();
    lockReasonRef.current = reason;
    await refreshStatus();
  }, [refreshStatus]);

  const startRecovery = useCallback(() => {
    setWizard({ kind: "recovery", step: 1 });
  }, []);

  const claimRecoveryCode = useCallback(async (code: string) => {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) {
      throw new ApiError({
        error: "invalid_recovery_code",
        message: "That recovery code is not valid.",
      });
    }

    recoverySession.clear();

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
      recoverySession.start({
        ticket: claim.recoveryTicket,
        challengeNonceB64: claim.challengeNonceB64,
        entries: claim.entries,
        masterKey,
      });
      setWizard({ kind: "recovery", step: 2 });
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      throw error;
    }
  }, [refreshStatus]);

  const completeRecovery = useCallback(async (newPassword: string) => {
    const attempt = recoverySession.beginComplete();
    if (!attempt) {
      throw new ApiError({
        error: "invalid_recovery_ticket",
        message: "Recovery session expired. Start again with a recovery code.",
      });
    }

    setIssuingRecoveryCodes(true);
    setState({ phase: "working", label: "Setting up your new Master Password…" });
    try {
      const { codes, session } = await completeVaultRecovery(
        attempt.ticket,
        attempt.challengeNonceB64,
        attempt.masterKey,
        attempt.entries,
        newPassword,
        (label) => setState({ phase: "working", label }),
      );

      const accepted = attempt.succeeded();
      parkRecoveryCodes(codes, "recovery");
      if (!accepted) {
        // Reset may have landed on the server, but a concurrent lock invalidated
        // this attempt. Drop the key completeVaultRecovery installed and stay locked.
        clearEncryptionKey();
        await refreshStatus();
        return;
      }
      lockReasonRef.current = "initial";
      setState({
        phase: "unlocked",
        idleTimeoutSeconds: session.idleTimeoutSeconds,
      });
    } catch (error) {
      // If the server already accepted the reset (e.g. reEncrypted mismatch),
      // failed() may restore a consumed ticket — server rejects on retry.
      attempt.failed();
      await refreshStatus();
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        error: "invalid_request",
        message: formatPasswordError(error, {
          fallback: "Recovery failed. Start again with a recovery code.",
        }),
      });
    } finally {
      setIssuingRecoveryCodes(false);
    }
  }, [parkRecoveryCodes, refreshStatus]);

  const changeMasterPasswordAction = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      onProgress?: (label: string) => void,
    ) => {
      setIssuingRecoveryCodes(true);
      try {
        const codes = await changeMasterPassword(
          currentPassword,
          newPassword,
          onProgress,
        );
        parkRecoveryCodes(codes, "password_change");
        await refreshStatus();
      } catch (error) {
        await refreshStatus();
        throw error;
      } finally {
        setIssuingRecoveryCodes(false);
      }
    },
    [parkRecoveryCodes, refreshStatus],
  );

  const regenerateRecoveryCodesAction = useCallback(
    async (password: string, onProgress?: (label: string) => void) => {
      setIssuingRecoveryCodes(true);
      try {
        const codes = await regenerateRecoveryCodes(password, onProgress);
        parkRecoveryCodes(codes, "regen");
        await refreshStatus();
      } catch (error) {
        await refreshStatus();
        throw error;
      } finally {
        setIssuingRecoveryCodes(false);
      }
    },
    [parkRecoveryCodes, refreshStatus],
  );

  const acknowledgeRecoveryCodes = useCallback((): RecoveryCodesAckOutcome => {
    if (wizard.kind !== "codes") {
      return { navigateTo: "/" };
    }

    switch (wizard.reason) {
      case "setup":
        setWizard({ kind: "setup", step: 3 });
        return { navigateTo: "/setup" };
      case "recovery":
        setWizard({ kind: "none" });
        return { navigateTo: "/" };
      case "password_change":
      case "regen":
        setWizard({ kind: "none" });
        return { navigateTo: "/settings" };
    }
  }, [wizard]);

  const finishWizard = useCallback(() => {
    setWizard({ kind: "none" });
  }, []);

  const cancelRecovery = useCallback(async () => {
    const ticket = recoverySession.openTicket();
    if (!ticket) {
      setWizard({ kind: "none" });
      await refreshStatus();
      return;
    }

    setState({ phase: "working", label: "Cancelling recovery…" });
    try {
      await postRecoveryCancel({ recoveryTicket: ticket });
      recoverySession.clear();
      setWizard({ kind: "none" });
    } catch (error) {
      await refreshStatus();
      throw error;
    }
    await refreshStatus();
  }, [refreshStatus]);

  const actions = useMemo<VaultActions>(
    () => ({
      refreshStatus,
      startSetup,
      submitSetup,
      unlock,
      lock,
      lockLocal,
      startRecovery,
      claimRecoveryCode,
      completeRecovery,
      changeMasterPassword: changeMasterPasswordAction,
      regenerateRecoveryCodes: regenerateRecoveryCodesAction,
      acknowledgeRecoveryCodes,
      finishWizard,
      cancelRecovery,
    }),
    [
      refreshStatus,
      startSetup,
      submitSetup,
      unlock,
      lock,
      lockLocal,
      startRecovery,
      claimRecoveryCode,
      completeRecovery,
      changeMasterPasswordAction,
      regenerateRecoveryCodesAction,
      acknowledgeRecoveryCodes,
      finishWizard,
      cancelRecovery,
    ],
  );

  const value = useMemo<VaultContextValue>(
    () => ({ state, wizard, actions, issuingRecoveryCodes }),
    [state, wizard, actions, issuingRecoveryCodes],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
