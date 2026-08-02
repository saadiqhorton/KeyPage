import type Database from "better-sqlite3";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  RECOVERY_CODE_COUNT,
  RECOVERY_TICKET_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  type KdfParams,
  type RecoveryClaimResponse,
  type RecoveryCodesRegenerateResponse,
  type RecoveryResetResponse,
  type VaultLoginResponse,
  type VaultPasswordChangeResponse,
  type VaultSessionResponse,
  type VaultSetupResponse,
  type VaultStatusResponse,
} from "@keypage/shared";

import {
  validateKdfParams,
  validateRecoveryEnvelopes,
} from "../auth/kdf-params.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  touchSession,
} from "../auth/sessions.js";
import {
  assertNotLocked,
  readLockout,
  recordFailure,
  resetThrottle,
} from "../auth/throttle.js";
import { newId, randomToken, sha256Hex } from "../auth/tokens.js";
import { hashAuthKey, verifyAuthKey } from "../auth/verifier.js";
import {
  kdfSchema,
  recoveryEnvelopeSchema,
  reencryptedEntrySchema,
  validateAuthKeyB64,
} from "../auth/vault-request.js";
import {
  changeMasterPassword,
  countUnusedRecoveryCodes,
  findRecoveryCodeByLookupHash,
  getVaultAuth,
  initializeVault,
  isVaultInitialized,
  regenerateRecoveryCodes,
  resetVaultFromRecovery,
  vaultAuthToKdfParams,
} from "../auth/vault-repo.js";
import { validateCipherInput } from "../keys/validate.js";
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import type { RecoveryCodeRow } from "../db/rows.js";
import {
  HttpInvalidCredentials,
  HttpInvalidRecoveryCode,
  HttpInvalidRequest,
  HttpSetupRequired,
  HttpVaultAlreadyInitialized,
} from "../errors.js";
import { checkOrigin } from "../plugins/check-origin.js";
import { createRequireSession } from "../plugins/require-session.js";
import { resolveIdleTimeoutSeconds } from "../settings.js";

const BODY_LIMIT = 65536;
const LARGE_BODY_LIMIT = 4_194_304;
const LOOKUP_HASH_PATTERN = /^[0-9a-f]{64}$/;

export type VaultRouteOptions = {
  db: Database.Database;
};

function idleTimeoutSeconds(db: Database.Database): number {
  return resolveIdleTimeoutSeconds(db);
}

function withEntryFieldPrefix<T>(index: number, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof HttpInvalidRequest && error.details) {
      throw new HttpInvalidRequest(
        error.message,
        error.details.map((detail) => ({
          field: `entries[${index}].${detail.field}`,
          message: detail.message,
        })),
      );
    }
    throw error;
  }
}

function recoveryCodeRowToKdfParams(row: RecoveryCodeRow): KdfParams {
  if (row.kdf_algorithm === "argon2id") {
    return {
      algorithm: "argon2id",
      saltB64: row.kdf_salt,
      iterations: row.kdf_iterations,
      memoryKiB: row.kdf_memory_kib ?? undefined,
      parallelism: row.kdf_parallelism ?? undefined,
    };
  }

  return {
    algorithm: "pbkdf2-sha256",
    saltB64: row.kdf_salt,
    iterations: row.kdf_iterations,
  };
}

function buildStatusResponse(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
): VaultStatusResponse {
  const idleSeconds = idleTimeoutSeconds(db);
  const resolution = resolveSession(db, request, idleSeconds);

  if (!resolution.ok && request.cookies?.[SESSION_COOKIE_NAME]) {
    clearSessionCookie(reply, request);
  }

  const vault = getVaultAuth(db);

  if (!vault) {
    return {
      state: "setup_required",
      kdf: null,
      recoveryCodesRemaining: 0,
      keyVersion: 0,
      lockout: readLockout(db, "login"),
      recoveryLockout: readLockout(db, "recovery"),
      session: {
        authenticated: false,
        idleTimeoutSeconds: idleSeconds,
      },
    };
  }

  return {
    state: "ready",
    kdf: vaultAuthToKdfParams(vault),
    recoveryCodesRemaining: countUnusedRecoveryCodes(db),
    keyVersion: vault.key_version,
    lockout: readLockout(db, "login"),
    recoveryLockout: readLockout(db, "recovery"),
    session: {
      authenticated: resolution.ok,
      idleTimeoutSeconds: idleSeconds,
    },
  };
}

