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
  required: ["id", "cipher"],
  properties: {
    id: { type: "string" },
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

export function validateAuthKeyB64(
  authKeyB64: string,
  field = "authKeyB64",
): void {
  let length: number;
  try {
    length = Buffer.from(authKeyB64, "base64").length;
  } catch {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must be valid base64" },
    ]);
  }

  if (length !== 32) {
    throw new HttpInvalidRequest(`Invalid ${field}`, [
      { field, message: "must decode to exactly 32 bytes" },
    ]);
  }
}
