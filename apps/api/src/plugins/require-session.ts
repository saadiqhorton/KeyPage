import type Database from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  resolveSession,
  type ResolvedSession,
} from "../auth/sessions.js";
import { clearSessionCookie } from "../cookies.js";
import {
  HttpSessionExpired,
  HttpUnauthenticated,
} from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    vaultSession?: ResolvedSession;
  }
}

export function createRequireSession(
  db: Database.Database,
  resolveIdleTimeoutSeconds: () => number,
) {
  return async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const resolution = resolveSession(
      db,
      request,
      resolveIdleTimeoutSeconds(),
    );

    if (!resolution.ok) {
      clearSessionCookie(reply, request);

      if (
        resolution.reason === "idle" ||
        resolution.reason === "expired" ||
        resolution.reason === "revoked"
      ) {
        throw new HttpSessionExpired();
      }

      throw new HttpUnauthenticated();
    }

    request.vaultSession = resolution.session;
  };
}
