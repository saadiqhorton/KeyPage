import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { downloadTextFile } from "./download.js";

describe("downloadTextFile", () => {
  const original = {
    document: globalThis.document,
    URL: globalThis.URL,
    Blob: globalThis.Blob,
    setTimeout: globalThis.setTimeout,
  };

  afterEach(() => {
    globalThis.document = original.document;
    globalThis.URL = original.URL;
    globalThis.Blob = original.Blob;
    globalThis.setTimeout = original.setTimeout;
  });

  it("creates a hidden download link and clicks it", () => {
    const clicks: Array<{ href: string; download: string }> = [];
    const blobs: Array<{ type: string; parts: unknown[] }> = [];
    let revoked = 0;

    class FakeBlob {
      parts: unknown[];
      type: string;
      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts;
        this.type = options?.type ?? "";
        blobs.push(this);
      }
    }

    globalThis.Blob = FakeBlob as unknown as typeof Blob;
    globalThis.URL = {
      createObjectURL: () => "blob:keypage-test",
      revokeObjectURL: () => {
        revoked += 1;
      },
    } as unknown as typeof URL;

    const removed: unknown[] = [];
    globalThis.document = {
      createElement: () => {
        const anchor = {
          href: "",
          download: "",
          style: { display: "" },
          click() {
            clicks.push({ href: this.href, download: this.download });
          },
          remove() {
            removed.push(this);
          },
        };
        return anchor;
      },
      body: {
        appendChild(node: unknown) {
          return node;
        },
      },
    } as unknown as Document;

    const timers: Array<() => void> = [];
    globalThis.setTimeout = ((handler: () => void) => {
      timers.push(handler);
      return 1;
    }) as typeof setTimeout;

    downloadTextFile("notes.txt", "hello vault", "text/plain");

    assert.equal(blobs[0]!.type, "text/plain");
    assert.deepEqual(clicks, [{ href: "blob:keypage-test", download: "notes.txt" }]);
    assert.equal(removed.length, 1);
    timers[0]!();
    assert.equal(revoked, 1);
  });
});
