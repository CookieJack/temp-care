import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ob_install_tip_dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const displayMode = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 安装引导：安卓/桌面 Chrome 走 beforeinstallprompt 原生安装；
 * iOS 无该事件，展示「分享 → 添加到主屏幕」图文提示。关闭后不再打扰。
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosTip, setIosTip] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissed()) {
      return;
    }
    if (isIOS()) {
      setIosTip(true);
      return;
    }
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || (!deferredPrompt && !iosTip)) {
    return null;
  }

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 忽略隐私模式下的写入失败
    }
  };

  const install = async () => {
    if (!deferredPrompt) {
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      dismiss();
      return;
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="install-tip" role="region" aria-label="安装到主屏幕">
      <div className="install-tip-main">
        <p className="install-tip-title">安装到主屏幕，离线也能记录</p>
        <p className="install-tip-desc">
          {iosTip
            ? '在 Safari 点底部「分享」，选择「添加到主屏幕」。'
            : '像 App 一样全屏使用，数据保存在本机浏览器。'}
        </p>
      </div>
      {deferredPrompt ? (
        <button type="button" className="install-tip-action" onClick={() => void install()}>
          安装
        </button>
      ) : null}
      <button type="button" className="install-tip-close" aria-label="关闭安装提示" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
