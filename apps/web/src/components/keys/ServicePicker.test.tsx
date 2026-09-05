import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ServicePicker } from "./ServicePicker.js";

describe("ServicePicker radiogroup tab stops", () => {
  it("keeps the radiogroup programmatically focusable without an extra tab stop", () => {
    const html = renderToStaticMarkup(
      <ServicePicker
        value="custom"
        onChange={() => undefined}
        customName=""
        onCustomNameChange={() => undefined}
      />,
    );

    assert.match(html, /role="radiogroup"[^>]*tabindex="-1"/);
    assert.doesNotMatch(html, /role="radiogroup"[^>]*tabindex="0"/);
  });

  it("leaves the selected radio in the tab order", () => {
    const html = renderToStaticMarkup(
      <ServicePicker
        value="custom"
        onChange={() => undefined}
        customName=""
        onCustomNameChange={() => undefined}
      />,
    );

    assert.match(html, /role="radio"[^>]*aria-checked="true"/);
    assert.match(html, /aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/);
  });
});
