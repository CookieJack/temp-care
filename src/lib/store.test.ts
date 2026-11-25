import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './storage';
import { createListStore } from './store';
import type { Profile } from './types';

function makeStore(seed?: Record<string, unknown>) {
  const storage = createMemoryStorage(seed);
  const store = createListStore<Profile>({
    storageKey: 'test_profiles',
    sortKey: 'createdAt',
    storage,
  });
  return { storage, store };
}

describe('createListStore', () => {
  it('create 生成「时间戳-序号」id 并写入创建/更新时间', async () => {
    const { store } = makeStore();
    const result = await store.create({ name: '本人', relation: '本人', note: '' });
    expect(result.error).toBeNull();
    expect(result.data?.id).toMatch(/^\d+-\d+$/);
    expect(result.data?.createdAt).toBeGreaterThan(0);
    expect(result.data?.createdAt).toBe(result.data?.updatedAt);

    const listed = await store.list();
    expect(listed.data).toHaveLength(1);
    expect(listed.data?.[0].name).toBe('本人');
  });

  it('create 拒绝空对象', async () => {
    const { store } = makeStore();
    const result = await store.create({});
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('list 按 sortKey 倒序，并过滤非法项、归一化 id 为字符串', async () => {
    const { store } = makeStore({
      test_profiles: [
        { id: 1, name: '旧', createdAt: 100, updatedAt: 100 },
        { id: 'a', name: '新', createdAt: 300, updatedAt: 300 },
        { id: 'b', name: '中', createdAt: 200, updatedAt: 200 },
        null,
        { name: '缺 id' },
      ],
    });
    const result = await store.list();
    expect(result.data?.map(item => item.name)).toEqual(['新', '中', '旧']);
    expect(result.data?.[2].id).toBe('1');
  });

  it('update 缺少 id / 空补丁 / 记录不存在分别返回对应错误码', async () => {
    const { store } = makeStore();
    const created = await store.create({ name: '本人' });
    const id = created.data?.id ?? '';

    expect((await store.update('', { name: 'x' })).error?.code).toBe('INVALID_ID');
    expect((await store.update(id, {})).error?.code).toBe('INVALID_PAYLOAD');
    expect((await store.update('missing', { name: 'x' })).error?.code).toBe('NOT_FOUND_OR_FORBIDDEN');

    const updated = await store.update(id, { name: '改名' });
    expect(updated.error).toBeNull();
    expect(updated.data?.name).toBe('改名');
    expect(updated.data?.updatedAt).toBeGreaterThanOrEqual(created.data?.updatedAt ?? 0);
  });

  it('remove 删除成功返回 removed=1，重复删除返回 NOT_FOUND', async () => {
    const { store } = makeStore();
    const created = await store.create({ name: '本人' });
    const id = created.data?.id ?? '';

    expect((await store.remove(id)).data).toEqual({ removed: 1 });
    expect((await store.remove(id)).error?.code).toBe('NOT_FOUND_OR_FORBIDDEN');
  });

  it('replace 整表替换并丢弃非法项', async () => {
    const { store } = makeStore();
    await store.create({ name: '本人' });
    const result = await store.replace([
      { id: 'x', name: '保留', relation: '本人', note: '', createdAt: 1, updatedAt: 1 },
      // @ts-expect-error 故意传入非法项，验证运行时过滤
      { name: '无 id' },
    ]);
    expect(result.data).toEqual({ count: 1 });
    const listed = await store.list();
    expect(listed.data?.map(item => item.name)).toEqual(['保留']);
  });

  it('存储异常收敛为 CLIENT_EXCEPTION', async () => {
    const store = createListStore<Profile>({
      storageKey: 'boom',
      storage: {
        get: async () => {
          throw new Error('读取失败');
        },
        set: async () => undefined,
        remove: async () => undefined,
      },
    });
    const result = await store.list();
    expect(result.error?.code).toBe('CLIENT_EXCEPTION');
    expect(result.error?.message).toBe('读取失败');
  });
});
