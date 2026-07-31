import { getService, type KeyEntry } from "@keypage/shared";

export type TagFacet = { key: string; label: string; count: number };

export function serviceDisplayName(
  entry: Pick<KeyEntry, "serviceId" | "customServiceName">,
): string {
  if (entry.serviceId === "custom" && entry.customServiceName) {
    return entry.customServiceName;
  }

  return getService(entry.serviceId).displayName;
}

export function toTagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

export function queryTokens(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed.split(/\s+/);
}

function entryHaystack(entry: KeyEntry): string {
  const serviceLabel = serviceDisplayName(entry);
  return [entry.label, serviceLabel, entry.serviceId, entry.description ?? ""]
    .join("\n")
    .toLowerCase();
}

export function filterByQuery(entries: KeyEntry[], query: string): KeyEntry[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = entryHaystack(entry);
    return tokens.every((token) => haystack.includes(token.toLowerCase()));
  });
}

export function filterByTags(
  entries: KeyEntry[],
  selectedTagKeys: readonly string[],
): KeyEntry[] {
  if (selectedTagKeys.length === 0) {
    return entries;
  }

  const required = new Set(selectedTagKeys);

  return entries.filter((entry) => {
    const entryKeys = new Set(entry.tags.map(toTagKey));
    for (const key of required) {
      if (!entryKeys.has(key)) {
        return false;
      }
    }
    return true;
  });
}

export function collectTagFacets(entries: KeyEntry[]): TagFacet[] {
  const facets = new Map<string, TagFacet>();

  for (const entry of entries) {
    const seenInEntry = new Set<string>();

    for (const tag of entry.tags) {
      const key = toTagKey(tag);
      if (!key || seenInEntry.has(key)) {
        continue;
      }

      seenInEntry.add(key);
      const existing = facets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        facets.set(key, { key, label: tag.trim(), count: 1 });
      }
    }
  }

  return [...facets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function toggleTagKey(selected: readonly string[], key: string): string[] {
  if (selected.includes(key)) {
    return selected.filter((item) => item !== key);
  }

  return [...selected, key];
}
