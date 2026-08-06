import { AuthShell } from "@/components/AuthShell";
import { RecoveryCodesPanel } from "@/components/settings/RecoveryCodesPanel";
import { Callout } from "@/components/ui/Callout";
import { useWarnBeforeUnload } from "@/hooks/useWarnBeforeUnload";
import { useVault } from "@/vault/useVault";

export function RecoveryCodesScreen() {
  const { state, wizard, actions } = useVault();
  const codesPending = wizard.kind === "codes";

  useWarnBeforeUnload(codesPending);

  if (wizard.kind !== "codes") {
    return null;
  }

  const locked = state.phase !== "unlocked";
  const title =
    wizard.reason === "password_change"
      ? "Your Master Password was changed. Save these recovery codes offline."
      : "Save your new recovery codes offline.";

  return (
    <AuthShell chip="RECOVERY CODES" title={title}>
      <div className="flex flex-col gap-4">
        <Callout tone="warning">
          These codes replace your previous set and are shown only once. They
          are not stored anywhere you can read them again.
        </Callout>
        {locked ? (
          <Callout tone="info">
            The vault locked while these codes were on screen. Save them, then
            choose Done to go back to the unlock screen.
          </Callout>
        ) : null}
        <RecoveryCodesPanel
          codes={wizard.codes}
          onAcknowledged={() => actions.finishWizard()}
        />
      </div>
    </AuthShell>
  );
}
