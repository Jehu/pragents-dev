import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal wrapper used by the config-ui Slice-1+ surfaces.
 *
 * Behavior:
 * - Backdrop click dismisses unless `mustConfirm` is true
 * - Esc dismisses unless `mustConfirm` is true
 * - Initial focus lands on the first focusable element inside the dialog
 * - Tab / Shift+Tab cycle through focusable elements (focus trap)
 * - On close, focus is returned to the element that was focused at open
 *
 * Not a replacement for the existing CommandPalette's bespoke chrome — that
 * migration is tracked as deferred follow-up work (see config-ui plan
 * "Deferred to Follow-Up Work" once landed). This Modal becomes the standard
 * for new modal surfaces from Slice 1 onward.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** ARIA label for screen readers. Provide one of `ariaLabel` or `ariaLabelledBy`. */
  ariaLabel?: string;
  /** ID of the element labelling the modal (typically the modal's heading). */
  ariaLabelledBy?: string;
  /** When true, Esc and backdrop click do not close the modal — useful for destructive confirms. */
  mustConfirm?: boolean;
  /** Optional className for the inner container; defaults to a neutral dark card. */
  containerClassName?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  mustConfirm = false,
  containerClassName,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fallbackId = useId();
  const labelledBy = ariaLabelledBy;
  const label = ariaLabelledBy ? undefined : ariaLabel ?? `Modal ${fallbackId}`;

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const focusFirst = () => {
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      const first = focusables[0] ?? root;
      first.focus();
    };
    const timer = window.setTimeout(focusFirst, 0);

    return () => {
      window.clearTimeout(timer);
      const node = returnFocusRef.current;
      if (node && typeof node.focus === 'function') {
        try {
          node.focus();
        } catch {
          // Ignore focus errors on detached/hidden elements
        }
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mustConfirm) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, mustConfirm, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => {
        if (!mustConfirm) onClose();
      }}
      data-testid="modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={
          containerClassName ??
          'w-[600px] max-w-[90vw] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden'
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
