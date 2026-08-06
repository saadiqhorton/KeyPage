import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";

import { resolveGuard, type RouteGuard } from "@/routes/guards";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { RecoverScreen } from "@/screens/RecoverScreen";
import { RecoveryCodesScreen } from "@/screens/RecoveryCodesScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SetupScreen } from "@/screens/SetupScreen";
import { UnlockScreen } from "@/screens/UnlockScreen";
import { useVault } from "@/vault/useVault";

function LoadingGate() {
  const { state, wizard } = useVault();

  if (wizard.kind === "codes") {
    return <Outlet />;
  }

  if (state.phase === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-muted">Loading vault…</p>
      </div>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <p className="max-w-md text-center text-danger">{state.message}</p>
      </div>
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
  const decision = resolveGuard(guard, state.phase, wizard.kind);

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
