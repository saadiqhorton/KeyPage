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
import {
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  type LockoutState,
} from "@keypage/shared";
import { useVault, type VaultState } from "@/vault/useVault";

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

function workingStatusLabel(state: VaultState): string {
  if (state.phase === "working") {
    return state.label;
  }
  return "Working…";
}

type RecoverCodeStepProps = {
  code: string;
  onCodeChange(value: string): void;
  error: string | null;
  working: boolean;
  workingLabel: string;
  lockoutActive: boolean;
  recoveryLockout: LockoutState | null;
  onLockoutExpired(): void;
  onSubmit(event: FormEvent): void;
  onBack(): void;
};

function RecoverCodeStep({
  code,
  onCodeChange,
  error,
  working,
  workingLabel,
  lockoutActive,
  recoveryLockout,
  onLockoutExpired,
  onSubmit,
  onBack,
}: RecoverCodeStepProps) {
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
            onExpired={onLockoutExpired}
          />
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <TextField
            label="Recovery code"
            value={code}
            onChange={(e) => onCodeChange(formatRecoveryCodeInput(e.target.value))}
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
              <span>{workingLabel}</span>
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
            onClick={onBack}
            className="text-sm text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Back to unlock
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

type RecoverPasswordStepProps = {
  password: string;
  confirm: string;
  error: string | null;
  working: boolean;
  workingLabel: string;
  onPasswordChange(value: string): void;
  onConfirmChange(value: string): void;
  onSubmit(event: FormEvent): void;
  onCancel(): void;
};

function RecoverPasswordStep({
  password,
  confirm,
  error,
  working,
  workingLabel,
  onPasswordChange,
  onConfirmChange,
  onSubmit,
  onCancel,
}: RecoverPasswordStepProps) {
  const confirmMismatch = Boolean(confirm) && password !== confirm;

  return (
    <AuthShell chip="ACCOUNT RECOVERY" title="Set a new Master Password for your vault.">
      <div className="flex flex-col gap-4">
        <Callout tone="warning">
          This replaces all {RECOVERY_CODE_COUNT} of your recovery codes. You will download a new
          set after resetting.
        </Callout>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <PasswordField
            label="New Master Password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={working}
          />
          <PasswordStrengthHint password={password} />
          <PasswordField
            label="Confirm Master Password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirmChange(e.target.value)}
            disabled={working}
            error={confirmMismatch ? "Passwords do not match." : undefined}
          />
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {working ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              <span>{workingLabel}</span>
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
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </AuthShell>
  );
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
      <RecoverCodeStep
        code={code}
        onCodeChange={setCode}
        error={error}
        working={working}
        workingLabel={workingStatusLabel(state)}
        lockoutActive={lockoutActive}
        recoveryLockout={recoveryLockout}
        onLockoutExpired={handleLockoutExpired}
        onSubmit={handleCodeSubmit}
        onBack={() => actions.cancelRecovery()}
      />
    );
  }

  return (
    <RecoverPasswordStep
      password={password}
      confirm={confirm}
      error={error}
      working={working}
      workingLabel={workingStatusLabel(state)}
      onPasswordChange={setPassword}
      onConfirmChange={setConfirm}
      onSubmit={handlePasswordSubmit}
      onCancel={() => {
        void handleCancel();
      }}
    />
  );
}
