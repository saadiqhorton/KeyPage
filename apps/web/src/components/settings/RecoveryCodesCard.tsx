import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { Spinner } from "@/components/ui/Spinner";

import { RecoveryCodesPanel } from "./RecoveryCodesPanel";

type RecoveryCodesCardProps = {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  codes: string[] | null;
  onRegenerate(password: string): Promise<void>;
  onSuccessAcknowledged(): void;
};

export function RecoveryCodesCard({
  remaining,
  loadingRemaining,
  busy,
  error,
  codes,
  onRegenerate,
  onSuccessAcknowledged,
}: RecoveryCodesCardProps) {
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy && codes === null) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [busy, codes]);

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

  if (codes) {
    return (
      <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-text">New recovery codes</h3>
          <p className="text-xs text-muted">
            Your previous recovery codes no longer work. Save this new set
            offline.
          </p>
        </div>
        <RecoveryCodesPanel
          codes={codes}
          onAcknowledged={onSuccessAcknowledged}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text">Recovery codes</h3>
        <p className="text-xs text-muted">
          One-time codes for account recovery if you forget your Master Password.
        </p>
      </div>

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
    </div>
  );
}
