import type Database from "better-sqlite3";

import type { LockoutState } from "@keypage/shared";

import type { ThrottleScope } from "../db/rows.js";
import { HttpRateLimited } from "../errors.js";
import { resolveThrottleConfig } from "../settings.js";

export type { ThrottleScope };

export function readLockout(
  db: Database.Database,
  scope: ThrottleScope,
): LockoutState {
  const row = db
    .prepare(
      `SELECT locked_until FROM auth_throttle WHERE scope = ?`,
    )
    .get(scope) as { locked_until: string | null } | undefined;

  if (!row?.locked_until) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  const lockedUntilMs = Date.parse(row.locked_until);
  const nowMs = Date.now();

  if (lockedUntilMs > nowMs) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((lockedUntilMs - nowMs) / 1000),
    };
  }

  return { locked: false, retryAfterSeconds: 0 };
}

export function assertNotLocked(
  db: Database.Database,
  scope: ThrottleScope,
): void {
  const row = db
    .prepare(
      `SELECT locked_until FROM auth_throttle WHERE scope = ?`,
    )
    .get(scope) as { locked_until: string | null } | undefined;

  if (!row?.locked_until) {
    return;
  }

  const lockedUntilMs = Date.parse(row.locked_until);
  const nowMs = Date.now();

  if (lockedUntilMs > nowMs) {
    throw new HttpRateLimited(
      "Too many attempts. Try again later.",
      Math.ceil((lockedUntilMs - nowMs) / 1000),
    );
  }

  db.prepare(
    `UPDATE auth_throttle
     SET locked_until = NULL, failed_count = 0
     WHERE scope = ?`,
  ).run(scope);
}

export function recordFailure(
  db: Database.Database,
  scope: ThrottleScope,
): number {
  const config = resolveThrottleConfig();
  const now = new Date();
  const nowIso = now.toISOString();

  const row = db
    .prepare(
      `SELECT failed_count, first_failed_at, locked_until
       FROM auth_throttle
       WHERE scope = ?`,
    )
    .get(scope) as {
    failed_count: number;
    first_failed_at: string | null;
    locked_until: string | null;
  };

  if (row.locked_until) {
    const lockedUntilMs = Date.parse(row.locked_until);
    if (lockedUntilMs > now.getTime()) {
      return 0;
    }
  }

  let failedCount = row.failed_count;
  const firstFailedAt = row.first_failed_at;

  if (
    firstFailedAt === null ||
    now.getTime() - Date.parse(firstFailedAt) >
      config.failureWindowSeconds * 1000
  ) {
    failedCount = 1;
    db.prepare(
      `UPDATE auth_throttle
       SET failed_count = 1,
           first_failed_at = ?,
           last_failed_at = ?,
           locked_until = NULL
       WHERE scope = ?`,
    ).run(nowIso, nowIso, scope);
  } else {
    failedCount += 1;
    if (failedCount >= config.maxAttempts) {
      const lockedUntil = new Date(
        now.getTime() + config.lockoutSeconds * 1000,
      ).toISOString();

      db.prepare(
        `UPDATE auth_throttle
         SET failed_count = 0,
             first_failed_at = NULL,
             last_failed_at = ?,
             locked_until = ?,
             lockout_count = lockout_count + 1
         WHERE scope = ?`,
      ).run(nowIso, lockedUntil, scope);

      return 0;
    }

    db.prepare(
      `UPDATE auth_throttle
       SET failed_count = ?,
           last_failed_at = ?
       WHERE scope = ?`,
    ).run(failedCount, nowIso, scope);
  }

  return config.maxAttempts - failedCount;
}

export function resetThrottle(
  db: Database.Database,
  scope: ThrottleScope,
): void {
  db.prepare(
    `UPDATE auth_throttle
     SET failed_count = 0,
         first_failed_at = NULL,
         last_failed_at = NULL,
         locked_until = NULL
     WHERE scope = ?`,
  ).run(scope);
}
