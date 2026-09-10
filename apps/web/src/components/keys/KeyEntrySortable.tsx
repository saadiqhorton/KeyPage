import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  flowDelta,
  hitTestRects,
  inferColumnCount,
  sortableShift,
  type SortableRect,
} from "@/lib/key-entry-sortable";

type SortableContextValue = {
  activeId: string | null;
  disabled: boolean;
  registerItem(id: string, node: HTMLElement | null): void;
  startDrag(id: string, event: ReactPointerEvent<HTMLElement>): void;
  itemStyle(id: string): CSSProperties | undefined;
};

const SortableContext = createContext<SortableContextValue>({
  activeId: null,
  disabled: false,
  registerItem() {},
  startDrag() {},
  itemStyle() {
    return undefined;
  },
});

type KeyEntrySortableProps = {
  ids: readonly string[];
  labels: Readonly<Record<string, string>>;
  layout: "vertical" | "grid";
  disabled: boolean;
  onDropEntry(draggedId: string, targetId: string): void;
  children: ReactNode;
};

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

function overlayTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(1.02)`;
}

function sortableLabels(entries: ReadonlyArray<{ id: string; label: string }>) {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry.label]));
}

export { sortableLabels };

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
  const overlayPosRef = useRef({ x: 0, y: 0 });
  const grabOffsetRef = useRef({ x: 0, y: 0 });
  const activeIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  const registerItem = useCallback((id: string, node: HTMLElement | null) => {
    if (node) {
      nodesRef.current.set(id, node);
    } else {
      nodesRef.current.delete(id);
    }
  }, []);

  const itemStyle = useCallback(
    (id: string): CSSProperties | undefined => {
      if (!activeId) {
        return undefined;
      }
      if (id === activeId) {
        return { opacity: 0 };
      }

      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId ?? activeId);
      const index = ids.indexOf(id);
      const shift = sortableShift(from, to, index);
      const rects = rectsRef.current;
      const columns = layout === "grid" ? inferColumnCount(rects) : 1;
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
      const delta =
        layout === "grid"
          ? flowDelta(index, shift, columns)
          : { col: 0, row: shift };

      return {
        transform: `translate3d(${delta.col * strideX}px, ${delta.row * strideY}px, 0)`,
        zIndex: 1,
        willChange: "transform",
      };
    },
    [activeId, ids, layout, overId],
  );

  const finishDrag = useCallback(
    (commit: boolean) => {
      detachRef.current?.();
      detachRef.current = null;
      const draggedId = activeIdRef.current;
      const targetId = overIdRef.current;
      activeIdRef.current = null;
      overIdRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setActiveId(null);
      setOverId(null);
      if (commit && draggedId && targetId) {
        onDropEntry(draggedId, targetId);
      }
    },
    [onDropEntry],
  );

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
      const origin = node.getBoundingClientRect();
      grabOffsetRef.current = {
        x: event.clientX - origin.left,
        y: event.clientY - origin.top,
      };
      overlayPosRef.current = { x: origin.left, y: origin.top };
      activeIdRef.current = id;
      overIdRef.current = id;
      setOverlaySize({ width: origin.width, height: origin.height });
      setActiveId(id);
      setOverId(id);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        const x = moveEvent.clientX - grabOffsetRef.current.x;
        const y = moveEvent.clientY - grabOffsetRef.current.y;
        overlayPosRef.current = { x, y };
        const liveOverlay = overlayRef.current;
        if (liveOverlay) {
          liveOverlay.style.transform = overlayTransform(x, y);
        }
        const nextOver = hitTestRects(
          moveEvent.clientX,
          moveEvent.clientY,
          ids,
          rectsRef.current,
        );
        if (nextOver && nextOver !== overIdRef.current) {
          overIdRef.current = nextOver;
          setOverId(nextOver);
        }
      };

      const onUp = () => {
        finishDrag(true);
      };

      const onCancel = () => {
        finishDrag(false);
      };

      detachRef.current?.();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("scroll", onCancel);
      detachRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("scroll", onCancel);
      };
    },
    [disabled, finishDrag, ids],
  );

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !activeId) {
      return;
    }
    const { x, y } = overlayPosRef.current;
    overlay.style.transform = overlayTransform(x, y);
  }, [activeId, overId]);

  useEffect(() => {
    return () => {
      detachRef.current?.();
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const value = useMemo<SortableContextValue>(
    () => ({
      activeId,
      disabled,
      registerItem,
      startDrag,
      itemStyle,
    }),
    [activeId, disabled, itemStyle, registerItem, startDrag],
  );

  const overIndex = overId ? ids.indexOf(overId) : -1;
  const placeholderRect = overIndex >= 0 ? rectsRef.current[overIndex] : null;
  const canPortal = typeof document !== "undefined";

  return (
    <SortableContext.Provider value={value}>
      {children}
      {canPortal && activeId && placeholderRect
        ? createPortal(
            <>
              <div
                className="key-entry-drop-placeholder"
                style={{
                  left: placeholderRect.left,
                  top: placeholderRect.top,
                  width: placeholderRect.right - placeholderRect.left,
                  height: placeholderRect.bottom - placeholderRect.top,
                }}
              />
              <div
                ref={overlayRef}
                className="key-entry-drag-overlay"
                style={{
                  width: overlaySize.width,
                  height: overlaySize.height,
                }}
              >
                <p className="truncate font-display text-sm font-medium text-text">
                  {labels[activeId] ?? "Key Entry"}
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
  const { registerItem, itemStyle, activeId } = useContext(SortableContext);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      registerItem(id, node);
    },
    [id, registerItem],
  );

  return {
    setRef,
    style: itemStyle(id),
    isActive: activeId === id,
  };
}

export function useKeyEntrySortableHandle() {
  const { startDrag, disabled } = useContext(SortableContext);
  return { startDrag, disabled };
}
