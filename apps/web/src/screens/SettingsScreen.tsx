import { useNavigate } from "react-router-dom";

import { BackupExportCard } from "@/components/settings/BackupExportCard";
import { BackupImportCard } from "@/components/settings/BackupImportCard";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DashboardShell } from "@/components/DashboardShell";
import { IdleWarningToast } from "@/components/IdleWarningToast";
import { Button } from "@/components/ui/Button";
import { formatCountdown } from "@/lib/format";
import { useBackup } from "@/vault/useBackup";
import { useIdleLock } from "@/vault/useIdleLock";
import { useKeyEntries } from "@/vault/useKeyEntries";
import { useVault } from "@/vault/useVault";

export function SettingsScreen() {
  const navigate = useNavigate();
  const { state, actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();
  const vaultUnlocked = state.phase === "unlocked";
  const { entries, reload } = useKeyEntries(vaultUnlocked);
  const { exportBusy, importBusy, exportBackup, importBackup } = useBackup();

  async function handleImport(fileText: string, password: string) {
    const outcome = await importBackup(fileText, password);
    if (outcome.imported > 0) {
      await reload();
    }
    return outcome;
  }

  const headerActions = (
    <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
      Back to vault
    </Button>
  );

  return (
    <>
      <DashboardShell
        onLock={() => void actions.lock("manual")}
        idleCountdown={
          warningVisible ? formatCountdown(secondsRemaining) : null
        }
        actions={headerActions}
        content={
          <div className="flex flex-col gap-10">
            <h1 className="font-display text-3xl font-medium tracking-[-0.03em] text-text">
              Settings
            </h1>

            <SettingsSection
              title="Encrypted backup"
              description="Export or import an encrypted backup of your key entries. Backups are encrypted in your browser and can be restored on a fresh KeyPage instance."
            >
              <div className="flex flex-col gap-6">
                <BackupExportCard
                  entryCount={entries.length}
                  busy={exportBusy}
                  onExport={exportBackup}
                />
                <BackupImportCard busy={importBusy} onImport={handleImport} />
              </div>
            </SettingsSection>
          </div>
        }
      />
      <IdleWarningToast
        visible={warningVisible}
        secondsRemaining={secondsRemaining}
        onStayUnlocked={stayUnlocked}
      />
    </>
  );
}
