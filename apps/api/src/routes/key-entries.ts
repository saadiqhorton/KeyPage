import type Database from "better-sqlite3";
import DatabaseLib from "better-sqlite3";
import type { FastifyPluginAsync } from "fastify";

import type {
  KeyEntryCreateRequest,
  KeyEntryCreateResponse,
  KeyEntryImportItem,
  KeyEntryImportRequest,
  KeyEntryImportResponse,
  KeyEntryListResponse,
  KeyEntryUpdateRequest,
  KeyEntryUpdateResponse,
  KeyEntryUseRequest,
  KeyEntryUseResponse,
} from "@keypage/shared";
import { KEY_ENTRY_IMPORT_MAX } from "@keypage/shared";

import { recordActivityEvent } from "../keys/activity-repo.js";
import {
  deleteKeyEntry,
  getKeyEntry,
  insertKeyEntry,
  listKeyEntries,
  listKeyEntryIds,
  markKeyEntryUsed,
  updateKeyEntry,
} from "../keys/key-entry-repo.js";
import {
  normalizeDescription,
  normalizeImportTimestamp,
  normalizeLabel,
  normalizeTags,
  validateCipherInput,
  validateKeyEntryId,
  validateService,
} from "../keys/validate.js";
import { assertKeyEntryMutationsAllowed } from "../auth/vault-repo.js";
import { checkOrigin } from "../plugins/check-origin.js";
import { createRequireSession } from "../plugins/require-session.js";
import { resolveClipboardClearSeconds, resolveIdleTimeoutSeconds } from "../settings.js";
import { HttpInvalidRequest } from "../errors.js";

const BODY_LIMIT = 65536;
const IMPORT_BODY_LIMIT = 4_194_304;

export type KeyEntryRouteOptions = {
  db: Database.Database;
};

const cipherSchema = {
  type: "object",
  required: ["algorithm", "ivB64", "ciphertextB64", "keyVersion"],
  properties: {
    algorithm: { type: "string", enum: ["aes-256-gcm"] },
    ivB64: { type: "string" },
    ciphertextB64: { type: "string" },
    keyVersion: { type: "integer" },
  },
} as const;

