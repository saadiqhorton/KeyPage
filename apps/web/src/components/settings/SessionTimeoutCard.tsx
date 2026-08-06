import { FormEvent, useEffect, useState } from "react";

import {
  type IdleTimeoutSource,
  SESSION_IDLE_MINUTES_OPTIONS,
} from "@keypage/shared";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";

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
      <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" />
          <span>Loading session settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text">Session timeout</h3>
        <p className="text-xs text-muted">
          Lock the vault after this period of inactivity.
        </p>
      </div>

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
          <label className="flex flex-col gap-2 text-sm text-text">
            <span>Inactivity timeout</span>
            <select
              className="rounded-sm border border-hairline bg-obsidian/50 px-3 py-2 text-sm text-text outline-none focus:border-brass/60"
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
            </select>
          </label>

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
    </div>
  );
}
