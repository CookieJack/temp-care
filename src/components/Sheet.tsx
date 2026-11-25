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

  // 移动端键盘弹起时把弹层约束在可视视口内，避免输入框和底部按钮被键盘遮挡
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

  // 键盘动画结束后把聚焦的输入框滚入弹层可视区域
  const focusTimer = useRef<number | undefined>(undefined);
  const [keyboardCover, setKeyboardCover] = useState(false);
  useEffect(() => {
    return () => window.clearTimeout(focusTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setKeyboardCover(false);
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
      // 部分安卓 PWA 内核对键盘浮层不更新视口高度，此时把弹层移到上半屏避免被遮挡
      setKeyboardCover(touchDevice && heightBefore - heightAfter < 40);
      window.setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 60);
    }, 350);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className={`overlay overlay-sheet${keyboardCover ? ' is-keyboard-cover' : ''}`}
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
