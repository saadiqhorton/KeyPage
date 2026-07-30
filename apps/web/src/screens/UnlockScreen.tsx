import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api.js";
import { formatCountdown } from "@/lib/format.js";
import { useVault } from "@/vault/useVault";

export function UnlockScreen() {
  const { state, actions } = useVault();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const working = state.phase === "working";
  const locked = state.phase === "locked";
  const lockout = locked ? state.lockout : null;
  const lockoutActive = lockout?.locked ?? false;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await actions.unlock(password);
      setPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unlock failed. Please try again.");
      }
    }
  }

  const reasonBanner =
    locked && state.reason === "idle"
      ? "Locked after inactivity."
      : locked && state.reason === "session_expired"
        ? "Your session expired."
        : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl">Unlock vault</h1>
      {reasonBanner ? <p>{reasonBanner}</p> : null}
      {lockoutActive ? (
        <p aria-live="polite">
          Too many attempts. Try again in {formatCountdown(lockout!.retryAfterSeconds)}.
        </p>
      ) : null}
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span>Master Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={working || lockoutActive}
          />
        </label>
        {error ? (
          <p className="text-danger" aria-live="polite">
            {error}
          </p>
        ) : null}
        {working ? <p>{state.phase === "working" ? state.label : "Working…"}</p> : null}
        <button type="submit" disabled={working || lockoutActive}>
          Unlock
        </button>
      </form>
      <Link
        to="/recover"
        onClick={() => actions.startRecovery()}
      >
        Use a recovery code
      </Link>
    </main>
  );
}
