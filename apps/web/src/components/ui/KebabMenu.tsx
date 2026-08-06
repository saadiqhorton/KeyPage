import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

export type KebabMenuItem = {
  id: string;
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect(): void;
};

type KebabMenuProps = {
  label: string;
  items: KebabMenuItem[];
  className?: string;
};

const triggerClass =
  "pressable rounded-sm p-1.5 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70 disabled:cursor-not-allowed disabled:opacity-50";

function DotsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

type MenuPosition = {
  top: number;
  left: number;
};

function computeMenuPosition(
  triggerRect: DOMRect,
  menuHeight: number,
): MenuPosition {
  const gap = 6;
  const viewportPadding = 8;
  const menuWidth = 144; // min-w-[9rem]

  let top = triggerRect.bottom + gap;
  const spaceBelow = window.innerHeight - triggerRect.bottom - gap;
  const spaceAbove = triggerRect.top - gap;

  if (menuHeight > spaceBelow && spaceAbove > spaceBelow) {
    top = triggerRect.top - gap - menuHeight;
  }

  top = Math.max(
    viewportPadding,
    Math.min(top, window.innerHeight - menuHeight - viewportPadding),
  );

  let left = triggerRect.right - menuWidth;
  left = Math.max(
    viewportPadding,
    Math.min(left, window.innerWidth - menuWidth - viewportPadding),
  );

  return { top, left };
}

export function KebabMenu({ label, items, className }: KebabMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const closeAndFocusTrigger = useCallback(() => {
    close();
    focusTrigger();
  }, [close, focusTrigger]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    setPosition(computeMenuPosition(triggerRect, menuHeight));
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      const firstEnabledIndex = items.findIndex((item) => !item.disabled);
      const target =
        firstEnabledIndex >= 0
          ? itemRefs.current[firstEnabledIndex]
          : itemRefs.current[0];
      target?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, items]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      close();
    }

    function handleScroll() {
      close();
    }

    function handleResize() {
      close();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [close, open]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabledIndices = items
      .map((item, index) => (item.disabled ? -1 : index))
      .filter((index) => index >= 0);

    if (enabledIndices.length === 0) return;

    const activeIndex = itemRefs.current.findIndex(
      (el) => el === document.activeElement,
    );

    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }

    if (event.key === "Tab") {
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const currentPos = enabledIndices.indexOf(activeIndex);
      const nextPos =
        currentPos < 0
          ? 0
          : (currentPos + 1) % enabledIndices.length;
      itemRefs.current[enabledIndices[nextPos]]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const currentPos = enabledIndices.indexOf(activeIndex);
      const nextPos =
        currentPos < 0
          ? enabledIndices.length - 1
          : (currentPos - 1 + enabledIndices.length) % enabledIndices.length;
      itemRefs.current[enabledIndices[nextPos]]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      itemRefs.current[enabledIndices[0]]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      itemRefs.current[enabledIndices[enabledIndices.length - 1]]?.focus();
    }
  }

  function handleItemSelect(item: KebabMenuItem) {
    if (item.disabled) return;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    item.onSelect();
  }

  itemRefs.current = items.map((_, index) => itemRefs.current[index] ?? null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(triggerClass, className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <DotsIcon className="h-4 w-4" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className={cn(
                "menu-pop-in fixed z-50 min-w-[9rem] rounded-sm border border-hairline bg-surface p-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]",
              )}
              style={
                position
                  ? { top: position.top, left: position.left }
                  : { top: 0, left: 0, visibility: "hidden" }
              }
              onKeyDown={handleMenuKeyDown}
            >
              {items.map((item, index) => {
                const isDanger = item.tone === "danger";

                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={cn(
                      "flex w-full items-center rounded-sm px-3 py-2 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      isDanger
                        ? "text-danger hover:bg-danger/15"
                        : "text-text hover:bg-brass/10",
                    )}
                    onClick={() => handleItemSelect(item)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
