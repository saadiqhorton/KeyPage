export const RECOVERY_CODE_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_GROUPS = 4;
export const RECOVERY_CODE_GROUP_LENGTH = 5;

const EXPECTED_CODE_LENGTH = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;

function mapCrockfordChar(char: string): string | null {
  switch (char) {
    case "O":
      return "0";
    case "I":
    case "L":
      return "1";
    default:
      return RECOVERY_CODE_ALPHABET.includes(char) ? char : null;
  }
}

/** Uppercase, strip non-alphanumerics, Crockford-map O→0 and I/L→1. Returns null if invalid. */
export function normalizeRecoveryCode(input: string): string | null {
  const stripped = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (stripped.length !== EXPECTED_CODE_LENGTH) {
    return null;
  }

  let normalized = "";
  for (const char of stripped) {
    const mapped = mapCrockfordChar(char);
    if (mapped === null) {
      return null;
    }
    normalized += mapped;
  }

  return normalized;
}

/** "3F7KQ9MTXB2WVHD8ZCRN" → "3F7KQ-9MTXB-2WVHD-8ZCRN" */
export function formatRecoveryCode(normalized: string): string {
  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_GROUPS; i++) {
    const start = i * RECOVERY_CODE_GROUP_LENGTH;
    groups.push(
      normalized.slice(start, start + RECOVERY_CODE_GROUP_LENGTH),
    );
  }
  return groups.join("-");
}
