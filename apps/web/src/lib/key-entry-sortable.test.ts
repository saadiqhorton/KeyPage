import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  flowDelta,
  hitTestRects,
  inferColumnCount,
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

describe("flowDelta", () => {
  it("converts a one-step flow shift into grid cell deltas", () => {
    assert.deepEqual(flowDelta(2, -1, 3), { col: -1, row: 0 });
    assert.deepEqual(flowDelta(0, 1, 3), { col: 1, row: 0 });
    assert.deepEqual(flowDelta(2, 1, 3), { col: -2, row: 1 });
  });
});

describe("inferColumnCount", () => {
  it("counts items that share the first row top", () => {
    assert.equal(
      inferColumnCount([
        { top: 10 },
        { top: 10 },
        { top: 10 },
        { top: 80 },
      ]),
      3,
    );
    assert.equal(inferColumnCount([{ top: 0 }]), 1);
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

  it("falls back to the nearest slot center", () => {
    assert.equal(hitTestRects(80, 10, ["a", "b", "c"], rects), "a");
  });
});
