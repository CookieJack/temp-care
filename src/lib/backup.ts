// 数据备份（PWA 专有能力）：把 localStorage 中全部业务数据导出为单个 JSON 文件，
// 导入时先整体校验再一次性覆盖，避免半套数据写坏存储。

import { storage } from './storage';
import { STORAGE_KEYS } from './types';
import type { Batch, MedName, MedRecord, Profile, TempRecord } from './types';

const BACKUP_APP = 'obstant';
const BACKUP_VERSION = 1;

export interface BackupData {
  profiles: Profile[];
  activeProfile: string;
  tempRecords: TempRecord[];
  medRecords: MedRecord[];
  batches: Batch[];
  medNames: MedName[];
}

export interface BackupPayload {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: number;
  data: BackupData;
}

type ListKey = 'profiles' | 'tempRecords' | 'medRecords' | 'batches' | 'medNames';

const LIST_LABELS: Record<ListKey, string> = {
  profiles: '档案',
  tempRecords: '体温记录',
  medRecords: '用药记录',
  batches: '批次',
  medNames: '药名库',
};

function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function todayText(): string {
  const now = new Date();
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
}

async function readList<T>(key: string): Promise<T[]> {
  const value = await storage.get<T[]>(key);
  return Array.isArray(value) ? value : [];
}

/** 汇总当前存储中的数据，返回可下载的备份文件 */
export async function createBackup(): Promise<{ blob: Blob; fileName: string }> {
  const [profiles, activeProfile, tempRecords, medRecords, batches, medNames] = await Promise.all([
    readList<Profile>(STORAGE_KEYS.profiles),
    storage.get<string>(STORAGE_KEYS.activeProfile),
    readList<TempRecord>(STORAGE_KEYS.tempRecords),
    readList<MedRecord>(STORAGE_KEYS.medRecords),
    readList<Batch>(STORAGE_KEYS.batches),
    readList<MedName>(STORAGE_KEYS.medNames),
  ]);

  const payload: BackupPayload = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: {
      profiles,
      activeProfile: typeof activeProfile === 'string' ? activeProfile : '',
      tempRecords,
      medRecords,
      batches,
      medNames,
    },
  };

  return {
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    fileName: `体温用药备份-${todayText()}.json`,
  };
}

function validateList(value: unknown, key: ListKey): string | null {
  const label = LIST_LABELS[key];
  if (!Array.isArray(value)) {
    return `备份数据缺少「${label}」列表`;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return `「${label}」中存在无效记录`;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') {
      return `「${label}」中存在缺少 ID 的记录`;
    }
    if (seen.has(id)) {
      return `「${label}」中存在重复的记录 ID`;
    }
    seen.add(id);
  }
  return null;
}

/**
 * 解析并校验备份文本。
 * 成功返回 data；失败返回 error（可直接提示给用户），二者不会同时有值。
 */
export function parseBackup(text: string): { data: BackupData | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: null, error: '备份文件不是有效的 JSON' };
  }
  if (!raw || typeof raw !== 'object') {
    return { data: null, error: '备份文件不是本应用导出的格式' };
  }

  const payload = raw as Partial<BackupPayload>;
  if (payload.app !== BACKUP_APP) {
    return { data: null, error: '备份文件不是本应用导出的格式' };
  }
  if (payload.version !== BACKUP_VERSION) {
    return { data: null, error: '备份文件版本不受支持，请使用当前版本重新导出' };
  }

  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return { data: null, error: '备份数据为空或已损坏' };
  }

  const keys: ListKey[] = ['profiles', 'tempRecords', 'medRecords', 'batches', 'medNames'];
  for (const key of keys) {
    const error = validateList((data as unknown as Record<string, unknown>)[key], key);
    if (error !== null) {
      return { data: null, error };
    }
  }

  const activeProfile = typeof data.activeProfile === 'string' ? data.activeProfile : '';
  const profileIds = new Set(data.profiles.map(item => item.id));
  return {
    data: {
      profiles: data.profiles,
      // 当前档案不存在时清空，交给 bootstrap 重新选出默认档案
      activeProfile: profileIds.has(activeProfile) ? activeProfile : '',
      tempRecords: data.tempRecords,
      medRecords: data.medRecords,
      batches: data.batches,
      medNames: data.medNames,
    },
    error: null,
  };
}

/** 将已校验的备份整体写入存储（覆盖现有数据） */
export async function applyBackup(data: BackupData): Promise<void> {
  await Promise.all([
    storage.set(STORAGE_KEYS.profiles, data.profiles),
    storage.set(STORAGE_KEYS.activeProfile, data.activeProfile),
    storage.set(STORAGE_KEYS.tempRecords, data.tempRecords),
    storage.set(STORAGE_KEYS.medRecords, data.medRecords),
    storage.set(STORAGE_KEYS.batches, data.batches),
    storage.set(STORAGE_KEYS.medNames, data.medNames),
  ]);
}
