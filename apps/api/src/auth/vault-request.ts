import { HttpInvalidRequest } from "../errors.js";

export const kdfSchema = {
  type: "object",
  required: ["algorithm", "saltB64", "iterations"],
  properties: {
    algorithm: { type: "string", enum: ["argon2id", "pbkdf2-sha256"] },
    saltB64: { type: "string" },
    iterations: { type: "number" },
    memoryKiB: { type: "number" },
    parallelism: { type: "number" },
  },
} as const;

export const recoveryEnvelopeSchema = {
  type: "object",
  required: ["label", "lookupHash", "kdf", "wrappedMasterKeyB64"],
  properties: {
    label: { type: "string" },
    lookupHash: { type: "string" },
    kdf: kdfSchema,
    wrappedMasterKeyB64: { type: "string" },
  },
} as const;

export const reencryptedEntrySchema = {
  type: "object",
  required: ["id", "cipher", "baseIvB64"],
  properties: {
    id: { type: "string" },
    baseIvB64: { type: "string" },
    cipher: {
      type: "object",
      required: ["algorithm", "ivB64", "ciphertextB64"],
      properties: {
        algorithm: { type: "string", enum: ["aes-256-gcm"] },
        ivB64: { type: "string" },
        ciphertextB64: { type: "string" },
      },
    },
  },
} as const;

const STANDARD_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeExactBase64(value: string, field: string): Buffer {
  if (value.length === 0 || !STANDARD_BASE64.test(value)) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must be valid base64" },
    ]);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must be valid base64" },
    ]);
  }

  return decoded;
}

export function validateAuthKeyB64(
  authKeyB64: string,
  field = "authKeyB64",
): void {
  const decoded = decodeExactBase64(authKeyB64, field);
  if (decoded.length !== 32) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must decode to exactly 32 bytes" },
    ]);
  }
}

export function validateStoredKeyHex(
  value: string,
  field: string,
): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      {
        field,
        message: "must be 64 lowercase hex characters",
      },
    ]);
  }
}

export function validateClientProofB64(
  value: string,
  field: string,
): void {
  const decoded = decodeExactBase64(value, field);
  if (decoded.length !== 32) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must decode to exactly 32 bytes" },
    ]);
  }
}
