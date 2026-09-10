import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  inferColumnCount,
  itemTranslate,
  layoutStrides,
  resolveOverId,
  type SortableRect,
} from "@/lib/key-entry-sortable";

function measureRects(
  ids: readonly string[],
  nodes: Map<string, HTMLElement>,
): SortableRect[] {
  return ids.map((id) => {
    const rect = nodes.get(id)?.getBoundingClientRect();
    return {
      left: rect?.left ?? 0,
      right: rect?.right ?? 0,
      top: rect?.top ?? 0,
      bottom: rect?.bottom ?? 0,
    };
  });
}

type SortableContextValue = {
  disabled: boolean;
  registerItem(id: string, node: HTMLElement | null): void;
  startDrag(id: string, event: ReactPointerEvent<HTMLElement>): void;
};

const SortableContext = createContext<SortableContextValue>({
  disabled: false,
  registerItem() {},
  startDrag() {},
});

type KeyEntrySortableProps = {
  ids: readonly string[];
  labels: Readonly<Record<string, string>>;
  layout: "vertical" | "grid";
  disabled: boolean;
  onDropEntry(draggedId: string, targetId: string): void;
  children: ReactNode;
};

function overlayTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(1.02)`;
}

function sortableLabels(entries: ReadonlyArray<{ id: string; label: string }>) {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry.label]));
}

export { sortableLabels };

const SORTING_CLASS = "is-key-entry-sorting";

function placePlaceholder(
  node: HTMLElement | null,
  rect: SortableRect | undefined,
): void {
  if (!node || !rect) {
    return;
  }
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.right - rect.left}px`;
  node.style.height = `${rect.bottom - rect.top}px`;
}

