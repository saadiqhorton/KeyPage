import type { WizardState } from "./useVault.js";

export function isRecoveryCodesParked(wizard: WizardState): boolean {
  return wizard.kind === "codes";
}

export function isRecoveryCodesMintInFlight(
  issuingRecoveryCodes: boolean,
): boolean {
  return issuingRecoveryCodes;
}

export function recoveryCodesExposurePending(
  wizard: WizardState,
  issuingRecoveryCodes: boolean,
): boolean {
  return isRecoveryCodesParked(wizard) || isRecoveryCodesMintInFlight(issuingRecoveryCodes);
}
