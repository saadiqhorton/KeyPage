import {
  AES_GCM_IV_BYTES,
  KEY_ENTRY_CIPHERTEXT_B64_MAX,
  KeyEntryFieldError,
  normalizeDescription as sharedNormalizeDescription,
  normalizeKeyEntryWriteFields as sharedNormalizeKeyEntryWriteFields,
  normalizeLabel as sharedNormalizeLabel,
  normalizeTags as sharedNormalizeTags,
  validateService as sharedValidateService,
  type KeyEntryCipherInput,
  type KeyEntryCipherPayload,
  type KeyEntryWriteFields,
  type KeyEntryWriteFieldsInput,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GCM_TAG_BYTES = 16;
const MIN_CIPHERTEXT_BYTES = 1 + GCM_TAG_BYTES;

function withFieldHttpError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof KeyEntryFieldError) {
      throw new HttpInvalidRequest(error.message, error.details);
    }
    throw error;
  }
}

export function isUuidV4(id: string): boolean {
  return UUID_V4_PATTERN.test(id);
}

export function decodeBase64Length(b64: string): number | null {
  try {
    return Buffer.from(b64, "base64").length;
  } catch {
    return null;
  }
}

function cipherPayloadDetails(
  cipher: KeyEntryCipherPayload,
): Array<{ field: string; message: string }> {
  const details: Array<{ field: string; message: string }> = [];

  if (cipher.algorithm !== "aes-256-gcm") {
    details.push({
      field: "cipher.algorithm",
      message: "must be aes-256-gcm",
    });
  }

  const ivLength = decodeBase64Length(cipher.ivB64);
  if (ivLength === null) {
    details.push({
      field: "cipher.ivB64",
      message: "must be valid base64",
    });
  } else if (ivLength !== AES_GCM_IV_BYTES) {
    details.push({
      field: "cipher.ivB64",
      message: `must decode to exactly ${AES_GCM_IV_BYTES} bytes`,
    });
  }

  const ciphertextLength = decodeBase64Length(cipher.ciphertextB64);
  if (ciphertextLength === null) {
    details.push({
      field: "cipher.ciphertextB64",
      message: "must be valid base64",
    });
  } else {
    if (ciphertextLength < MIN_CIPHERTEXT_BYTES) {
      details.push({
        field: "cipher.ciphertextB64",
        message: `must decode to at least ${MIN_CIPHERTEXT_BYTES} bytes`,
      });
    }
    if (ciphertextLength > KEY_ENTRY_CIPHERTEXT_B64_MAX) {
      details.push({
        field: "cipher.ciphertextB64",
        message: `must decode to at most ${KEY_ENTRY_CIPHERTEXT_B64_MAX} bytes`,
      });
    }
  }

  return details;
}

/** Shape-only check for the rotation paths, where the server sets the key version. */
export function validateCipherPayload(cipher: KeyEntryCipherPayload): void {
  const details = cipherPayloadDetails(cipher);

  if (details.length > 0) {
    throw new HttpInvalidRequest("Invalid cipher", details);
  }
}

/** Full check for client-authored writes, which must also declare a key version. */
export function validateCipherInput(cipher: KeyEntryCipherInput): void {
  const details = cipherPayloadDetails(cipher);

  if (!Number.isInteger(cipher.keyVersion) || cipher.keyVersion < 1) {
    details.push({
      field: "cipher.keyVersion",
      message: "must be a positive integer",
    });
  }

  if (details.length > 0) {
    throw new HttpInvalidRequest("Invalid cipher", details);
  }
}

export function normalizeLabel(label: string): string {
  return withFieldHttpError(() => sharedNormalizeLabel(label));
}

export function normalizeDescription(
  description: string | undefined,
): string | null {
  return withFieldHttpError(() => sharedNormalizeDescription(description));
}

export function normalizeTags(tags: string[]): string[] {
  return withFieldHttpError(() => sharedNormalizeTags(tags));
}

export function validateService(
  serviceId: string,
  customServiceName: string | undefined,
): { customServiceName: string | null } {
  return withFieldHttpError(() =>
    sharedValidateService(serviceId, customServiceName),
  );
}

/** Shared create/update/import field normalize + validate, mapped to HTTP errors. */
export function normalizeKeyEntryWriteFields(
  input: KeyEntryWriteFieldsInput,
): KeyEntryWriteFields {
  return withFieldHttpError(() => sharedNormalizeKeyEntryWriteFields(input));
}

export function validateKeyEntryId(id: string): void {
  if (!isUuidV4(id)) {
    throw new HttpInvalidRequest("Invalid id", [
      { field: "id", message: "must be a UUID v4" },
    ]);
  }
}

export function normalizeImportTimestamp(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length > 40) {
    throw new HttpInvalidRequest("Invalid import timestamp", [
      { field, message: "must be a string of at most 40 characters" },
    ]);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpInvalidRequest("Invalid import timestamp", [
      { field, message: "must be a valid ISO timestamp" },
    ]);
  }

  return value;
}
