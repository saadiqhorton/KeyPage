import {
  ARGON2ID_VAULT_PARAMS,
  DERIVED_KEY_BYTES,
  HKDF_INFO_AUTH_KEY,
  HKDF_INFO_ENCRYPTION_KEY,
  KDF_SALT_BYTES,
  PBKDF2_FALLBACK_ITERATIONS,
  type KdfParams,
} from "@keypage/shared";

import { argon2idDerive, probeArgon2Wasm } from "./argon2.js";
import { base64Decode, base64Encode } from "./encoding.js";
import {
  hkdfSha256,
  importAesKey,
  pbkdf2Sha256,
  randomBytes,
  zeroize,
  type AesKey,
} from "./provider.js";

export type DerivedVaultKeys = {
  /** Only for wrapping recovery codes; caller MUST zeroize immediately after use. */
  masterKey: Uint8Array;
  encryptionKey: AesKey;
  authKeyB64: string;
};

export async function pickKdfParams(): Promise<KdfParams> {
  const salt = randomBytes(KDF_SALT_BYTES);
  const saltB64 = base64Encode(salt);

  if (await probeArgon2Wasm()) {
    return {
      algorithm: "argon2id",
      saltB64,
      iterations: ARGON2ID_VAULT_PARAMS.iterations,
      memoryKiB: ARGON2ID_VAULT_PARAMS.memoryKiB,
      parallelism: ARGON2ID_VAULT_PARAMS.parallelism,
    };
  }

  return {
    algorithm: "pbkdf2-sha256",
    saltB64,
    iterations: PBKDF2_FALLBACK_ITERATIONS,
  };
}

/**
 * Split an already-derived master key into encryption + auth keys using the
 * vault KDF salt (same HKDF info strings as `deriveVaultKeys`).
 * Caller owns `masterKey` lifetime — this does not zeroize it.
 */
export async function keysFromMasterKey(
  masterKey: Uint8Array,
  saltB64: string,
): Promise<{ encryptionKey: AesKey; authKeyB64: string }> {
  const salt = base64Decode(saltB64);
  if (salt.length !== KDF_SALT_BYTES) {
    throw new Error(`KDF salt must be ${KDF_SALT_BYTES} bytes`);
  }

  const authKeyBytes = await hkdfSha256(
    masterKey,
    salt,
    HKDF_INFO_AUTH_KEY,
    DERIVED_KEY_BYTES,
  );
  const authKeyB64 = base64Encode(authKeyBytes);
  zeroize(authKeyBytes);

  const encRaw = await hkdfSha256(
    masterKey,
    salt,
    HKDF_INFO_ENCRYPTION_KEY,
    DERIVED_KEY_BYTES,
  );
  const encryptionKey = await importAesKey(encRaw);
  zeroize(encRaw);

  return { encryptionKey, authKeyB64 };
}

export async function deriveVaultKeys(
  password: string,
  kdf: KdfParams,
): Promise<DerivedVaultKeys> {
  const salt = base64Decode(kdf.saltB64);
  if (salt.length !== KDF_SALT_BYTES) {
    throw new Error(`KDF salt must be ${KDF_SALT_BYTES} bytes`);
  }

  let masterKey: Uint8Array;
  if (kdf.algorithm === "argon2id") {
    masterKey = await argon2idDerive({
      password,
      salt,
      memoryKiB: kdf.memoryKiB!,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism!,
      hashLength: DERIVED_KEY_BYTES,
    });
  } else {
    masterKey = await pbkdf2Sha256(
      password,
      salt,
      kdf.iterations,
      DERIVED_KEY_BYTES,
    );
  }

  const { encryptionKey, authKeyB64 } = await keysFromMasterKey(
    masterKey,
    kdf.saltB64,
  );

  return { masterKey, encryptionKey, authKeyB64 };
}
