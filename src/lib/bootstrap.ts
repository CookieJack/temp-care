// 应用启动初始化：幂等，多次调用复用同一 Promise。
// StrictMode 下 effect 会执行两次，单例可避免并发创建出两个默认档案。
import { ensureDefaultProfile } from './common';
import { profileStore } from './store';

let bootstrapPromise: Promise<void> | null = null;

export function bootstrapApp(): Promise<void> {
  if (!bootstrapPromise) {
    // 请求持久化存储，降低浏览器在空间紧张时清理本地记录的概率
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }
    bootstrapPromise = ensureDefaultProfile(profileStore)
      .then(() => undefined)
      .catch(() => undefined);
  }
  return bootstrapPromise;
}
