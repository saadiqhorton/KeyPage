import { randomBytes } from "node:crypto";
import { argon2Verify, argon2id } from "hash-wasm";

const VERIFIER_MEMORY_KIB = 19456;
const VERIFIER_ITERATIONS = 2;
const VERIFIER_PARALLELISM = 1;
const VERIFIER_HASH_LENGTH = 32;
const VERIFIER_SALT_BYTES = 16;

export async function hashAuthKey(authKeyB64: string): Promise<string> {
  return argon2id({
    password: authKeyB64,
    salt: randomBytes(VERIFIER_SALT_BYTES),
    memorySize: VERIFIER_MEMORY_KIB,
    iterations: VERIFIER_ITERATIONS,
    parallelism: VERIFIER_PARALLELISM,
    hashLength: VERIFIER_HASH_LENGTH,
    outputType: "encoded",
  });
}

export async function verifyAuthKey(
  authKeyB64: string,
  phc: string,
): Promise<boolean> {
  return argon2Verify({ password: authKeyB64, hash: phc });
}
