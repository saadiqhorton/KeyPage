export function applyVisibleReorder(
  allIds: readonly string[],
  visibleIds: readonly string[],
  nextVisibleIds: readonly string[],
): string[] {
  if (visibleIds.length !== nextVisibleIds.length) {
    return [...allIds];
  }

  const visibleSet = new Set(visibleIds);
  if (
    visibleIds.some((id) => !visibleSet.has(id)) ||
    nextVisibleIds.some((id) => !visibleSet.has(id))
  ) {
    return [...allIds];
  }

  const nextVisible = [...nextVisibleIds];
  let cursor = 0;

  return allIds.map((id) => {
    if (!visibleSet.has(id)) {
      return id;
    }
    const next = nextVisible[cursor];
    cursor += 1;
    return next ?? id;
  });
}

export function moveVisibleEntry(
  allIds: readonly string[],
  visibleIds: readonly string[],
  id: string,
  delta: number,
): string[] {
  const from = visibleIds.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= visibleIds.length) {
    return [...allIds];
  }

  const nextVisible = [...visibleIds];
  const [moved] = nextVisible.splice(from, 1);
  if (moved === undefined) {
    return [...allIds];
  }
  nextVisible.splice(to, 0, moved);
  return applyVisibleReorder(allIds, visibleIds, nextVisible);
}

export function dropVisibleEntry(
  allIds: readonly string[],
  visibleIds: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId) {
    return [...allIds];
  }

  const from = visibleIds.indexOf(draggedId);
  const to = visibleIds.indexOf(targetId);
  if (from < 0 || to < 0) {
    return [...allIds];
  }

  const nextVisible = [...visibleIds];
  const [moved] = nextVisible.splice(from, 1);
  if (moved === undefined) {
    return [...allIds];
  }
  nextVisible.splice(to, 0, moved);
  return applyVisibleReorder(allIds, visibleIds, nextVisible);
}
