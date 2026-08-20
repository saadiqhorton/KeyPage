import type Database from "better-sqlite3";
import type { FastifyRequest } from "fastify";

import {
  base64Decode,
  keyEntryWriteAuthMessage,
  verifyClientProof,
} from "@keypage/shared";

import { consumeLoginChallenge } from "../auth/login-challenges.js";
import { getVaultAuth } from "../auth/vault-repo.js";
import { HttpUnauthenticated } from "../errors.js";

export const KEY_WRITE_CHALLENGE_HEADER = "x-keypage-write-challenge";
export const KEY_WRITE_NONCE_HEADER = "x-keypage-write-nonce";
export const KEY_WRITE_PROOF_HEADER = "x-keypage-write-proof";

/** Uniform 401 message — do not distinguish missing vs invalid proof components. */
const PROOF_FAILURE_MESSAGE = "Invalid or expired key possession proof";

function singleHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function requireKeyWriteProof(
  db: Database.Database,
  request: FastifyRequest,
  path: string,
): void {
  const challengeId = singleHeader(request, KEY_WRITE_CHALLENGE_HEADER);
  const nonceB64 = singleHeader(request, KEY_WRITE_NONCE_HEADER);
  const proofB64 = singleHeader(request, KEY_WRITE_PROOF_HEADER);
  if (!challengeId || !nonceB64 || !proofB64) {
    throw new HttpUnauthenticated(PROOF_FAILURE_MESSAGE);
  }

  const challenge = consumeLoginChallenge(
    db,
    challengeId,
    nonceB64,
    "key-write",
  );
  const vault = getVaultAuth(db);
  if (!challenge || !vault?.auth_stored_key) {
    throw new HttpUnauthenticated(PROOF_FAILURE_MESSAGE);
  }

  let proof: Uint8Array;
  try {
    proof = base64Decode(proofB64);
  } catch {
    throw new HttpUnauthenticated(PROOF_FAILURE_MESSAGE);
  }

  const message = keyEntryWriteAuthMessage({
    challengeId,
    nonceB64,
    method: request.method,
    path,
    bodyJson: JSON.stringify(request.body),
  });
  if (!verifyClientProof(vault.auth_stored_key, message, proof)) {
    throw new HttpUnauthenticated(PROOF_FAILURE_MESSAGE);
  }
}
