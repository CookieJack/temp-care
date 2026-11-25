// 通用本地列表存储：移植自 utils/store.js，保持 { data, error } 契约与排序语义不变。
// 唯一差异：wx.*StorageSync 换成注入式 StorageAdapter，读写变为 Promise。
// 页面只通过 list / create / update / remove / replace 访问存储。

import type { Batch, ListStore, MedName, MedRecord, Profile, StoreError, StoreItem, StoreResult, TempRecord } from './types';
import { STORAGE_KEYS } from './types';
import { storage as defaultStorage, type StorageAdapter } from './storage';

const NOT_FOUND_OR_FORBIDDEN_ERROR: StoreError = {
  code: 'NOT_FOUND_OR_FORBIDDEN',
  message: '没有保存成功，这条记录可能已被删除或无权修改',
};

const INVALID_ID_ERROR: StoreError = {
  code: 'INVALID_ID',
  message: '缺少记录 id',
};

const INVALID_PAYLOAD_ERROR: StoreError = {
  code: 'INVALID_PAYLOAD',
  message: '没有可提交的字段',
};

let idCounter = 0;

export interface CreateListStoreOptions {
  storageKey: string;
  sortKey?: string;
  /** 便于单测注入；默认使用全局 localStorage 适配器 */
  storage?: StorageAdapter;
}

export function createListStore<T extends StoreItem>(options: CreateListStoreOptions): ListStore<T> {
  if (typeof options?.storageKey !== 'string' || options.storageKey.trim() === '') {
    throw new TypeError('storageKey 不能为空');
  }
  const storageKey = options.storageKey;
  const sortKey = typeof options.sortKey === 'string' && options.sortKey !== '' ? options.sortKey : 'updatedAt';
  const adapter = options.storage ?? defaultStorage;

  return {
    list() {
      return safely(async () => ({
        data: await readItems<T>(adapter, storageKey, sortKey),
        error: null,
      }));
    },

    create(payload) {
      return safely(async () => {
        if (!isPlainObject(payload) || Object.keys(payload).length === 0) {
          return { data: null, error: INVALID_PAYLOAD_ERROR };
        }
        const now = Date.now();
        const item = { ...payload, id: createItemId(now), createdAt: now, updatedAt: now } as T;
        const items = await readItems<T>(adapter, storageKey, sortKey);
        items.unshift(item);
        await writeItems(adapter, storageKey, items);
        return { data: item, error: null };
      });
    },

    update(id, patch) {
      if (isInvalidId(id)) {
        return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
      }
      return safely(async () => {
        if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
          return { data: null, error: INVALID_PAYLOAD_ERROR };
        }
        const items = await readItems<T>(adapter, storageKey, sortKey);
        const index = findIndexById(items, String(id));
        if (index === -1) {
          return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
        }
        const next = { ...items[index], ...patch, updatedAt: Date.now() } as T;
        items[index] = next;
        await writeItems(adapter, storageKey, items);
        return { data: next, error: null };
      });
    },

    remove(id) {
      if (isInvalidId(id)) {
        return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
      }
      return safely(async () => {
        const itemId = String(id);
        const items = await readItems<T>(adapter, storageKey, sortKey);
        const filtered = items.filter(item => item.id !== itemId);
        if (items.length - filtered.length === 0) {
          return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
        }
        await writeItems(adapter, storageKey, filtered);
        return { data: { removed: 1 }, error: null };
      });
    },

    // 用整表替换实现批量删除等操作：调用方先 list，再过滤，最后 replace。
    replace(items) {
      return safely(async () => {
        if (!Array.isArray(items)) {
          return { data: null, error: INVALID_PAYLOAD_ERROR };
        }
        const valid = (items as unknown[]).filter(isStoredItem).map(normalizeStoredItem) as T[];
        await writeItems(adapter, storageKey, valid);
        return { data: { count: valid.length }, error: null };
      });
    },
  };
}

// 泛型包装：保持与小程序版相同的 Promise + 异常收敛行为
function safely<T>(executor: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  return Promise.resolve()
    .then(executor)
    .catch(error => ({ data: null, error: toClientException(error) }));
}

function toClientException(error: unknown): StoreError {
  const message =
    error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  return { code: 'CLIENT_EXCEPTION', message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readItems<T extends StoreItem>(
  adapter: StorageAdapter,
  storageKey: string,
  sortKey: string
): Promise<T[]> {
  const value = await adapter.get<unknown>(storageKey);
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isStoredItem)
    .map(normalizeStoredItem)
    .sort((left, right) => toNumber(right[sortKey]) - toNumber(left[sortKey])) as T[];
}

async function writeItems<T>(adapter: StorageAdapter, storageKey: string, items: T[]): Promise<void> {
  await adapter.set(storageKey, items);
}

function normalizeStoredItem(item: Record<string, unknown>): Record<string, unknown> {
  return { ...item, id: String(item.id) };
}

function findIndexById(items: StoreItem[], itemId: string): number {
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].id === itemId) {
      return i;
    }
  }
  return -1;
}

function createItemId(timestamp: number): string {
  idCounter = (idCounter + 1) % 1000000;
  return String(timestamp) + '-' + String(idCounter);
}

function isInvalidId(id: string | number): boolean {
  if (typeof id === 'string') {
    return id.trim() === '';
  }
  if (typeof id === 'number') {
    return !Number.isFinite(id);
  }
  return true;
}

function isStoredItem(item: unknown): item is Record<string, unknown> {
  return (
    item !== null &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    (typeof (item as { id?: unknown }).id === 'string' || typeof (item as { id?: unknown }).id === 'number')
  );
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// ---- 业务 store 单例（排序键与小程序各页面一致） ----

export const profileStore = createListStore<Profile>({
  storageKey: STORAGE_KEYS.profiles,
  sortKey: 'createdAt',
});

export const batchStore = createListStore<Batch>({
  storageKey: STORAGE_KEYS.batches,
  sortKey: 'updatedAt',
});

export const tempStore = createListStore<TempRecord>({
  storageKey: STORAGE_KEYS.tempRecords,
  sortKey: 'measuredAt',
});

export const medStore = createListStore<MedRecord>({
  storageKey: STORAGE_KEYS.medRecords,
  sortKey: 'takenAt',
});

export const medNameStore = createListStore<MedName>({
  storageKey: STORAGE_KEYS.medNames,
  sortKey: 'createdAt',
});
