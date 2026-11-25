import { describe, expect, it } from 'vitest';
import {
  collectMedNameSuggestions,
  collectNewMedNames,
  dateTimeToTs,
  ensureDefaultProfile,
  feverLevel,
  formatClock,
  formatDate,
  formatDateTime,
  formatDose,
  getActiveProfileId,
  isSameDay,
  sortByTimeAsc,
} from './common';
import { createMemoryStorage } from './storage';
import { createListStore } from './store';
import type { Profile } from './types';

describe('feverLevel', () => {
  it('按小程序阈值分级', () => {
    expect(feverLevel(35.4).key).toBe('lowTemp');
    expect(feverLevel(36.6).key).toBe('normal');
    expect(feverLevel(37.2).key).toBe('normal');
    expect(feverLevel(37.3)).toMatchObject({ key: 'lowFever', burst: false });
    expect(feverLevel(38)).toMatchObject({ key: 'lowFever', burst: false });
    expect(feverLevel(38.1)).toMatchObject({ key: 'midFever', burst: true });
    expect(feverLevel(38.5).key).toBe('midFever');
    expect(feverLevel(39.1).key).toBe('highFever');
    expect(feverLevel(41).key).toBe('highFever');
    expect(feverLevel(41.1).key).toBe('superFever');
  });

  it('非法值返回未知且不爆表', () => {
    expect(feverLevel('abc')).toMatchObject({ key: 'normal', label: '未知', burst: false });
  });
});

describe('时间格式化与解析', () => {
  const ts = new Date(2026, 0, 2, 3, 4).getTime();

  it('dateTimeToTs 与本地时间一致', () => {
    expect(dateTimeToTs('2026-01-02', '03:04')).toBe(ts);
  });

  it('参数不完整时退化为当前时间', () => {
    const before = Date.now();
    expect(dateTimeToTs('2026-01-02')).toBeGreaterThanOrEqual(before);
    expect(dateTimeToTs(undefined, undefined)).toBeGreaterThanOrEqual(before);
  });

  it('格式化输出', () => {
    expect(formatDateTime(ts)).toBe('2026-01-02 03:04');
    expect(formatDate(ts)).toBe('2026-01-02');
    expect(formatClock(ts)).toBe('03:04');
    expect(formatDate('bad')).toBe('--');
  });

  it('isSameDay 按本地日期比较', () => {
    expect(isSameDay(ts, ts + 60 * 60 * 1000)).toBe(true);
    expect(isSameDay(ts, ts + 24 * 60 * 60 * 1000)).toBe(false);
  });
});

describe('formatDose', () => {
  it('整数/小数/空值', () => {
    expect(formatDose(2, 'mg')).toBe('2mg');
    expect(formatDose(1.25, 'ml')).toBe('1.3ml');
    expect(formatDose(0, '片')).toBe('片');
    expect(formatDose(0, '')).toBe('未记录剂量');
  });
});

describe('sortByTimeAsc', () => {
  it('按时间升序且不修改原数组', () => {
    const items = [{ measuredAt: 3 }, { measuredAt: 1 }, { measuredAt: 2 }];
    expect(sortByTimeAsc(items).map(item => item.measuredAt)).toEqual([1, 2, 3]);
    expect(items[0].measuredAt).toBe(3);
  });
});

describe('ensureDefaultProfile', () => {
  it('空库时创建「本人」并设为当前，重复调用不重复创建', async () => {
    const store = createListStore<Profile>({
      storageKey: 'test_ensure_default_empty',
      sortKey: 'createdAt',
      storage: createMemoryStorage(),
    });

    const created = await ensureDefaultProfile(store);
    expect(created).toMatchObject({ name: '本人', relation: '本人' });
    expect(await getActiveProfileId()).toBe(created?.id);

    expect(await ensureDefaultProfile(store)).toBeNull();
    expect((await store.list()).data).toHaveLength(1);
  });

  it('已有档案但当前档案失效时回落到第一条', async () => {
    const store = createListStore<Profile>({
      storageKey: 'test_ensure_default_existing',
      sortKey: 'createdAt',
      storage: createMemoryStorage({
        test_ensure_default_existing: [
          { id: 'p1', name: '家人', relation: '家人', note: '', createdAt: 1, updatedAt: 1 },
        ],
      }),
    });

    expect(await ensureDefaultProfile(store)).toBeNull();
    expect(await getActiveProfileId()).toBe('p1');
  });
});

describe('collectMedNameSuggestions', () => {
  const library = [
    { name: '布洛芬', manufacturer: '厂家A' },
    { name: '布洛芬', manufacturer: '厂家B' },
    { name: '对乙酰氨基酚', manufacturer: '' },
  ];
  const records = [
    { name: '布洛芬', manufacturer: '厂家A' },
    { name: '布洛芬', manufacturer: '厂家A' },
    { name: '阿莫西林', manufacturer: '' },
    { name: '阿莫西林', manufacturer: '' },
    { name: '头孢', manufacturer: '' },
  ];

  it('药名库优先、按药名+厂商去重、label 带厂商', () => {
    const result = collectMedNameSuggestions(library, records);
    expect(result.map(item => item.label)).toEqual([
      '布洛芬（厂家A）',
      '布洛芬（厂家B）',
      '对乙酰氨基酚',
      '阿莫西林',
      '头孢',
    ]);
  });

  it('尊重 limit', () => {
    expect(collectMedNameSuggestions(library, records, 2)).toHaveLength(2);
  });

  it('忽略空药名并兼容字符串药名库', () => {
    const result = collectMedNameSuggestions(['  维C  ', ''], [{ name: '  ' }]);
    expect(result).toEqual([{ name: '维C', manufacturer: '', label: '维C' }]);
  });
});

describe('collectNewMedNames', () => {
  it('排除已收录与重复项，保留新药名', () => {
    const library = [{ name: '布洛芬', manufacturer: '厂家A' }];
    const entries = [
      { name: '布洛芬', manufacturer: '厂家A' },
      { name: '布洛芬', manufacturer: '厂家B' },
      { name: '布洛芬', manufacturer: '厂家B' },
      { name: '感冒灵', manufacturer: '' },
    ];
    expect(collectNewMedNames(entries, library)).toEqual([
      { name: '布洛芬', manufacturer: '厂家B' },
      { name: '感冒灵', manufacturer: '' },
    ]);
  });
});
