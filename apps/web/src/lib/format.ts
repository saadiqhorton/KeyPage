import { RECOVERY_CODE_GROUP_LENGTH, RECOVERY_CODE_GROUPS } from "@keypage/shared";

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatEntryDate(iso: string): string {
  return `Added ${formatShortDate(iso)}`;
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatKeyCount(count: number): string {
  return count === 1 ? "1 key" : `${count} keys`;
}

const RECOVERY_INPUT_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_RECOVERY_CHARS = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;

function mapRecoveryInputChar(char: string): string | null {
  switch (char) {
    case "O":
      return "0";
    case "I":
    case "L":
      return "1";
    default:
      return RECOVERY_INPUT_ALPHABET.includes(char) ? char : null;
  }
}

/** Uppercase, Crockford-normalize, and insert dashes while typing. */
export function formatRecoveryCodeInput(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  let normalized = "";

  for (const char of stripped) {
    if (normalized.length >= MAX_RECOVERY_CHARS) break;
    const mapped = mapRecoveryInputChar(char);
    if (mapped) normalized += mapped;
  }

  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_GROUPS; i++) {
    const start = i * RECOVERY_CODE_GROUP_LENGTH;
    const slice = normalized.slice(start, start + RECOVERY_CODE_GROUP_LENGTH);
    if (!slice) break;
    groups.push(slice);
  }

  return groups.join("-");
}
