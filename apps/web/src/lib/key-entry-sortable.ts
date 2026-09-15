export type SortableRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function sortableShift(
  from: number,
  to: number,
  index: number,
): number {
  if (from === to || index === from) {
    return 0;
  }
  if (from < to && index > from && index <= to) {
    return -1;
  }
  if (from > to && index >= to && index < from) {
    return 1;
  }
  return 0;
}

export function hitTestRects(
  x: number,
  y: number,
  ids: readonly string[],
  rects: readonly SortableRect[],
): string | null {
  for (const [index, id] of ids.entries()) {
    const rect = rects[index];
    if (!rect) {
      continue;
    }
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return id;
    }
  }
  return null;
}

export function resolveOverId(
  x: number,
  y: number,
  ids: readonly string[],
  rects: readonly SortableRect[],
  current: string | null,
): string | null {
  return hitTestRects(x, y, ids, rects) ?? current;
}

export function itemTranslate(
  from: number,
  to: number,
  index: number,
  rects: readonly SortableRect[],
): string {
  const shift = sortableShift(from, to, index);
  if (shift === 0) {
    return "translate3d(0px, 0px, 0)";
  }
  const self = rects[index];
  const target = rects[index + shift];
  if (!self || !target) {
    return "translate3d(0px, 0px, 0)";
  }
  return `translate3d(${target.left - self.left}px, ${
    target.top - self.top
  }px, 0)`;
}
