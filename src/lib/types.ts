// 数据模型与存储契约（P0 冻结）
// 与小程序 utils/store.js、utils/common.js 保持一致，迁移期间不得擅改字段语义。

export type StoreErrorCode =
  | 'NOT_FOUND_OR_FORBIDDEN'
  | 'INVALID_ID'
  | 'INVALID_PAYLOAD'
  | 'CLIENT_EXCEPTION';

export interface StoreError {
  code: StoreErrorCode;
  message: string;
}

/** 所有 store 方法统一的返回契约 */
export interface StoreResult<T> {
  data: T | null;
  error: StoreError | null;
}

/** 列表项公共字段：id 为「时间戳-自增序号」字符串 */
export interface StoreItem {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface Profile extends StoreItem {
  name: string;
  relation: string;
  note: string;
}

export interface Batch extends StoreItem {
  profileId: string;
  name: string;
  note: string;
}

export interface TempRecord extends StoreItem {
  profileId: string;
  batchId: string;
  value: number;
  measuredAt: number;
  method: string;
  note: string;
  /** 关联的第一条用药记录 id，无关联为空串 */
  medicationId: string;
}

export interface MedRecord extends StoreItem {
  profileId: string;
  batchId: string;
  name: string;
  manufacturer: string;
  dose: number;
  unit: string;
  takenAt: number;
  note: string;
  /** manual = 手动录入；temp-link = 体温编辑时同步创建 */
  source: 'manual' | 'temp-link';
  /** 由体温联动创建时指向该体温记录 id */
  tempId: string;
}

export interface MedName extends StoreItem {
  name: string;
  manufacturer: string;
  /** YYYY-MM-DD，空串表示未设置 */
  expiryDate: string;
}

export type AnyRecord = Profile | Batch | TempRecord | MedRecord | MedName;

/** 存储键（与小程序 Storage Key 完全一致，便于将来导入备份） */
export const STORAGE_KEYS = {
  profiles: 'ob_health_profiles',
  activeProfile: 'ob_health_active_profile',
  tempRecords: 'ob_temp_records',
  medRecords: 'ob_med_records',
  batches: 'ob_health_batches',
  medNames: 'ob_med_name_library',
} as const;

export interface ListStore<T extends StoreItem> {
  list(): Promise<StoreResult<T[]>>;
  create(payload: Omit<T, keyof StoreItem> | Partial<T>): Promise<StoreResult<T>>;
  update(id: string | number, patch: Partial<T>): Promise<StoreResult<T>>;
  remove(id: string | number): Promise<StoreResult<{ removed: number }>>;
  replace(items: T[]): Promise<StoreResult<{ count: number }>>;
}

/** 页面加载状态（与小程序各页 viewState 对齐） */
export type ViewState = 'loading' | 'ready' | 'empty' | 'error';

/** 业务枚举（与 common.js 对齐） */
export const MEASURE_METHODS = ['腋下', '口腔', '耳温', '额温', '肛温'] as const;
export const MED_UNITS = ['mg', 'ml', '片', '粒', '支', '袋', '滴'] as const;
export const RELATIONS = ['本人', '家人', '朋友', '其他'] as const;

export const FEVER_LOW = 37.3;
export const FEVER_BURST = 38.5;