function buildSessionResponse(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
): VaultSessionResponse {
  const idleSeconds = idleTimeoutSeconds(db);
  const resolution = resolveSession(db, request, idleSeconds);

  if (!resolution.ok) {
    if (request.cookies?.[SESSION_COOKIE_NAME]) {
      clearSessionCookie(reply, request);
    }

    return {
      authenticated: false,
      idleTimeoutSeconds: idleSeconds,
      idleSecondsRemaining: 0,
      absoluteExpiresAt: null,
    };
  }

  const idleElapsedSeconds = Math.floor(
    (Date.now() - Date.parse(resolution.session.lastSeenAt)) / 1000,
  );
  const idleSecondsRemaining = Math.max(0, idleSeconds - idleElapsedSeconds);

  return {
    authenticated: true,
    idleTimeoutSeconds: idleSeconds,
    idleSecondsRemaining,
    absoluteExpiresAt: resolution.session.absoluteExpiresAt,
  };
}

function claimRecoveryCode(
  db: Database.Database,
  lookupHash: string,
): RecoveryClaimResponse {
  const code = findRecoveryCodeByLookupHash(db, lookupHash);
  if (!code || code.used_at !== null) {
    const attemptsRemaining = recordFailure(db, "recovery");
    throw new HttpInvalidRecoveryCode(
      "That recovery code isn't valid",
      attemptsRemaining,
    );
  }

  const vault = getVaultAuth(db);
  if (!vault) {
    throw new HttpSetupRequired();
  }

  const ticket = randomToken();
  const tokenHash = sha256Hex(ticket);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + RECOVERY_TICKET_TTL_SECONDS * 1000,
  ).toISOString();

  let raced = false;
  const apply = db.transaction(() => {
    const update = db
      .prepare(
        `UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
      )
      .run(nowIso, code.id);

    if (update.changes === 0) {
      raced = true;
      return;
    }

    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(newId(), tokenHash, code.id, nowIso, expiresAt);
  });

  apply();

  if (raced) {
    const attemptsRemaining = recordFailure(db, "recovery");
    throw new HttpInvalidRecoveryCode(
      "That recovery code isn't valid",
      attemptsRemaining,
    );
  }

  const codesRemaining = countUnusedRecoveryCodes(db);

  return {
    recoveryTicket: ticket,
    kdf: recoveryCodeRowToKdfParams(code),
    wrappedMasterKeyB64: code.wrapped_master_key,
    keyVersion: vault.key_version,
    codesRemaining,
  };
}

export const vaultRoutes: FastifyPluginAsync<VaultRouteOptions> = async (
  app,
  options,
) => {
  const { db } = options;
  const requireSession = createRequireSession(db, () =>
    idleTimeoutSeconds(db),
  );

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      if (body === "" || (typeof body === "string" && body.trim() === "")) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get("/status", async (request, reply): Promise<VaultStatusResponse> =>
    buildStatusResponse(db, request, reply),
  );

  app.get(
    "/session",
    async (request, reply): Promise<VaultSessionResponse> =>
      buildSessionResponse(db, request, reply),
  );

  app.post(
    "/setup",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: ["kdf", "authKeyB64", "recoveryCodes"],
          properties: {
            kdf: kdfSchema,
            authKeyB64: { type: "string" },
            recoveryCodes: {
              type: "array",
              minItems: RECOVERY_CODE_COUNT,
              maxItems: RECOVERY_CODE_COUNT,
              items: recoveryEnvelopeSchema,
            },
          },
        },
      },
    },
    async (request, reply): Promise<VaultSetupResponse> => {
      const body = request.body as {
        kdf: KdfParams;
        authKeyB64: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateKdfParams(body.kdf);
      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      if (isVaultInitialized(db)) {
        throw new HttpVaultAlreadyInitialized();
      }

      const authVerifier = await hashAuthKey(body.authKeyB64);

      initializeVault(db, {
        kdf: body.kdf,
        authVerifier,
        recoveryCodes: body.recoveryCodes,
      });

      const idleSeconds = idleTimeoutSeconds(db);
      const { token, info } = createSession(db, request, idleSeconds);
      setSessionCookie(reply, request, token);

      return reply.status(201).send({
        state: "ready",
        session: info,
      });
    },
  );

  app.post(
    "/login",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: ["authKeyB64"],
          properties: {
            authKeyB64: { type: "string" },
          },
        },
      },
    },
    async (request, reply): Promise<VaultLoginResponse> => {
      if (!isVaultInitialized(db)) {
        throw new HttpSetupRequired();
      }

      assertNotLocked(db, "login");

      const body = request.body as { authKeyB64: string };
      validateAuthKeyB64(body.authKeyB64);

      const vault = getVaultAuth(db);
      if (!vault) {
        throw new HttpSetupRequired();
      }

      const valid = await verifyAuthKey(body.authKeyB64, vault.auth_verifier);
      if (!valid) {
        const attemptsRemaining = recordFailure(db, "login");
        throw new HttpInvalidCredentials(
          "Incorrect Master Password",
          attemptsRemaining,
        );
      }

      resetThrottle(db, "login");

      const idleSeconds = idleTimeoutSeconds(db);
      const currentSession = resolveSession(db, request, idleSeconds);
      if (currentSession.ok) {
        revokeSession(db, currentSession.session.id);
      }

      const { token, info } = createSession(db, request, idleSeconds);
      setSessionCookie(reply, request, token);

      return { session: info };
    },
  );

  app.post(
    "/session/touch",
    {
      preHandler: [checkOrigin, requireSession],
    },
    async (request, reply) => {
      touchSession(db, request.vaultSession!.id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/lock",
    {
      preHandler: checkOrigin,
    },
    async (request, reply) => {
      const idleSeconds = idleTimeoutSeconds(db);
      const resolution = resolveSession(db, request, idleSeconds);

      if (resolution.ok) {
        revokeSession(db, resolution.session.id);
      }

      clearSessionCookie(reply, request);
      return reply.code(204).send();
    },
  );

  app.post(
    "/recovery/claim",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: ["lookupHash"],
          properties: {
            lookupHash: { type: "string" },
          },
        },
      },
    },
    async (request): Promise<RecoveryClaimResponse> => {
      if (!isVaultInitialized(db)) {
        throw new HttpSetupRequired();
      }

      assertNotLocked(db, "recovery");

      const body = request.body as { lookupHash: string };
      if (!LOOKUP_HASH_PATTERN.test(body.lookupHash)) {
        throw new HttpInvalidRequest("Invalid lookupHash", [
          {
            field: "lookupHash",
            message: "must be 64 lowercase hex characters",
          },
        ]);
      }

      return claimRecoveryCode(db, body.lookupHash);
    },
  );

  app.post(
    "/recovery/reset",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: ["recoveryTicket", "kdf", "authKeyB64", "recoveryCodes"],
          properties: {
            recoveryTicket: { type: "string" },
            kdf: kdfSchema,
            authKeyB64: { type: "string" },
            recoveryCodes: {
              type: "array",
              minItems: RECOVERY_CODE_COUNT,
              maxItems: RECOVERY_CODE_COUNT,
              items: recoveryEnvelopeSchema,
            },
          },
        },
      },
    },
    async (request, reply): Promise<RecoveryResetResponse> => {
      const body = request.body as {
        recoveryTicket: string;
        kdf: KdfParams;
        authKeyB64: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateKdfParams(body.kdf);
      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      const authVerifier = await hashAuthKey(body.authKeyB64);
      const idleSeconds = idleTimeoutSeconds(db);

      const { token, info } = resetVaultFromRecovery(
        db,
        {
          recoveryTicket: body.recoveryTicket,
          kdf: body.kdf,
          authVerifier,
          recoveryCodes: body.recoveryCodes,
        },
        request,
        idleSeconds,
      );

      setSessionCookie(reply, request, token);

      return {
        state: "ready",
        session: info,
      };
    },
  );

  app.post(
    "/password",
    {
      bodyLimit: LARGE_BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: [
            "currentAuthKeyB64",
            "kdf",
            "authKeyB64",
            "recoveryCodes",
            "entries",
          ],
          properties: {
            currentAuthKeyB64: { type: "string" },
            kdf: kdfSchema,
            authKeyB64: { type: "string" },
            recoveryCodes: {
              type: "array",
              minItems: RECOVERY_CODE_COUNT,
              maxItems: RECOVERY_CODE_COUNT,
              items: recoveryEnvelopeSchema,
            },
            entries: {
              type: "array",
              items: reencryptedEntrySchema,
            },
          },
        },
      },
    },
    async (request, reply): Promise<VaultPasswordChangeResponse> => {
      assertNotLocked(db, "login");

      const body = request.body as {
        currentAuthKeyB64: string;
        kdf: KdfParams;
        authKeyB64: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
        entries: Array<{
          id: string;
          cipher: Parameters<typeof validateCipherInput>[0];
        }>;
      };

      validateAuthKeyB64(body.currentAuthKeyB64, "currentAuthKeyB64");
      validateKdfParams(body.kdf);
      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      body.entries.forEach((entry, index) => {
        withEntryFieldPrefix(index, () => {
          validateCipherInput(entry.cipher);
        });
      });

      const vault = getVaultAuth(db);
      if (!vault) {
        throw new HttpSetupRequired();
      }

      const currentValid = await verifyAuthKey(
        body.currentAuthKeyB64,
        vault.auth_verifier,
      );
      if (!currentValid) {
        const attemptsRemaining = recordFailure(db, "login");
        throw new HttpInvalidCredentials(
          "Incorrect Master Password",
          attemptsRemaining,
        );
      }

      const authVerifier = await hashAuthKey(body.authKeyB64);
      const idleSeconds = idleTimeoutSeconds(db);

      const { token, info, keyVersion, reEncrypted } = changeMasterPassword(
        db,
        {
          kdf: body.kdf,
          authVerifier,
          recoveryCodes: body.recoveryCodes,
          entries: body.entries,
        },
        request,
        idleSeconds,
      );

      setSessionCookie(reply, request, token);

      return {
        state: "ready",
        keyVersion,
        reEncrypted,
        session: info,
      };
    },
  );

  app.post(
    "/recovery-codes",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: ["authKeyB64", "recoveryCodes"],
          properties: {
            authKeyB64: { type: "string" },
            recoveryCodes: {
              type: "array",
              minItems: RECOVERY_CODE_COUNT,
              maxItems: RECOVERY_CODE_COUNT,
              items: recoveryEnvelopeSchema,
            },
          },
        },
      },
    },
    async (request): Promise<RecoveryCodesRegenerateResponse> => {
      assertNotLocked(db, "login");

      const body = request.body as {
        authKeyB64: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      const vault = getVaultAuth(db);
      if (!vault) {
        throw new HttpSetupRequired();
      }

      const valid = await verifyAuthKey(body.authKeyB64, vault.auth_verifier);
      if (!valid) {
        const attemptsRemaining = recordFailure(db, "login");
        throw new HttpInvalidCredentials(
          "Incorrect Master Password",
          attemptsRemaining,
        );
      }

      resetThrottle(db, "login");

      return regenerateRecoveryCodes(db, body.recoveryCodes);
    },
  );
};
