import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { useConfirm } from '../../components/ConfirmDialog';
import { MdField, MdTextArea } from '../../components/MdField';
import { Sheet } from '../../components/Sheet';
import { StateCard } from '../../components/StateCard';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import { applyBackup, createBackup, parseBackup } from '../../lib/backup';
import { getActiveProfileId, RELATIONS, setActiveProfileId } from '../../lib/common';
import { medStore, profileStore, tempStore } from '../../lib/store';
import type { MedRecord, Profile, TempRecord, ViewState } from '../../lib/types';
import './index.css';

interface ProfileItem {
  id: string;
  name: string;
  relation: string;
  isActive: boolean;
  count: number;
}

function countRecords(profileId: string, temps: TempRecord[], meds: MedRecord[]): number {
  let count = 0;
  temps.forEach(item => {
    if (item.profileId === profileId) {
      count += 1;
    }
  });
  meds.forEach(item => {
    if (item.profileId === profileId) {
      count += 1;
    }
  });
  return count;
}

export default function ProfileManagePage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [items, setItems] = useState<ProfileItem[]>([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState('');
  const [formName, setFormName] = useState('');
  const [formRelationIndex, setFormRelationIndex] = useState(0);
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const rawProfilesRef = useRef<Profile[]>([]);
  const rawTempsRef = useRef<TempRecord[]>([]);
  const rawMedsRef = useRef<MedRecord[]>([]);
  const activeIdRef = useRef('');

  const loadItems = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const [profileResult, tempResult, medResult, storedActiveId] = await Promise.all([
      profileStore.list(),
      tempStore.list(),
      medStore.list(),
      getActiveProfileId(),
    ]);

    const failed = [profileResult, tempResult, medResult].find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    rawProfilesRef.current = profileResult.data || [];
    rawTempsRef.current = tempResult.data || [];
    rawMedsRef.current = medResult.data || [];
    activeIdRef.current = storedActiveId;

    setItems(
      rawProfilesRef.current.map(profile => ({
        id: profile.id,
        name: profile.name,
        relation: profile.relation,
        isActive: profile.id === storedActiveId,
        count: countRecords(profile.id, rawTempsRef.current, rawMedsRef.current),
      }))
    );
    setViewState('ready');
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const findRawById = (itemId: string) => rawProfilesRef.current.find(item => item.id === itemId) ?? null;

  const openCreate = () => {
    setSheetOpen(true);
    setEditorMode('create');
    setEditingId('');
    setFormName('');
    setFormRelationIndex(0);
    setFormNote('');
    setFormError('');
    setSubmitting(false);
  };

  const openEdit = (itemId: string) => {
    const raw = findRawById(itemId);
    if (!raw) {
      return;
    }
    setSheetOpen(true);
    setEditorMode('edit');
    setEditingId(raw.id);
    setFormName(typeof raw.name === 'string' ? raw.name : '');
    setFormRelationIndex(
      Math.max(0, (RELATIONS as readonly string[]).indexOf(typeof raw.relation === 'string' ? raw.relation : ''))
    );
    setFormNote(typeof raw.note === 'string' ? raw.note : '');
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
      setFormError('请填写称呼');
      return;
    }
    const payload = {
      name,
      relation: RELATIONS[formRelationIndex] || RELATIONS[0],
      note: formNote.trim(),
    };

    setSubmitting(true);
    setFormError('');
    const result =
      editorMode === 'edit'
        ? await profileStore.update(editingId, payload)
        : await profileStore.create(payload);
    if (result.error) {
      setFormError(result.error.message || '保存失败，请稍后重试');
      setSubmitting(false);
      return;
    }

    // 新建第一个档案或当前档案缺失时，把新档案设为当前
    if (editorMode === 'create' && result.data) {
      const hasActive = items.some(item => item.isActive);
      if (!hasActive) {
        await setActiveProfileId(result.data.id);
      }
    }

    setSheetOpen(false);
    setSubmitting(false);
    toast.show(editorMode === 'edit' ? '已更新档案' : '已创建档案', 'success');
    void loadItems();
  };

  const handleSwitch = async (itemId: string) => {
    if (itemId === '') {
      return;
    }
    await setActiveProfileId(itemId);
    activeIdRef.current = itemId;
    toast.show('已切换当前档案', 'success');
    void loadItems();
  };

  const handleDelete = async (itemId: string) => {
    const raw = findRawById(itemId);
    if (!raw) {
      return;
    }
    const count = countRecords(itemId, rawTempsRef.current, rawMedsRef.current);
    const confirmed = await confirm({
      title: '确认删除档案',
      content:
        count > 0
          ? `删除「${raw.name}」将同时删除其 ${count} 条体温与用药记录，不可恢复。`
          : `删除「${raw.name}」后不可恢复，是否继续？`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const keepTemps = rawTempsRef.current.filter(item => item.profileId !== itemId);
    const keepMeds = rawMedsRef.current.filter(item => item.profileId !== itemId);
    const results = await Promise.all([
      tempStore.replace(keepTemps),
      medStore.replace(keepMeds),
      profileStore.remove(itemId),
    ]);
    const failed = results.find(item => item.error);
    if (failed?.error) {
      toast.show(failed.error.message || '删除失败', 'error');
      void loadItems();
      return;
    }

    const wasActive = activeIdRef.current === itemId;
    const remaining = items.filter(item => item.id !== itemId);
    if (wasActive && remaining.length > 0) {
      await setActiveProfileId(remaining[0].id);
      activeIdRef.current = remaining[0].id;
    }
    toast.show('已删除档案', 'success');
    void loadItems();
  };

  // ---- 数据备份 ----

  const handleExportBackup = async () => {
    if (backupBusy) {
      return;
    }
    setBackupBusy(true);
    try {
      const { blob, fileName } = await createBackup();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.show('已导出备份文件', 'success');
    } catch (error) {
      toast.show(error instanceof Error && error.message ? error.message : '导出失败', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 清空 value，便于连续选择同一个文件
    event.target.value = '';
    if (!file || backupBusy) {
      return;
    }
    setBackupBusy(true);
    try {
      const text = await file.text();
      const { data, error } = parseBackup(text);
      if (error !== null || !data) {
        toast.show(error ?? '备份文件无效', 'error');
        return;
      }
      const confirmed = await confirm({
        title: '导入备份',
        content: `将覆盖当前全部数据（${data.profiles.length} 个档案、${data.tempRecords.length} 条体温、${data.medRecords.length} 条用药），是否继续？`,
        confirmText: '覆盖导入',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await applyBackup(data);
      toast.show('已导入备份', 'success');
      await loadItems();
    } catch (error) {
      toast.show(error instanceof Error && error.message ? error.message : '导入失败', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <main className="page page-profiles">
      <header className="md-head">
        <p className="md-head-eyebrow">PROFILES</p>
        <h1 className="md-head-title">档案管理</h1>
        <p className="md-head-sub">为自己或家人分别建立档案，数据按档案分开记录</p>
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

      {viewState === 'ready' ? (
        <section className="md-card">
          {items.length === 0 ? (
            <div className="list-empty">
              <p className="list-empty-text">还没有档案，点「新建档案」创建第一个。</p>
            </div>
          ) : null}
          {items.map(item => (
            <div className="profile-item" key={item.id}>
              <div className="profile-main">
                <div className="profile-line">
                  <span className="profile-name">{item.name}</span>
                  <span className="profile-badge">{item.relation}</span>
                  {item.isActive ? <span className="active-badge">当前使用</span> : null}
                </div>
                <span className="profile-count">{item.count} 条记录</span>
              </div>
              <div className="profile-actions">
                {!item.isActive ? (
                  <button
                    type="button"
                    className="action-button btn-tonal"
                    onClick={() => void handleSwitch(item.id)}
                  >
                    设为当前
                  </button>
                ) : null}
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
                  删除
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {viewState === 'ready' ? (
        <section className="md-card backup-card">
          <div className="section-head">
            <div className="section-lead">
              <span className="section-emoji">🛟</span>
              <span className="section-title">数据备份</span>
            </div>
            <span className="section-hint">换设备 / 清理缓存前建议导出</span>
          </div>
          <p className="backup-desc">
            所有数据仅保存在本机浏览器，不会上传。导出 JSON 备份可在新设备或清理缓存后恢复。
          </p>
          <div className="backup-actions">
            <Button variant="tonal" loading={backupBusy} onClick={() => void handleExportBackup()}>
              导出备份
            </Button>
            <Button
              variant="tonal"
              disabled={backupBusy}
              onClick={() => importInputRef.current?.click()}
            >
              导入备份
            </Button>
          </div>
          <input
            ref={importInputRef}
            className="backup-file"
            type="file"
            accept=".json,application/json"
            onChange={event => void handleImportFile(event)}
          />
        </section>
      ) : null}

      {viewState === 'ready' ? (
        <button type="button" className="fab" aria-label="新建档案" onClick={openCreate}>
          +
        </button>
      ) : null}

      <Sheet
        open={sheetOpen}
        title={editorMode === 'edit' ? '编辑档案' : '新建档案'}
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
            label="称呼"
            placeholder="如 本人 / 妈妈 / 小宝"
            maxLength={20}
            value={formName}
            onChange={value => {
              setFormName(value);
              setFormError('');
            }}
          />
        </div>
        <div className="field-group">
          <p className="field-label">与我的关系</p>
          <div className="chip-row">
            {RELATIONS.map((relation, index) => (
              <Chip
                key={relation}
                label={relation}
                selected={formRelationIndex === index}
                onClick={() => setFormRelationIndex(index)}
              />
            ))}
          </div>
        </div>
        <div className="field-group">
          <MdTextArea
            label="备注"
            placeholder="可选，如出生年份、过敏史等"
            maxLength={200}
            value={formNote}
            onChange={setFormNote}
          />
        </div>
      </Sheet>
    </main>
  );
}
