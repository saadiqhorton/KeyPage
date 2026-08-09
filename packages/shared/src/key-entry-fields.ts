import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "./key-entries.js";
import { SERVICE_CATALOG, type ServiceId } from "./service-catalog.js";

export type KeyEntryFieldIssue = {
  field: string;
  message: string;
};

export class KeyEntryFieldError extends Error {
  readonly details: KeyEntryFieldIssue[];

  constructor(message: string, details: KeyEntryFieldIssue[]) {
    super(message);
    this.name = "KeyEntryFieldError";
    this.details = details;
  }
}

const SERVICE_IDS = new Set<string>(SERVICE_CATALOG.map((service) => service.id));

export function isKnownServiceId(serviceId: string): serviceId is ServiceId {
  return SERVICE_IDS.has(serviceId);
}

export function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > KEY_ENTRY_LABEL_MAX) {
    throw new KeyEntryFieldError("Invalid label", [
      {
        field: "label",
        message: `must be 1..${KEY_ENTRY_LABEL_MAX} characters after trim`,
      },
    ]);
  }
  return trimmed;
}

export function normalizeDescription(
  description: string | undefined,
): string | null {
  if (description === undefined) {
    return null;
  }

  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > KEY_ENTRY_DESCRIPTION_MAX) {
    throw new KeyEntryFieldError("Invalid description", [
      {
        field: "description",
        message: `must be at most ${KEY_ENTRY_DESCRIPTION_MAX} characters`,
      },
    ]);
  }

  return trimmed;
}

/**
 * Trim, drop empties, case-insensitive dedupe (first wins), enforce tag length
 * and count caps. Throws when a tag is too long or the unique count exceeds
 * {@link KEY_ENTRY_TAGS_MAX}.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.length > KEY_ENTRY_TAG_MAX) {
      throw new KeyEntryFieldError("Invalid tags", [
        {
          field: "tags",
          message: `each tag must be 1..${KEY_ENTRY_TAG_MAX} characters`,
        },
      ]);
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);

    if (normalized.length > KEY_ENTRY_TAGS_MAX) {
      throw new KeyEntryFieldError("Invalid tags", [
        {
          field: "tags",
          message: `must contain at most ${KEY_ENTRY_TAGS_MAX} tags`,
        },
      ]);
    }
  }

  return normalized;
}

/**
 * Soft variant for interactive UI (TagInput): same trim/dedupe rules, but caps
 * at `max` instead of throwing when the unique count would exceed it.
 */
export function normalizeTagsCapped(
  tags: string[],
  max: number = KEY_ENTRY_TAGS_MAX,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > KEY_ENTRY_TAG_MAX) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
    if (normalized.length >= max) {
      break;
    }
  }

  return normalized;
}

export function validateService(
  serviceId: string,
  customServiceName: string | undefined,
): { customServiceName: string | null } {
  if (!isKnownServiceId(serviceId)) {
    throw new KeyEntryFieldError("Invalid serviceId", [
      { field: "serviceId", message: "must be a known service id" },
    ]);
  }

  if (serviceId === "custom") {
    const trimmed = customServiceName?.trim() ?? "";
    if (trimmed.length === 0) {
      throw new KeyEntryFieldError("Invalid customServiceName", [
        {
          field: "customServiceName",
          message: "is required when serviceId is custom",
        },
      ]);
    }

    if (trimmed.length > KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX) {
      throw new KeyEntryFieldError("Invalid customServiceName", [
        {
          field: "customServiceName",
          message: `must be at most ${KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX} characters`,
        },
      ]);
    }

    return { customServiceName: trimmed };
  }

  if (customServiceName !== undefined && customServiceName.trim().length > 0) {
    throw new KeyEntryFieldError("Invalid customServiceName", [
      {
        field: "customServiceName",
        message: "must not be set unless serviceId is custom",
      },
    ]);
  }

  return { customServiceName: null };
}

/**
 * Backup / legacy payloads may carry unknown catalog ids. Remap those to
 * `custom` so the subsequent {@link validateService} acceptance check agrees
 * with the server write path.
 */
export function resolveServiceForImport(
  serviceId: string,
  customServiceName: string | null | undefined,
): { serviceId: string; customServiceName?: string } {
  if (isKnownServiceId(serviceId)) {
    return {
      serviceId,
      ...(customServiceName
        ? { customServiceName }
        : {}),
    };
  }

  return {
    serviceId: "custom",
    customServiceName: customServiceName?.trim() || serviceId,
  };
}

export type KeyEntryWriteFieldsInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
};

export type KeyEntryWriteFields = {
  label: string;
  serviceId: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
};

/** Single normalize/validate block for create, update, and import writes. */
export function normalizeKeyEntryWriteFields(
  input: KeyEntryWriteFieldsInput,
): KeyEntryWriteFields {
  const label = normalizeLabel(input.label);
  const description = normalizeDescription(input.description);
  const tags = normalizeTags(input.tags);
  const { customServiceName } = validateService(
    input.serviceId,
    input.customServiceName,
  );

  return {
    label,
    serviceId: input.serviceId,
    customServiceName,
    description,
    tags,
  };
}