export function KeyEntrySortable({
  ids,
  labels,
  layout,
  disabled,
  onDropEntry,
  children,
}: Readonly<KeyEntrySortableProps>) {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const rectsRef = useRef<SortableRect[]>([]);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const overlayPosRef = useRef({ x: 0, y: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const grabOffsetRef = useRef({ x: 0, y: 0 });
  const activeIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const stridesRef = useRef({ strideX: 0, strideY: 0, columns: 1 });

  const [session, setSession] = useState<{
    id: string;
    label: string;
    width: number;
    height: number;
  } | null>(null);

  const registerItem = useCallback((id: string, node: HTMLElement | null) => {
    if (node) {
      nodesRef.current.set(id, node);
    } else {
      nodesRef.current.delete(id);
    }
  }, []);

  const applyShifts = useCallback(
    (activeId: string, overId: string) => {
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      const { columns, strideX, strideY } = stridesRef.current;
      for (const [index, id] of ids.entries()) {
        const node = nodesRef.current.get(id);
        if (!node) {
          continue;
        }
        node.style.animation = "none";
        if (id === activeId) {
          node.classList.add("is-sortable-active");
          node.style.opacity = "0";
          node.style.visibility = "hidden";
          node.style.pointerEvents = "none";
          node.style.transform = "none";
          continue;
        }
        node.style.transform = itemTranslate(
          from,
          to,
          index,
          columns,
          strideX,
          strideY,
        );
      }
      placePlaceholder(placeholderRef.current, rectsRef.current[to]);
    },
    [ids],
  );

  const clearShifts = useCallback(() => {
    for (const node of nodesRef.current.values()) {
      node.style.transition = "none";
      node.style.removeProperty("transform");
      node.style.removeProperty("opacity");
      node.style.removeProperty("visibility");
      node.style.removeProperty("pointer-events");
      node.style.removeProperty("animation");
      node.classList.remove("is-sortable-active");
    }
    document.documentElement.classList.remove(SORTING_CLASS);
  }, []);

  const finishDrag = useCallback(
    (commit: boolean) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      detachRef.current?.();
      detachRef.current = null;
      const draggedId = activeIdRef.current;
      const targetId = overIdRef.current;
      activeIdRef.current = null;
      overIdRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      clearShifts();
      setSession(null);
      if (commit && draggedId && targetId) {
        onDropEntry(draggedId, targetId);
      }
    },
    [clearShifts, onDropEntry],
  );

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transform = overlayTransform(
        overlayPosRef.current.x,
        overlayPosRef.current.y,
      );
    }
    const activeId = activeIdRef.current;
    if (!activeId) {
      return;
    }
    const nextOver = resolveOverId(
      pointerRef.current.x,
      pointerRef.current.y,
      ids,
      rectsRef.current,
      overIdRef.current,
    );
    if (nextOver && nextOver !== overIdRef.current) {
      overIdRef.current = nextOver;
      applyShifts(activeId, nextOver);
    }
  }, [applyShifts, ids]);

  const startDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) {
        return;
      }
      const node = nodesRef.current.get(id);
      if (!node) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const rects = measureRects(ids, nodesRef.current);
      rectsRef.current = rects;
      const columns = layout === "grid" ? inferColumnCount(rects) : 1;
      const { strideX, strideY } = layoutStrides(rects, columns);
      stridesRef.current = { columns, strideX, strideY };

      const origin = node.getBoundingClientRect();
      grabOffsetRef.current = {
        x: event.clientX - origin.left,
        y: event.clientY - origin.top,
      };
      overlayPosRef.current = { x: origin.left, y: origin.top };
      pointerRef.current = { x: event.clientX, y: event.clientY };
      activeIdRef.current = id;
      overIdRef.current = id;
      document.documentElement.classList.add(SORTING_CLASS);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      setSession({
        id,
        label: labels[id] ?? "Key Entry",
        width: origin.width,
        height: origin.height,
      });

      const onMove = (moveEvent: PointerEvent) => {
        overlayPosRef.current = {
          x: moveEvent.clientX - grabOffsetRef.current.x,
          y: moveEvent.clientY - grabOffsetRef.current.y,
        };
        pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flushMove);
        }
      };

      detachRef.current?.();
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("scroll", onCancel);
      detachRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("scroll", onCancel);
      };

      function onUp() {
        finishDrag(true);
      }

      function onCancel() {
        finishDrag(false);
      }
    },
    [disabled, finishDrag, flushMove, ids, labels, layout],
  );

  useEffect(() => {
    if (!session) {
      return;
    }
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transform = overlayTransform(
        overlayPosRef.current.x,
        overlayPosRef.current.y,
      );
    }
    const activeId = activeIdRef.current;
    const overId = overIdRef.current;
    if (activeId && overId) {
      applyShifts(activeId, overId);
    }
  }, [applyShifts, session]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      detachRef.current?.();
      document.documentElement.classList.remove(SORTING_CLASS);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const value = useMemo<SortableContextValue>(
    () => ({
      disabled,
      registerItem,
      startDrag,
    }),
    [disabled, registerItem, startDrag],
  );

  const canPortal = typeof document !== "undefined";

  return (
    <SortableContext.Provider value={value}>
      {children}
      {canPortal && session
        ? createPortal(
            <>
              <div ref={placeholderRef} className="key-entry-drop-placeholder" />
              <div
                ref={overlayRef}
                className="key-entry-drag-overlay"
                style={{
                  width: session.width,
                  height: session.height,
                  transform: overlayTransform(
                    overlayPosRef.current.x,
                    overlayPosRef.current.y,
                  ),
                }}
              >
                <p className="truncate font-display text-sm font-medium text-text">
                  {session.label}
                </p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  Drop to reorder
                </p>
              </div>
            </>,
            document.body,
          )
        : null}
    </SortableContext.Provider>
  );
}

export function useKeyEntrySortableItem(id: string) {
  const { registerItem } = useContext(SortableContext);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      registerItem(id, node);
    },
    [id, registerItem],
  );

  return {
    setRef,
    style: undefined,
    isActive: false,
    className: undefined,
  };
}

export function useKeyEntrySortableHandle() {
  const { startDrag, disabled } = useContext(SortableContext);
  return { startDrag, disabled };
}
