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

const MIGRATION_2_SQL = `
CREATE TABLE key_entries (
  id                  TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  service_id          TEXT NOT NULL,
  custom_service_name TEXT,
  description         TEXT,
  tags_json           TEXT NOT NULL DEFAULT '[]',
  cipher_algorithm    TEXT NOT NULL CHECK (cipher_algorithm = 'aes-256-gcm'),
  cipher_iv           TEXT NOT NULL,
  cipher_text         TEXT NOT NULL,
  key_version         INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  last_used_at        TEXT
);

CREATE TABLE activity_events (
  id           TEXT PRIMARY KEY,
  key_entry_id TEXT REFERENCES key_entries(id) ON DELETE SET NULL,
  action       TEXT NOT NULL CHECK (action IN ('created','edited','deleted','revealed','copied')),
  occurred_at  TEXT NOT NULL
);

CREATE INDEX idx_key_entries_created_at ON key_entries (created_at DESC);
CREATE INDEX idx_activity_events_occurred_at ON activity_events (occurred_at DESC);
`;

const MIGRATION_3_SQL = `
CREATE TABLE activity_events_new (
  id           TEXT PRIMARY KEY,
  key_entry_id TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('created','edited','deleted','revealed','copied')),
  occurred_at  TEXT NOT NULL
);

INSERT INTO activity_events_new (id, key_entry_id, action, occurred_at)
SELECT id, key_entry_id, action, occurred_at
FROM activity_events
WHERE key_entry_id IS NOT NULL;

DROP TABLE activity_events;
ALTER TABLE activity_events_new RENAME TO activity_events;

CREATE INDEX idx_activity_events_occurred_at ON activity_events (occurred_at DESC);
CREATE INDEX idx_activity_events_key_entry ON activity_events (key_entry_id);
`;

const MIGRATION_4_SQL = `
-- SAA-170 / SAA-173: stored-key possession proofs (authKey / masterKey stay off the wire).
ALTER TABLE vault_auth ADD COLUMN auth_stored_key TEXT;
ALTER TABLE vault_auth ADD COLUMN recovery_stored_key TEXT;

ALTER TABLE recovery_tickets ADD COLUMN challenge_nonce TEXT;

CREATE TABLE login_challenges (
  id         TEXT PRIMARY KEY,
  nonce_b64  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
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
  {
    version: 2,
    up(db) {
      db.exec(MIGRATION_2_SQL);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(MIGRATION_3_SQL);
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(MIGRATION_4_SQL);
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
