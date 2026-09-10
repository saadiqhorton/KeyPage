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

export function flowDelta(
  index: number,
  steps: number,
  columns: number,
): { col: number; row: number } {
  const dest = index + steps;
  return {
    col: (dest % columns) - (index % columns),
    row: Math.floor(dest / columns) - Math.floor(index / columns),
  };
}

export function inferColumnCount(
  rects: ReadonlyArray<Pick<SortableRect, "top">>,
): number {
  if (rects.length < 2) {
    return 1;
  }
  const firstTop = rects[0]?.top ?? 0;
  let columns = 1;
  for (let index = 1; index < rects.length; index += 1) {
    const top = rects[index]?.top ?? firstTop;
    if (Math.abs(top - firstTop) < 8) {
      columns += 1;
    } else {
      break;
    }
  }
  return columns;
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

export function layoutStrides(
  rects: readonly SortableRect[],
  columns: number,
): { strideX: number; strideY: number } {
  const first = rects[0];
  const next = rects[1];
  const nextRow = rects[columns];
  const strideX =
    columns > 1 && next && first ? next.left - first.left : 0;
  const strideY = nextRow && first
    ? nextRow.top - first.top
    : next && first && columns === 1
      ? next.top - first.top
      : first
        ? first.bottom - first.top
        : 0;
  return { strideX, strideY };
}

export function itemTranslate(
  from: number,
  to: number,
  index: number,
  columns: number,
  strideX: number,
  strideY: number,
): string {
  const shift = sortableShift(from, to, index);
  const delta =
    columns > 1 ? flowDelta(index, shift, columns) : { col: 0, row: shift };
  return `translate3d(${delta.col * strideX}px, ${delta.row * strideY}px, 0)`;
}
