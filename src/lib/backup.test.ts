import { describe, expect, it } from 'vitest';
import { applyBackup, createBackup, parseBackup } from './backup';
import type { BackupData } from './backup';
import { storage } from './storage';
import { STORAGE_KEYS } from './types';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    app: 'obstant',
    version: 1,
    exportedAt: 1730000000000,
    data: {
      profiles: [{ id: 'p1', name: '本人', relation: '本人', note: '', createdAt: 1 }],
      activeProfile: 'p1',
      tempRecords: [],
      medRecords: [],
      batches: [],
      medNames: [],
      ...overrides,
    },
  };
}

describe('parseBackup', () => {
  it('拒绝非法 JSON', () => {
    const result = parseBackup('{oops');
    expect(result.data).toBeNull();
    expect(result.error).toBe('备份文件不是有效的 JSON');
  });

  it('拒绝非本应用的备份', () => {
    const raw = JSON.stringify({ ...makePayload(), app: 'other' });
    const result = parseBackup(raw);
    expect(result.data).toBeNull();
    expect(result.error).toContain('不是本应用导出的格式');
  });

  it('拒绝重复的记录 ID', () => {
    const raw = JSON.stringify(
      makePayload({
        batches: [
          { id: 'b1', profileId: 'p1', name: 'A', createdAt: 1, updatedAt: 1 },
          { id: 'b1', profileId: 'p1', name: 'B', createdAt: 1, updatedAt: 1 },
        ],
      })
    );
    const result = parseBackup(raw);
    expect(result.data).toBeNull();
    expect(result.error).toContain('重复的记录 ID');
  });

  it('当前档案不存在时清空，交给 bootstrap 兜底', () => {
    const raw = JSON.stringify(makePayload({ activeProfile: 'missing' }));
    const result = parseBackup(raw);
    expect(result.error).toBeNull();
    expect(result.data?.activeProfile).toBe('');
  });

  it('接受合法备份并保留当前档案', () => {
    const result = parseBackup(JSON.stringify(makePayload()));
    expect(result.error).toBeNull();
    expect(result.data?.activeProfile).toBe('p1');
    expect(result.data?.profiles).toHaveLength(1);
  });

  it('applyBackup 覆盖全部存储键', async () => {
    const data: BackupData = {
      profiles: [{ id: 'p9', name: '备份档案', relation: '家人', note: '', createdAt: 9, updatedAt: 9 }],
      activeProfile: 'p9',
      tempRecords: [],
      medRecords: [],
      batches: [],
      medNames: [],
    };
    await applyBackup(data);

    expect(await storage.get(STORAGE_KEYS.profiles)).toEqual(data.profiles);
    expect(await storage.get(STORAGE_KEYS.activeProfile)).toBe('p9');
    expect(await storage.get(STORAGE_KEYS.tempRecords)).toEqual([]);
  });

  it('createBackup 导出后可被 parseBackup 完整还原', async () => {
    const data: BackupData = {
      profiles: [{ id: 'p1', name: '本人', relation: '本人', note: '回归', createdAt: 1, updatedAt: 1 }],
      activeProfile: 'p1',
      tempRecords: [],
      medRecords: [],
      batches: [{ id: 'b1', profileId: 'p1', name: '批次A', note: '', createdAt: 1, updatedAt: 2 }],
      medNames: [{ id: 'm1', name: '布洛芬', manufacturer: '测试厂', expiryDate: '', createdAt: 1, updatedAt: 1 }],
    };
    await applyBackup(data);
    const { blob, fileName } = await createBackup();

    expect(fileName).toMatch(/^体温用药备份-\d{8}\.json$/);
    const result = parseBackup(await blob.text());
    expect(result.error).toBeNull();
    expect(result.data).toEqual(data);
  });
});
