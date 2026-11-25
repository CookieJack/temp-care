import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** 底部编辑弹层：对应小程序 editor-mask + editor-sheet */
export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  // 桌面端可用 Esc 关闭弹层（与 confirm / actionSheet 行为一致）
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay overlay-sheet" role="presentation" onClick={onClose}>
      <div
        className="sheet sheet-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
      >
        <h2 className="sheet-heading">{title}</h2>
        <div className="sheet-content">{children}</div>
        {footer ? <div className="sheet-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
