import type Database from "better-sqlite3";

const REVOKED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

export function runHousekeeping(
  db: Database.Database,
  now: Date = new Date(),
): void {
  const nowIso = now.toISOString();
  const revokedCutoff = new Date(
    now.getTime() - REVOKED_SESSION_RETENTION_MS,
  ).toISOString();

  db.prepare(
    `DELETE FROM sessions WHERE absolute_expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
  ).run(nowIso, revokedCutoff);

  db.prepare(`DELETE FROM recovery_tickets WHERE expires_at < ?`).run(nowIso);
}
