import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE, DEFAULT_LISTEN_PORT } from "@keypage/shared";

describe("vite config", () => {
  it("proxies /api to the KeyPage listen port", async () => {
    const { default: config } = await import("../vite.config.ts");
    const apiProxy = config.server?.proxy?.[API_BASE];
    assert.ok(apiProxy && typeof apiProxy === "object");
    assert.equal(
      "target" in apiProxy && apiProxy.target,
      `http://127.0.0.1:${DEFAULT_LISTEN_PORT}`,
    );
    assert.equal("changeOrigin" in apiProxy && apiProxy.changeOrigin, false);
    assert.equal(config.server?.host, true);
    assert.ok(Array.isArray(config.plugins) && config.plugins.length >= 2);
  });
});
