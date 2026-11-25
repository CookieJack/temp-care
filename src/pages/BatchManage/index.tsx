import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { MdField } from '../../components/MdField';
import { Sheet } from '../../components/Sheet';
import { StateCard } from '../../components/StateCard';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import {
  formatDateTime,
  formatShortDate,
  getActiveProfile,
  getActiveProfileId,
} from '../../lib/common';
import { batchDetailPath } from '../../lib/routes';
import { batchStore, medStore, profileStore, tempStore } from '../../lib/store';
import type { Batch, MedRecord, TempRecord, ViewState } from '../../lib/types';
import './index.css';

interface BatchItem {
  id: string;
  name: string;
  count: number;
  startText: string;
  updatedText: string;
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

export default function BatchManagePage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [items, setItems] = useState<BatchItem[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState('');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeProfileIdRef = useRef('');
  const rawBatchesRef = useRef<Batch[]>([]);
  const rawTempsRef = useRef<TempRecord[]>([]);
  const rawMedsRef = useRef<MedRecord[]>([]);

  const loadItems = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const [profileResult, batchResult, tempResult, medResult, storedActiveId] = await Promise.all([
      profileStore.list(),
      batchStore.list(),
      tempStore.list(),
      medStore.list(),
      getActiveProfileId(),
    ]);

    const results = [profileResult, batchResult, tempResult, medResult];
    const failed = results.find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, storedActiveId);
    if (!active) {
      activeProfileIdRef.current = '';
      rawBatchesRef.current = [];
      rawTempsRef.current = [];
      rawMedsRef.current = [];
      setProfileName('');
      setItems([]);
      setViewState('empty');
      return;
    }

    activeProfileIdRef.current = active.id;
    rawBatchesRef.current = (batchResult.data || []).filter(item => item.profileId === active.id);
    rawTempsRef.current = tempResult.data || [];
    rawMedsRef.current = medResult.data || [];

    setProfileName(active.name);
    setItems(
      rawBatchesRef.current.map(batch => ({
        id: batch.id,
        name: batch.name,
        count: countBatchRecords(batch.id, rawTempsRef.current, rawMedsRef.current),
        startText: formatBatchStart(batch.id, rawTempsRef.current, rawMedsRef.current),
        updatedText: formatDateTime(batch.updatedAt),
      }))
    );
    setViewState('ready');
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const openCreate = () => {
    setEditorMode('create');
    setEditingId('');
    setFormName('');
    setFormError('');
    setSubmitting(false);
    setSheetOpen(true);
  };

  const openRename = (batchId: string) => {
    const raw = rawBatchesRef.current.find(item => item.id === batchId);
    if (!raw) {
      return;
    }
    setEditorMode('edit');
    setEditingId(raw.id);
    setFormName(typeof raw.name === 'string' ? raw.name : '');
    setFormError('');
    setSubmitting(false);
    setSheetOpen(true);
  };

  const closeEditor = () => {
    if (submitting) {
      return;
    }
    setSheetOpen(false);
    setFormError('');
  };

  const handleSave = async () => {
    if (submitting) {
      return;
    }
    const name = formName.trim();
    if (name === '') {
      setFormError('请填写批次名称');
      return;
    }

    setSubmitting(true);
    setFormError('');
    const request =
      editorMode === 'edit'
        ? batchStore.update(editingId, { name })
        : batchStore.create({ profileId: activeProfileIdRef.current || '', name, note: '' });
    const result = await request;
    if (result.error) {
      setFormError(result.error.message || '保存失败，请稍后重试');
      setSubmitting(false);
      return;
    }

    setSheetOpen(false);
    setSubmitting(false);
    toast.show(editorMode === 'edit' ? '已重命名' : '已创建批次', 'success');
    void loadItems();
  };

  const handleDelete = async (batchId: string) => {
    const raw = rawBatchesRef.current.find(item => item.id === batchId);
    if (!raw) {
      return;
    }
    const count = countBatchRecords(batchId, rawTempsRef.current, rawMedsRef.current);
    const confirmed = await confirm({
      title: '确认删除批次',
      content:
        count > 0
          ? `删除「${raw.name}」将同时删除批次内的 ${count} 条体温与用药记录，删除后不可恢复！`
          : `删除「${raw.name}」后不可恢复，是否继续？`,
      confirmText: count > 0 ? '全部删除' : '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const remainingTemps = rawTempsRef.current.filter(item => item.batchId !== batchId);
    const remainingMeds = rawMedsRef.current.filter(item => item.batchId !== batchId);
    const results = await Promise.all([
      tempStore.replace(remainingTemps),
      medStore.replace(remainingMeds),
      batchStore.remove(batchId),
    ]);
    const failed = results.find(item => item.error);
    if (failed?.error) {
      toast.show(failed.error.message || '删除失败', 'error');
      void loadItems();
      return;
    }
    toast.show('已删除批次及内部记录', 'success');
    void loadItems();
  };

  return (
    <main className="page page-batches">
      <header className="md-head">
        <p className="md-head-eyebrow">BATCHES</p>
        <h1 className="md-head-title">记录批次</h1>
        <p className="md-head-sub">
          按病程或场景把记录归组 · 当前档案：{profileName || '—'}
        </p>
      </header>

      {viewState === 'loading' ? (
        <StateCard kind="loading" title="正在加载" description="请稍候。" />
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

      {viewState === 'empty' ? (
        <StateCard
          kind="empty"
          title="还没有批次"
          description="如「11月24日发烧」，把一段病程的体温与用药归在一起看。"
          actionLabel="新建批次"
          onAction={openCreate}
        />
      ) : null}

      {viewState === 'ready' ? (
        <section className="md-card">
          {items.map(item => (
            <div className="batch-row" key={item.id}>
              <Link className="batch-row-main" to={batchDetailPath(item.id)}>
                <div className="batch-item-lead">
                  <span className="section-emoji">📋</span>
                  <span className="batch-name">{item.name}</span>
                </div>
                <span className="batch-meta">
                  {item.count} 条记录
                  {item.startText !== '' ? ` · ${item.startText}` : ''}
                </span>
                <span className="batch-updated">更新于 {item.updatedText}</span>
              </Link>
              <div className="batch-actions">
                <button
                  type="button"
                  className="action-button btn-tonal"
                  onClick={() => openRename(item.id)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="action-button btn-error"
                  onClick={() => void handleDelete(item.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 ? (
            <div className="mini-empty">
              <p className="mini-empty-text">还没有批次，点右下角「+」新建一个。</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {viewState === 'ready' ? (
        <button type="button" className="fab" aria-label="新建批次" onClick={openCreate}>
          +
        </button>
      ) : null}

      <Sheet
        open={sheetOpen}
        title={editorMode === 'edit' ? '重命名批次' : '新建批次'}
        onClose={closeEditor}
        footer={
          <>
            <Button variant="tonal" onClick={closeEditor}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} loading={submitting}>
              {submitting ? '保存中…' : '保存'}
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
            value={formName}
            onChange={value => {
              setFormName(value);
              setFormError('');
            }}
          />
        </div>
      </Sheet>
    </main>
  );
}
