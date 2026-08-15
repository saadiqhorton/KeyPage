import type Database from "better-sqlite3";

import { RECOVERY_TICKET_TTL_SECONDS, AUTH_VERIFIER_PROOF_V1 } from "@keypage/shared";
import type {
  KdfParams,
  RecoveryClaimResponse,
  RecoveryCodeEnvelope,
  SessionInfo,
} from "@keypage/shared";

import {
  HttpInvalidRecoveryTicket,
  HttpInvalidRequest,
  HttpKeyVersionMismatch,
  HttpSessionExpired,
  HttpSetupRequired,
  HttpVaultAlreadyInitialized,
} from "../errors.js";
import type {
  KdfColumns,
  RecoveryCodeRow,
  RecoveryTicketRow,
  VaultAuthRow,
} from "../db/rows.js";
import {
  listKeyEntries,
  listKeyEntryCipherIvs,
  listKeyEntryIds,
  replaceKeyEntryCiphers,
  type ReencryptedEntryInput,
} from "../keys/key-entry-repo.js";
import { resetThrottle } from "./throttle.js";
import {
  createSession,
  isSessionActive,
  revokeAllSessions,
  type SessionRequest,
} from "./sessions.js";
import { newId, randomToken, sha256Hex } from "./tokens.js";

export type VaultProofKeys = {
  authStoredKeyHex: string;
  recoveryStoredKeyHex: string;
};

export function getVaultAuth(
  db: Database.Database,
): VaultAuthRow | undefined {
  return db
    .prepare(`SELECT * FROM vault_auth WHERE id = 1`)
    .get() as VaultAuthRow | undefined;
}

export function isVaultInitialized(db: Database.Database): boolean {
  return getVaultAuth(db) !== undefined;
}

/** Map the kdf_* columns of `vault_auth` or a `recovery_codes` row to KdfParams. */
export function rowToKdfParams(row: KdfColumns): KdfParams {
  if (row.kdf_algorithm === "argon2id") {
    return {
      algorithm: "argon2id",
      saltB64: row.kdf_salt,
      iterations: row.kdf_iterations,
      memoryKiB: row.kdf_memory_kib ?? undefined,
      parallelism: row.kdf_parallelism ?? undefined,
    };
  }

  return {
    algorithm: "pbkdf2-sha256",
    saltB64: row.kdf_salt,
    iterations: row.kdf_iterations,
  };
}

export function countUnusedRecoveryCodes(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM recovery_codes WHERE used_at IS NULL`)
    .get() as { count: number };

  return row.count;
}

export function findRecoveryCodeByLookupHash(
  db: Database.Database,
  lookupHash: string,
): RecoveryCodeRow | undefined {
  return db
    .prepare(`SELECT * FROM recovery_codes WHERE lookup_hash = ?`)
    .get(lookupHash) as RecoveryCodeRow | undefined;
}

export function findRecoveryTicketByTokenHash(
  db: Database.Database,
  tokenHash: string,
): RecoveryTicketRow | undefined {
  return db
    .prepare(`SELECT * FROM recovery_tickets WHERE token_hash = ?`)
    .get(tokenHash) as RecoveryTicketRow | undefined;
}

export function hasOpenRecoveryTicket(db: Database.Database): boolean {
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM recovery_tickets
       WHERE consumed_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .get(nowIso) as { ok: number } | undefined;

  return row !== undefined;
}

export type RecoveryClaimResult =
  | { ok: true; claim: RecoveryClaimResponse }
  | { ok: false };

/**
 * Claim a recovery code: burn it, mint a short-lived ticket, and freeze other
 * sessions so they cannot mutate the snapshot the client is about to
 * re-encrypt.
 *
 * Returns `{ ok: false }` for an unknown, already-used, or concurrently-claimed
 * code. Recording the throttle failure is the caller's job, because it must
 * survive outside this function's transaction.
 */
export function claimRecoveryCode(
  db: Database.Database,
  lookupHash: string,
): RecoveryClaimResult {
  const code = findRecoveryCodeByLookupHash(db, lookupHash);
  if (!code || code.used_at !== null) {
    return { ok: false };
  }

  const vault = getVaultAuth(db);
  if (!vault) {
    throw new HttpSetupRequired();
  }

  const ticket = randomToken();
  const tokenHash = sha256Hex(ticket);
  const challengeNonceB64 = Buffer.from(randomToken(), "utf8").toString(
    "base64",
  );
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + RECOVERY_TICKET_TTL_SECONDS * 1000,
  ).toISOString();

  const apply = db.transaction(() => {
    const update = db
      .prepare(
        `UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
      )
      .run(nowIso, code.id);

    if (update.changes === 0) {
      return false;
    }

    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at,
         challenge_nonce
       ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(newId(), tokenHash, code.id, nowIso, expiresAt, challengeNonceB64);

    // Freeze other sessions so they cannot mutate the claim snapshot.
    revokeAllSessions(db);

    return true;
  });

  if (!apply()) {
    return { ok: false };
  }

  return {
    ok: true,
    claim: {
      recoveryTicket: ticket,
      challengeNonceB64,
      kdf: rowToKdfParams(code),
      wrappedMasterKeyB64: code.wrapped_master_key,
      keyVersion: vault.key_version,
      codesRemaining: countUnusedRecoveryCodes(db),
      entries: listKeyEntries(db),
    },
  };
}

