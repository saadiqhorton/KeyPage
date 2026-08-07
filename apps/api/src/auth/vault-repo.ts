import type Database from "better-sqlite3";

import type {
  KdfParams,
  RecoveryCodeEnvelope,
  SessionInfo,
} from "@keypage/shared";

import {
  HttpInvalidRecoveryTicket,
  HttpInvalidRequest,
  HttpVaultAlreadyInitialized,
} from "../errors.js";
import type {
  RecoveryCodeRow,
  RecoveryTicketRow,
  VaultAuthRow,
} from "../db/rows.js";
import {
  listKeyEntryCipherIvs,
  listKeyEntryIds,
  replaceKeyEntryCiphers,
  type ReencryptedEntryInput,
} from "../keys/key-entry-repo.js";
import { resetThrottle } from "./throttle.js";
import {
  createSession,
  revokeAllSessions,
  type SessionRequest,
} from "./sessions.js";
import { newId, sha256Hex } from "./tokens.js";

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

export function vaultAuthToKdfParams(row: VaultAuthRow): KdfParams {
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

export type InitializeVaultInput = {
  kdf: KdfParams;
  authVerifier: string;
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
  authVerifier: string,
  keyVersion: number,
  timestamp: string,
): void {
  db.prepare(
    `INSERT INTO vault_auth (
       id, kdf_algorithm, kdf_memory_kib, kdf_iterations, kdf_parallelism,
       kdf_salt, auth_verifier, key_version, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    kdf.algorithm,
    kdf.memoryKiB ?? null,
    kdf.iterations,
    kdf.parallelism ?? null,
    kdf.saltB64,
    authVerifier,
    keyVersion,
    timestamp,
    timestamp,
  );
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

    insertVaultAuth(db, input.kdf, input.authVerifier, 1, nowIso);

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
  kdf: KdfParams;
  authVerifier: string;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedEntryInput[];
};

export function resetVaultFromRecovery(
  db: Database.Database,
  input: ResetVaultFromRecoveryInput,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): { token: string; info: SessionInfo; keyVersion: number; reEncrypted: number } {
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

    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRecoveryTicket();
    }

    assertEntriesMatchVault(db, input.entries);

    const nextKeyVersion = vault.key_version + 1;

    db.prepare(
      `UPDATE vault_auth
       SET kdf_algorithm = ?,
           kdf_memory_kib = ?,
           kdf_iterations = ?,
           kdf_parallelism = ?,
           kdf_salt = ?,
           auth_verifier = ?,
           key_version = ?,
           updated_at = ?
       WHERE id = 1`,
    ).run(
      input.kdf.algorithm,
      input.kdf.memoryKiB ?? null,
      input.kdf.iterations,
      input.kdf.parallelism ?? null,
      input.kdf.saltB64,
      input.authVerifier,
      nextKeyVersion,
      nowIso,
    );

    const reEncrypted = replaceKeyEntryCiphers(
      db,
      input.entries,
      nextKeyVersion,
    );

    db.prepare(
      `UPDATE recovery_tickets SET consumed_at = ? WHERE id = ?`,
    ).run(nowIso, ticket.id);

    replaceRecoveryCodes(db, input.recoveryCodes, nextKeyVersion, nowIso);

    resetThrottle(db, "login");
    resetThrottle(db, "recovery");

    revokeAllSessions(db);

    const session = createSession(db, req, idleTimeoutSeconds);

    return {
      ...session,
      keyVersion: nextKeyVersion,
      reEncrypted,
    };
  });

  return apply();
}

export type ChangeMasterPasswordInput = {
  kdf: KdfParams;
  authVerifier: string;
  recoveryCodes: RecoveryCodeEnvelope[];
  entries: ReencryptedEntryInput[];
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

export function changeMasterPassword(
  db: Database.Database,
  input: ChangeMasterPasswordInput,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): { token: string; info: SessionInfo; keyVersion: number; reEncrypted: number } {
  const nowIso = new Date().toISOString();

  const apply = db.transaction(() => {
    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRequest("Vault is not initialized");
    }

    assertEntriesMatchVault(db, input.entries);

    const nextKeyVersion = vault.key_version + 1;

    db.prepare(
      `UPDATE vault_auth
       SET kdf_algorithm = ?,
           kdf_memory_kib = ?,
           kdf_iterations = ?,
           kdf_parallelism = ?,
           kdf_salt = ?,
           auth_verifier = ?,
           key_version = ?,
           updated_at = ?
       WHERE id = 1`,
    ).run(
      input.kdf.algorithm,
      input.kdf.memoryKiB ?? null,
      input.kdf.iterations,
      input.kdf.parallelism ?? null,
      input.kdf.saltB64,
      input.authVerifier,
      nextKeyVersion,
      nowIso,
    );

    const reEncrypted = replaceKeyEntryCiphers(
      db,
      input.entries,
      nextKeyVersion,
    );

    replaceRecoveryCodes(db, input.recoveryCodes, nextKeyVersion, nowIso);

    resetThrottle(db, "login");
    resetThrottle(db, "recovery");

    revokeAllSessions(db);

    const session = createSession(db, req, idleTimeoutSeconds);

    return {
      ...session,
      keyVersion: nextKeyVersion,
      reEncrypted,
    };
  });

  return apply();
}

export function regenerateRecoveryCodes(
  db: Database.Database,
  envelopes: RecoveryCodeEnvelope[],
): { recoveryCodesRemaining: number; keyVersion: number } {
  const nowIso = new Date().toISOString();

  const apply = db.transaction(() => {
    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpInvalidRequest("Vault is not initialized");
    }

    replaceRecoveryCodes(db, envelopes, vault.key_version, nowIso);

    return {
      recoveryCodesRemaining: countUnusedRecoveryCodes(db),
      keyVersion: vault.key_version,
    };
  });

  return apply();
}
