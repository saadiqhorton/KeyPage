import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hitTestRects,
  itemTranslate,
  resolveOverId,
  sortableShift,
} from "./key-entry-sortable.ts";

describe("sortableShift", () => {
  it("shifts items between the origin and the drop index toward the gap", () => {
    assert.equal(sortableShift(1, 3, 0), 0);
    assert.equal(sortableShift(1, 3, 1), 0);
    assert.equal(sortableShift(1, 3, 2), -1);
    assert.equal(sortableShift(1, 3, 3), -1);
    assert.equal(sortableShift(3, 1, 0), 0);
    assert.equal(sortableShift(3, 1, 1), 1);
    assert.equal(sortableShift(3, 1, 2), 1);
    assert.equal(sortableShift(3, 1, 3), 0);
  });

  it("does not shift when the drop target is the origin", () => {
    assert.equal(sortableShift(2, 2, 0), 0);
    assert.equal(sortableShift(2, 2, 2), 0);
  });
});

describe("hitTestRects", () => {
  const rects = [
    { left: 0, right: 40, top: 0, bottom: 20 },
    { left: 0, right: 40, top: 20, bottom: 40 },
    { left: 0, right: 40, top: 40, bottom: 60 },
  ];

  it("returns the id whose original slot contains the pointer", () => {
    assert.equal(hitTestRects(10, 25, ["a", "b", "c"], rects), "b");
  });

  it("returns null outside every slot so the current over can stay", () => {
    assert.equal(hitTestRects(80, 10, ["a", "b", "c"], rects), null);
  });
});

describe("resolveOverId", () => {
  const rects = [
    { left: 0, right: 40, top: 0, bottom: 20 },
    { left: 0, right: 40, top: 20, bottom: 40 },
  ];

  it("keeps the current over while the pointer is in a gap", () => {
    assert.equal(resolveOverId(80, 10, ["a", "b"], rects, "b"), "b");
  });

  it("switches when the pointer enters another original slot", () => {
    assert.equal(resolveOverId(10, 10, ["a", "b"], rects, "b"), "a");
  });
});

describe("itemTranslate", () => {
  const rows = [
    { left: 0, right: 40, top: 0, bottom: 20 },
    { left: 0, right: 40, top: 20, bottom: 50 },
    { left: 0, right: 40, top: 50, bottom: 90 },
  ];

  it("returns zero for the dragged item and untouched items", () => {
    assert.equal(itemTranslate(0, 2, 0, rows), "translate3d(0px, 0px, 0)");
  });

  it("slides a later item up by its own measured slot distance", () => {
    assert.equal(itemTranslate(0, 2, 1, rows), "translate3d(0px, -20px, 0)");
  });

  it("uses each row's measured height instead of one fixed stride", () => {
    assert.equal(itemTranslate(0, 2, 2, rows), "translate3d(0px, -30px, 0)");
  });

  it("wraps across grid columns using measured rects", () => {
    const grid = [
      { left: 0, right: 40, top: 0, bottom: 20 },
      { left: 40, right: 80, top: 0, bottom: 20 },
      { left: 0, right: 40, top: 30, bottom: 50 },
    ];
    assert.equal(itemTranslate(0, 2, 1, grid), "translate3d(-40px, 0px, 0)");
    assert.equal(itemTranslate(0, 2, 2, grid), "translate3d(40px, -30px, 0)");
  });
});
