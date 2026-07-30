import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { LockoutCountdown } from "@/components/LockoutCountdown";
import { RecoveryCodeGrid } from "@/components/RecoveryCodeGrid";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import {
  isPasswordStrongEnough,
  PasswordStrengthHint,
} from "@/components/ui/PasswordStrengthHint";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { buildRecoveryCodesFileText } from "@/crypto/recovery.js";
import { ApiError } from "@/lib/api.js";
import { downloadTextFile } from "@/lib/download.js";
import { formatRecoveryCodeInput } from "@/lib/format.js";
import { formatRecoveryCode, normalizeRecoveryCode } from "@keypage/shared";
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
  const navigate = useNavigate();
  const { state, wizard, actions } = useVault();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (wizard.kind === "none" && state.phase === "locked") {
      actions.startRecovery();
    }
  }, [actions, state.phase, wizard.kind]);

  const working = state.phase === "working";
  const step = wizard.kind === "recovery" ? wizard.step : 1;
  const codes = wizard.kind === "recovery" ? wizard.codes : null;
  const recoveryLockout =
    state.phase === "locked" ? state.recoveryLockout : null;
  const lockoutActive = recoveryLockout?.locked ?? false;

  const handleLockoutExpired = useCallback(() => {
    void actions.refreshStatus();
  }, [actions]);

  const downloadCodes = useCallback(() => {
    if (!codes) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `keypage-recovery-codes-${date}.txt`,
      buildRecoveryCodesFileText(codes),
    );
  }, [codes]);

  useEffect(() => {
    if (step !== 3 || !codes) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step, codes]);

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
    if (!isPasswordStrongEnough(password)) {
      setError("Choose a stronger Master Password before continuing.");
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

  async function handleCopyAll() {
    if (!codes) return;
    const text = codes.map((item) => formatRecoveryCode(item)).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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

  if (step === 2) {
    return (
      <AuthShell chip="ACCOUNT RECOVERY" title="Set a new Master Password for your vault.">
        <div className="flex flex-col gap-4">
          <Callout tone="warning">
            This replaces all 10 of your recovery codes. You will download a new
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
          <Button type="button" variant="ghost" onClick={() => actions.cancelRecovery()}>
            Cancel
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell chip="ACCOUNT RECOVERY" title="Save your new recovery codes offline.">
      <div className="flex flex-col gap-4">
        <RecoveryCodeGrid codes={codes ?? []} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={downloadCodes}>
            Download again
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyAll()}>
            {copied ? "Copied" : "Copy all"}
          </Button>
        </div>
        <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
          <input
            type="checkbox"
            className="mt-1 accent-brass"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          <span>I&apos;ve saved my recovery codes somewhere safe.</span>
        </label>
        <Button
          type="button"
          disabled={!saved}
          className="w-full"
          onClick={() => {
            if (!saved) return;
            actions.finishWizard();
            navigate("/");
          }}
        >
          Open Dashboard
        </Button>
      </div>
    </AuthShell>
  );
}
