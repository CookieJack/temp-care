import { useEffect, useRef } from 'react';
import type { FocusEvent, ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** 编辑弹层：触屏设备停在屏幕上部的安全区，桌面端保持底部弹出 */
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

  // 聚焦后把输入框滚入弹层可视区域
  const focusTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(focusTimer.current);
  }, []);

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }
    window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      target.scrollIntoView({ block: 'nearest' });
    }, 250);
  };

  if (!open) {
    return null;
  }

  return (
    <div className="overlay overlay-sheet overlay-editor" role="presentation" onClick={onClose}>
      <div
        className="sheet sheet-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
        onFocus={handleFocus}
      >
        <h2 className="sheet-heading">{title}</h2>
        <div className="sheet-content">{children}</div>
        {footer ? <div className="sheet-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
