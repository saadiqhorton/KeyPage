import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { StepIndicator } from "@/components/StepIndicator";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import {
  PasswordStrengthHint,
} from "@/components/ui/PasswordStrengthHint";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { ApiError } from "@/lib/api.js";
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
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupTokenError, setSetupTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase === "setup_required" && wizard.kind === "none") {
      actions.startSetup();
    }
  }, [actions, state.phase, wizard.kind]);

  const working = state.phase === "working";
  const step = wizard.kind === "setup" ? wizard.step : 1;

  if (wizard.kind === "codes") {
    return null;
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSetupTokenError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Master Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      await actions.submitSetup(password, setupToken.trim());
      setSetupToken("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_setup_token") {
        setSetupTokenError(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Setup failed.");
    }
  }

  if (step === 1) {
    return (
      <AuthShell chip="FIRST-RUN SETUP" title="Create your vault with a Master Password.">
        <StepIndicator steps={SETUP_STEPS} currentStep={1} />
        <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
          <TextField
            label="Setup token"
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            disabled={working}
            hint="Printed in the server log the first time KeyPage starts. Docker: `docker compose logs keypage | grep -A4 'setup token'`, or `cat ./data/setup-token`."
            error={setupTokenError ?? undefined}
          />
          <PasswordField
            label="Master Password"
            autoComplete="new-password"
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

  return (
    <AuthShell chip="FIRST-RUN SETUP" title="Your vault is ready.">
      <StepIndicator steps={SETUP_STEPS} currentStep={3} />
      <div className="flex flex-col gap-4">
        <Callout tone="info">
          Your Master Password and recovery codes are set. Open the Dashboard to
          add your first API key.
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
