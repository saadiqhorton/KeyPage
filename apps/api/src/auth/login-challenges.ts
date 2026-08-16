import { randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import {
  LOGIN_CHALLENGE_MAX_OPEN,
  LOGIN_CHALLENGE_TTL_SECONDS,
} from "@keypage/shared";

import type { LoginChallengeRow } from "../db/rows.js";
import { HttpRateLimited } from "../errors.js";
import { newId } from "./tokens.js";

export type IssuedLoginChallenge = {
  challengeId: string;
  nonceB64: string;
  expiresAt: string;
};

export function createLoginChallenge(
  db: Database.Database,
): IssuedLoginChallenge {
  const now = new Date();
  const nowIso = now.toISOString();
  db.prepare(`DELETE FROM login_challenges WHERE expires_at < ?`).run(nowIso);

  const open = db
    .prepare(`SELECT COUNT(*) AS count FROM login_challenges`)
    .get() as { count: number };
  if (open.count >= LOGIN_CHALLENGE_MAX_OPEN) {
    throw new HttpRateLimited(
      "Too many outstanding login challenges",
      LOGIN_CHALLENGE_TTL_SECONDS,
    );
  }

  const expiresAt = new Date(
    now.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * 1000,
  ).toISOString();
  const challengeId = newId();
  const nonceB64 = randomBytes(32).toString("base64");

  db.prepare(
    `INSERT INTO login_challenges (id, nonce_b64, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(challengeId, nonceB64, nowIso, expiresAt);

  return { challengeId, nonceB64, expiresAt };
}

/**
 * Consume a challenge atomically. Returns the row if id+nonce match and unexpired.
 */
export function consumeLoginChallenge(
  db: Database.Database,
  challengeId: string,
  nonceB64: string,
): LoginChallengeRow | null {
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `DELETE FROM login_challenges
       WHERE id = ? AND nonce_b64 = ? AND expires_at > ?
       RETURNING id, nonce_b64, created_at, expires_at`,
    )
    .get(challengeId, nonceB64, nowIso) as LoginChallengeRow | undefined;

  return row ?? null;
}
