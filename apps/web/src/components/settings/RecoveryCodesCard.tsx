import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useWarnBeforeUnload } from "@/hooks/useWarnBeforeUnload";

type RecoveryCodesCardProps = {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  onRegenerate(password: string): Promise<void>;
};

export function RecoveryCodesCard({
  remaining,
  loadingRemaining,
  busy,
  error,
  onRegenerate,
}: RecoveryCodesCardProps) {
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // The new set is already being minted server-side; leaving now would lose
  // codes that the /recovery-codes screen is about to show.
  useWarnBeforeUnload(busy);

  async function handleSubmit(event: FormEvent) {
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
      {loadingRemaining ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" />
          <span>Loading…</span>
        </div>
      ) : remaining !== null ? (
        <p className="text-sm text-text">
          <span className="font-medium">{remaining}</span>{" "}
          {remaining === 1 ? "code" : "codes"} remaining
        </p>
      ) : null}

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

        <div>
          <Button type="submit" loading={busy}>
            Regenerate recovery codes
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
