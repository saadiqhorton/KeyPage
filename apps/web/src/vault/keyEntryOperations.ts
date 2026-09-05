import {
  normalizeDescription,
  normalizeKeyEntryWriteFields,
  resolveServiceForImport,
  type BackupEntry,
  type KeyEntry,
  type KeyEntryCreateRequest,
  type KeyEntryCreateResponse,
  type KeyEntryImportItem,
  type KeyEntryImportRequest,
  type KeyEntryImportResponse,
  type KeyEntryUpdateRequest,
  type KeyEntryUpdateResponse,
  type KeyEntryUseAction,
  type KeyEntryUseResponse,
} from "@keypage/shared";

import {
  ClipboardWriteError,
  type ClipboardAutoClearHandle,
  type ClipboardWriteErrorReason,
} from "@/lib/clipboard.js";
import type { KeyVersionPin } from "@/vault/key-version-pin.js";

export type NewKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue: string;
};

export type EditKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue?: string;
};

export type ImportKeyEntriesResult = {
  imported: number;
  skippedIds: string[];
  /** Entries from the payload that were skipped client-side because the id already exists. */
  clientSkipped: number;
};

export type RevealSecretResult =
  | { ok: true; value: string; lastUsedAt?: string | null; activityFailed?: boolean }
  | { ok: false; reason: "decrypt" };

export type CopySecretResult =
  | {
      ok: true;
      clearSeconds: number;
      lastUsedAt?: string | null;
      activityFailed?: boolean;
    }
  | { ok: false; reason: "decrypt" }
  | { ok: false; reason: "clipboard"; clipboard: ClipboardWriteErrorReason };

export type KeyEntryOperationsPorts = {
  pin: KeyVersionPin;
  newKeyEntryId(): string;
  decryptKeyValue(entry: KeyEntry): Promise<string>;
  postKeyEntry(body: KeyEntryCreateRequest): Promise<KeyEntryCreateResponse>;
  patchKeyEntry(
    id: string,
    body: KeyEntryUpdateRequest,
  ): Promise<KeyEntryUpdateResponse>;
  deleteKeyEntry(id: string, options: { keyVersion: number }): Promise<void>;
  postKeyEntryUse(
    id: string,
    action: KeyEntryUseAction,
  ): Promise<KeyEntryUseResponse>;
  postKeyEntryImport(
    body: KeyEntryImportRequest,
  ): Promise<KeyEntryImportResponse>;
  copyTextWithAutoClear(text: string, clearMs: number): Promise<ClipboardAutoClearHandle>;
};

export type KeyEntryOperations = {
  create(input: NewKeyEntryInput): Promise<KeyEntry>;
  update(id: string, input: EditKeyEntryInput): Promise<KeyEntry>;
  remove(id: string): Promise<void>;
  markUsed(id: string, action: KeyEntryUseAction): Promise<KeyEntry>;
  revealSecret(entry: KeyEntry): Promise<RevealSecretResult>;
  copySecret(
    entry: KeyEntry,
    options: {
      revealedValue?: string | null;
      clipboardClearMs: number;
    },
  ): Promise<CopySecretResult>;
  /**
   * Normalize + encrypt backup plaintext entries, skip existing IDs, POST import.
   * Server still merges by entry ID as a second line of defense.
   */
  importEntries(
    entries: BackupEntry[],
    existingIds: ReadonlySet<string>,
  ): Promise<ImportKeyEntriesResult>;
};

function writeFieldsFromInput(input: {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
}) {
  const fields = normalizeKeyEntryWriteFields({
    label: input.label,
    serviceId: input.serviceId,
    customServiceName: input.customServiceName,
    description: input.description,
    tags: input.tags,
  });

  return {
    label: fields.label,
    serviceId: fields.serviceId,
    ...(fields.customServiceName !== null
      ? { customServiceName: fields.customServiceName }
      : {}),
    ...(fields.description !== null ? { description: fields.description } : {}),
    tags: fields.tags,
  };
}

