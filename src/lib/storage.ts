// 存储适配器：页面与 store 只依赖 StorageAdapter，不直接接触 localStorage。
// 与小程序 wx.*StorageSync 的差异：小程序缺失键返回 ''，这里统一返回 null。
// 后续切 IndexedDB 时只需替换适配器实现，调用方无感。

/** 存储/序列化异常，统一错误码与 utils/store.js 的 CLIENT_EXCEPTION 对齐 */
export class ClientException extends Error {
  readonly code = 'CLIENT_EXCEPTION';

  constructor(message: string) {
    super(message);
    this.name = 'ClientException';
  }
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

function parseValue<T>(raw: string | null): T | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ClientException('本地数据解析失败，存储内容可能已损坏');
  }
}

function stringifyValue<T>(value: T): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new ClientException('本地数据序列化失败');
  }
}

/** localStorage 驱动（浏览器默认实现） */
export function createLocalStorageAdapter(): StorageAdapter {
  return {
    async get<T>(key: string): Promise<T | null> {
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        throw new ClientException('读取本地存储失败');
      }
      return parseValue<T>(raw);
    },

    async set<T>(key: string, value: T): Promise<void> {
      const raw = stringifyValue(value);
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        throw new ClientException('写入本地存储失败，存储空间可能已满');
      }
    },

    async remove(key: string): Promise<void> {
      try {
        window.localStorage.removeItem(key);
      } catch {
        throw new ClientException('删除本地存储失败');
      }
    },
  };
}

/** 内存实现：单元测试与 localStorage 不可用（隐私模式/SSR）时的兜底 */
export function createMemoryStorage(seed?: Record<string, unknown>): StorageAdapter {
  const map = new Map<string, string>();
  if (seed) {
    Object.entries(seed).forEach(([key, value]) => {
      map.set(key, stringifyValue(value));
    });
  }
  return {
    async get<T>(key: string): Promise<T | null> {
      return parseValue<T>(map.get(key) ?? null);
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, stringifyValue(value));
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
  };
}

function canUseLocalStorage(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    const probe = '__ob_storage_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** 全局默认适配器：浏览器用 localStorage，其余场景退化为内存 */
export const storage: StorageAdapter = canUseLocalStorage()
  ? createLocalStorageAdapter()
  : createMemoryStorage();
