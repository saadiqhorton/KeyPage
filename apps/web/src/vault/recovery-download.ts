import { buildRecoveryCodesFileText } from "@/crypto/recovery.js";
import { downloadTextFile } from "@/lib/download.js";

export function downloadRecoveryCodes(codes: string[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const text = buildRecoveryCodesFileText(codes);
  downloadTextFile(`keypage-recovery-codes-${date}.txt`, text);
}
