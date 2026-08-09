import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";
import { useWarnBeforeUnload } from "@/hooks/useWarnBeforeUnload";
import { resolveGuard, type RouteGuard } from "@/routes/guards";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { RecoverScreen } from "@/screens/RecoverScreen";
import { RecoveryCodesScreen } from "@/screens/RecoveryCodesScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SetupScreen } from "@/screens/SetupScreen";
import { UnlockScreen } from "@/screens/UnlockScreen";
import {
  isRecoveryCodesParked,
  recoveryCodesExposurePending,
} from "@/vault/recovery-codes-pending";
import { useVault } from "@/vault/useVault";

function LoadingGate() {
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

function Guarded({
  guard,
  children,
}: {
  guard: RouteGuard;
  children: React.ReactNode;
}) {
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

export const router = createBrowserRouter([
  {
    element: <LoadingGate />,
    children: [
      {
        path: "/",
        element: (
          <Guarded guard="unlocked">
            <DashboardScreen />
          </Guarded>
        ),
      },
      {
        path: "/settings",
        element: (
          <Guarded guard="unlocked">
            <SettingsScreen />
          </Guarded>
        ),
      },
      {
        path: "/recovery-codes",
        element: (
          <Guarded guard="recovery-codes">
            <RecoveryCodesScreen />
          </Guarded>
        ),
      },
      {
        path: "/setup",
        element: (
          <Guarded guard="setup-wizard">
            <SetupScreen />
          </Guarded>
        ),
      },
      {
        path: "/unlock",
        element: (
          <Guarded guard="locked">
            <UnlockScreen />
          </Guarded>
        ),
      },
      {
        path: "/recover",
        element: (
          <Guarded guard="recovery-wizard">
            <RecoverScreen />
          </Guarded>
        ),
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
