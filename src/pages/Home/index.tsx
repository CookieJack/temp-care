import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { MdField } from '../../components/MdField';
import { Sheet } from '../../components/Sheet';
import { StateCard } from '../../components/StateCard';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import {
  feverLevel,
  formatShortDate,
  getActiveProfile,
  getActiveProfileId,
  todayStart,
} from '../../lib/common';
import { batchDetailPath, ROUTES } from '../../lib/routes';
import { batchStore, medStore, profileStore, tempStore } from '../../lib/store';
import type { MedRecord, Profile, TempRecord, ViewState } from '../../lib/types';
import './index.css';

interface BatchItem {
  id: string;
  name: string;
  count: number;
  startText: string;
}

const CROSS_VIEWS = [
  { key: 'temp', text: '体温历史', path: ROUTES.tempHistory, emoji: '🌡️' },
  { key: 'med', text: '用药历史', path: ROUTES.medHistory, emoji: '💊' },
  { key: 'medNames', text: '药名库', path: ROUTES.medNameManage, emoji: '📖' },
  { key: 'chart', text: '体温图表', path: ROUTES.chartReport, emoji: '📊' },
];

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function countBatchRecords(batchId: string, temps: TempRecord[], meds: MedRecord[]): number {
  let count = 0;
  temps.forEach(item => {
    if (item.batchId === batchId) {
      count += 1;
    }
  });
  meds.forEach(item => {
    if (item.batchId === batchId) {
      count += 1;
    }
  });
  return count;
}

function formatBatchStart(batchId: string, temps: TempRecord[], meds: MedRecord[]): string {
  let earliest = NaN;
  temps.forEach(item => {
    const ts = Number(item.measuredAt);
    if (item.batchId === batchId && Number.isFinite(ts) && (Number.isNaN(earliest) || ts < earliest)) {
      earliest = ts;
    }
  });
  meds.forEach(item => {
    const ts = Number(item.takenAt);
    if (item.batchId === batchId && Number.isFinite(ts) && (Number.isNaN(earliest) || ts < earliest)) {
      earliest = ts;
    }
  });
  return Number.isFinite(earliest) ? '起于 ' + formatShortDate(earliest) : '';
}

