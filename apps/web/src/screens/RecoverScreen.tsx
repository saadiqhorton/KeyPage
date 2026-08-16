import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { LockoutCountdown } from "@/components/LockoutCountdown";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import {
  PasswordStrengthHint,
} from "@/components/ui/PasswordStrengthHint";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { ApiError } from "@/lib/api.js";
import { formatRecoveryCodeInput } from "@/lib/format.js";
import { normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "@keypage/shared";
import { useVault } from "@/vault/useVault";

const MIN_PASSWORD_LENGTH = 12;

function formatRecoveryError(error: ApiError): string {
  if (
    (error.code === "invalid_recovery_code" || error.code === "rate_limited") &&
    error.body.attemptsRemaining !== undefined
  ) {
    const remaining = error.body.attemptsRemaining;
    return `That recovery code isn't valid. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a temporary lockout.`;
  }
  if (error.code === "invalid_recovery_code") {
    return "That recovery code isn't valid.";
  }
  return error.message;
}

export function RecoverScreen() {
  const { state, wizard, actions } = useVault();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wizard.kind === "none" && state.phase === "locked") {
      actions.startRecovery();
    }
  }, [actions, state.phase, wizard.kind]);

  const working = state.phase === "working";
  const step = wizard.kind === "recovery" ? wizard.step : 1;
  const recoveryLockout =
    state.phase === "locked" ? state.recoveryLockout : null;
  const lockoutActive = recoveryLockout?.locked ?? false;

  const handleLockoutExpired = useCallback(() => {
    void actions.refreshStatus();
  }, [actions]);

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!normalizeRecoveryCode(code)) {
      setError("Enter a complete recovery code in the format XXXXX-XXXXX-XXXXX-XXXXX.");
      return;
    }

    try {
      await actions.claimRecoveryCode(code);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? formatRecoveryError(err) : "Recovery failed.");
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Master Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      await actions.completeRecovery(password);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recovery reset failed.");
    }
  }

  async function handleCancel() {
    setError(null);
    try {
      await actions.cancelRecovery();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not cancel recovery. Try again, or finish the reset.",
      );
    }
  }

  if (step === 1) {
    return (
      <AuthShell
        chip="ACCOUNT RECOVERY"
        title="Enter one unused recovery code to set a new Master Password."
      >
        <div className="flex flex-col gap-4">
          <Callout tone="warning">
            Using a recovery code consumes it permanently, even if you do not
            finish resetting your Master Password.
          </Callout>

          {lockoutActive && recoveryLockout ? (
            <LockoutCountdown
              retryAfterSeconds={recoveryLockout.retryAfterSeconds}
              onExpired={handleLockoutExpired}
            />
          ) : null}

          <form className="flex flex-col gap-4" onSubmit={handleCodeSubmit}>
            <TextField
              label="Recovery code"
              value={code}
              onChange={(e) => setCode(formatRecoveryCodeInput(e.target.value))}
              disabled={working || lockoutActive}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              inputMode="text"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="uppercase"
            />
            {error ? (
              <p className="text-sm text-danger" aria-live="polite" role="alert">
                {error}
              </p>
            ) : null}
            {working ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" />
                <span>{state.phase === "working" ? state.label : "Working…"}</span>
              </div>
            ) : null}
            <Button
              type="submit"
              loading={working}
              disabled={lockoutActive}
              className="w-full"
            >
              Verify code
            </Button>
          </form>

          <div className="border-t border-hairline pt-4 text-center">
            <Link
              to="/unlock"
              onClick={() => actions.cancelRecovery()}
              className="text-sm text-muted underline-offset-4 hover:text-text hover:underline"
            >
              Back to unlock
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell chip="ACCOUNT RECOVERY" title="Set a new Master Password for your vault.">
      <div className="flex flex-col gap-4">
        <Callout tone="warning">
          This replaces all {RECOVERY_CODE_COUNT} of your recovery codes. You will download a new
          set after resetting.
        </Callout>
        <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
          <PasswordField
            label="New Master Password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={working}
          />
          <PasswordStrengthHint password={password} />
          <PasswordField
            label="Confirm Master Password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={working}
            error={
              confirm && password !== confirm ? "Passwords do not match." : undefined
            }
          />
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {working ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              <span>{state.phase === "working" ? state.label : "Working…"}</span>
            </div>
          ) : null}
          <Button type="submit" loading={working} className="w-full">
            Reset vault
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          disabled={working}
          onClick={() => {
            void handleCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </AuthShell>
  );
}
