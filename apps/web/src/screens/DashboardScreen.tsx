import { type ReactNode, useState } from "react";

import { AddKeyModal } from "@/components/keys/AddKeyModal";
import { KeyEntryCardGrid } from "@/components/keys/KeyEntryCardGrid";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyVaultState } from "@/components/EmptyVaultState";
import { IdleWarningToast } from "@/components/IdleWarningToast";
import { StatusPanel } from "@/components/StatusPanel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Spinner } from "@/components/ui/Spinner";
import { useHealth } from "@/hooks/useHealth";
import { formatCountdown } from "@/lib/format";
import { useIdleLock } from "@/vault/useIdleLock";
import { useKeyEntries } from "@/vault/useKeyEntries.js";
import { useVault } from "@/vault/useVault";

export function DashboardScreen() {
  const health = useHealth();
  const { state, actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();
  const vaultUnlocked = state.phase === "unlocked";
  const { status, entries, error, createKeyEntry } = useKeyEntries(vaultUnlocked);
  const [addKeyOpen, setAddKeyOpen] = useState(false);

  function openAddKey() {
    setAddKeyOpen(true);
  }

  let content: ReactNode;

  if (!vaultUnlocked || status === "loading") {
    content = (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner label="Loading key entries" />
      </div>
    );
  } else if (status === "error") {
    content = (
      <Callout tone="danger">{error ?? "Failed to load key entries."}</Callout>
    );
  } else if (entries.length === 0) {
    content = (
      <EmptyVaultState onAddKey={openAddKey} />
    );
  } else {
    content = <KeyEntryCardGrid entries={entries} />;
  }

  const headerActions =
    vaultUnlocked && status === "ready" && entries.length > 0 ? (
      <Button size="sm" onClick={openAddKey}>
        Add Key
      </Button>
    ) : null;

  return (
    <>
      <DashboardShell
        onLock={() => void actions.lock("manual")}
        idleCountdown={
          warningVisible ? formatCountdown(secondsRemaining) : null
        }
        actions={headerActions}
        footer={<StatusPanel health={health} />}
        content={content}
      />
      <IdleWarningToast
        visible={warningVisible}
        secondsRemaining={secondsRemaining}
        onStayUnlocked={stayUnlocked}
      />
      <AddKeyModal
        open={addKeyOpen}
        onClose={() => setAddKeyOpen(false)}
        onCreate={createKeyEntry}
      />
    </>
  );
}
