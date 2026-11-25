import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { MdField } from '../../components/MdField';
import { Sheet } from '../../components/Sheet';
import { StateCard } from '../../components/StateCard';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import { formatDateTime } from '../../lib/common';
import { medNameStore } from '../../lib/store';
import type { ViewState } from '../../lib/types';
import './index.css';

interface MedNameItem {
  id: string;
  name: string;
  manufacturer: string;
  expiryDate: string;
  expired: boolean;
  addedText: string;
}

function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function todayText(): string {
  const now = new Date();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

export default function MedNameManagePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const expiryInputId = useId();

  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [items, setItems] = useState<MedNameItem[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState('');
  const [formName, setFormName] = useState('');
  const [formManufacturer, setFormManufacturer] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadItems = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const result = await medNameStore.list();
    if (result.error) {
      setViewState('error');
      setErrorMessage(result.error.message || '加载失败，请稍后重试');
      return;
    }

    const today = todayText();
    const nextItems = (result.data || []).map(item => {
      const name = typeof item.name === 'string' ? item.name : '';
      const manufacturer = typeof item.manufacturer === 'string' ? item.manufacturer : '';
      const expiryDate = typeof item.expiryDate === 'string' ? item.expiryDate : '';
      return {
        id: item.id,
        name,
        manufacturer,
        expiryDate,
        // 过期时间早于今天视为已过期（标红提示）
        expired: expiryDate !== '' && expiryDate < today,
        addedText: formatDateTime(item.createdAt),
      };
    });

    setItems(nextItems);
    setViewState(nextItems.length === 0 ? 'empty' : 'ready');
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const openEditor = () => {
    setSheetOpen(true);
    setEditorMode('create');
    setEditingId('');
    setFormName('');
    setFormManufacturer('');
    setFormExpiryDate('');
    setFormError('');
    setSubmitting(false);
  };

  const openEdit = (itemId: string) => {
    const target = items.find(item => item.id === itemId);
    if (!target) {
      return;
    }
    setSheetOpen(true);
    setEditorMode('edit');
    setEditingId(target.id);
    setFormName(target.name);
    setFormManufacturer(target.manufacturer);
    setFormExpiryDate(target.expiryDate);
    setFormError('');
    setSubmitting(false);
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
      setFormError('请填写药品名称');
      return;
    }
    // 同名同厂商才算重复（同名不同厂商是不同药，允许并存），编辑时排除自身
    const manufacturer = formManufacturer.trim();
    const duplicated = items.some(
      item => item.name === name && (item.manufacturer || '') === manufacturer && item.id !== editingId
    );
    if (duplicated) {
      setFormError('同名同厂商的药品已在库中，请换一个名称或修改厂商');
      return;
    }

    const payload = {
      name,
      manufacturer,
      expiryDate: formExpiryDate || '',
    };

    setSubmitting(true);
    setFormError('');
    const result =
      editorMode === 'edit'
        ? await medNameStore.update(editingId, payload)
        : await medNameStore.create(payload);
    if (result.error) {
      setFormError(result.error.message || '保存失败，请稍后重试');
      setSubmitting(false);
      return;
    }

    setSheetOpen(false);
    setSubmitting(false);
    toast.show(editorMode === 'edit' ? '已更新' : '已加入药名库', 'success');
    void loadItems();
  };

  const handleDelete = async (itemId: string) => {
    const target = items.find(item => item.id === itemId);
    if (!target) {
      return;
    }
    const confirmed = await confirm({
      title: '确认移除',
      content: `从药名库移除「${target.name}」后，录入页的快捷选择中将不再出现；已有用药记录不受影响。`,
      confirmText: '移除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const result = await medNameStore.remove(itemId);
    if (result.error) {
      toast.show(result.error.message || '删除失败', 'error');
      return;
    }
    toast.show('已移除', 'success');
    void loadItems();
  };

  return (
    <main className="page page-med-names">
      <header className="md-head">
        <p className="md-head-eyebrow">MED NAME LIBRARY</p>
        <h1 className="md-head-title">药名库</h1>
        <p className="md-head-sub">录入页的快捷药名来自这里 · 保存记录时未收录的药名会自动加入</p>
      </header>

      {viewState === 'loading' ? (
        <StateCard kind="loading" title="正在加载" description="请稍候。" />
      ) : null}

      {viewState === 'empty' ? (
        <StateCard
          kind="empty"
          title="药名库还是空的"
          description="手动添加常用药品（可附厂商与效期），或在保存记录时自动记忆。"
          actionLabel="添加药品名称"
          onAction={openEditor}
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

      {viewState === 'ready' ? (
        <section className="md-card">
          <div className="section-head">
            <span className="section-title">已收录 {items.length} 个药名</span>
            <span className="section-hint">可编辑或移除</span>
          </div>
          {items.map(item => (
            <div className="name-item" key={item.id}>
              <div className="name-main">
                <div className="batch-item-lead">
                  <span className="section-emoji">💊</span>
                  <span className="name-text">{item.name}</span>
                </div>
                {item.manufacturer !== '' ? (
                  <span className="name-meta">厂商：{item.manufacturer}</span>
                ) : null}
                {item.expiryDate !== '' ? (
                  <span className={item.expired ? 'name-meta name-meta-warn' : 'name-meta'}>
                    有效期至 {item.expiryDate}
                    {item.expired ? '（已过期）' : ''}
                  </span>
                ) : null}
                <span className="name-added">加入于 {item.addedText}</span>
              </div>
              <div className="name-actions">
                <button
                  type="button"
                  className="action-button btn-tonal"
                  onClick={() => openEdit(item.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="action-button btn-error"
                  onClick={() => void handleDelete(item.id)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {viewState === 'ready' || viewState === 'empty' ? (
        <button type="button" className="fab" aria-label="添加药品名称" onClick={openEditor}>
          +
        </button>
      ) : null}

      <Sheet
        open={sheetOpen}
        title={editorMode === 'edit' ? '编辑药品名称' : '添加药品名称'}
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
            label="药品名称"
            placeholder="如 布洛芬混悬液"
            maxLength={40}
            value={formName}
            onChange={value => {
              setFormName(value);
              setFormError('');
            }}
          />
        </div>
        <div className="field-group">
          <MdField
            label="厂商名称"
            placeholder="如 XX制药"
            maxLength={40}
            value={formManufacturer}
            onChange={setFormManufacturer}
          />
        </div>
        <div className="field-group">
          <div className="md-field md-field-disabled">
            <label className="md-label" htmlFor={expiryInputId}>
              过期时间 <span className="optional">选填</span>
            </label>
            {formExpiryDate !== '' ? (
              <button
                type="button"
                className="clear-expiry"
                onClick={() => setFormExpiryDate('')}
              >
                清除
              </button>
            ) : null}
            <input
              id={expiryInputId}
              className="md-input"
              type="date"
              value={formExpiryDate}
              onChange={event => setFormExpiryDate(event.target.value)}
            />
          </div>
        </div>
      </Sheet>
    </main>
  );
}
