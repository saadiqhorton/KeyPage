import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { RecoveryCodeGrid } from "@/components/RecoveryCodeGrid";
import { StepIndicator } from "@/components/StepIndicator";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import {
  PasswordStrengthHint,
} from "@/components/ui/PasswordStrengthHint";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { buildRecoveryCodesFileText } from "@/crypto/recovery.js";
import { ApiError } from "@/lib/api.js";
import { copyTextWithAutoClear } from "@/lib/clipboard.js";
import { downloadTextFile } from "@/lib/download.js";
import { formatRecoveryCode } from "@keypage/shared";
import { useVault } from "@/vault/useVault";

const MIN_PASSWORD_LENGTH = 12;

const SETUP_STEPS = [
  "Create Master Password",
  "Save recovery codes",
  "Vault ready",
];

export function SetupScreen() {
  const navigate = useNavigate();
  const { state, wizard, actions } = useVault();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const downloadCodes = useCallback(() => {
    if (!codes) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `keypage-recovery-codes-${date}.txt`,
      buildRecoveryCodesFileText(codes),
    );
  }, [codes]);

  useEffect(() => {
    if (step !== 2 || !codes) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step, codes]);

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

  async function handleCopyAll() {
    if (!codes) return;
    const text = codes.map((code) => formatRecoveryCode(code)).join("\n");
    try {
      await copyTextWithAutoClear(text, 30_000);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (step === 1) {
    return (
      <AuthShell chip="FIRST-RUN SETUP" title="Create your vault with a Master Password.">
        <StepIndicator steps={SETUP_STEPS} currentStep={1} />
        <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
          <PasswordField
            label="Master Password"
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
          <Callout tone="warning">
            KeyPage cannot reset this for you. If you lose it, only a recovery
            code can get you back in.
          </Callout>
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
            Create vault
          </Button>
        </form>
      </AuthShell>
    );
  }

  if (step === 2) {
    return (
      <AuthShell
        chip="FIRST-RUN SETUP"
        title="Save these recovery codes offline. Any one code can recover your vault."
      >
        <StepIndicator steps={SETUP_STEPS} currentStep={2} />
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
            onClick={() => setCodesConfirmed(true)}
          >
            Continue
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell chip="FIRST-RUN SETUP" title="Your vault is ready.">
      <StepIndicator steps={SETUP_STEPS} currentStep={3} />
      <div className="flex flex-col gap-4">
        <Callout tone="info">
          Your Master Password and recovery codes are set. Open the Dashboard to
          continue — you can add API keys in a future release.
        </Callout>
        <Button
          type="button"
          className="w-full"
          onClick={() => {
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
