import { useNavigate } from "react-router-dom";

import { BackupExportCard } from "@/components/settings/BackupExportCard";
import { BackupImportCard } from "@/components/settings/BackupImportCard";
import { ChangeMasterPasswordCard } from "@/components/settings/ChangeMasterPasswordCard";
import { RecoveryCodesCard } from "@/components/settings/RecoveryCodesCard";
import { SessionTimeoutCard } from "@/components/settings/SessionTimeoutCard";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DashboardShell } from "@/components/DashboardShell";
import { IdleWarningToast } from "@/components/IdleWarningToast";
import { Button } from "@/components/ui/Button";
import { formatCountdown } from "@/lib/format";
import { useAppSettings } from "@/vault/useAppSettings";
import { useBackup } from "@/vault/useBackup";
import { useChangeMasterPassword } from "@/vault/useChangeMasterPassword";
import { useIdleLock } from "@/vault/useIdleLock";
import { useKeyEntries } from "@/vault/useKeyEntries";
import { useRecoveryCodes } from "@/vault/useRecoveryCodes";
import { useVault } from "@/vault/useVault";

export function SettingsScreen() {
  const navigate = useNavigate();
  const { state, actions } = useVault();
  const { warningVisible, secondsRemaining, stayUnlocked } = useIdleLock();
  const vaultUnlocked = state.phase === "unlocked";
  const { entries, reload } = useKeyEntries(vaultUnlocked);
  const { exportBusy, importBusy, exportBackup, importBackup } = useBackup();
  const passwordChange = useChangeMasterPassword();
  const recoveryCodes = useRecoveryCodes();
  const appSettings = useAppSettings();

  async function handleImport(fileText: string, password: string) {
    const outcome = await importBackup(fileText, password);
    if (outcome.imported > 0) {
      await reload();
    }
    return outcome;
  }

  async function handleChangePassword(
    currentPassword: string,
    newPassword: string,
  ) {
    await passwordChange.changePassword(currentPassword, newPassword);
    await actions.refreshStatus();
    await reload();
  }

  async function handleRegenerateRecoveryCodes(password: string) {
    await recoveryCodes.regenerate(password);
    await actions.refreshStatus();
    await recoveryCodes.refreshRemaining();
  }

  async function handleSaveSessionTimeout() {
    await appSettings.save();
    await actions.refreshStatus();
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
              title="Master Password"
              description="Change your Master Password. KeyPage re-encrypts every key entry in your browser before saving the new verifier."
            >
              <ChangeMasterPasswordCard
                busy={passwordChange.busy}
                error={passwordChange.error}
                progress={passwordChange.progress}
                codes={passwordChange.codes}
                onChangePassword={handleChangePassword}
                onSuccessAcknowledged={() => {
                  passwordChange.clearCodes();
                }}
              />
            </SettingsSection>

            <SettingsSection
              title="Recovery codes"
              description="View how many recovery codes remain and generate a fresh set when needed."
            >
              <RecoveryCodesCard
                remaining={recoveryCodes.remaining}
                loadingRemaining={recoveryCodes.loadingRemaining}
                busy={recoveryCodes.busy}
                error={recoveryCodes.error}
                codes={recoveryCodes.codes}
                onRegenerate={handleRegenerateRecoveryCodes}
                onSuccessAcknowledged={() => {
                  recoveryCodes.clearCodes();
                }}
              />
            </SettingsSection>

            <SettingsSection
              title="Session"
              description="Configure how long KeyPage stays unlocked during inactivity."
            >
              <SessionTimeoutCard
                loading={appSettings.loading}
                sessionIdleMinutes={appSettings.sessionIdleMinutes}
                sessionIdleSource={appSettings.sessionIdleSource}
                saveBusy={appSettings.saveBusy}
                error={appSettings.error}
                success={appSettings.success}
                onSessionIdleMinutesChange={appSettings.setSessionIdleMinutes}
                onSave={handleSaveSessionTimeout}
                onClearSuccess={appSettings.clearSuccess}
              />
            </SettingsSection>

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