export function createKeyEntryOperations(
  ports: KeyEntryOperationsPorts,
): KeyEntryOperations {
  const markUsed = async (
    id: string,
    action: KeyEntryUseAction,
  ): Promise<KeyEntry> => {
    const response = await ports.postKeyEntryUse(id, action);
    return response.entry;
  };

  return {
    async create(input) {
      const fields = writeFieldsFromInput(input);
      const id = ports.newKeyEntryId();
      const cipher = await ports.pin.encryptKeyValue(id, input.keyValue);
      const response = await ports.pin.guardWrite(
        ports.postKeyEntry({
          id,
          ...fields,
          cipher,
        }),
      );
      return response.entry;
    },

    async update(id, input) {
      const keyVersion = ports.pin.requireForWrite();
      const fields = writeFieldsFromInput(input);
      const body: KeyEntryUpdateRequest = {
        keyVersion,
        ...fields,
      };

      if (input.keyValue && input.keyValue.length > 0) {
        body.cipher = await ports.pin.encryptKeyValue(id, input.keyValue);
      }

      const response = await ports.pin.guardWrite(ports.patchKeyEntry(id, body));
      return response.entry;
    },

    async remove(id) {
      const keyVersion = ports.pin.requireForWrite();
      await ports.pin.guardWrite(ports.deleteKeyEntry(id, { keyVersion }));
    },

    markUsed,

    async revealSecret(entry) {
      let value: string;
      try {
        value = await ports.decryptKeyValue(entry);
      } catch {
        return { ok: false, reason: "decrypt" };
      }

      try {
        const updated = await markUsed(entry.id, "revealed");
        return { ok: true, value, lastUsedAt: updated.lastUsedAt };
      } catch {
        return { ok: true, value, activityFailed: true };
      }
    },

    async copySecret(entry, options) {
      let value: string;
      if (options.revealedValue != null && options.revealedValue.length > 0) {
        value = options.revealedValue;
      } else {
        try {
          value = await ports.decryptKeyValue(entry);
        } catch {
          return { ok: false, reason: "decrypt" };
        }
      }

      try {
        await ports.copyTextWithAutoClear(value, options.clipboardClearMs);
      } catch (err) {
        const clipboard: ClipboardWriteErrorReason =
          err instanceof ClipboardWriteError ? err.reason : "denied";
        return { ok: false, reason: "clipboard", clipboard };
      }

      const clearSeconds = Math.round(options.clipboardClearMs / 1000);

      try {
        const updated = await markUsed(entry.id, "copied");
        return { ok: true, clearSeconds, lastUsedAt: updated.lastUsedAt };
      } catch {
        return { ok: true, clearSeconds, activityFailed: true };
      }
    },

    async importEntries(entries, existingIds) {
      const candidates = entries.filter((entry) => !existingIds.has(entry.id));
      const clientSkipped = entries.length - candidates.length;

      if (candidates.length === 0) {
        return { imported: 0, skippedIds: [], clientSkipped };
      }

      const importItems: KeyEntryImportItem[] = [];
      for (const entry of candidates) {
        const resolved = resolveServiceForImport(
          entry.serviceId,
          entry.customServiceName,
        );
        const description =
          entry.description === null
            ? undefined
            : (normalizeDescription(entry.description) ?? undefined);
        const fields = writeFieldsFromInput({
          label: entry.label,
          serviceId: resolved.serviceId,
          customServiceName: resolved.customServiceName,
          description,
          tags: entry.tags,
        });
        const cipher = await ports.pin.encryptKeyValue(entry.id, entry.keyValue);
        importItems.push({
          id: entry.id,
          ...fields,
          cipher,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          lastUsedAt: entry.lastUsedAt,
        });
      }

      const response = await ports.pin.guardWrite(
        ports.postKeyEntryImport({ entries: importItems }),
      );

      return {
        imported: response.imported,
        skippedIds: response.skippedIds,
        clientSkipped,
      };
    },
  };
}
