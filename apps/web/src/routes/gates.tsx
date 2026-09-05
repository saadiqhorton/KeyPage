import { type ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";
import { useWarnBeforeUnload } from "@/hooks/useWarnBeforeUnload";
import { resolveGuard, type RouteGuard } from "@/routes/guards";
import {
  isRecoveryCodesParked,
  recoveryCodesExposurePending,
} from "@/vault/recovery-codes-pending";
import { useVault } from "@/vault/useVault";

export function LoadingGate() {
  const { state, wizard, issuingRecoveryCodes } = useVault();
  useWarnBeforeUnload(recoveryCodesExposurePending(wizard, issuingRecoveryCodes));

  if (isRecoveryCodesParked(wizard)) {
    return <Outlet />;
  }

  if (state.phase === "loading") {
    return (
      <AuthShell chip="STARTING">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-muted">Loading vault…</p>
        </div>
      </AuthShell>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <AuthShell chip="UNAVAILABLE">
        <Callout tone="danger">{state.message}</Callout>
      </AuthShell>
    );
  }

  return <Outlet />;
}

export function Guarded({
  guard,
  children,
}: Readonly<{
  guard: RouteGuard;
  children: ReactNode;
}>) {
  const { state, wizard } = useVault();
  const decision = resolveGuard(guard, state.phase, wizard);

  if (decision.kind === "wait") {
    return null;
  }
  if (decision.kind === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  return children;
}
