import {
  AES_GCM_IV_BYTES,
  ARGON2ID_RECOVERY_PARAMS,
  DERIVED_KEY_BYTES,
  KDF_SALT_BYTES,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LOOKUP_PREFIX,
  RECOVERY_WRAP_AAD,
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  type RecoveryCodeEnvelope,
} from "@keypage/shared";

import { argon2idDerive } from "./argon2.js";
import { base64Decode, base64Encode, hexEncode, utf8Bytes } from "./encoding.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  importAesKey,
  randomBytes,
  sha256,
  zeroize,
} from "./provider.js";

const RECOVERY_CODE_BYTES = 20;
const WRAPPED_MASTER_KEY_BYTES = AES_GCM_IV_BYTES + DERIVED_KEY_BYTES + 16;

export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  let code = "";
  for (const byte of bytes) {
    code += RECOVERY_CODE_ALPHABET[byte & 31];
  }
  return code;
}

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(generateRecoveryCode());
  }
  return codes;
}

export async function computeLookupHash(normalizedCode: string): Promise<string> {
  const digest = await sha256(
    utf8Bytes(`${RECOVERY_CODE_LOOKUP_PREFIX}${normalizedCode}`),
  );
  return hexEncode(digest);
}

export async function buildRecoveryCodeEnvelope(
  masterKey: Uint8Array,
  normalizedCode: string,
  label: string,
): Promise<RecoveryCodeEnvelope> {
  const codeSalt = randomBytes(KDF_SALT_BYTES);
  const recoveryKey = await argon2idDerive({
    password: normalizedCode,
    salt: codeSalt,
    memoryKiB: ARGON2ID_RECOVERY_PARAMS.memoryKiB,
    iterations: ARGON2ID_RECOVERY_PARAMS.iterations,
    parallelism: ARGON2ID_RECOVERY_PARAMS.parallelism,
    hashLength: DERIVED_KEY_BYTES,
  });

  const iv = randomBytes(AES_GCM_IV_BYTES);
  const aad = utf8Bytes(RECOVERY_WRAP_AAD);
  const recoveryAesKey = await importAesKey(recoveryKey);
  const ciphertext = await aesGcmEncrypt(recoveryAesKey, iv, aad, masterKey);
  zeroize(recoveryKey);

  const wrapped = new Uint8Array(AES_GCM_IV_BYTES + ciphertext.length);
  wrapped.set(iv, 0);
  wrapped.set(ciphertext, AES_GCM_IV_BYTES);
  const wrappedMasterKeyB64 = base64Encode(wrapped);

  if (wrapped.length !== WRAPPED_MASTER_KEY_BYTES) {
    throw new Error(
      `Wrapped master key must be ${WRAPPED_MASTER_KEY_BYTES} bytes`,
    );
  }

  return {
    label,
    lookupHash: await computeLookupHash(normalizedCode),
    kdf: {
      algorithm: "argon2id",
      saltB64: base64Encode(codeSalt),
      iterations: ARGON2ID_RECOVERY_PARAMS.iterations,
      memoryKiB: ARGON2ID_RECOVERY_PARAMS.memoryKiB,
      parallelism: ARGON2ID_RECOVERY_PARAMS.parallelism,
    },
    wrappedMasterKeyB64,
  };
}

export async function buildRecoveryCodeEnvelopes(
  masterKey: Uint8Array,
): Promise<{ codes: string[]; envelopes: RecoveryCodeEnvelope[] }> {
  const codes = generateRecoveryCodes();
  const envelopes: RecoveryCodeEnvelope[] = [];
  for (let i = 0; i < codes.length; i++) {
    envelopes.push(
      await buildRecoveryCodeEnvelope(masterKey, codes[i]!, String(i + 1)),
    );
  }
  return { codes, envelopes };
}

export async function unwrapMasterKey(
  envelope: RecoveryCodeEnvelope,
  codeInput: string,
): Promise<Uint8Array> {
  const normalizedCode = normalizeRecoveryCode(codeInput);
  if (normalizedCode === null) {
    throw new Error("Invalid recovery code");
  }

  const wrapped = base64Decode(envelope.wrappedMasterKeyB64);
  if (wrapped.length !== WRAPPED_MASTER_KEY_BYTES) {
    throw new Error(
      `Wrapped master key must be ${WRAPPED_MASTER_KEY_BYTES} bytes`,
    );
  }

  const iv = wrapped.slice(0, AES_GCM_IV_BYTES);
  const ciphertext = wrapped.slice(AES_GCM_IV_BYTES);
  const codeSalt = base64Decode(envelope.kdf.saltB64);
  if (codeSalt.length !== KDF_SALT_BYTES) {
    throw new Error(`Recovery code salt must be ${KDF_SALT_BYTES} bytes`);
  }

  const recoveryKey = await argon2idDerive({
    password: normalizedCode,
    salt: codeSalt,
    memoryKiB: envelope.kdf.memoryKiB!,
    iterations: envelope.kdf.iterations,
    parallelism: envelope.kdf.parallelism!,
    hashLength: DERIVED_KEY_BYTES,
  });

  const recoveryAesKey = await importAesKey(recoveryKey);
  zeroize(recoveryKey);

  try {
    return await aesGcmDecrypt(
      recoveryAesKey,
      iv,
      utf8Bytes(RECOVERY_WRAP_AAD),
      ciphertext,
    );
  } catch {
    throw new Error("Invalid recovery code");
  }
}

export function buildRecoveryCodesFileText(
  codes: string[],
  generatedAt: Date = new Date(),
): string {
  const timestamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "KeyPage — Recovery Codes",
    `Generated: ${timestamp}`,
    "",
    "Keep this file somewhere safe and offline. Any ONE unused code below can recover",
    "access to your vault and let you set a new Master Password.",
    "",
    "Using a code replaces this entire set — download the new file it gives you.",
    "",
  ];

  for (let i = 0; i < codes.length; i++) {
    const formatted = formatRecoveryCode(codes[i]!);
    lines.push(`${String(i + 1).padStart(3, " ")}.  ${formatted}`);
  }

  lines.push(
    "",
    "KeyPage never stores your Master Password. If you lose both the Master Password",
    "and these codes, your API Keys cannot be recovered.",
  );

  return `${lines.join("\n")}\n`;
}
