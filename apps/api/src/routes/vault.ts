import type Database from "better-sqlite3";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  RECOVERY_CODE_COUNT,
  SESSION_COOKIE_NAME,
  type KdfParams,
  type RecoveryClaimResponse,
  type RecoveryCodesRegenerateResponse,
  type RecoveryResetResponse,
  type SessionInfo,
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
import { hashAuthKey, verifyAuthKey } from "../auth/verifier.js";
import {
  kdfSchema,
  recoveryEnvelopeSchema,
  reencryptedEntrySchema,
  validateAuthKeyB64,
} from "../auth/vault-request.js";
import {
  changeMasterPassword,
  claimRecoveryCode,
  countUnusedRecoveryCodes,
  getVaultAuth,
  initializeVault,
  isVaultInitialized,
  regenerateRecoveryCodes,
  resetVaultFromRecovery,
  rowToKdfParams,
} from "../auth/vault-repo.js";
import { validateCipherPayload } from "../keys/validate.js";
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import type { VaultAuthRow } from "../db/rows.js";
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
// 32 MiB: ~8.5 KiB worst-case JSON per entry (KEY_ENTRY_CIPHERTEXT_B64_MAX ciphertext + iv/metadata).
const PASSWORD_CHANGE_BODY_LIMIT = 33_554_432;
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
    kdf: rowToKdfParams(vault),
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

async function verifyMasterPassword(
  db: Database.Database,
  authKeyB64: string,
): Promise<VaultAuthRow> {
  const vault = getVaultAuth(db);
  if (!vault) {
    throw new HttpSetupRequired();
  }

  const valid = await verifyAuthKey(authKeyB64, vault.auth_verifier);
  if (!valid) {
    const attemptsRemaining = recordFailure(db, "login");
    throw new HttpInvalidCredentials(
      "Incorrect Master Password",
      attemptsRemaining,
    );
  }

  return vault;
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
        keyVersion: getVaultAuth(db)!.key_version,
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

      const verifiedVerifier = vault.auth_verifier;

      const valid = await verifyAuthKey(body.authKeyB64, verifiedVerifier);
      if (!valid) {
        const attemptsRemaining = recordFailure(db, "login");
        throw new HttpInvalidCredentials(
          "Incorrect Master Password",
          attemptsRemaining,
        );
      }

      resetThrottle(db, "login");

      const idleSeconds = idleTimeoutSeconds(db);

      // Pin session creation to the verifier that was checked — synchronously,
      // inside the writer transaction, so a rotation cannot commit in a gap.
      let loginResult: { token: string; info: SessionInfo; keyVersion: number };
      try {
        loginResult = db.transaction(() => {
          const currentVault = getVaultAuth(db);
          if (!currentVault || currentVault.auth_verifier !== verifiedVerifier) {
            throw new HttpInvalidCredentials("Incorrect Master Password", 0);
          }

          const currentSession = resolveSession(db, request, idleSeconds);
          if (currentSession.ok) {
            revokeSession(db, currentSession.session.id);
          }

          const { token, info } = createSession(db, request, idleSeconds);
          return { token, info, keyVersion: currentVault.key_version };
        })();
      } catch (error) {
        if (error instanceof HttpInvalidCredentials) {
          const attemptsRemaining = recordFailure(db, "login");
          throw new HttpInvalidCredentials(
            "Incorrect Master Password",
            attemptsRemaining,
          );
        }
        throw error;
      }

      setSessionCookie(reply, request, loginResult.token);

      return { keyVersion: loginResult.keyVersion, session: loginResult.info };
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

      const result = claimRecoveryCode(db, body.lookupHash);
      if (!result.ok) {
        const attemptsRemaining = recordFailure(db, "recovery");
        throw new HttpInvalidRecoveryCode(
          "That recovery code isn't valid",
          attemptsRemaining,
        );
      }

      return result.claim;
    },
  );

  app.post(
    "/recovery/reset",
    {
      bodyLimit: PASSWORD_CHANGE_BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: [
            "recoveryTicket",
            "kdf",
            "authKeyB64",
            "recoveryCodes",
            "entries",
          ],
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
            entries: {
              type: "array",
              items: reencryptedEntrySchema,
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
        entries: Array<{
          id: string;
          baseIvB64: string;
          cipher: Parameters<typeof validateCipherPayload>[0];
        }>;
      };

      validateKdfParams(body.kdf);
      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      body.entries.forEach((entry, index) => {
        withEntryFieldPrefix(index, () => {
          validateCipherPayload(entry.cipher);
        });
      });

      const authVerifier = await hashAuthKey(body.authKeyB64);
      const idleSeconds = idleTimeoutSeconds(db);

      const { token, info, keyVersion, reEncrypted } = resetVaultFromRecovery(
        db,
        {
          recoveryTicket: body.recoveryTicket,
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
    "/password",
    {
      bodyLimit: PASSWORD_CHANGE_BODY_LIMIT,
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
          baseIvB64: string;
          cipher: Parameters<typeof validateCipherPayload>[0];
        }>;
      };

      validateAuthKeyB64(body.currentAuthKeyB64, "currentAuthKeyB64");
      validateKdfParams(body.kdf);
      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      body.entries.forEach((entry, index) => {
        withEntryFieldPrefix(index, () => {
          validateCipherPayload(entry.cipher);
        });
      });

      await verifyMasterPassword(db, body.currentAuthKeyB64);

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
          required: ["authKeyB64", "keyVersion", "recoveryCodes"],
          properties: {
            authKeyB64: { type: "string" },
            keyVersion: { type: "integer" },
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
        keyVersion: number;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateAuthKeyB64(body.authKeyB64);
      validateRecoveryEnvelopes(body.recoveryCodes);

      await verifyMasterPassword(db, body.authKeyB64);

      resetThrottle(db, "login");

      return regenerateRecoveryCodes(db, {
        sessionId: request.vaultSession!.id,
        keyVersion: body.keyVersion,
        recoveryCodes: body.recoveryCodes,
      });
    },
  );
};
