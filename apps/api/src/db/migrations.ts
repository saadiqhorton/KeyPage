import type Database from "better-sqlite3";

export type Migration = {
  version: number;
  up(db: Database.Database): void;
};

const MIGRATION_1_SQL = `
-- Singleton row: the vault's authentication state.
CREATE TABLE vault_auth (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  kdf_algorithm   TEXT    NOT NULL CHECK (kdf_algorithm IN ('argon2id','pbkdf2-sha256')),
  kdf_memory_kib  INTEGER,                 -- argon2id only
  kdf_iterations  INTEGER NOT NULL,
  kdf_parallelism INTEGER,                 -- argon2id only
  kdf_salt        TEXT    NOT NULL,        -- base64, 16 bytes, client-generated
  auth_verifier   TEXT    NOT NULL,        -- PHC argon2id string over authKeyB64
  key_version     INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

-- One row per recovery code. Server holds a lookup hash + an AES-GCM-wrapped masterKey.
CREATE TABLE recovery_codes (
  id                 TEXT PRIMARY KEY,           -- randomUUID() (node:crypto, server-side)
  label              TEXT NOT NULL,              -- "1".."10", display order only
  lookup_hash        TEXT NOT NULL UNIQUE,       -- 64 lowercase hex chars
  kdf_algorithm      TEXT NOT NULL CHECK (kdf_algorithm IN ('argon2id','pbkdf2-sha256')),
  kdf_memory_kib     INTEGER,
  kdf_iterations     INTEGER NOT NULL,
  kdf_parallelism    INTEGER,
  kdf_salt           TEXT NOT NULL,              -- base64, 16 bytes
  wrapped_master_key TEXT NOT NULL,              -- base64 of iv(12) || ciphertext+tag(48)
  key_version        INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  used_at            TEXT
);
CREATE INDEX idx_recovery_codes_unused ON recovery_codes (used_at);

-- Server-side sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  token_hash          TEXT NOT NULL UNIQUE,      -- 64 hex chars
  created_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at          TEXT,
  user_agent          TEXT,
  ip                  TEXT
);
CREATE INDEX idx_sessions_last_seen ON sessions (last_seen_at);

-- Short-lived single-use ticket proving a recovery code was just claimed.
CREATE TABLE recovery_tickets (
  id               TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL UNIQUE,
  recovery_code_id TEXT NOT NULL REFERENCES recovery_codes(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  consumed_at      TEXT
);

-- Server-side rate limiting. Survives page refresh AND process restart.
CREATE TABLE auth_throttle (
  scope           TEXT PRIMARY KEY CHECK (scope IN ('login','recovery')),
  failed_count    INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at  TEXT,
  locked_until    TEXT,
  lockout_count   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO auth_throttle (scope) VALUES ('login'), ('recovery');

-- Key/value settings surface (Settings page lands in a later ticket).
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(MIGRATION_1_SQL);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
      ).run("session_idle_minutes", "20", now);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  let currentVersion = db.pragma("user_version", { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    if (migration.version !== currentVersion + 1) {
      throw new Error(
        `Missing migration: expected version ${currentVersion + 1}, found ${migration.version}`,
      );
    }

    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
    currentVersion = migration.version;
  }
}