function isDuplicateIdError(error: unknown): boolean {
  return (
    error instanceof DatabaseLib.SqliteError &&
    error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
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

type ValidatedImportEntry = {
  id: string;
  label: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
  serviceId: string;
  cipher: KeyEntryCreateRequest["cipher"];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
};

function validateImportEntry(
  entry: KeyEntryImportItem,
  index: number,
): ValidatedImportEntry {
  return withEntryFieldPrefix(index, () => {
    validateKeyEntryId(entry.id);
    const label = normalizeLabel(entry.label);
    const description = normalizeDescription(entry.description);
    const tags = normalizeTags(entry.tags);
    const { customServiceName } = validateService(
      entry.serviceId,
      entry.customServiceName,
    );
    validateCipherInput(entry.cipher);

    const createdAt = normalizeImportTimestamp(entry.createdAt, "createdAt");
    const updatedAt = normalizeImportTimestamp(entry.updatedAt, "updatedAt");
    const lastUsedAt = normalizeImportTimestamp(entry.lastUsedAt, "lastUsedAt");

    return {
      id: entry.id,
      label,
      customServiceName,
      description,
      tags,
      serviceId: entry.serviceId,
      cipher: entry.cipher,
      ...(createdAt !== null ? { createdAt } : {}),
      ...(updatedAt !== null ? { updatedAt } : {}),
      ...(lastUsedAt !== null ? { lastUsedAt } : {}),
    };
  });
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
      clipboardClearSeconds: resolveClipboardClearSeconds(db),
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
        const sessionId = request.vaultSession!.id;
        const apply = db.transaction(() => {
          assertKeyEntryMutationsAllowed(db, sessionId);
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

  app.post(
    "/import",
    {
      bodyLimit: IMPORT_BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: ["entries"],
          properties: {
            entries: {
              type: "array",
              minItems: 1,
              maxItems: KEY_ENTRY_IMPORT_MAX,
              items: {
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
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  lastUsedAt: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    async (request): Promise<KeyEntryImportResponse> => {
      const body = request.body as KeyEntryImportRequest;

      const validatedEntries = body.entries.map((entry, index) =>
        validateImportEntry(entry, index),
      );

      const occurredAt = new Date().toISOString();
      const sessionId = request.vaultSession!.id;

      return db.transaction(() => {
        assertKeyEntryMutationsAllowed(db, sessionId);
        const existingIds = listKeyEntryIds(db);
        const skippedIds: string[] = [];
        let imported = 0;

        for (const entry of validatedEntries) {
          if (existingIds.has(entry.id)) {
            skippedIds.push(entry.id);
            continue;
          }

          const created = insertKeyEntry(db, {
            id: entry.id,
            label: entry.label,
            serviceId: entry.serviceId,
            customServiceName: entry.customServiceName,
            description: entry.description,
            tags: entry.tags,
            cipher: entry.cipher,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastUsedAt: entry.lastUsedAt,
          });
          recordActivityEvent(db, {
            keyEntryId: created.id,
            action: "created",
            occurredAt,
          });
          existingIds.add(created.id);
          imported += 1;
        }

        return { imported, skippedIds };
      })();
    },
  );

  app.post(
    "/:id/use",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["revealed", "copied"] },
          },
        },
      },
    },
    /**
     * Deliberately outside the key-version invariant: this writes only
     * `last_used_at` plus an activity row, never ciphertext, so a rotation
     * cannot mislabel anything here. Recovery claim revokes every session, so
     * `requireSession` already blocks it for the lifetime of a ticket.
     */
    async (request): Promise<KeyEntryUseResponse> => {
      const { id } = request.params as { id: string };
      validateKeyEntryId(id);

      const body = request.body as KeyEntryUseRequest;
      const occurredAt = new Date().toISOString();

      const entry = db.transaction(() => {
        const updated = markKeyEntryUsed(db, id, occurredAt);
        if (!updated) {
          throw new HttpInvalidRequest("Unknown key entry", [
            { field: "id", message: "not found" },
          ]);
        }
        recordActivityEvent(db, {
          keyEntryId: id,
          action: body.action,
          occurredAt,
        });
        return updated;
      })();

      return { entry };
    },
  );

  app.patch(
    "/:id",
    {
      bodyLimit: BODY_LIMIT,
      preHandler: [checkOrigin, requireSession],
      schema: {
        body: {
          type: "object",
          required: ["label", "serviceId", "tags"],
          properties: {
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
    async (request): Promise<KeyEntryUpdateResponse> => {
      const { id } = request.params as { id: string };
      validateKeyEntryId(id);

      const body = request.body as KeyEntryUpdateRequest;
      const label = normalizeLabel(body.label);
      const description = normalizeDescription(body.description);
      const tags = normalizeTags(body.tags);
      const { customServiceName } = validateService(
        body.serviceId,
        body.customServiceName,
      );
      if (body.cipher !== undefined) {
        validateCipherInput(body.cipher);
      }

      const occurredAt = new Date().toISOString();
      const sessionId = request.vaultSession!.id;

      const entry = db.transaction(() => {
        assertKeyEntryMutationsAllowed(db, sessionId);
        const updated = updateKeyEntry(db, {
          id,
          label,
          serviceId: body.serviceId,
          customServiceName,
          description,
          tags,
          ...(body.cipher !== undefined ? { cipher: body.cipher } : {}),
          updatedAt: occurredAt,
        });
        if (!updated) {
          throw new HttpInvalidRequest("Unknown key entry", [
            { field: "id", message: "not found" },
          ]);
        }
        recordActivityEvent(db, {
          keyEntryId: id,
          action: "edited",
          occurredAt,
        });
        return updated;
      })();

      return { entry };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [checkOrigin, requireSession],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      validateKeyEntryId(id);

      const occurredAt = new Date().toISOString();
      const sessionId = request.vaultSession!.id;

      db.transaction(() => {
        assertKeyEntryMutationsAllowed(db, sessionId);
        const existing = getKeyEntry(db, id);
        if (!existing) {
          throw new HttpInvalidRequest("Unknown key entry", [
            { field: "id", message: "not found" },
          ]);
        }
        recordActivityEvent(db, {
          keyEntryId: id,
          action: "deleted",
          occurredAt,
        });
        deleteKeyEntry(db, id);
      })();

      return reply.status(204).send();
    },
  );
};