/**
 * Cancel / abandon an open recovery ticket (SAA-172). Idempotent for already
 * consumed or unknown tickets — returns whether a live ticket was revoked.
 */
export function cancelRecoveryTicket(
  db: Database.Database,
  recoveryTicket: string,
): boolean {
  const tokenHash = sha256Hex(recoveryTicket);
  const nowIso = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE recovery_tickets
       SET consumed_at = ?
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    )
    .run(nowIso, tokenHash, nowIso);

  return result.changes > 0;
}

/**
 * Call at the start of Key Entry mutation transactions.
 * Blocks writes after session revoke (recovery/password reset) and while a
 * recovery ticket is open so claim snapshots cannot go stale.
 */
export function assertKeyEntryMutationsAllowed(
  db: Database.Database,
  sessionId: string,
): void {
  if (!isSessionActive(db, sessionId)) {
    throw new HttpSessionExpired();
  }

  if (hasOpenRecoveryTicket(db)) {
    throw new HttpInvalidRequest(
      "Vault recovery in progress",
      [
        {
          field: "recovery",
          message:
            "key entry changes are blocked until recovery reset completes or the ticket expires",
        },
      ],
    );
  }
}

export type InitializeVaultInput = {
  kdf: KdfParams;
  proofKeys: VaultProofKeys;
  recoveryCodes: RecoveryCodeEnvelope[];
};

function insertRecoveryCode(
  db: Database.Database,
  envelope: RecoveryCodeEnvelope,
  keyVersion: number,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO recovery_codes (
       id, label, lookup_hash, kdf_algorithm, kdf_memory_kib, kdf_iterations,
       kdf_parallelism, kdf_salt, wrapped_master_key, key_version, created_at, used_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    newId(),
    envelope.label,
    envelope.lookupHash,
    envelope.kdf.algorithm,
    envelope.kdf.memoryKiB ?? null,
    envelope.kdf.iterations,
    envelope.kdf.parallelism ?? null,
    envelope.kdf.saltB64,
    envelope.wrappedMasterKeyB64,
    keyVersion,
    createdAt,
  );
}

export function replaceRecoveryCodes(
  db: Database.Database,
  envelopes: RecoveryCodeEnvelope[],
  keyVersion: number,
  nowIso: string,
): void {
  db.prepare(`DELETE FROM recovery_codes`).run();

  for (const envelope of envelopes) {
    insertRecoveryCode(db, envelope, keyVersion, nowIso);
  }
}

function insertVaultAuth(
  db: Database.Database,
  kdf: KdfParams,
  proofKeys: VaultProofKeys,
  keyVersion: number,
  timestamp: string,
): void {
  db.prepare(
    `INSERT INTO vault_auth (
       id, kdf_algorithm, kdf_memory_kib, kdf_iterations, kdf_parallelism,
       kdf_salt, auth_verifier, auth_stored_key, recovery_stored_key,
       key_version, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    kdf.algorithm,
    kdf.memoryKiB ?? null,
    kdf.iterations,
    kdf.parallelism ?? null,
    kdf.saltB64,
    AUTH_VERIFIER_PROOF_V1,
    proofKeys.authStoredKeyHex,
    proofKeys.recoveryStoredKeyHex,
    keyVersion,
    timestamp,
    timestamp,
  );
}

function updateVaultAuth(
  db: Database.Database,
  kdf: KdfParams,
  proofKeys: VaultProofKeys,
  keyVersion: number,
  timestamp: string,
): void {
  db.prepare(
    `UPDATE vault_auth
     SET kdf_algorithm = ?,
         kdf_memory_kib = ?,
         kdf_iterations = ?,
         kdf_parallelism = ?,
         kdf_salt = ?,
         auth_verifier = ?,
         auth_stored_key = ?,
         recovery_stored_key = ?,
         key_version = ?,
         updated_at = ?
     WHERE id = 1`,
  ).run(
    kdf.algorithm,
    kdf.memoryKiB ?? null,
    kdf.iterations,
    kdf.parallelism ?? null,
    kdf.saltB64,
    AUTH_VERIFIER_PROOF_V1,
    proofKeys.authStoredKeyHex,
    proofKeys.recoveryStoredKeyHex,
    keyVersion,
    timestamp,
  );
}

export function enrollLegacyAuthStoredKey(
  db: Database.Database,
  storedKeyHex: string,
): void {
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE vault_auth
       SET auth_stored_key = ?, auth_verifier = ?, updated_at = ?
       WHERE id = 1 AND auth_stored_key IS NULL`,
    )
    .run(storedKeyHex, AUTH_VERIFIER_PROOF_V1, nowIso);
  if (result.changes !== 1) {
    throw new HttpInvalidRequest("legacy auth enrollment failed");
  }
}

