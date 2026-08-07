import {
  AES_GCM_IV_BYTES,
  KEY_ENTRY_CIPHERTEXT_B64_MAX,
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
  SERVICE_CATALOG,
  type KeyEntryCipherInput,
  type KeyEntryCipherPayload,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GCM_TAG_BYTES = 16;
const MIN_CIPHERTEXT_BYTES = 1 + GCM_TAG_BYTES;

const SERVICE_IDS = new Set(SERVICE_CATALOG.map((service) => service.id));

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
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > KEY_ENTRY_LABEL_MAX) {
    throw new HttpInvalidRequest("Invalid label", [
      {
        field: "label",
        message: `must be 1..${KEY_ENTRY_LABEL_MAX} characters after trim`,
      },
    ]);
  }
  return trimmed;
}

export function normalizeDescription(
  description: string | undefined,
): string | null {
  if (description === undefined) {
    return null;
  }

  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > KEY_ENTRY_DESCRIPTION_MAX) {
    throw new HttpInvalidRequest("Invalid description", [
      {
        field: "description",
        message: `must be at most ${KEY_ENTRY_DESCRIPTION_MAX} characters`,
      },
    ]);
  }

  return trimmed;
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.length > KEY_ENTRY_TAG_MAX) {
      throw new HttpInvalidRequest("Invalid tags", [
        {
          field: "tags",
          message: `each tag must be 1..${KEY_ENTRY_TAG_MAX} characters`,
        },
      ]);
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);

    if (normalized.length > KEY_ENTRY_TAGS_MAX) {
      throw new HttpInvalidRequest("Invalid tags", [
        {
          field: "tags",
          message: `must contain at most ${KEY_ENTRY_TAGS_MAX} tags`,
        },
      ]);
    }
  }

  return normalized;
}

export function validateService(
  serviceId: string,
  customServiceName: string | undefined,
): { customServiceName: string | null } {
  if (!SERVICE_IDS.has(serviceId as (typeof SERVICE_CATALOG)[number]["id"])) {
    throw new HttpInvalidRequest("Invalid serviceId", [
      { field: "serviceId", message: "must be a known service id" },
    ]);
  }

  if (serviceId === "custom") {
    const trimmed = customServiceName?.trim() ?? "";
    if (trimmed.length === 0) {
      throw new HttpInvalidRequest("Invalid customServiceName", [
        {
          field: "customServiceName",
          message: "is required when serviceId is custom",
        },
      ]);
    }

    if (trimmed.length > KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX) {
      throw new HttpInvalidRequest("Invalid customServiceName", [
        {
          field: "customServiceName",
          message: `must be at most ${KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX} characters`,
        },
      ]);
    }

    return { customServiceName: trimmed };
  }

  if (customServiceName !== undefined && customServiceName.trim().length > 0) {
    throw new HttpInvalidRequest("Invalid customServiceName", [
      {
        field: "customServiceName",
        message: "must not be set unless serviceId is custom",
      },
    ]);
  }

  return { customServiceName: null };
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
