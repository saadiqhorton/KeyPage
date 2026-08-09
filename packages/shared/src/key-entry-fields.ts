import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "./key-entries.js";
import { SERVICE_CATALOG, type ServiceId } from "./service-catalog.js";

export type KeyEntryFieldCode =
  | "label.required"
  | "label.too_long"
  | "description.too_long"
  | "tag.too_long"
  | "tags.too_many"
  | "service.unknown"
  | "custom_service_name.required"
  | "custom_service_name.too_long"
  | "custom_service_name.not_allowed";

export type KeyEntryFieldField =
  | "label"
  | "description"
  | "tags"
  | "serviceId"
  | "customServiceName";

export type KeyEntryFieldIssue = {
  field: KeyEntryFieldField;
  code: KeyEntryFieldCode;
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

function collectLabelIssues(label: string): KeyEntryFieldIssue[] {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return [
      {
        field: "label",
        code: "label.required",
        message: `must be 1..${KEY_ENTRY_LABEL_MAX} characters after trim`,
      },
    ];
  }
  if (trimmed.length > KEY_ENTRY_LABEL_MAX) {
    return [
      {
        field: "label",
        code: "label.too_long",
        message: `must be 1..${KEY_ENTRY_LABEL_MAX} characters after trim`,
      },
    ];
  }
  return [];
}

function collectDescriptionIssues(
  description: string | undefined,
): KeyEntryFieldIssue[] {
  if (description === undefined) {
    return [];
  }

  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.length > KEY_ENTRY_DESCRIPTION_MAX) {
    return [
      {
        field: "description",
        code: "description.too_long",
        message: `must be at most ${KEY_ENTRY_DESCRIPTION_MAX} characters`,
      },
    ];
  }

  return [];
}

function collectTagIssues(tags: string[]): KeyEntryFieldIssue[] {
  const issues: KeyEntryFieldIssue[] = [];
  const seen = new Set<string>();
  let uniqueCount = 0;

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.length > KEY_ENTRY_TAG_MAX) {
      issues.push({
        field: "tags",
        code: "tag.too_long",
        message: `each tag must be 1..${KEY_ENTRY_TAG_MAX} characters`,
      });
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueCount += 1;
    if (uniqueCount > KEY_ENTRY_TAGS_MAX) {
      issues.push({
        field: "tags",
        code: "tags.too_many",
        message: `must contain at most ${KEY_ENTRY_TAGS_MAX} tags`,
      });
    }
  }

  return issues;
}

function collectServiceIssues(
  serviceId: string,
  customServiceName: string | undefined,
): KeyEntryFieldIssue[] {
  if (!isKnownServiceId(serviceId)) {
    return [
      {
        field: "serviceId",
        code: "service.unknown",
        message: "must be a known service id",
      },
    ];
  }

  if (serviceId === "custom") {
    const trimmed = customServiceName?.trim() ?? "";
    if (trimmed.length === 0) {
      return [
        {
          field: "customServiceName",
          code: "custom_service_name.required",
          message: "is required when serviceId is custom",
        },
      ];
    }

    if (trimmed.length > KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX) {
      return [
        {
          field: "customServiceName",
          code: "custom_service_name.too_long",
          message: `must be at most ${KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX} characters`,
        },
      ];
    }

    return [];
  }

  if (customServiceName !== undefined && customServiceName.trim().length > 0) {
    return [
      {
        field: "customServiceName",
        code: "custom_service_name.not_allowed",
        message: "must not be set unless serviceId is custom",
      },
    ];
  }

  return [];
}

/** Accumulates every field issue without throwing on the first failure. */
export function collectKeyEntryFieldIssues(
  input: KeyEntryWriteFieldsInput,
): KeyEntryFieldIssue[] {
  return [
    ...collectLabelIssues(input.label),
    ...collectDescriptionIssues(input.description),
    ...collectTagIssues(input.tags),
    ...collectServiceIssues(input.serviceId, input.customServiceName),
  ];
}

export function normalizeLabel(label: string): string {
  const issues = collectLabelIssues(label);
  if (issues.length > 0) {
    throw new KeyEntryFieldError("Invalid label", issues);
  }
  return label.trim();
}

export function normalizeDescription(
  description: string | undefined,
): string | null {
  const issues = collectDescriptionIssues(description);
  if (issues.length > 0) {
    throw new KeyEntryFieldError("Invalid description", issues);
  }

  if (description === undefined) {
    return null;
  }

  const trimmed = description.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Trim, drop empties, case-insensitive dedupe (first wins), enforce tag length
 * and count caps. Throws when a tag is too long or the unique count exceeds
 * {@link KEY_ENTRY_TAGS_MAX}.
 */
export function normalizeTags(tags: string[]): string[] {
  const issues = collectTagIssues(tags);
  if (issues.length > 0) {
    throw new KeyEntryFieldError("Invalid tags", issues);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

/**
 * Soft variant for interactive UI (TagInput): same trim/dedupe/length rules as
 * {@link normalizeTags}, but caps unique count at `max` instead of throwing when
 * the count would exceed it. Oversized tags still throw so callers cannot
 * silently discard user input.
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
      throw new KeyEntryFieldError("Invalid tags", [
        {
          field: "tags",
          code: "tag.too_long",
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
  const issues = collectServiceIssues(serviceId, customServiceName);
  if (issues.length > 0) {
    throw new KeyEntryFieldError(
      issues[0]!.field === "serviceId"
        ? "Invalid serviceId"
        : "Invalid customServiceName",
      issues,
    );
  }

  if (serviceId === "custom") {
    return { customServiceName: customServiceName!.trim() };
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
  const issues = collectKeyEntryFieldIssues(input);
  if (issues.length > 0) {
    throw new KeyEntryFieldError("Invalid key entry fields", issues);
  }

  const label = input.label.trim();
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