export function initializeVault(
  db: Database.Database,
  input: InitializeVaultInput,
): void {
  const nowIso = new Date().toISOString();

  const apply = db.transaction(() => {
    if (isVaultInitialized(db)) {
      throw new HttpVaultAlreadyInitialized();
    }

    insertVaultAuth(db, input.kdf, input.proofKeys, 1, nowIso);

    replaceRecoveryCodes(db, input.recoveryCodes, 1, nowIso);
  });

  try {
    apply();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      throw new HttpVaultAlreadyInitialized();
    }
    throw error;
  }
}

export type ResetVaultFromRecoveryInput = {
  recoveryTicket: string;
  challengeNonceB64: string;
  kdf: KdfParams;
  proofKeys: VaultProofKeys;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedEntryInput[];
};

export type VaultRotationResult = {
  token: string;
  info: SessionInfo;
  keyVersion: number;
  reEncrypted: number;
};

type RotateVaultMaterialArgs = {
  /** Read by the caller inside the same transaction; supplies the pre-rotation key_version. */
  vault: VaultAuthRow;
  kdf: KdfParams;
  proofKeys: VaultProofKeys;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedEntryInput[];
  /**
   * Recovery reset only. Consumed between the cipher rotation and
   * `replaceRecoveryCodes`, never after: `recovery_tickets.recovery_code_id`
   * is `REFERENCES recovery_codes(id) ON DELETE CASCADE`, so replacing the
   * codes deletes the ticket row and a later UPDATE would silently match
   * nothing.
   */
  consumeRecoveryTicketId?: string;
  req: SessionRequest;
  idleTimeoutSeconds: number;
  nowIso: string;
};

function assertEntriesMatchVault(
  db: Database.Database,
  entries: ReencryptedEntryInput[],
): void {
  const dbIds = listKeyEntryIds(db);
  const cipherIvs = listKeyEntryCipherIvs(db);
  const submittedIds = new Set(entries.map((entry) => entry.id));

  if (
    entries.length !== submittedIds.size ||
    dbIds.size !== submittedIds.size ||
    ![...dbIds].every((id) => submittedIds.has(id))
  ) {
    throw new HttpInvalidRequest("Entry set does not match vault", [
      {
        field: "entries",
        message: "must include each key entry id in the vault exactly once",
      },
    ]);
  }

  for (const entry of entries) {
    if (cipherIvs.get(entry.id) !== entry.baseIvB64) {
      throw new HttpInvalidRequest("Entry set does not match vault", [
        {
          field: "entries",
          message:
            "one or more entries were modified since the client snapshot",
        },
      ]);
    }
  }
}

/**
 * The one server-side vault rotation: Master Password change and recovery
 * reset differ only in how the caller is gated, so they share this body.
 *
 * Call from inside a `db.transaction(...)`; this function deliberately does
 * not open one, so the whole rotation stays a single rollback unit.
 *
 * Two orderings here are load-bearing:
 *  - sessions are revoked before any ciphertext moves, so an in-flight write
 *    re-checks and fails instead of storing old-key material under the new
 *    key_version (SAA-133/SAA-134);
 *  - the recovery ticket is consumed before the recovery codes are replaced,
 *    because replacing them cascade-deletes the ticket row.
 */
