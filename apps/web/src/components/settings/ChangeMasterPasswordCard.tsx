import { FormEvent, useEffect, useState } from "react";

import { MASTER_PASSWORD_MIN_LENGTH } from "@keypage/shared";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { PasswordStrengthHint } from "@/components/ui/PasswordStrengthHint";
import { Spinner } from "@/components/ui/Spinner";

type ChangeMasterPasswordCardProps = {
  busy: boolean;
  error: string | null;
  progress: string | null;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
};

export function ChangeMasterPasswordCard({
  busy,
  error,
  progress,
  onChangePassword,
}: ChangeMasterPasswordCardProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Leaving mid-re-encryption would abandon a half-rotated vault; the codes it
  // issues are guarded by the /recovery-codes screen it hands them to.
  useEffect(() => {
    if (!busy) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [busy]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!currentPassword) {
      setFormError("Enter your current Master Password.");
      return;
    }
    if (newPassword.length < MASTER_PASSWORD_MIN_LENGTH) {
      setFormError(
        `New Master Password must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword !== confirm) {
      setFormError("New passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setFormError("New Master Password must be different from the current one.");
      return;
    }

    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch {
      // Error surfaced via parent hook.
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text">Change Master Password</h3>
        <p className="text-xs text-muted">
          Re-encrypts every key entry in your browser and issues a new set of
          recovery codes.
        </p>
      </div>

      <Callout tone="warning">
        Changing your Master Password generates new recovery codes and signs out
        other browser sessions. Download and store the new codes before closing
        this page.
      </Callout>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <PasswordField
          label="Current Master Password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={busy}
          autoComplete="current-password"
        />
        <PasswordField
          label="New Master Password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={busy}
          autoComplete="new-password"
        />
        <PasswordStrengthHint password={newPassword} />
        <PasswordField
          label="Confirm new Master Password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={busy}
          autoComplete="new-password"
          error={
            confirm && newPassword !== confirm ? "Passwords do not match." : undefined
          }
        />

        {(formError ?? error) ? (
          <p className="text-sm text-danger" role="alert">
            {formError ?? error}
          </p>
        ) : null}

        {busy && progress ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            <span>{progress}</span>
          </div>
        ) : null}

        <div>
          <Button type="submit" loading={busy}>
            Change Master Password
          </Button>
        </div>
      </form>
    </div>
  );
}
