import { useEffect, useRef, type JSX, type ReactNode } from 'react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Bottom sheet (DESIGN.md section 8).
 *
 * Slides on transform only — animating height would thrash layout on
 * mid-range Android (GUARDRAILS.md section 8).
 */
export function Sheet({ open, onClose, title, children }: SheetProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the sheet so keyboard and screen-reader users land here.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet__scrim" onClick={onClose} aria-label="Close" type="button" />
      <div className="sheet__panel" ref={panelRef} tabIndex={-1}>
        <div className="sheet__grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
