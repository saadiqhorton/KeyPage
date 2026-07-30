import { DashboardShell } from "@/components/DashboardShell";
import { EmptyVaultState } from "@/components/EmptyVaultState";
import { IdleWarningToast } from "@/components/IdleWarningToast";
import { StatusPanel } from "@/components/StatusPanel";
import { useHealth } from "@/hooks/useHealth";
import { formatCountdown } from "@/lib/format";
import { useIdleLock } from "@/vault/useIdleLock";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const health = useHealth();
  const { actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();

  return (
    <>
      <DashboardShell
        onLock={() => void actions.lock("manual")}
        idleCountdown={
          warningVisible ? formatCountdown(secondsRemaining) : null
        }
        footer={<StatusPanel health={health} />}
        content={<EmptyVaultState />}
      />
      <IdleWarningToast
        visible={warningVisible}
        secondsRemaining={secondsRemaining}
        onStayUnlocked={stayUnlocked}
      />
    </>
  );
}
