import { useEffect, useState } from 'react';

/**
 * 键盘/视口调试读数：URL 带 ?debug=1 时显示，桌面 PWA（standalone）下始终显示，
 * 用于真机上确认软键盘弹起时各视口高度是否变化。
 */
const DEBUG_KEY = 'ob_debug_viewport';

export function ViewportDebug() {
  const [enabled] = useState(() => {
    const flag = new URLSearchParams(window.location.search).get('debug');
    let stored = false;
    try {
      if (flag === '1') {
        window.localStorage.setItem(DEBUG_KEY, '1');
      }
      if (flag === '0') {
        window.localStorage.removeItem(DEBUG_KEY);
      }
      stored = window.localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
      // 隐私模式下忽略存储失败
    }
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    return flag === '1' || stored || standalone;
  });
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const update = () => {
      const viewport = window.visualViewport;
      const root = document.documentElement;
      const sheet = document.querySelector('.sheet-editor');
      const sheetRect = sheet ? sheet.getBoundingClientRect() : null;
      const active = document.activeElement;
      const isField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement;
      const fieldRect = isField ? active.getBoundingClientRect() : null;
      const virtualKeyboard = (
        navigator as Navigator & {
          virtualKeyboard?: { boundingRect?: DOMRect };
        }
      ).virtualKeyboard;
      const keyboardHeight = virtualKeyboard?.boundingRect?.height ?? 0;
      const standalone = window.matchMedia('(display-mode: standalone)').matches;

      setLines([
        `mode: ${standalone ? 'standalone' : 'browser'}`,
        `inner: ${window.innerWidth}x${window.innerHeight}`,
        `layout: ${root.clientWidth}x${root.clientHeight} scrollY:${Math.round(window.scrollY)}`,
        viewport
          ? `vv: ${Math.round(viewport.width)}x${Math.round(viewport.height)} top:${Math.round(viewport.offsetTop)} pageTop:${Math.round(viewport.pageTop)} scale:${viewport.scale.toFixed(2)}`
          : 'vv: 不支持',
        `css var: h=${root.style.getPropertyValue('--vv-height') || '-'} t=${root.style.getPropertyValue('--vv-top') || '-'}`,
        `sheet: ${sheetRect ? `${Math.round(sheetRect.top)}-${Math.round(sheetRect.bottom)}` : '未打开'}`,
        `focus: ${isField ? active.tagName.toLowerCase() : '无'} ${fieldRect ? `${Math.round(fieldRect.top)}-${Math.round(fieldRect.bottom)}` : ''}`,
        `virtualKeyboard: ${virtualKeyboard ? `有 h=${Math.round(keyboardHeight)}` : '无'}`,
        `meta: ${document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '-'}`,
      ]);
    };

    update();
    const timer = window.setInterval(update, 300);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="viewport-debug">
      {lines.map(line => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
