"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Prevents closing with Escape/backdrop while an operation is running. */
  locked?: boolean;
  size?: "sm" | "lg";
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: labelled, focus moves in on open and is restored on close,
 * Tab is trapped inside, Escape closes (unless locked).
 */
export function Modal({ title, onClose, children, footer, locked = false, size }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, locked });
  useEffect(() => {
    latest.current = { onClose, locked };
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !latest.current.locked) {
        e.stopPropagation();
        latest.current.onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <>
      <div className="modal-backdrop-cx" onClick={locked ? undefined : onClose} aria-hidden="true" />
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable${size ? ` modal-${size}` : ""}`}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title fs-6" id={titleId}>
                {title}
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={locked} />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
