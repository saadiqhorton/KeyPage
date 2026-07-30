import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api.js";
import { buildRecoveryCodesFileText } from "@/crypto/recovery.js";
import { downloadTextFile } from "@/lib/download.js";
import { formatCountdown } from "@/lib/format.js";
import { formatRecoveryCode } from "@keypage/shared";
import { useVault } from "@/vault/useVault";

const MIN_PASSWORD_LENGTH = 12;

export function RecoverScreen() {
  const { state, wizard, actions } = useVault();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await actions.claimRecoveryCode(code);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recovery failed.");
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

  function handleDownloadAgain() {
    if (!codes) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `keypage-recovery-codes-${date}.txt`,
      buildRecoveryCodesFileText(codes),
    );
  }

  if (step === 1) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-2xl">Recovery — Enter code</h1>
        <p>Using a recovery code consumes it permanently.</p>
        {lockoutActive ? (
          <p aria-live="polite">
            Too many attempts. Try again in{" "}
            {formatCountdown(recoveryLockout!.retryAfterSeconds)}.
          </p>
        ) : null}
        <form className="flex flex-col gap-3" onSubmit={handleCodeSubmit}>
          <label className="flex flex-col gap-1">
            <span>Recovery code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={working || lockoutActive}
              autoComplete="off"
            />
          </label>
          {error ? (
            <p className="text-danger" aria-live="polite">
              {error}
            </p>
          ) : null}
          {working ? <p>{state.phase === "working" ? state.label : "Working…"}</p> : null}
          <button type="submit" disabled={working || lockoutActive}>
            Verify code
          </button>
        </form>
        <Link to="/unlock" onClick={() => actions.cancelRecovery()}>
          Back to unlock
        </Link>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-2xl">Recovery — New Master Password</h1>
        <p>This replaces all 10 recovery codes.</p>
        <form className="flex flex-col gap-3" onSubmit={handlePasswordSubmit}>
          <label className="flex flex-col gap-1">
            <span>New Master Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={working}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Confirm Master Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={working}
            />
          </label>
          {error ? <p className="text-danger">{error}</p> : null}
          {working ? <p>{state.phase === "working" ? state.label : "Working…"}</p> : null}
          <button type="submit" disabled={working}>
            Reset vault
          </button>
        </form>
        <button type="button" onClick={() => actions.cancelRecovery()}>
          Cancel
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl">Recovery — Save new codes</h1>
      <ul className="font-mono text-sm">
        {codes?.map((item, index) => (
          <li key={item}>
            {index + 1}. {formatRecoveryCode(item)}
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleDownloadAgain}>
        Download again
      </button>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <span>I&apos;ve saved my recovery codes somewhere safe.</span>
      </label>
      <Link
        to="/"
        onClick={() => {
          if (saved) actions.finishWizard();
        }}
        aria-disabled={!saved}
        className={!saved ? "pointer-events-none opacity-50" : undefined}
      >
        Open Dashboard
      </Link>
    </main>
  );
}
