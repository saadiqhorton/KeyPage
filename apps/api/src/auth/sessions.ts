import type Database from "better-sqlite3";

import {
  SESSION_ABSOLUTE_HOURS,
  SESSION_COOKIE_NAME,
  type SessionInfo,
} from "@keypage/shared";

import { newId, randomToken, sha256Hex } from "./tokens.js";

const TOUCH_THROTTLE_MS = 15_000;

export type ResolvedSession = {
  id: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
};

export type SessionResolution =
  | { ok: true; session: ResolvedSession }
  | {
      ok: false;
      reason: "missing" | "unknown" | "revoked" | "idle" | "expired";
    };

export type SessionRequest = {
  cookies?: Record<string, string | undefined>;
  headers?: { "user-agent"?: string };
  ip?: string;
};

function readSessionToken(req: SessionRequest): string | undefined {
  return req.cookies?.[SESSION_COOKIE_NAME];
}

function resolveAbsoluteLifetimeHours(): number {
  const raw = process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS;
  if (raw === undefined || raw === "") {
    return SESSION_ABSOLUTE_HOURS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SESSION_ABSOLUTE_HOURS;
  }

  return parsed;
}

export function createSession(
  db: Database.Database,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): { token: string; info: SessionInfo } {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const absoluteExpiresAt = new Date(
    now.getTime() + resolveAbsoluteLifetimeHours() * 60 * 60 * 1000,
  ).toISOString();
  const id = newId();

  db.prepare(
    `INSERT INTO sessions (
       id, token_hash, created_at, last_seen_at, absolute_expires_at,
       revoked_at, user_agent, ip
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    tokenHash,
    nowIso,
    nowIso,
    absoluteExpiresAt,
    req.headers?.["user-agent"] ?? null,
    req.ip ?? null,
  );

  return {
    token,
    info: {
      idleTimeoutSeconds,
      absoluteExpiresAt,
    },
  };
}

export function resolveSession(
  db: Database.Database,
  req: SessionRequest,
  idleTimeoutSeconds: number,
): SessionResolution {
  const token = readSessionToken(req);
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  const tokenHash = sha256Hex(token);
  const row = db
    .prepare(
      `SELECT id, last_seen_at, absolute_expires_at, revoked_at
       FROM sessions
       WHERE token_hash = ?`,
    )
    .get(tokenHash) as
    | {
        id: string;
        last_seen_at: string;
        absolute_expires_at: string;
        revoked_at: string | null;
      }
    | undefined;

  if (!row) {
    return { ok: false, reason: "unknown" };
  }

  const nowMs = Date.now();

  if (row.revoked_at !== null) {
    return { ok: false, reason: "revoked" };
  }

  if (Date.parse(row.absolute_expires_at) <= nowMs) {
    revokeSession(db, row.id);
    return { ok: false, reason: "expired" };
  }

  const idleMs = idleTimeoutSeconds * 1000;
  if (nowMs - Date.parse(row.last_seen_at) > idleMs) {
    revokeSession(db, row.id);
    return { ok: false, reason: "idle" };
  }

  return {
    ok: true,
    session: {
      id: row.id,
      lastSeenAt: row.last_seen_at,
      absoluteExpiresAt: row.absolute_expires_at,
    },
  };
}

export function touchSession(db: Database.Database, id: string): void {
  const row = db
    .prepare(`SELECT last_seen_at FROM sessions WHERE id = ? AND revoked_at IS NULL`)
    .get(id) as { last_seen_at: string } | undefined;

  if (!row) {
    return;
  }

  const nowMs = Date.now();
  if (nowMs - Date.parse(row.last_seen_at) < TOUCH_THROTTLE_MS) {
    return;
  }

  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(
    new Date(nowMs).toISOString(),
    id,
  );
}

export function revokeSession(db: Database.Database, id: string): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ).run(nowIso, id);
}

export function revokeAllSessions(db: Database.Database): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL`,
  ).run(nowIso);
}
