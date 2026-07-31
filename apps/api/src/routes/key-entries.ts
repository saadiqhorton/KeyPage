import type Database from "better-sqlite3";
import DatabaseLib from "better-sqlite3";
import type { FastifyPluginAsync } from "fastify";

import type {
  KeyEntryCreateRequest,
  KeyEntryCreateResponse,
  KeyEntryListResponse,
} from "@keypage/shared";

import { recordActivityEvent } from "../keys/activity-repo.js";
import {
  insertKeyEntry,
  listKeyEntries,
} from "../keys/key-entry-repo.js";
import {
  normalizeDescription,
  normalizeLabel,
  normalizeTags,
  validateCipherInput,
  validateKeyEntryId,
  validateService,
} from "../keys/validate.js";
import { checkOrigin } from "../plugins/check-origin.js";
import { createRequireSession } from "../plugins/require-session.js";
import { resolveIdleTimeoutSeconds } from "../settings.js";
import { HttpInvalidRequest } from "../errors.js";

const BODY_LIMIT = 65536;

export type KeyEntryRouteOptions = {
  db: Database.Database;
};

const cipherSchema = {
  type: "object",
  required: ["algorithm", "ivB64", "ciphertextB64"],
  properties: {
    algorithm: { type: "string", enum: ["aes-256-gcm"] },
    ivB64: { type: "string" },
    ciphertextB64: { type: "string" },
  },
} as const;

function isDuplicateIdError(error: unknown): boolean {
  return (
    error instanceof DatabaseLib.SqliteError &&
    error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
}

export const keyEntryRoutes: FastifyPluginAsync<KeyEntryRouteOptions> = async (
  app,
  options,
) => {
  const { db } = options;
  const requireSession = createRequireSession(db, () =>
    resolveIdleTimeoutSeconds(db),
  );

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get(
    "/",
    {
      preHandler: [checkOrigin, requireSession],
    },
    async (): Promise<KeyEntryListResponse> => ({
      entries: listKeyEntries(db),
    }),
  );

  app.post(
    "/",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: [
            "id",
            "label",
            "serviceId",
            "tags",
            "cipher",
          ],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            serviceId: { type: "string" },
            customServiceName: { type: "string" },
            description: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            cipher: cipherSchema,
          },
        },
      },
    },
    async (request, reply): Promise<KeyEntryCreateResponse> => {
      const body = request.body as KeyEntryCreateRequest;

      validateKeyEntryId(body.id);
      const label = normalizeLabel(body.label);
      const description = normalizeDescription(body.description);
      const tags = normalizeTags(body.tags);
      const { customServiceName } = validateService(
        body.serviceId,
        body.customServiceName,
      );
      validateCipherInput(body.cipher);

      let entry;

      try {
        const occurredAt = new Date().toISOString();
        const apply = db.transaction(() => {
          const created = insertKeyEntry(db, {
            id: body.id,
            label,
            serviceId: body.serviceId,
            customServiceName,
            description,
            tags,
            cipher: body.cipher,
          });
          recordActivityEvent(db, {
            keyEntryId: created.id,
            action: "created",
            occurredAt,
          });
          return created;
        });
        entry = apply();
      } catch (error) {
        if (isDuplicateIdError(error)) {
          throw new HttpInvalidRequest("Duplicate key entry id", [
            { field: "id", message: "already exists" },
          ]);
        }
        throw error;
      }

      return reply.status(201).send({ entry });
    },
  );
};
