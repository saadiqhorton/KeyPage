import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TagFilterChips } from "./TagFilterChips.js";

describe("TagFilterChips fieldset layout reset", () => {
  it("uses a fieldset with UA box model neutralized", () => {
    const html = renderToStaticMarkup(
      <TagFilterChips
        facets={[{ key: "work", label: "work", count: 1 }]}
        counts={new Map([["work", 1]])}
        selected={[]}
        onToggle={() => undefined}
      />,
    );

    const fieldsetClass = html.match(/<fieldset class="([^"]*)"/)?.[1] ?? "";
    for (const token of ["m-0", "border-0", "p-0", "min-w-0", "[min-inline-size:0]"]) {
      assert.ok(fieldsetClass.includes(token), `fieldset missing ${token}`);
    }
    assert.match(
      html,
      /<legend class="sr-only float-none p-0 \[display:inherit\]">Filter by tag</,
    );
  });
});
