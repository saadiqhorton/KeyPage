import { useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { StepIndicator } from "@/components/StepIndicator";
import { RecoveryCodesPanel } from "@/components/settings/RecoveryCodesPanel";
import { Callout } from "@/components/ui/Callout";
import { useVault } from "@/vault/useVault";

const SETUP_STEPS = [
  "Create Master Password",
  "Save recovery codes",
  "Vault ready",
];

export function titleForReason(
  reason: "setup" | "recovery" | "password_change" | "regen",
): string {
  switch (reason) {
    case "setup":
      return "Save these recovery codes offline. Any one code can recover your vault.";
    case "recovery":
      return "Save your new recovery codes offline.";
    case "password_change":
      return "Your Master Password was changed. Save these recovery codes offline.";
    case "regen":
      return "Save your new recovery codes offline.";
  }
}

export function RecoveryCodesScreen() {
  const navigate = useNavigate();
  const { state, wizard, actions } = useVault();

  if (wizard.kind !== "codes") {
    return null;
  }

  const unavailable = state.phase === "unavailable";
  const locked = state.phase !== "unlocked" && !unavailable;
  const title = titleForReason(wizard.reason);

  let vaultStateCallout = null;
  if (unavailable) {
    vaultStateCallout = (
      <Callout tone="info">
        The server could not be reached. Save these codes before leaving this
        page, then choose Done.
      </Callout>
    );
  } else if (locked) {
    vaultStateCallout = (
      <Callout tone="info">
        The vault locked while these codes were on screen. Save them, then
        choose Done to go back to the unlock screen.
      </Callout>
    );
  }

  return (
    <AuthShell chip="RECOVERY CODES" title={title}>
      <div className="flex flex-col gap-4">
        {wizard.reason === "setup" ? (
          <StepIndicator steps={SETUP_STEPS} currentStep={2} />
        ) : null}
        <Callout tone="warning">
          {wizard.reason === "setup"
            ? "These codes are shown only once. They are not stored anywhere you can read them again."
            : "These codes replace your previous set and are shown only once. They are not stored anywhere you can read them again."}
        </Callout>
        {vaultStateCallout}
        <RecoveryCodesPanel
          codes={wizard.codes}
          onAcknowledged={() => {
            const outcome = actions.acknowledgeRecoveryCodes();
            navigate(outcome.navigateTo);
          }}
        />
      </div>
    </AuthShell>
  );
}
