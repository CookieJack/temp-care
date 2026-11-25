import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StateCard } from '../../components/StateCard';
import { bootstrapApp } from '../../lib/bootstrap';
import { feverLevel, formatDateTime, getActiveProfile, getActiveProfileId } from '../../lib/common';
import { batchDetailPath } from '../../lib/routes';
import { batchStore, profileStore, tempStore } from '../../lib/store';
import type { TempRecord, ViewState } from '../../lib/types';
import './index.css';

interface TempItem {
  id: string;
  valueText: string;
  levelLabel: string;
  levelColor: string;
  timeText: string;
  methodText: string;
  noteText: string;
  medText: string;
}

interface TempGroup {
  id: string;
  name: string;
  items: TempItem[];
}

function mapTempItem(item: TempRecord): TempItem {
  const level = feverLevel(item.value);
  const linked = typeof item.medicationId === 'string' && item.medicationId !== '';
  return {
    id: item.id,
    valueText: Number.isFinite(Number(item.value)) ? Number(item.value).toFixed(1) : '--',
    levelLabel: level.label,
    levelColor: level.color,
    timeText: formatDateTime(item.measuredAt),
    methodText: typeof item.method === 'string' && item.method !== '' ? item.method : '未记录方式',
    noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
    medText: linked ? '已同步用药' : '',
  };
}

export default function TempHistoryPage() {
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [groups, setGroups] = useState<TempGroup[]>([]);

  const loadItems = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const [profileResult, tempResult, batchResult, storedActiveId] = await Promise.all([
      profileStore.list(),
      tempStore.list(),
      batchStore.list(),
      getActiveProfileId(),
    ]);

    const failed = [profileResult, tempResult, batchResult].find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, storedActiveId);
    if (!active) {
      setProfileName('');
      setGroups([]);
      setViewState('empty');
      return;
    }

    // 先为当前档案的每个批次建组（批次按更新时间倒序），未归组固定在最后
    const nextGroups: TempGroup[] = [];
    const groupMap: Record<string, TempGroup> = {};
    (batchResult.data || [])
      .filter(item => item.profileId === active.id)
      .forEach(batch => {
        const group: TempGroup = { id: batch.id, name: batch.name, items: [] };
        nextGroups.push(group);
        groupMap[batch.id] = group;
      });
    const ungrouped: TempGroup = { id: '', name: '未归组', items: [] };
    nextGroups.push(ungrouped);
    groupMap[''] = ungrouped;

    (tempResult.data || [])
      .filter(item => item.profileId === active.id)
      .forEach(item => {
        const key = typeof item.batchId === 'string' ? item.batchId : '';
        const group = groupMap[key] || ungrouped;
        group.items.push(mapTempItem(item));
      });

    const visibleGroups = nextGroups.filter(group => group.items.length > 0);
    setProfileName(active.name);
    setGroups(visibleGroups);
    setViewState(visibleGroups.length === 0 ? 'empty' : 'ready');
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  return (
    <main className="page">
      <header className="md-head">
        <p className="md-head-eyebrow">TEMPERATURE</p>
        <h1 className="md-head-title">体温历史</h1>
        <p className="md-head-sub">
          按批次分组只读查看 · 编辑或删除请进入所属批次 · 当前档案：{profileName || '—'}
        </p>
      </header>

      {viewState === 'loading' ? (
        <StateCard kind="loading" title="正在加载" description="请稍候，记录马上准备好。" />
      ) : null}

      {viewState === 'empty' ? (
        <StateCard
          kind="empty"
          title="暂无体温记录"
          description="在批次内快速记录后，这里会按批次分组显示。"
        />
      ) : null}

      {viewState === 'error' ? (
        <StateCard
          kind="error"
          title="加载失败"
          description={errorMessage}
          actionLabel="重试"
          onAction={() => void loadItems()}
        />
      ) : null}

      {viewState === 'ready'
        ? groups.map(group => (
            <section className="md-card" key={group.id || 'ungrouped'}>
              {group.id !== '' ? (
                <Link className="section-head group-head" to={batchDetailPath(group.id)}>
                  <div className="section-lead">
                    <span className="section-emoji">🌡️</span>
                    <span className="section-title">{group.name}</span>
                  </div>
                  <span className="section-link">{group.items.length} 条 · 查看 ›</span>
                </Link>
              ) : (
                <div className="section-head group-head">
                  <div className="section-lead">
                    <span className="section-emoji">🗂️</span>
                    <span className="section-title">{group.name}</span>
                  </div>
                  <span className="section-hint">{group.items.length} 条</span>
                </div>
              )}
              {group.items.map(record => (
                <div className="list-item" key={record.id}>
                  <div className="list-main">
                    <div className="temp-line">
                      <span className="temp-value" style={{ color: record.levelColor }}>
                        {record.valueText}°C
                      </span>
                      <span
                        className="level-badge"
                        style={{ backgroundColor: record.levelColor }}
                      >
                        {record.levelLabel}
                      </span>
                      {record.medText !== '' ? <span className="med-tag">{record.medText}</span> : null}
                    </div>
                    <span className="item-time">
                      {record.timeText} · {record.methodText}
                    </span>
                    {record.noteText !== '' ? <span className="item-note">{record.noteText}</span> : null}
                  </div>
                </div>
              ))}
            </section>
          ))
        : null}
    </main>
  );
}
