import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api.js";
import { buildRecoveryCodesFileText } from "@/crypto/recovery.js";
import { downloadTextFile } from "@/lib/download.js";
import { formatRecoveryCode } from "@keypage/shared";
import { useVault } from "@/vault/useVault";

const MIN_PASSWORD_LENGTH = 12;

export function SetupScreen() {
  const { state, wizard, actions } = useVault();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase === "setup_required" && wizard.kind === "none") {
      actions.startSetup();
    }
  }, [actions, state.phase, wizard.kind]);

  const [codesConfirmed, setCodesConfirmed] = useState(false);
  const working = state.phase === "working";
  const wizardStep = wizard.kind === "setup" ? wizard.step : 1;
  const step = wizardStep >= 2 && codesConfirmed ? 3 : wizardStep;
  const codes = wizard.kind === "setup" ? wizard.codes : null;

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
      await actions.submitSetup(password);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed.");
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
        <h1 className="text-2xl">Setup — Master Password</h1>
        <form className="flex flex-col gap-3" onSubmit={handlePasswordSubmit}>
          <label className="flex flex-col gap-1">
            <span>Master Password</span>
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
            Create vault
          </button>
        </form>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-2xl">Setup — Save recovery codes</h1>
        <p>Save these recovery codes offline. Any one code can recover your vault.</p>
        <ul className="font-mono text-sm">
          {codes?.map((code, index) => (
            <li key={code}>
              {index + 1}. {formatRecoveryCode(code)}
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
        <button
          type="button"
          disabled={!saved}
          onClick={() => setCodesConfirmed(true)}
        >
          Continue
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl">Vault ready</h1>
      <p>Your vault is set up. Open the Dashboard to continue.</p>
      <Link to="/" onClick={() => actions.finishWizard()}>
        Open Dashboard
      </Link>
    </main>
  );
}
