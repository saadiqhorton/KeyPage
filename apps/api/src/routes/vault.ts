import type Database from "better-sqlite3";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  RECOVERY_CODE_COUNT,
  SESSION_COOKIE_NAME,
  loginAuthMessage,
  recoveryAuthMessage,
  verifyClientProof,
  type KdfParams,
  type RecoveryClaimResponse,
  type RecoveryCodesRegenerateResponse,
  type RecoveryResetResponse,
  type SessionInfo,
  type VaultLoginChallengeResponse,
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
  createLoginChallenge,
  consumeLoginChallenge,
} from "../auth/login-challenges.js";
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
import {
  kdfSchema,
  recoveryEnvelopeSchema,
  reencryptedEntrySchema,
  validateClientProofB64,
  validateStoredKeyHex,
} from "../auth/vault-request.js";
import {
  cancelRecoveryTicket,
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
  HttpInvalidRecoveryTicket,
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

function requireProofReadyVault(db: Database.Database): VaultAuthRow {
  const vault = getVaultAuth(db);
  if (!vault) {
    throw new HttpSetupRequired();
  }
  if (!vault.auth_stored_key || !vault.recovery_stored_key) {
    throw new HttpInvalidRequest(
      "This vault must be recovered before it can unlock on this version of KeyPage.",
      [
        {
          field: "auth",
          message:
            "stored-key proofs are required; use a recovery code to reset the Master Password",
        },
      ],
    );
  }
  return vault;
}

function verifyLoginProof(
  db: Database.Database,
  args: {
    challengeId: string;
    nonceB64: string;
    clientProofB64: string;
    storedKeyHex: string;
  },
): void {
  const challenge = consumeLoginChallenge(
    db,
    args.challengeId,
    args.nonceB64,
  );
  const proof = Buffer.from(args.clientProofB64, "base64");
  const message = loginAuthMessage(args.challengeId, args.nonceB64);
  if (
    !challenge ||
    !verifyClientProof(args.storedKeyHex, message, proof)
  ) {
    const attemptsRemaining = recordFailure(db, "login");
    throw new HttpInvalidCredentials(
      "Incorrect Master Password",
      attemptsRemaining,
    );
  }
}

function revokeOpenRecoveryTickets(db: Database.Database): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE recovery_tickets
     SET consumed_at = ?
     WHERE consumed_at IS NULL AND expires_at > ?`,
  ).run(nowIso, nowIso);
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
          required: [
            "kdf",
            "authStoredKeyHex",
            "recoveryStoredKeyHex",
            "recoveryCodes",
          ],
          properties: {
            kdf: kdfSchema,
            authStoredKeyHex: { type: "string" },
            recoveryStoredKeyHex: { type: "string" },
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
        authStoredKeyHex: string;
        recoveryStoredKeyHex: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateKdfParams(body.kdf);
      validateStoredKeyHex(body.authStoredKeyHex, "authStoredKeyHex");
      validateStoredKeyHex(body.recoveryStoredKeyHex, "recoveryStoredKeyHex");
      validateRecoveryEnvelopes(body.recoveryCodes);

      if (isVaultInitialized(db)) {
        throw new HttpVaultAlreadyInitialized();
      }

      initializeVault(db, {
        kdf: body.kdf,
        proofKeys: {
          authStoredKeyHex: body.authStoredKeyHex,
          recoveryStoredKeyHex: body.recoveryStoredKeyHex,
        },
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
    "/login/challenge",
    {
      preHandler: checkOrigin,
    },
    async (): Promise<VaultLoginChallengeResponse> => {
      if (!isVaultInitialized(db)) {
        throw new HttpSetupRequired();
      }
      assertNotLocked(db, "login");
      requireProofReadyVault(db);
      return createLoginChallenge(db);
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
          required: ["challengeId", "nonceB64", "clientProofB64"],
          properties: {
            challengeId: { type: "string" },
            nonceB64: { type: "string" },
            clientProofB64: { type: "string" },
          },
        },
      },
    },
    async (request, reply): Promise<VaultLoginResponse> => {
      if (!isVaultInitialized(db)) {
        throw new HttpSetupRequired();
      }

      assertNotLocked(db, "login");

      const body = request.body as {
        challengeId: string;
        nonceB64: string;
        clientProofB64: string;
      };
      validateClientProofB64(body.clientProofB64, "clientProofB64");

      const vault = requireProofReadyVault(db);
      const storedKeyHex = vault.auth_stored_key!;

      try {
        verifyLoginProof(db, {
          challengeId: body.challengeId,
          nonceB64: body.nonceB64,
          clientProofB64: body.clientProofB64,
          storedKeyHex,
        });
      } catch (error) {
        if (error instanceof HttpInvalidCredentials) {
          throw error;
        }
        throw error;
      }

      resetThrottle(db, "login");

      const idleSeconds = idleTimeoutSeconds(db);

      let loginResult: { token: string; info: SessionInfo; keyVersion: number };
      try {
        loginResult = db.transaction(() => {
          const currentVault = getVaultAuth(db);
          if (
            !currentVault ||
            currentVault.auth_stored_key !== storedKeyHex
          ) {
            throw new HttpInvalidCredentials("Incorrect Master Password", 0);
          }

          const currentSession = resolveSession(db, request, idleSeconds);
          if (currentSession.ok) {
            revokeSession(db, currentSession.session.id);
          }

          revokeOpenRecoveryTickets(db);

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
    "/recovery/cancel",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: checkOrigin,
      schema: {
        body: {
          type: "object",
          required: ["recoveryTicket"],
          properties: {
            recoveryTicket: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { recoveryTicket: string };
      cancelRecoveryTicket(db, body.recoveryTicket);
      return reply.code(204).send();
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
            "challengeNonceB64",
            "recoveryClientProofB64",
            "kdf",
            "authStoredKeyHex",
            "recoveryStoredKeyHex",
            "recoveryCodes",
            "entries",
          ],
          properties: {
            recoveryTicket: { type: "string" },
            challengeNonceB64: { type: "string" },
            recoveryClientProofB64: { type: "string" },
            kdf: kdfSchema,
            authStoredKeyHex: { type: "string" },
            recoveryStoredKeyHex: { type: "string" },
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
        challengeNonceB64: string;
        recoveryClientProofB64: string;
        kdf: KdfParams;
        authStoredKeyHex: string;
        recoveryStoredKeyHex: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
        entries: Array<{
          id: string;
          baseIvB64: string;
          cipher: Parameters<typeof validateCipherPayload>[0];
        }>;
      };

      validateKdfParams(body.kdf);
      validateClientProofB64(
        body.recoveryClientProofB64,
        "recoveryClientProofB64",
      );
      validateStoredKeyHex(body.authStoredKeyHex, "authStoredKeyHex");
      validateStoredKeyHex(body.recoveryStoredKeyHex, "recoveryStoredKeyHex");
      validateRecoveryEnvelopes(body.recoveryCodes);

      body.entries.forEach((entry, index) => {
        withEntryFieldPrefix(index, () => {
          validateCipherPayload(entry.cipher);
        });
      });

      const vault = requireProofReadyVault(db);
      const recoveryStoredKey = vault.recovery_stored_key!;
      const message = recoveryAuthMessage(
        body.recoveryTicket,
        body.challengeNonceB64,
      );
      const proof = Buffer.from(body.recoveryClientProofB64, "base64");
      if (!verifyClientProof(recoveryStoredKey, message, proof)) {
        throw new HttpInvalidRecoveryTicket();
      }

      const idleSeconds = idleTimeoutSeconds(db);

      const { token, info, keyVersion, reEncrypted } = resetVaultFromRecovery(
        db,
        {
          recoveryTicket: body.recoveryTicket,
          challengeNonceB64: body.challengeNonceB64,
          kdf: body.kdf,
          proofKeys: {
            authStoredKeyHex: body.authStoredKeyHex,
            recoveryStoredKeyHex: body.recoveryStoredKeyHex,
          },
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
            "challengeId",
            "nonceB64",
            "currentClientProofB64",
            "kdf",
            "authStoredKeyHex",
            "recoveryStoredKeyHex",
            "recoveryCodes",
            "entries",
          ],
          properties: {
            challengeId: { type: "string" },
            nonceB64: { type: "string" },
            currentClientProofB64: { type: "string" },
            kdf: kdfSchema,
            authStoredKeyHex: { type: "string" },
            recoveryStoredKeyHex: { type: "string" },
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
        challengeId: string;
        nonceB64: string;
        currentClientProofB64: string;
        kdf: KdfParams;
        authStoredKeyHex: string;
        recoveryStoredKeyHex: string;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
        entries: Array<{
          id: string;
          baseIvB64: string;
          cipher: Parameters<typeof validateCipherPayload>[0];
        }>;
      };

      validateClientProofB64(
        body.currentClientProofB64,
        "currentClientProofB64",
      );
      validateKdfParams(body.kdf);
      validateStoredKeyHex(body.authStoredKeyHex, "authStoredKeyHex");
      validateStoredKeyHex(body.recoveryStoredKeyHex, "recoveryStoredKeyHex");
      validateRecoveryEnvelopes(body.recoveryCodes);

      body.entries.forEach((entry, index) => {
        withEntryFieldPrefix(index, () => {
          validateCipherPayload(entry.cipher);
        });
      });

      const vault = requireProofReadyVault(db);
      verifyLoginProof(db, {
        challengeId: body.challengeId,
        nonceB64: body.nonceB64,
        clientProofB64: body.currentClientProofB64,
        storedKeyHex: vault.auth_stored_key!,
      });

      resetThrottle(db, "login");

      const idleSeconds = idleTimeoutSeconds(db);

      const { token, info, keyVersion, reEncrypted } = changeMasterPassword(
        db,
        {
          kdf: body.kdf,
          proofKeys: {
            authStoredKeyHex: body.authStoredKeyHex,
            recoveryStoredKeyHex: body.recoveryStoredKeyHex,
          },
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
          required: [
            "challengeId",
            "nonceB64",
            "clientProofB64",
            "keyVersion",
            "recoveryCodes",
          ],
          properties: {
            challengeId: { type: "string" },
            nonceB64: { type: "string" },
            clientProofB64: { type: "string" },
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
        challengeId: string;
        nonceB64: string;
        clientProofB64: string;
        keyVersion: number;
        recoveryCodes: Parameters<typeof validateRecoveryEnvelopes>[0];
      };

      validateClientProofB64(body.clientProofB64, "clientProofB64");
      validateRecoveryEnvelopes(body.recoveryCodes);

      const vault = requireProofReadyVault(db);
      verifyLoginProof(db, {
        challengeId: body.challengeId,
        nonceB64: body.nonceB64,
        clientProofB64: body.clientProofB64,
        storedKeyHex: vault.auth_stored_key!,
      });

      resetThrottle(db, "login");

      return regenerateRecoveryCodes(db, {
        sessionId: request.vaultSession!.id,
        keyVersion: body.keyVersion,
        recoveryCodes: body.recoveryCodes,
      });
    },
  );
};
