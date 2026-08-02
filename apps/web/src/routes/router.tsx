import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";

import { DashboardScreen } from "@/screens/DashboardScreen";
import { RecoverScreen } from "@/screens/RecoverScreen";
import { RecoveryCodesScreen } from "@/screens/RecoveryCodesScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SetupScreen } from "@/screens/SetupScreen";
import { UnlockScreen } from "@/screens/UnlockScreen";
import { useVault } from "@/vault/useVault";

function LoadingGate() {
  const { state } = useVault();

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

function RequireUnlocked({
  children,
  rendersRecoveryCodes = false,
}: {
  children: React.ReactNode;
  rendersRecoveryCodes?: boolean;
}) {
  const { state, wizard } = useVault();

  if (state.phase === "loading" || state.phase === "unavailable") {
    return null;
  }

  // Settings renders freshly issued codes inline, so it may stay mounted while
  // they are pending. Every other route hands them to the dedicated screen so
  // the only copy in memory cannot be navigated or locked away.
  if (
    state.phase === "unlocked" &&
    (wizard.kind === "none" || (wizard.kind === "codes" && rendersRecoveryCodes))
  ) {
    return children;
  }

  if (wizard.kind === "codes") {
    return <Navigate to="/recovery-codes" replace />;
  }
  if (wizard.kind === "setup") {
    return <Navigate to="/setup" replace />;
  }
  if (wizard.kind === "recovery") {
    return <Navigate to="/recover" replace />;
  }
  if (state.phase === "setup_required") {
    return <Navigate to="/setup" replace />;
  }
  return <Navigate to="/unlock" replace />;
}

function RequireRecoveryCodes({ children }: { children: React.ReactNode }) {
  const { state, wizard } = useVault();

  if (state.phase === "loading" || state.phase === "unavailable") {
    return null;
  }

  if (wizard.kind === "codes") {
    return children;
  }

  return <Navigate to="/" replace />;
}

function RequireWizard({
  kind,
  children,
}: {
  kind: "setup" | "recovery";
  children: React.ReactNode;
}) {
  const { state, wizard } = useVault();

  if (state.phase === "loading" || state.phase === "unavailable") {
    return null;
  }

  if (wizard.kind === "codes") {
    return <Navigate to="/recovery-codes" replace />;
  }

  if (kind === "setup") {
    if (state.phase === "setup_required" || wizard.kind === "setup") {
      return children;
    }
    if (state.phase === "unlocked" && wizard.kind === "none") {
      return <Navigate to="/" replace />;
    }
    return <Navigate to="/unlock" replace />;
  }

  if (state.phase === "locked" || wizard.kind === "recovery") {
    return children;
  }
  if (state.phase === "unlocked" && wizard.kind === "none") {
    return <Navigate to="/" replace />;
  }
  return <Navigate to="/setup" replace />;
}

function RequireLocked({ children }: { children: React.ReactNode }) {
  const { state, wizard } = useVault();

  if (state.phase === "loading" || state.phase === "unavailable") {
    return null;
  }

  if (
    (state.phase === "locked" || state.phase === "working") &&
    wizard.kind === "none"
  ) {
    return children;
  }

  if (wizard.kind === "codes") {
    return <Navigate to="/recovery-codes" replace />;
  }
  if (wizard.kind === "setup") {
    return <Navigate to="/setup" replace />;
  }
  if (wizard.kind === "recovery") {
    return <Navigate to="/recover" replace />;
  }
  if (state.phase === "unlocked") {
    return <Navigate to="/" replace />;
  }
  return <Navigate to="/setup" replace />;
}

export const router = createBrowserRouter([
  {
    element: <LoadingGate />,
    children: [
      {
        path: "/",
        element: (
          <RequireUnlocked>
            <DashboardScreen />
          </RequireUnlocked>
        ),
      },
      {
        path: "/settings",
        element: (
          <RequireUnlocked rendersRecoveryCodes>
            <SettingsScreen />
          </RequireUnlocked>
        ),
      },
      {
        path: "/recovery-codes",
        element: (
          <RequireRecoveryCodes>
            <RecoveryCodesScreen />
          </RequireRecoveryCodes>
        ),
      },
      {
        path: "/setup",
        element: (
          <RequireWizard kind="setup">
            <SetupScreen />
          </RequireWizard>
        ),
      },
      {
        path: "/unlock",
        element: (
          <RequireLocked>
            <UnlockScreen />
          </RequireLocked>
        ),
      },
      {
        path: "/recover",
        element: (
          <RequireWizard kind="recovery">
            <RecoverScreen />
          </RequireWizard>
        ),
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
