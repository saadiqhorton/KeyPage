import { DashboardShell } from "@/components/DashboardShell";
import { EmptyVaultState } from "@/components/EmptyVaultState";
import { StatusPanel } from "@/components/StatusPanel";
import { useHealth } from "@/hooks/useHealth";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const health = useHealth();
  const { actions } = useVault();

  return (
    <DashboardShell
      onLock={() => void actions.lock("manual")}
      footer={<StatusPanel health={health} />}
      content={<EmptyVaultState />}
    />
  );
}
