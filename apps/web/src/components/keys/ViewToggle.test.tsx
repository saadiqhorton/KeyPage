import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewToggle } from "./ViewToggle.js";

describe("ViewToggle fieldset layout reset", () => {
  it("uses a fieldset with UA box model neutralized", () => {
    const html = renderToStaticMarkup(
      <ViewToggle value="grid" onChange={() => undefined} />,
    );

    const fieldsetClass = html.match(/<fieldset class="([^"]*)"/)?.[1] ?? "";
    for (const token of ["m-0", "min-w-0", "[min-inline-size:0]", "inline-flex"]) {
      assert.ok(fieldsetClass.includes(token), `fieldset missing ${token}`);
    }
    assert.match(
      html,
      /<legend class="sr-only float-none p-0 \[display:inherit\]">Key Entry view</,
    );
  });
});