export default function HomePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [todayTempCount, setTodayTempCount] = useState(0);
  const [todayMedCount, setTodayMedCount] = useState(0);
  const [latestTemp, setLatestTemp] = useState<{ valueText: string; color: string } | null>(null);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const [profileResult, tempResult, medResult, batchResult, storedActiveId] = await Promise.all([
      profileStore.list(),
      tempStore.list(),
      medStore.list(),
      batchStore.list(),
      getActiveProfileId(),
    ]);

    const results = [profileResult, tempResult, medResult, batchResult];
    const failed = results.find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, storedActiveId);
    if (!active) {
      setProfile(null);
      setActiveProfileId('');
      setViewState('empty');
      return;
    }

    const profileId = active.id;
    const today = todayStart();
    const temps = (tempResult.data || []).filter(item => item.profileId === profileId);
    const meds = (medResult.data || []).filter(item => item.profileId === profileId);

    const todayTemps = temps.filter(item => toNumber(item.measuredAt) >= today).length;
    const todayMeds = meds.filter(item => toNumber(item.takenAt) >= today).length;

    let latest: { valueText: string; color: string } | null = null;
    if (temps.length > 0) {
      const value = Number(temps[0].value);
      latest = {
        valueText: Number.isFinite(value) ? value.toFixed(1) : '--',
        color: feverLevel(temps[0].value).color,
      };
    }

    const batches = (batchResult.data || []).filter(item => item.profileId === profileId);
    const items = batches.map(batch => ({
      id: batch.id,
      name: batch.name,
      count: countBatchRecords(batch.id, temps, meds),
      startText: formatBatchStart(batch.id, temps, meds),
    }));

    setProfile(active);
    setActiveProfileId(profileId);
    setTodayTempCount(todayTemps);
    setTodayMedCount(todayMeds);
    setLatestTemp(latest);
    setBatchItems(items);
    setViewState('ready');
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openBatchEditor = () => {
    setSheetOpen(true);
    setBatchName('');
    setFormError('');
    setSubmitting(false);
  };

  const closeBatchEditor = () => {
    if (submitting) {
      return;
    }
    setSheetOpen(false);
    setFormError('');
  };

  const handleCreateBatch = async () => {
    if (submitting) {
      return;
    }
    const name = batchName.trim();
    if (name === '') {
      setFormError('请填写批次名称');
      return;
    }
    setSubmitting(true);
    setFormError('');
    const result = await batchStore.create({ profileId: activeProfileId, name, note: '' });
    if (result.error) {
      setFormError(result.error.message || '保存失败，请稍后重试');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setSheetOpen(false);
    setBatchName('');
    toast.show('已创建批次', 'success');
    void loadData();
  };

  if (viewState === 'loading') {
    return (
      <main className="page">
        <StateCard kind="loading" title="正在加载" description="请稍候，数据马上准备好。" />
      </main>
    );
  }

  if (viewState === 'error') {
    return (
      <main className="page">
        <StateCard
          kind="error"
          title="加载失败"
          description={errorMessage}
          actionLabel="重试"
          onAction={() => void loadData()}
        />
      </main>
    );
  }

  if (viewState === 'empty' || !profile) {
    return (
      <main className="page">
        <StateCard
          kind="empty"
          title="还没有档案"
          description="先为自己或家人创建一个健康档案，再开始记录。"
          actionLabel="去创建档案"
          onAction={() => navigate(ROUTES.profileManage)}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="md-head">
        <p className="md-head-eyebrow">HEALTH RECORD</p>
        <h1 className="md-head-title">体温用药记录</h1>
      </header>

      <Link className="profile-card" to={ROUTES.profileManage}>
        <div className="profile-row">
          <span className="profile-name">{profile.name}</span>
          <span className="profile-badge">{profile.relation}</span>
          <span className="profile-switch">切换 ›</span>
        </div>
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat-value">{todayTempCount}</span>
            <span className="profile-stat-label">今日体温</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">{todayMedCount}</span>
            <span className="profile-stat-label">今日用药</span>
          </div>
          <div className="profile-stat">
            <span
              className="profile-stat-value"
              style={latestTemp ? { color: latestTemp.color } : undefined}
            >
              {latestTemp ? latestTemp.valueText : '--'}
            </span>
            <span className="profile-stat-label">最近体温</span>
          </div>
        </div>
      </Link>

      <section className="md-card">
        <div className="section-head">
          <div className="section-lead">
            <span className="section-emoji">📋</span>
            <span className="section-title">记录批次</span>
          </div>
          <Link className="section-link" to={ROUTES.batchManage}>
            管理 ›
          </Link>
        </div>

        {batchItems.length === 0 ? (
          <div className="mini-empty">
            <p className="mini-empty-text">
              还没有批次。一段病程或一次体检建一个批次，把相关记录归在一起看。
            </p>
          </div>
        ) : (
          <div className="batch-list">
            {batchItems.map(item => (
              <Link className="batch-item" key={item.id} to={batchDetailPath(item.id)}>
                <div className="batch-main">
                  <div className="batch-item-lead">
                    <span className="section-emoji">📋</span>
                    <span className="batch-name">{item.name}</span>
                  </div>
                  <span className="batch-meta">
                    {item.count} 条记录
                    {item.startText !== '' ? ` · ${item.startText}` : ''}
                  </span>
                </div>
                <span className="batch-arrow">›</span>
              </Link>
            ))}
          </div>
        )}

        <button type="button" className="batch-add" onClick={openBatchEditor}>
          ＋ 添加批次
        </button>
      </section>

      <nav className="quick-grid">
        {CROSS_VIEWS.map(item => (
          <Link className="quick-item" key={item.key} to={item.path}>
            <span className="quick-emoji">{item.emoji}</span>
            <span className="quick-text">{item.text}</span>
          </Link>
        ))}
      </nav>

      <Sheet
        open={sheetOpen}
        title="新建批次"
        onClose={closeBatchEditor}
        footer={
          <>
            <Button variant="tonal" onClick={closeBatchEditor}>
              取消
            </Button>
            <Button onClick={() => void handleCreateBatch()} loading={submitting}>
              {submitting ? '保存中…' : '创建'}
            </Button>
          </>
        }
      >
        {formError !== '' ? <p className="sheet-error">{formError}</p> : null}
        <div className="field-group first">
          <MdField
            label="批次名称"
            placeholder="如 11月24日发烧 / 体检周期"
            maxLength={30}
            value={batchName}
            onChange={value => {
              setBatchName(value);
              setFormError('');
            }}
          />
        </div>
      </Sheet>
    </main>
  );
}
