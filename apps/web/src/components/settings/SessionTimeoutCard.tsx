import { FormEvent, useEffect, useState } from "react";

import {
  type IdleTimeoutSource,
  SESSION_IDLE_MINUTES_OPTIONS,
} from "@keypage/shared";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";
import { SelectField } from "@/components/ui/SelectField";
import { SettingsCard } from "@/components/settings/SettingsCard";

type SessionTimeoutSettings = {
  loading: boolean;
  sessionIdleMinutes: number | null;
  sessionIdleSource: IdleTimeoutSource | null;
  saveBusy: boolean;
  error: string | null;
  success: boolean;
};

type SessionTimeoutCardProps = {
  settings: SessionTimeoutSettings;
  onSessionIdleMinutesChange(minutes: number): void;
  onSave(): Promise<void>;
  onClearSuccess(): void;
};

export function SessionTimeoutCard({
  settings,
  onSessionIdleMinutesChange,
  onSave,
  onClearSuccess,
}: SessionTimeoutCardProps) {
  const {
    loading,
    sessionIdleMinutes,
    sessionIdleSource,
    saveBusy,
    error,
    success,
  } = settings;
  const [dirty, setDirty] = useState(false);
  const readOnly = sessionIdleSource === "env";

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      onClearSuccess();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [success, onClearSuccess]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || sessionIdleMinutes === null) return;

    try {
      await onSave();
      setDirty(false);
    } catch {
      // Error surfaced via parent hook.
    }
  }

  if (loading) {
    return (
      <SettingsCard
        title="Session timeout"
        description="Lock the vault after this period of inactivity."
      >
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" />
          <span>Loading session settings…</span>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Session timeout"
      description="Lock the vault after this period of inactivity."
    >
      {readOnly ? (
        <Callout tone="info">
          Session timeout is set by the server environment variable{" "}
          <span className="font-mono text-xs">KEYPAGE_SESSION_IDLE_MINUTES</span>{" "}
          and cannot be changed here.
          {sessionIdleMinutes !== null ? (
            <>
              {" "}
              Current value:{" "}
              <span className="font-medium">{sessionIdleMinutes} minutes</span>.
            </>
          ) : null}
        </Callout>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <SelectField
            label="Inactivity timeout"
            value={sessionIdleMinutes ?? ""}
            disabled={saveBusy || sessionIdleMinutes === null}
            onChange={(event) => {
              onSessionIdleMinutesChange(Number(event.target.value));
              setDirty(true);
              onClearSuccess();
            }}
          >
            {SESSION_IDLE_MINUTES_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </SelectField>

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {success ? (
            <Callout tone="info">Session timeout saved.</Callout>
          ) : null}

          <div>
            <Button type="submit" loading={saveBusy} disabled={!dirty}>
              Save
            </Button>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}
