export const KEY_ENTRY_AAD_PREFIX = "keypage:v1:key-entry:";

export const KEY_ENTRY_LABEL_MAX = 120;
export const KEY_ENTRY_DESCRIPTION_MAX = 500;
export const KEY_ENTRY_TAG_MAX = 32;
export const KEY_ENTRY_TAGS_MAX = 10;
export const KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX = 60;
export const KEY_ENTRY_CIPHERTEXT_B64_MAX = 8192;
export const KEY_ENTRY_MASK = "••••••••••••";

export const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 30;
export const CLIPBOARD_CLEAR_SECONDS_MIN = 5;
export const CLIPBOARD_CLEAR_SECONDS_MAX = 300;

export type KeyEntryCipherInput = {
  algorithm: "aes-256-gcm";
  ivB64: string;
  ciphertextB64: string;
};

export type KeyEntryCipher = KeyEntryCipherInput & {
  keyVersion: number;
};

export type KeyEntry = {
  id: string;
  label: string;
  serviceId: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
  cipher: KeyEntryCipher;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export const KEY_ENTRY_IMPORT_MAX = 500;

export type KeyEntryImportItem = KeyEntryCreateRequest & {
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
};
export type KeyEntryImportRequest = { entries: KeyEntryImportItem[] };
export type KeyEntryImportResponse = { imported: number; skippedIds: string[] };

export type KeyEntryCreateRequest = {
  id: string;
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  cipher: KeyEntryCipherInput;
};

export type KeyEntryCreateResponse = {
  entry: KeyEntry;
};

export type ActivityEventAction =
  | "created"
  | "edited"
  | "deleted"
  | "revealed"
  | "copied";

export type KeyEntryListResponse = {
  entries: KeyEntry[];
  clipboardClearSeconds: number;
};

export type KeyEntryUseAction = Extract<
  ActivityEventAction,
  "revealed" | "copied"
>;

export type KeyEntryUseRequest = {
  action: KeyEntryUseAction;
};

export type KeyEntryUseResponse = {
  entry: KeyEntry;
};
