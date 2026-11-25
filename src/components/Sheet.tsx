import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
}

function getVirtualKeyboard(): VirtualKeyboardLike | undefined {
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardInsetRef = useRef(0);
  useEffect(() => {
    return () => window.clearTimeout(focusTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setKeyboardCover(false);
    }
  }, [open]);

  // 支持 VirtualKeyboard API 的内核：接管键盘布局，读取高度后把弹层顶到键盘上沿
  useEffect(() => {
    if (!open) {
      return;
    }
    const keyboard = getVirtualKeyboard();
    if (!keyboard) {
      return;
    }
    const previousOverlay = keyboard.overlaysContent;
    const handleGeometry = () => {
      const height = keyboard.boundingRect?.height ?? 0;
      keyboardInsetRef.current = height;
      setKeyboardInset(height);
      if (height > 0) {
        setKeyboardCover(false);
      }
    };
    try {
      keyboard.overlaysContent = true;
    } catch {
      return;
    }
    handleGeometry();
    keyboard.addEventListener('geometrychange', handleGeometry);
    return () => {
      keyboard.removeEventListener('geometrychange', handleGeometry);
      try {
        keyboard.overlaysContent = previousOverlay;
      } catch {
        // 忽略恢复失败
      }
      keyboardInsetRef.current = 0;
      setKeyboardInset(0);
    };
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
      // 拿不到键盘高度且视口未收缩时（部分安卓 PWA 内核），只能把弹层移到上半屏避免遮挡
      const coveredByOverlay =
        keyboardInsetRef.current === 0 && heightBefore - heightAfter < 40;
      setKeyboardCover(touchDevice && coveredByOverlay);
      window.setTimeout(() => target.scrollIntoView({ block: 'nearest' }), 60);
    }, 350);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className={`overlay overlay-sheet${keyboardCover ? ' is-keyboard-cover' : ''}`}
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
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