function rotateVaultMaterial(
  db: Database.Database,
  args: RotateVaultMaterialArgs,
): VaultRotationResult {
  assertEntriesMatchVault(db, args.entries);

  // Revoke before ciphertext rotation so in-flight session writes re-check
  // and fail instead of storing old-key material under the new key_version.
  revokeAllSessions(db);

  const nextKeyVersion = args.vault.key_version + 1;

  updateVaultAuth(
    db,
    args.kdf,
    args.proofKeys,
    nextKeyVersion,
    args.nowIso,
  );

  const reEncrypted = replaceKeyEntryCiphers(
    db,
    args.entries,
    nextKeyVersion,
  );

  if (args.consumeRecoveryTicketId !== undefined) {
    const consumed = db
      .prepare(
        `UPDATE recovery_tickets
         SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL`,
      )
      .run(args.nowIso, args.consumeRecoveryTicketId);

    // Must still be here to consume: replaceRecoveryCodes below cascade-deletes
    // this row, so a zero-row update means the order was broken.
    if (consumed.changes === 0) {
      throw new HttpInvalidRecoveryTicket();
    }
  }

  replaceRecoveryCodes(
    db,
    args.recoveryCodes,
    nextKeyVersion,
    args.nowIso,
  );

  resetThrottle(db, "login");
  resetThrottle(db, "recovery");

  const session = createSession(db, args.req, args.idleTimeoutSeconds);

  return { ...session, keyVersion: nextKeyVersion, reEncrypted };
}

export function resetVaultFromRecovery(
  db: Database.Database,
  input: ResetVaultFromRecoveryInput,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): VaultRotationResult {
  const tokenHash = sha256Hex(input.recoveryTicket);
  const now = new Date();
  const nowIso = now.toISOString();

  const apply = db.transaction(() => {
    const ticket = findRecoveryTicketByTokenHash(db, tokenHash);
    if (
      !ticket ||
      ticket.consumed_at !== null ||
      Date.parse(ticket.expires_at) <= now.getTime()
    ) {
      throw new HttpInvalidRecoveryTicket();
    }

    if (
      !ticket.challenge_nonce ||
      ticket.challenge_nonce !== input.challengeNonceB64
    ) {
      throw new HttpInvalidRecoveryTicket();
    }

    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRecoveryTicket();
    }

    return rotateVaultMaterial(db, {
      vault,
      kdf: input.kdf,
      proofKeys: input.proofKeys,
      recoveryCodes: input.recoveryCodes,
      entries: input.entries,
      consumeRecoveryTicketId: ticket.id,
      req,
      idleTimeoutSeconds,
      nowIso,
    });
  });

  return apply();
}

export type ChangeMasterPasswordInput = {
  kdf: KdfParams;
  proofKeys: VaultProofKeys;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedEntryInput[];
};

export function changeMasterPassword(
  db: Database.Database,
  input: ChangeMasterPasswordInput,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): VaultRotationResult {
  const nowIso = new Date().toISOString();

  const apply = db.transaction(() => {
    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRequest("Vault is not initialized");
    }

    return rotateVaultMaterial(db, {
      vault,
      kdf: input.kdf,
      proofKeys: input.proofKeys,
      recoveryCodes: input.recoveryCodes,
      entries: input.entries,
      req,
      idleTimeoutSeconds,
      nowIso,
    });
  });

  return apply();
}

export type RegenerateRecoveryCodesInput = {
  sessionId: string;
  /** Vault key version whose master key the client wrapped into `recoveryCodes`. */
  keyVersion: number;
  recoveryCodes: RecoveryCodeEnvelope[];
};

/**
 * Recovery envelopes wrap the master key, so they are only meaningful for the
 * key version they were built against.
 *
 * Both checks below are re-run inside the transaction because the route awaits
 * Argon2id verification before calling in, and an await yields the event loop:
 * a concurrent password change or recovery reset can commit a rotation in that
 * gap. Persisting the envelopes anyway would store codes that unwrap the
 * *previous* master key while claiming the current version, which turns every
 * Key Entry undecryptable the next time recovery is used (SAA-134).
 */
export function regenerateRecoveryCodes(
  db: Database.Database,
  input: RegenerateRecoveryCodesInput,
): { recoveryCodesRemaining: number; keyVersion: number } {
  const nowIso = new Date().toISOString();

  const apply = db.transaction(() => {
    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRequest("Vault is not initialized");
    }

    if (!isSessionActive(db, input.sessionId)) {
      throw new HttpSessionExpired();
    }

    if (input.keyVersion !== vault.key_version) {
      throw new HttpKeyVersionMismatch({
        field: "keyVersion",
        expected: vault.key_version,
        received: input.keyVersion,
      });
    }

    replaceRecoveryCodes(db, input.recoveryCodes, vault.key_version, nowIso);

    return {
      recoveryCodesRemaining: countUnusedRecoveryCodes(db),
      keyVersion: vault.key_version,
    };
  });

  return apply();
}
