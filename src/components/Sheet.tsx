import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';

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

  // 键盘会收缩视口的内核（iOS / 普通 Chrome）：让遮罩始终贴合可视视口
  useEffect(() => {
    if (!open) {
      return;
    }
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const syncViewport = () => {
      const height = viewport ? viewport.height : window.innerHeight;
      const top = viewport ? viewport.offsetTop : 0;
      root.style.setProperty('--vv-height', `${height}px`);
      root.style.setProperty('--vv-top', `${top}px`);
    };
    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    return () => {
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-top');
    };
  }, [open]);

  // 键盘浮层不改变视口时（HyperOS PWA），无法读取键盘高度，按常见中文输入法高度估算抬升量
  const [keyboardLift, setKeyboardLift] = useState(0);
  const focusTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(focusTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setKeyboardLift(0);
    }
  }, [open]);

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }
    const visibleHeight = () =>
      Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
    const heightBefore = visibleHeight();
    window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      const heightAfter = visibleHeight();
      const touchDevice = window.matchMedia('(pointer: coarse)').matches;
      const viewportShrunk = heightBefore - heightAfter > 40;
      if (touchDevice && !viewportShrunk) {
        // 键盘约占半屏，把弹层整体抬到键盘上方
        setKeyboardLift(Math.round(window.innerHeight * 0.5));
      }
      window.setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 80);
    }, 250);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="overlay overlay-sheet"
      style={keyboardLift > 0 ? { paddingBottom: keyboardLift } : undefined}
      role="presentation"
      onClick={onClose}
    >
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
