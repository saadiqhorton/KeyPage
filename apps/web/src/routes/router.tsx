import { Navigate, createBrowserRouter } from "react-router-dom";

import { Guarded, LoadingGate } from "@/routes/gates";
import { DashboardScreen } from "@/screens/DashboardScreen";
import { RecoverScreen } from "@/screens/RecoverScreen";
import { RecoveryCodesScreen } from "@/screens/RecoveryCodesScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SetupScreen } from "@/screens/SetupScreen";
import { UnlockScreen } from "@/screens/UnlockScreen";

export { Guarded, LoadingGate } from "@/routes/gates";

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
