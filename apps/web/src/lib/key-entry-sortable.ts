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

  let nearestId: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [index, id] of ids.entries()) {
    const rect = rects[index];
    if (!rect) {
      continue;
    }
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const distance = (x - cx) ** 2 + (y - cy) ** 2;
    if (distance < nearest) {
      nearest = distance;
      nearestId = id;
    }
  }
  return nearestId;
}
