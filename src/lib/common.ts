// 业务工具：移植自 utils/common.js，纯函数逻辑逐行对齐。
// 差异：getActiveProfileId / setActiveProfileId 改为经 StorageAdapter 异步读写；
// getActiveProfile 因此改为显式接收 activeId（由调用方先读一次），避免隐式同步存储访问。

import type { ListStore, Profile } from './types';
import { FEVER_BURST, FEVER_LOW, MEASURE_METHODS, MED_UNITS, RELATIONS, STORAGE_KEYS } from './types';
import { storage } from './storage';

export { FEVER_BURST, FEVER_LOW, MEASURE_METHODS, MED_UNITS, RELATIONS };

export const LEVEL_COLORS = {
  normal: '#00b42a',
  lowTemp: '#2b7de9',
  lowFever: '#ff9a2e',
  midFever: '#f77a2f',
  highFever: '#e64531',
  superFever: '#a9170f',
} as const;

export type FeverLevelKey = keyof typeof LEVEL_COLORS;

export interface FeverLevel {
  key: FeverLevelKey;
  label: string;
  color: string;
  burst: boolean;
}

// 体温分级：<35.5 偏低，<37.3 正常，<38.1 低热，<39.1 中度发热，≤41 高热，>41 超高热
export function feverLevel(value: unknown): FeverLevel {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { key: 'normal', label: '未知', color: LEVEL_COLORS.normal, burst: false };
  }
  if (num < 35.5) {
    return { key: 'lowTemp', label: '体温偏低', color: LEVEL_COLORS.lowTemp, burst: false };
  }
  if (num < FEVER_LOW) {
    return { key: 'normal', label: '正常', color: LEVEL_COLORS.normal, burst: false };
  }
  if (num < 38.1) {
    return { key: 'lowFever', label: '低热', color: LEVEL_COLORS.lowFever, burst: num >= FEVER_BURST };
  }
  if (num < 39.1) {
    return { key: 'midFever', label: '中度发热', color: LEVEL_COLORS.midFever, burst: true };
  }
  if (num <= 41) {
    return { key: 'highFever', label: '高热', color: LEVEL_COLORS.highFever, burst: true };
  }
  return { key: 'superFever', label: '超高热', color: LEVEL_COLORS.superFever, burst: true };
}

