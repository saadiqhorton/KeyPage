import type Database from "better-sqlite3";

import type {
  KeyEntry,
  KeyEntryCreateRequest,
} from "@keypage/shared";

import { getVaultAuth } from "../auth/vault-repo.js";
import type { KeyEntryRow } from "../db/rows.js";
import { HttpSetupRequired } from "../errors.js";

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
    vault.key_version,
    input.createdAt ?? now,
    input.updatedAt ?? now,
    input.lastUsedAt ?? null,
  );

  const row = db
    .prepare(`SELECT * FROM key_entries WHERE id = ?`)
    .get(input.id) as KeyEntryRow;

  return rowToKeyEntry(row);
}
