import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { SettingsCard } from "@/components/settings/SettingsCard";

type RecoveryCodesCardProps = {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  progress: string | null;
  onRegenerate(password: string): Promise<void>;
};

export function remainingCodesSummary(
  remaining: number | null,
  loadingRemaining: boolean,
) {
  if (loadingRemaining) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner size="sm" />
        <span>Loading…</span>
      </div>
    );
  }
  if (remaining === null) {
    return null;
  }
  return (
    <p className="text-sm text-text">
      <span className="font-medium">{remaining}</span>{" "}
      {remaining === 1 ? "code" : "codes"} remaining
    </p>
  );
}

export function RecoveryCodesCard({
  remaining,
  loadingRemaining,
  busy,
  error,
  progress,
  onRegenerate,
}: Readonly<RecoveryCodesCardProps>) {
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!password) {
      setFormError("Enter your Master Password to regenerate recovery codes.");
      return;
    }

    try {
      await onRegenerate(password);
      setPassword("");
    } catch {
      // Error surfaced via parent hook.
    }
  }

  return (
    <SettingsCard
      title="Recovery codes"
      description="One-time codes for account recovery if you forget your Master Password."
    >
      {remainingCodesSummary(remaining, loadingRemaining)}

      <Callout tone="warning">
        Regenerating recovery codes replaces all existing codes immediately.
        Unused codes from your previous set will stop working.
      </Callout>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <PasswordField
          label="Master Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          autoComplete="current-password"
          error={formError ?? error}
        />

        {busy && progress ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            <span>{progress}</span>
          </div>
        ) : null}

        <div>
          <Button type="submit" loading={busy}>
            Regenerate recovery codes
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
