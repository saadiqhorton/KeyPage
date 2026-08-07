import type Database from "better-sqlite3";

import type {
  KeyEntry,
  KeyEntryCipherInput,
  KeyEntryCipherPayload,
  KeyEntryCreateRequest,
  KeyEntryUpdateRequest,
} from "@keypage/shared";

import { getVaultAuth } from "../auth/vault-repo.js";
import type { KeyEntryRow } from "../db/rows.js";
import { HttpKeyVersionMismatch, HttpSetupRequired } from "../errors.js";

/**
 * A client-authored write must name the key version its ciphertext was produced
 * under, and that version must still be current.
 *
 * The check lives here, next to the only statements that write `key_version`,
 * so every present and future write path inherits it rather than having to
 * remember a guard call.
 *
 * Without it the server infers the version from `vault_auth` at write time,
 * which silently mislabels ciphertext from a client whose key is stale. The
 * session cookie cannot stand in for this: it is per-origin and shared by every
 * browser tab, while the AES key is per-tab in-memory state, so a tab that
 * missed a rotation still presents a perfectly valid session (SAA-134).
 *
 * This is an integrity guard against a stale client, not an authentication
 * control — a caller holding a session can always submit bytes of its choosing.
 * What it removes is the silent failure: ciphertext stamped with a key version
 * that cannot decrypt it.
 */
function assertCipherKeyVersion(
  vaultKeyVersion: number,
  cipher: KeyEntryCipherInput,
): void {
  if (cipher.keyVersion !== vaultKeyVersion) {
    throw new HttpKeyVersionMismatch({
      field: "cipher.keyVersion",
      expected: vaultKeyVersion,
      received: cipher.keyVersion,
    });
  }
}

function parseTagsJson(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

function rowToKeyEntry(row: KeyEntryRow): KeyEntry {
  return {
    id: row.id,
    label: row.label,
    serviceId: row.service_id,
    customServiceName: row.custom_service_name,
    description: row.description,
    tags: parseTagsJson(row.tags_json),
    cipher: {
      algorithm: row.cipher_algorithm,
      ivB64: row.cipher_iv,
      ciphertextB64: row.cipher_text,
      keyVersion: row.key_version,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listKeyEntries(db: Database.Database): KeyEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM key_entries ORDER BY created_at DESC, id DESC`,
    )
    .all() as KeyEntryRow[];

  return rows.map(rowToKeyEntry);
}

export function listKeyEntryIds(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT id FROM key_entries`)
    .all() as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
}

export function listKeyEntryCipherIvs(
  db: Database.Database,
): Map<string, string> {
  const rows = db
    .prepare(`SELECT id, cipher_iv FROM key_entries`)
    .all() as Array<{ id: string; cipher_iv: string }>;

  return new Map(rows.map((row) => [row.id, row.cipher_iv]));
}

export function getKeyEntry(
  db: Database.Database,
  id: string,
): KeyEntry | null {
  const row = db
    .prepare(`SELECT * FROM key_entries WHERE id = ?`)
    .get(id) as KeyEntryRow | undefined;

  if (!row) {
    return null;
  }

  return rowToKeyEntry(row);
}

export function markKeyEntryUsed(
  db: Database.Database,
  id: string,
  usedAt: string,
): KeyEntry | null {
  const result = db
    .prepare(`UPDATE key_entries SET last_used_at = ? WHERE id = ?`)
    .run(usedAt, id);

  if (result.changes === 0) {
    return null;
  }

  const row = db
    .prepare(`SELECT * FROM key_entries WHERE id = ?`)
    .get(id) as KeyEntryRow;

  return rowToKeyEntry(row);
}

export type InsertKeyEntryInput = Omit<
  KeyEntryCreateRequest,
  "customServiceName" | "description" | "label" | "tags"
> & {
  label: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
};

export function insertKeyEntry(
  db: Database.Database,
  input: InsertKeyEntryInput,
): KeyEntry {
  const vault = getVaultAuth(db);
  if (!vault) {
    throw new HttpSetupRequired();
  }

  assertCipherKeyVersion(vault.key_version, input.cipher);

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO key_entries (
       id, label, service_id, custom_service_name, description, tags_json,
       cipher_algorithm, cipher_iv, cipher_text, key_version,
       created_at, updated_at, last_used_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.label,
    input.serviceId,
    input.customServiceName,
    input.description,
    JSON.stringify(input.tags),
    input.cipher.algorithm,
    input.cipher.ivB64,
    input.cipher.ciphertextB64,
    input.cipher.keyVersion,
    input.createdAt ?? now,
    input.updatedAt ?? now,
    input.lastUsedAt ?? null,
  );

  const row = db
    .prepare(`SELECT * FROM key_entries WHERE id = ?`)
    .get(input.id) as KeyEntryRow;

  return rowToKeyEntry(row);
}

export type UpdateKeyEntryInput = Omit<
  KeyEntryUpdateRequest,
  "customServiceName" | "description" | "label" | "tags" | "cipher"
> & {
  id: string;
  label: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
  cipher?: KeyEntryCipherInput;
  updatedAt: string;
};

export function updateKeyEntry(
  db: Database.Database,
  input: UpdateKeyEntryInput,
): KeyEntry | null {
  const assignments = [
    "label = ?",
    "service_id = ?",
    "custom_service_name = ?",
    "description = ?",
    "tags_json = ?",
    "updated_at = ?",
  ];
  const values: unknown[] = [
    input.label,
    input.serviceId,
    input.customServiceName,
    input.description,
    JSON.stringify(input.tags),
    input.updatedAt,
  ];

  if (input.cipher !== undefined) {
    const vault = getVaultAuth(db);
    if (!vault) {
      throw new HttpSetupRequired();
    }

    assertCipherKeyVersion(vault.key_version, input.cipher);

    assignments.push(
      "cipher_algorithm = ?",
      "cipher_iv = ?",
      "cipher_text = ?",
      "key_version = ?",
    );
    values.push(
      input.cipher.algorithm,
      input.cipher.ivB64,
      input.cipher.ciphertextB64,
      input.cipher.keyVersion,
    );
  }

  values.push(input.id);

  const result = db
    .prepare(
      `UPDATE key_entries SET ${assignments.join(", ")} WHERE id = ?`,
    )
    .run(...values);

  if (result.changes === 0) {
    return null;
  }

  const row = db
    .prepare(`SELECT * FROM key_entries WHERE id = ?`)
    .get(input.id) as KeyEntryRow;

  return rowToKeyEntry(row);
}

export function deleteKeyEntry(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM key_entries WHERE id = ?`).run(id);
  return result.changes > 0;
}

export type ReencryptedEntryInput = {
  id: string;
  baseIvB64: string;
  cipher: KeyEntryCipherPayload;
};

export function replaceKeyEntryCiphers(
  db: Database.Database,
  entries: ReencryptedEntryInput[],
  keyVersion: number,
): number {
  const stmt = db.prepare(
    `UPDATE key_entries
     SET cipher_algorithm = ?,
         cipher_iv = ?,
         cipher_text = ?,
         key_version = ?
     WHERE id = ?`,
  );

  let updated = 0;
  for (const entry of entries) {
    const result = stmt.run(
      entry.cipher.algorithm,
      entry.cipher.ivB64,
      entry.cipher.ciphertextB64,
      keyVersion,
      entry.id,
    );
    updated += result.changes;
  }

  return updated;
}
