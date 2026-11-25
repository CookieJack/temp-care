import { useRegisterSW } from 'virtual:pwa-register/react';

/** 新版本提示：检测到新的 Service Worker 时展示刷新入口，对应 registerType: 'prompt' */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) {
    return null;
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-text">有新版本，刷新后生效</span>
      <button
        type="button"
        className="update-banner-button"
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        刷新
      </button>
      <button type="button" className="section-link" onClick={() => setNeedRefresh(false)}>
        稍后
      </button>
    </div>
  );
}
