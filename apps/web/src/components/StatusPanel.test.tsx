import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusPanel } from "./StatusPanel.js";

const okHealth = {
  status: "ok" as const,
  data: {
    status: "ok" as const,
    app: "KeyPage",
    version: "0.1.0",
    dataDir: "/tmp/keypage",
    firstBootAt: "2026-01-01T00:00:00.000Z",
  },
};

describe("StatusPanel footer copy", () => {
  it("shows key count when entryCount is provided", () => {
    const html = renderToStaticMarkup(
      <StatusPanel health={okHealth} entryCount={4} />,
    );

    assert.match(html, />4 keys</);
    assert.doesNotMatch(html, /services/);
  });

  it("uses singular copy for one key", () => {
    const html = renderToStaticMarkup(
      <StatusPanel health={okHealth} entryCount={1} />,
    );

    assert.match(html, />1 key</);
    assert.doesNotMatch(html, />1 keys</);
  });

  it("omits key count when entryCount is null", () => {
    const html = renderToStaticMarkup(
      <StatusPanel health={okHealth} entryCount={null} />,
    );

    assert.doesNotMatch(html, /\bkeys?\b/);
    assert.doesNotMatch(html, /services/);
  });
});
