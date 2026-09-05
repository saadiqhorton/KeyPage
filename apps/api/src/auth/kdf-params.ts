import {
  AES_GCM_IV_BYTES,
  DERIVED_KEY_BYTES,
  KDF_SALT_BYTES,
  RECOVERY_CODE_COUNT,
  type KdfParams,
  type RecoveryCodeEnvelope,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";

const LOOKUP_HASH_PATTERN = /^[0-9a-f]{64}$/;
const WRAPPED_MASTER_KEY_BYTES =
  AES_GCM_IV_BYTES + DERIVED_KEY_BYTES + 16;

const KDF_BOUNDS = {
  argon2id: {
    iterations: { min: 2, max: 10 },
    memoryKiB: { min: 19456, max: 262144 },
    parallelism: { min: 1, max: 4 },
  },
  "pbkdf2-sha256": {
    iterations: { min: 300_000, max: 5_000_000 },
  },
} as const;

function decodeBase64Length(value: string): number | null {
  try {
    return Buffer.from(value, "base64").length;
  } catch {
    return null;
  }
}

function rejectKdf(field: string, message: string, headline = "Invalid KDF parameters"): never {
  throw new HttpInvalidRequest(headline, [{ field, message }]);
}

function validateSaltB64(saltB64: string, field: string): void {
  const length = decodeBase64Length(saltB64);
  if (length !== KDF_SALT_BYTES) {
    rejectKdf(field, "salt must decode to exactly 16 bytes", `Invalid ${field}: salt must decode to 16 bytes`);
  }
}

function requireInRange(
  value: number,
  min: number,
  max: number,
  field: string,
): void {
  if (value < min || value > max) {
    rejectKdf(field, `must be between ${min} and ${max}`);
  }
}

function validateArgon2idParams(kdf: KdfParams, fieldPrefix: string): void {
  const bounds = KDF_BOUNDS.argon2id;

  if (kdf.memoryKiB === undefined) {
    rejectKdf(`${fieldPrefix}.memoryKiB`, "required for argon2id");
  }
  if (kdf.parallelism === undefined) {
    rejectKdf(`${fieldPrefix}.parallelism`, "required for argon2id");
  }

  requireInRange(
    kdf.memoryKiB,
    bounds.memoryKiB.min,
    bounds.memoryKiB.max,
    `${fieldPrefix}.memoryKiB`,
  );
  requireInRange(
    kdf.iterations,
    bounds.iterations.min,
    bounds.iterations.max,
    `${fieldPrefix}.iterations`,
  );
  requireInRange(
    kdf.parallelism,
    bounds.parallelism.min,
    bounds.parallelism.max,
    `${fieldPrefix}.parallelism`,
  );
}

function validatePbkdf2Params(kdf: KdfParams, fieldPrefix: string): void {
  const bounds = KDF_BOUNDS["pbkdf2-sha256"];

  if (kdf.memoryKiB !== undefined) {
    rejectKdf(`${fieldPrefix}.memoryKiB`, "must be absent for pbkdf2-sha256");
  }
  if (kdf.parallelism !== undefined) {
    rejectKdf(`${fieldPrefix}.parallelism`, "must be absent for pbkdf2-sha256");
  }
  requireInRange(
    kdf.iterations,
    bounds.iterations.min,
    bounds.iterations.max,
    `${fieldPrefix}.iterations`,
  );
}

export function validateKdfParams(kdf: KdfParams, fieldPrefix = "kdf"): void {
  validateSaltB64(kdf.saltB64, `${fieldPrefix}.saltB64`);

  if (kdf.algorithm === "argon2id") {
    validateArgon2idParams(kdf, fieldPrefix);
    return;
  }

  if (kdf.algorithm === "pbkdf2-sha256") {
    validatePbkdf2Params(kdf, fieldPrefix);
    return;
  }

  rejectKdf(`${fieldPrefix}.algorithm`, "unsupported algorithm");
}

export function validateRecoveryEnvelopes(
  recoveryCodes: RecoveryCodeEnvelope[],
): void {
  if (recoveryCodes.length !== RECOVERY_CODE_COUNT) {
    throw new HttpInvalidRequest("Invalid recovery codes", [
      {
        field: "recoveryCodes",
        message: `expected exactly ${RECOVERY_CODE_COUNT} recovery codes`,
      },
    ]);
  }

  const seenLookupHashes = new Set<string>();

  recoveryCodes.forEach((envelope, index) => {
    const fieldPrefix = `recoveryCodes[${index}]`;

    if (!LOOKUP_HASH_PATTERN.test(envelope.lookupHash)) {
      throw new HttpInvalidRequest("Invalid recovery codes", [
        {
          field: `${fieldPrefix}.lookupHash`,
          message: "must be 64 lowercase hex characters",
        },
      ]);
    }

    if (seenLookupHashes.has(envelope.lookupHash)) {
      throw new HttpInvalidRequest("Invalid recovery codes", [
        {
          field: `${fieldPrefix}.lookupHash`,
          message: "lookup hashes must be unique",
        },
      ]);
    }
    seenLookupHashes.add(envelope.lookupHash);

    const wrappedLength = decodeBase64Length(envelope.wrappedMasterKeyB64);
    if (wrappedLength !== WRAPPED_MASTER_KEY_BYTES) {
      throw new HttpInvalidRequest("Invalid recovery codes", [
        {
          field: `${fieldPrefix}.wrappedMasterKeyB64`,
          message: `must decode to exactly ${WRAPPED_MASTER_KEY_BYTES} bytes`,
        },
      ]);
    }

    validateKdfParams(envelope.kdf, `${fieldPrefix}.kdf`);
  });
}