function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function toTs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function formatDateTime(ts: unknown): string {
  const date = new Date(toTs(ts));
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

export function formatDate(ts: unknown): string {
  const date = new Date(toTs(ts));
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function formatShortDate(ts: unknown): string {
  const date = new Date(toTs(ts));
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function formatClock(ts: unknown): string {
  const date = new Date(toTs(ts));
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// 与 iOS 兼容的时间解析：避免 new Date('YYYY-MM-DD HH:mm') 在 iOS 上返回 NaN
export function dateTimeToTs(dateStr?: string, timeStr?: string): number {
  const dateParts = typeof dateStr === 'string' ? dateStr.split('-') : [];
  const timeParts = typeof timeStr === 'string' ? timeStr.split(':') : [];
  if (dateParts.length !== 3 || timeParts.length !== 2) {
    return Date.now();
  }
  const ts = new Date(
    Number(dateParts[0]),
    Number(dateParts[1]) - 1,
    Number(dateParts[2]),
    Number(timeParts[0]),
    Number(timeParts[1])
  ).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

export function todayStart(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 当天 0 点起往前 days 天（含今天）的时间范围起点
export function daysRangeStart(days: number): number {
  return todayStart() - (days - 1) * 24 * 60 * 60 * 1000;
}

export function isSameDay(ts: unknown, baseTs: unknown): boolean {
  const date = new Date(toTs(ts));
  const base = new Date(toTs(baseTs));
  return (
    date.getFullYear() === base.getFullYear() &&
    date.getMonth() === base.getMonth() &&
    date.getDate() === base.getDate()
  );
}

export function formatDose(dose: unknown, unit?: unknown): string {
  const num = Number(dose);
  const unitText = typeof unit === 'string' && unit !== '' ? unit : '';
  if (!Number.isFinite(num) || num <= 0) {
    return unitText === '' ? '未记录剂量' : unitText;
  }
  return (num % 1 === 0 ? String(num) : num.toFixed(1)) + unitText;
}

export function sortByTimeAsc<T extends object>(items: T[], timeKey = 'measuredAt'): T[] {
  const key = typeof timeKey === 'string' && timeKey !== '' ? timeKey : 'measuredAt';
  return items
    .slice()
    .sort(
      (a, b) =>
        toNumber((a as Record<string, unknown>)[key]) - toNumber((b as Record<string, unknown>)[key])
    );
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// ---- 档案选择（active profile） ----

export async function getActiveProfileId(): Promise<string> {
  const value = await storage.get<unknown>(STORAGE_KEYS.activeProfile);
  return typeof value === 'string' && value !== '' ? value : '';
}

export async function setActiveProfileId(id: string): Promise<void> {
  if (typeof id === 'string' && id !== '') {
    await storage.set(STORAGE_KEYS.activeProfile, id);
  }
}

// 首次启动时创建默认档案，保证各页面开箱可用
export async function ensureDefaultProfile(profileStore: ListStore<Profile>): Promise<Profile | null> {
  const result = await profileStore.list();
  if (result.error || !Array.isArray(result.data)) {
    return null;
  }
  const profiles = result.data;
  if (profiles.length === 0) {
    const created = await profileStore.create({ name: '本人', relation: '本人', note: '' });
    if (!created.error && created.data && created.data.id) {
      await setActiveProfileId(created.data.id);
      return created.data;
    }
    return null;
  }
  const activeId = await getActiveProfileId();
  const exists = profiles.some(profile => profile.id === activeId);
  if (!exists) {
    await setActiveProfileId(profiles[0].id);
  }
  return null;
}

export function getActiveProfile(profiles: Profile[] | null | undefined, activeId: string): Profile | null {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return null;
  }
  for (let i = 0; i < profiles.length; i += 1) {
    if (profiles[i].id === activeId) {
      return profiles[i];
    }
  }
  return profiles[0];
}

// 药名快捷建议：药名库（用户维护 + 提交自动记忆）优先，历史用药按频次补充。
// 同名药可能来自不同厂商：按「药名+厂商」组合去重，返回带 label 的芯片数据。
export interface MedNameSuggestion {
  name: string;
  manufacturer: string;
  label: string;
}

interface MedIdentity {
  name?: unknown;
  manufacturer?: unknown;
}

export function collectMedNameSuggestions(
  libraryItems: Array<MedIdentity | string> | null | undefined,
  medRecords: MedIdentity[] | null | undefined,
  limit?: number
): MedNameSuggestion[] {
  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : 8;
  const seen: Record<string, boolean> = {};
  const suggestions: MedNameSuggestion[] = [];
  const pushSuggestion = function (name: unknown, manufacturer: unknown) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedManu = typeof manufacturer === 'string' ? manufacturer.trim() : '';
    if (trimmedName === '') {
      return;
    }
    const label = trimmedManu !== '' ? trimmedName + '（' + trimmedManu + '）' : trimmedName;
    const key = trimmedName + '\u0001' + trimmedManu;
    if (seen[key] || suggestions.length >= safeLimit) {
      return;
    }
    seen[key] = true;
    suggestions.push({ name: trimmedName, manufacturer: trimmedManu, label });
  };
  (libraryItems || []).forEach(item => {
    if (item && typeof item === 'object') {
      pushSuggestion(item.name, item.manufacturer);
    } else if (typeof item === 'string') {
      pushSuggestion(item, '');
    }
  });
  const counts: Record<string, { count: number; name: string; manufacturer: string }> = {};
  const order: string[] = [];
  (medRecords || []).forEach(item => {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name === '') {
      return;
    }
    const manufacturer = typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '';
    const key = name + '\u0001' + manufacturer;
    if (!counts[key]) {
      counts[key] = { count: 0, name, manufacturer };
      order.push(key);
    }
    counts[key].count += 1;
  });
  order
    .sort((left, right) => counts[right].count - counts[left].count)
    .forEach(key => {
      const entry = counts[key];
      pushSuggestion(entry.name, entry.manufacturer);
    });
  return suggestions;
}

// 从本次提交的药物条目中筛选出药名库里尚未收录的（按「药名+厂商」组合判重，用于自动记忆）
export function collectNewMedNames(
  entries: MedIdentity[] | null | undefined,
  libraryItems: MedIdentity[] | null | undefined
): Array<{ name: string; manufacturer: string }> {
  const existing: Record<string, boolean> = {};
  (libraryItems || []).forEach(item => {
    const name = item && typeof item.name === 'string' ? item.name.trim() : '';
    const manufacturer = item && typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '';
    if (name !== '') {
      existing[name + '\u0001' + manufacturer] = true;
    }
  });
  const seen: Record<string, boolean> = {};
  const fresh: Array<{ name: string; manufacturer: string }> = [];
  (entries || []).forEach(raw => {
    const name = raw && typeof raw.name === 'string' ? raw.name.trim() : '';
    const manufacturer = raw && typeof raw.manufacturer === 'string' ? raw.manufacturer.trim() : '';
    const key = name + '\u0001' + manufacturer;
    if (name === '' || existing[key] || seen[key]) {
      return;
    }
    seen[key] = true;
    fresh.push({ name, manufacturer });
  });
  return fresh;
}
