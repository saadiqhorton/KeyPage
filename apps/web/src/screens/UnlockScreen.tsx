import { type SubmitEvent, useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { LockoutCountdown } from "@/components/LockoutCountdown";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError } from "@/lib/api.js";
import { useVault, type VaultState } from "@/vault/useVault";

function formatIdleLockMinutes(idleTimeoutSeconds: number): string {
  const minutes = Math.round(idleTimeoutSeconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function formatUnlockError(error: ApiError): string {
  if (
    error.code === "invalid_credentials" &&
    error.body.attemptsRemaining !== undefined
  ) {
    const remaining = error.body.attemptsRemaining;
    return `Incorrect Master Password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a temporary lockout.`;
  }
  return error.message;
}

function lockReasonBanner(state: VaultState): string | null {
  if (state.phase !== "locked") {
    return null;
  }
  if (state.reason === "idle") {
    return `Locked after ${formatIdleLockMinutes(state.idleTimeoutSeconds)} of inactivity.`;
  }
  if (state.reason === "session_expired") {
    return "Your session expired.";
  }
  if (state.reason === "rekeyed") {
    return "Your Master Password was changed somewhere else. Unlock with the new one.";
  }
  return null;
}

function workingStatusLabel(state: VaultState): string {
  if (state.phase === "working") {
    return state.label;
  }
  return "Working…";
}

export function UnlockScreen() {
  const { state, actions } = useVault();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const working = state.phase === "working";
  const locked = state.phase === "locked";
  const lockout = locked ? state.lockout : null;
  const lockoutActive = lockout?.locked ?? false;
  const reasonBanner = lockReasonBanner(state);

  const handleLockoutExpired = useCallback(() => {
    void actions.refreshStatus();
  }, [actions]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await actions.unlock(password);
      setPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(formatUnlockError(err));
      } else {
        setError("Unlock failed. Please try again.");
      }
    }
  }

  return (
    <AuthShell chip="VAULT LOCKED" title="Enter your Master Password to unlock.">
      <div className="flex flex-col gap-4">
        {reasonBanner ? (
          <Callout tone="info">{reasonBanner}</Callout>
        ) : null}

        {lockoutActive && lockout ? (
          <LockoutCountdown
            retryAfterSeconds={lockout.retryAfterSeconds}
            onExpired={handleLockoutExpired}
          />
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <PasswordField
            label="Master Password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={working || lockoutActive}
          />
          {error ? (
            <p className="text-sm text-danger" aria-live="polite" role="alert">
              {error}
            </p>
          ) : null}
          {working ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              <span>{workingStatusLabel(state)}</span>
            </div>
          ) : null}
          <Button
            type="submit"
            loading={working}
            disabled={lockoutActive}
            className="w-full"
          >
            Unlock
          </Button>
        </form>

        <div className="border-t border-hairline pt-4 text-center">
          <Link
            to="/recover"
            onClick={() => actions.startRecovery()}
            className="text-sm text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Use a recovery code
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
