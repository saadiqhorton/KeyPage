import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyEntry } from "@keypage/shared";

import { customBadge, ServiceIcon } from "@/components/ui/ServiceIcon.js";
import { KeyEntryCard } from "@/components/keys/KeyEntryCard.js";
import { KeyEntryList } from "@/components/keys/KeyEntryList.js";
import { KeyEntryTable } from "@/components/keys/KeyEntryTable.js";

function makeEntry(overrides: Partial<KeyEntry> = {}): KeyEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    label: "Production",
    serviceId: "custom",
    customServiceName: "LITELLM",
    description: null,
    tags: [],
    cipher: {
      algorithm: "aes-256-gcm",
      ivB64: "AAAAAAAAAAAAAAAA",
      ciphertextB64: "BBBBBBBBBBBBBBBBBBBBBBBB",
      keyVersion: 1,
    },
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

describe("customBadge", () => {
  it("uses the first alphanumeric character of the display name", () => {
    assert.equal(customBadge("LITELLM"), "L");
    assert.equal(customBadge("litellm"), "L");
    assert.equal(customBadge("LiteLLM"), "L");
    assert.equal(customBadge("1Password"), "1");
    assert.equal(customBadge("  MyService"), "M");
  });

  it("falls back safely for empty or unusual names", () => {
    assert.equal(customBadge(""), "?");
    assert.equal(customBadge("   "), "?");
    assert.equal(customBadge("🎉🚀"), "?");
    assert.equal(customBadge("---"), "?");
  });
});

describe("ServiceIcon custom services", () => {
  it("derives the badge from the custom service name", () => {
    const html = renderToStaticMarkup(
      <ServiceIcon serviceId="custom" displayName="LITELLM" />,
    );
    assert.match(html, />L</);
    assert.doesNotMatch(html, />C</);
  });

  it("falls back to ? when the custom name has no alphanumeric character", () => {
    const html = renderToStaticMarkup(
      <ServiceIcon serviceId="custom" displayName="🎉" />,
    );
    assert.match(html, />\?</);
  });

  it("keeps the branded monogram for built-in services even when a name is passed", () => {
    const html = renderToStaticMarkup(
      <ServiceIcon serviceId="github" displayName="GitHub" />,
    );
    assert.match(html, />G</);
  });

  it("keeps the built-in Custom monogram when no display name is given", () => {
    const html = renderToStaticMarkup(<ServiceIcon serviceId="custom" />);
    assert.match(html, />C</);
  });
});

describe("custom service badge in every view", () => {
  const entry = makeEntry();

  it("renders the custom initial in the card view", () => {
    const html = renderToStaticMarkup(<KeyEntryCard entry={entry} revealed={false} revealedValue={null} busy={false} reorderBusy={false} onDropEntry={() => undefined} onToggleReveal={() => undefined} onCopy={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />);
    assert.match(html, />L</);
    assert.doesNotMatch(html, />C</);
  });

  it("renders the custom initial in the list view", () => {
    const html = renderToStaticMarkup(<KeyEntryList entries={[entry]} revealedId={null} revealedValue={null} busyId={null} reorderBusy={false} onDropEntry={() => undefined} onToggleReveal={() => undefined} onCopy={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />);
    assert.match(html, />L</);
    assert.doesNotMatch(html, />C</);
  });

  it("renders the custom initial in the table view", () => {
    const html = renderToStaticMarkup(<KeyEntryTable entries={[entry]} revealedId={null} revealedValue={null} busyId={null} reorderBusy={false} onDropEntry={() => undefined} onToggleReveal={() => undefined} onCopy={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />);
    assert.match(html, />L</);
    assert.doesNotMatch(html, />C</);
  });

  // The delete modal view passes displayName through as well, but it renders
  // via createPortal, which the server renderer does not support; that call
  // site is covered by source review in the DEZ-37 verification instead.
});
