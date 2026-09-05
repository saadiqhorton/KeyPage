import {
  type AnimationEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const EXIT_ANIMATION_MS = 150;

type ModalProps = {
  open: boolean;
  onClose(): void;
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  labelledById?: string;
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.tabIndex !== -1 &&
      element.offsetParent !== null,
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  busy = false,
  labelledById,
}: ModalProps) {
  const generatedTitleId = useId();
  const titleId = labelledById ?? generatedTitleId;
  const descriptionId = useId();
  const panelRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const closeTimeoutRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(open);
  const [isClosing, setIsClosing] = useState(false);

  // Capture opener focus synchronously when `open` flips true (before effects
  // or portal autofocus can move document.activeElement).
  if (open && !wasOpenRef.current && !previousFocusRef.current) {
    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement ? active : null;
  }
  wasOpenRef.current = open;

  const restoreFocus = useCallback(() => {
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    if (!previous || !previous.isConnected) return;
    previous.focus({ preventScroll: true });
  }, []);

  const finishClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setMounted(false);
    setIsClosing(false);
    restoreFocus();
  }, [restoreFocus]);

  const beginClose = useCallback(() => {
    if (isClosing || !mounted) return;
    setIsClosing(true);

    closeTimeoutRef.current = window.setTimeout(
      finishClose,
      prefersReducedMotion() ? 0 : EXIT_ANIMATION_MS + 50,
    );
  }, [finishClose, isClosing, mounted]);

  useEffect(() => {
    if (open) {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setMounted(true);
      setIsClosing(false);
      return;
    }

    if (mounted) {
      beginClose();
    }
  }, [beginClose, mounted, open]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!mounted || isClosing) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = getFocusableElements(panel);
      if (focusable.length > 0) {
        focusable[0].focus({ preventScroll: true });
      } else {
        panel.focus({ preventScroll: true });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isClosing, mounted]);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || isClosing || busy) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, isClosing, mounted, onClose]);

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = getFocusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (!isClosing || event.target !== panelRef.current) return;
    finishClose();
  }

  if (!mounted) return null;

  const backdropClass = isClosing ? "modal-backdrop-out" : "modal-backdrop-in";
  const panelClass = isClosing ? "modal-panel-out" : "modal-panel-in";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        backdropClass,
        "bg-obsidian/80 backdrop-blur-sm",
      )}
      onAnimationEnd={handleAnimationEnd}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={busy}
        aria-label="Dismiss"
        className="absolute inset-0 cursor-default bg-transparent p-0"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <dialog
        ref={panelRef}
        open
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "bezel-shell relative z-10 m-0 flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col outline-none",
          "left-auto right-auto shadow-[0_24px_80px_rgba(0,0,0,0.55)]",
          panelClass,
        )}
        onCancel={(event) => {
          event.preventDefault();
        }}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="bezel-core flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-hairline px-5 py-4">
            {eyebrow ? (
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-brass/80">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id={titleId}
              className="font-display text-xl font-medium tracking-[-0.02em] text-text"
            >
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-muted">
                {description}
              </div>
            ) : null}
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? (
            <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-4">
              {footer}
            </footer>
          ) : null}
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
