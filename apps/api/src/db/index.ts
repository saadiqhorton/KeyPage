import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { runMigrations } from "./migrations.js";

const DB_FILE_MODE = 0o600;

export function openDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "keypage.db");
  const db = new Database(dbPath);

  fs.chmodSync(dbPath, DB_FILE_MODE);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  runMigrations(db);

  return db;
}

export function closeDatabase(db: Database.Database): void {
  db.close();
}
