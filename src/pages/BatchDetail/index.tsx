import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { useActionSheet } from '../../components/ActionSheet';
import type { ActionSheetItem } from '../../components/ActionSheet';
import { useConfirm } from '../../components/ConfirmDialog';
import { DoseStepper } from '../../components/DoseStepper';
import { DateTimeField, MdField, MdTextArea } from '../../components/MdField';
import { Sheet } from '../../components/Sheet';
import { StateCard } from '../../components/StateCard';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import {
  collectMedNameSuggestions,
  collectNewMedNames,
  dateTimeToTs,
  formatClock,
  formatDateTime,
  formatDose,
  feverLevel,
  getActiveProfile,
  getActiveProfileId,
  sortByTimeAsc,
} from '../../lib/common';
import type { MedNameSuggestion } from '../../lib/common';
import { recordPath, ROUTES } from '../../lib/routes';
import { exportBatchToPdf } from '../../lib/pdf/export';
import { batchStore, medNameStore, medStore, profileStore, tempStore } from '../../lib/store';
import { FEVER_BURST, MEASURE_METHODS, MED_UNITS } from '../../lib/types';
import type { MedRecord, StoreError, TempRecord, ViewState } from '../../lib/types';
import './index.css';

interface TimelineBase {
  id: string;
  kind: 'temp' | 'med';
  ts: number;
  dateText: string;
  timeText: string;
  showDateHead: boolean;
}

interface TempTimeline extends TimelineBase {
  kind: 'temp';
  valueText: string;
  levelLabel: string;
  levelColor: string;
  methodText: string;
  noteText: string;
  hasMed: boolean;
}

interface MedTimeline extends TimelineBase {
  kind: 'med';
  name: string;
  manufacturer: string;
  doseText: string;
  noteText: string;
  sourceLabel: string;
}

type TimelineItem = TempTimeline | MedTimeline;

interface TempMedEntry {
  key: number;
  medId: string;
  name: string;
  manufacturer: string;
  dose: string;
  unitIndex: number;
  note: string;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function formatDateLabel(ts: number): string {
  const date = new Date(toNumber(ts));
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function mapTempItem(item: TempRecord): TempTimeline {
  const level = feverLevel(item.value);
  const ts = toNumber(item.measuredAt);
  return {
    id: item.id,
    kind: 'temp',
    ts,
    dateText: formatDateLabel(ts),
    timeText: formatClock(ts),
    showDateHead: false,
    valueText: Number.isFinite(Number(item.value)) ? Number(item.value).toFixed(1) : '--',
    levelLabel: level.label,
    levelColor: level.color,
    methodText: typeof item.method === 'string' && item.method !== '' ? item.method : '未记录方式',
    noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
    hasMed: typeof item.medicationId === 'string' && item.medicationId !== '',
  };
}

function mapMedItem(item: MedRecord): MedTimeline {
  const ts = toNumber(item.takenAt);
  return {
    id: item.id,
    kind: 'med',
    ts,
    dateText: formatDateLabel(ts),
    timeText: formatClock(ts),
    showDateHead: false,
    name: typeof item.name === 'string' && item.name !== '' ? item.name : '未命名药品',
    manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : '',
    doseText: formatDose(item.dose, item.unit),
    noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
    sourceLabel: item.source === 'temp-link' ? '体温联动' : '',
  };
}

export default function BatchDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const actionSheet = useActionSheet();

  const batchId = searchParams.get('id') ?? '';

  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [batchName, setBatchName] = useState('');
  const [profileName, setProfileName] = useState('');
  const [tempCount, setTempCount] = useState(0);
  const [medCount, setMedCount] = useState(0);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [medSuggestions, setMedSuggestions] = useState<MedNameSuggestion[]>([]);

  const activeProfileIdRef = useRef('');
  const rawTempsRef = useRef<TempRecord[]>([]);
  const rawMedsRef = useRef<MedRecord[]>([]);

  // ---- 体温编辑弹层 ----
  const [tempEditorOpen, setTempEditorOpen] = useState(false);
  const [editingTempId, setEditingTempId] = useState('');
  const [tMeds, setTMeds] = useState<TempMedEntry[]>([]);
  const [tValue, setTValue] = useState('');
  const [tDate, setTDate] = useState('');
  const [tTime, setTTime] = useState('');
  const [tMethodIndex, setTMethodIndex] = useState(0);
  const [tNote, setTNote] = useState('');
  const [tSync, setTSync] = useState(false);
  const [syncHint, setSyncHint] = useState('');
  const [tError, setTError] = useState('');
  const [tempSubmitting, setTempSubmitting] = useState(false);

  const linkedMedIdsRef = useRef<string[]>([]);
  const syncAutoShownRef = useRef(false);
  const medKeySeedRef = useRef(1);

  // ---- 用药编辑弹层 ----
  const [medEditorOpen, setMedEditorOpen] = useState(false);
  const [editingMedRecId, setEditingMedRecId] = useState('');
  const [mName, setMName] = useState('');
  const [mManufacturer, setMManufacturer] = useState('');
  const [mDose, setMDose] = useState('');
  const [mUnitIndex, setMUnitIndex] = useState(0);
  const [mDate, setMDate] = useState('');
  const [mTime, setMTime] = useState('');
  const [mNote, setMNote] = useState('');
  const [mError, setMError] = useState('');
  const [medSubmitting, setMedSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    await bootstrapApp();
    const [profileResult, batchResult, tempResult, medResult, libraryResult, storedActiveId] =
      await Promise.all([
        profileStore.list(),
        batchStore.list(),
        tempStore.list(),
        medStore.list(),
        medNameStore.list(),
        getActiveProfileId(),
      ]);

    const results = [profileResult, batchResult, tempResult, medResult, libraryResult];
    const failed = results.find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, storedActiveId);
    const batch = (batchResult.data || []).find(item => item.id === batchId) ?? null;

    // 批次可能已被删除、或与当前档案不匹配
    if (!batch || !active || batch.profileId !== active.id) {
      setBatchName('');
      setViewState('empty');
      return;
    }

    activeProfileIdRef.current = active.id;
    const temps = sortByTimeAsc(
      (tempResult.data || []).filter(item => item.batchId === batchId),
      'measuredAt'
    );
    const meds = sortByTimeAsc(
      (medResult.data || []).filter(item => item.batchId === batchId),
      'takenAt'
    );
    rawTempsRef.current = temps;
    rawMedsRef.current = meds;

    // 合并时间轴：体温与用药按时间正序统一排列
    const merged: TimelineItem[] = [
      ...temps.map(mapTempItem),
      ...meds.map(mapMedItem),
    ].sort((left, right) => toNumber(left.ts) - toNumber(right.ts));
    let lastDate = '';
    merged.forEach(item => {
      item.showDateHead = item.dateText !== lastDate;
      lastDate = item.dateText;
    });

    const suggestions = collectMedNameSuggestions(
      libraryResult.data || [],
      (medResult.data || []).filter(item => item.profileId === active.id),
      8
    );

    setBatchName(batch.name);
    setProfileName(active.name);
    setTempCount(temps.length);
    setMedCount(meds.length);
    setTimeline(merged);
    setMedSuggestions(suggestions);
    setViewState('ready');
  }, [batchId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rememberMedNames = (entries: Array<{ name: string; manufacturer: string }>) => {
    void medNameStore
      .list()
      .then(async result => {
        const fresh = collectNewMedNames(entries, result.data || []);
        if (fresh.length === 0) {
          return;
        }
        await Promise.all(
          fresh.map(item => medNameStore.create({ name: item.name, manufacturer: item.manufacturer }))
        );
      })
      .catch(() => undefined);
  };

  // ---- PDF 导出 ----

  const handleExportPdf = async () => {
    if (exporting || viewState !== 'ready') {
      return;
    }
    setExporting(true);
    try {
      const result = await exportBatchToPdf({
        batchName,
        profileName,
        exportTimeText: formatDateTime(Date.now()),
        tempCount,
        medCount,
        timeline,
      });
      const pdfFile = new File([result.blob], result.fileName, { type: 'application/pdf' });
      const items: ActionSheetItem[] = [
        { key: 'preview', label: '打开预览', description: `共 ${result.pageCount} 页` },
        { key: 'download', label: '下载 PDF', description: result.fileName },
      ];
      const canShare =
        typeof navigator.canShare === 'function' &&
        typeof navigator.share === 'function' &&
        navigator.canShare({ files: [pdfFile] });
      if (canShare) {
        items.push({ key: 'share', label: '系统分享' });
      }

      const choice = await actionSheet({ title: 'PDF 已生成', items });
      if (choice === 'preview') {
        const url = URL.createObjectURL(result.blob);
        const opened = window.open(url, '_blank');
        if (!opened) {
          toast.show('浏览器阻止了预览窗口，请改用下载', 'error');
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (choice === 'download') {
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast.show('已开始下载 PDF', 'success');
      } else if (choice === 'share') {
        try {
          await navigator.share({ files: [pdfFile], title: result.fileName });
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            toast.show('分享失败，请改用下载', 'error');
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '导出失败，请稍后重试';
      toast.show(message, 'error');
    } finally {
      setExporting(false);
    }
  };

  // ---- 体温编辑 ----

  const openTempEdit = async (tempId: string) => {
    const raw = rawTempsRef.current.find(item => item.id === tempId);
    if (!raw) {
      return;
    }
    syncAutoShownRef.current = false;
    medKeySeedRef.current = 1;

    const editingMedId = typeof raw.medicationId === 'string' ? raw.medicationId : '';
    const medResult = await medStore.list();
    const allMeds = medResult.data || [];
    let linkedMeds = allMeds.filter(item => item.tempId === raw.id);
    if (linkedMeds.length === 0 && editingMedId !== '') {
      const med = allMeds.find(item => item.id === editingMedId);
      if (med) {
        linkedMeds = [med];
      }
    }
    linkedMedIdsRef.current = linkedMeds.map(item => item.id);

    let entries: TempMedEntry[] = linkedMeds.map(item => {
      medKeySeedRef.current += 1;
      return {
        key: medKeySeedRef.current,
        medId: item.id,
        name: typeof item.name === 'string' ? item.name : '',
        manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : '',
        dose: Number.isFinite(Number(item.dose)) && Number(item.dose) > 0 ? String(item.dose) : '',
        unitIndex: Math.max(0, (MED_UNITS as readonly string[]).indexOf(item.unit)),
        note: typeof item.note === 'string' ? item.note : '',
      };
    });
    if (entries.length === 0) {
      medKeySeedRef.current += 1;
      entries = [
        {
          key: medKeySeedRef.current,
          medId: '',
          name: '',
          manufacturer: '',
          dose: '',
          unitIndex: 0,
          note: '',
        },
      ];
    }

    const measured = new Date(toNumber(raw.measuredAt));
    setEditingTempId(raw.id);
    setTMeds(entries);
    setTValue(Number.isFinite(Number(raw.value)) ? String(raw.value) : '');
    setTDate(
      `${measured.getFullYear()}-${pad(measured.getMonth() + 1)}-${pad(measured.getDate())}`
    );
    setTTime(`${pad(measured.getHours())}:${pad(measured.getMinutes())}`);
    setTMethodIndex(
      Math.max(0, (MEASURE_METHODS as readonly string[]).indexOf(raw.method))
    );
    setTNote(typeof raw.note === 'string' ? raw.note : '');
    setTSync(linkedMeds.length > 0);
    setSyncHint('');
    setTError('');
    setTempSubmitting(false);
    setTempEditorOpen(true);
  };

  const handleTValueInput = (text: string) => {
    setTValue(text);
    setTError('');
    const num = Number(text);
    // 体温不可能超过 45°C
    if (Number.isFinite(num) && num > 45) {
      setTError('体温上限为 45°C，请检查输入');
      return;
    }
    // 体温 ≥ 38.5°C 自动提示并展开同步用药
    if (Number.isFinite(num) && num >= FEVER_BURST && !tSync && !syncAutoShownRef.current) {
      setTSync(true);
      setSyncHint('体温 ≥ 38.5°C，已自动开启同步记录用药');
      syncAutoShownRef.current = true;
    }
  };

  const handleSyncChange = () => {
    const next = !tSync;
    setTSync(next);
    setTError('');
    if (!next) {
      setSyncHint('');
      syncAutoShownRef.current = false;
    }
  };

  const updateTempMedItem = (index: number, patch: Partial<TempMedEntry>) => {
    setTMeds(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setTError('');
  };

  const addTempMedItem = () => {
    medKeySeedRef.current += 1;
    const entry: TempMedEntry = {
      key: medKeySeedRef.current,
      medId: '',
      name: '',
      manufacturer: '',
      dose: '',
      unitIndex: 0,
      note: '',
    };
    setTMeds(prev => prev.concat([entry]));
    setTError('');
  };

  const removeTempMedItem = (index: number) => {
    setTMeds(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    setTError('');
  };

  const doseToNumber = (doseText: string): number => {
    const dose = Number(doseText);
    return Number.isFinite(dose) && dose > 0 ? dose : 0;
  };

  const handleTempSave = async () => {
    if (tempSubmitting) {
      return;
    }
    const value = Number(tValue);
    if (!Number.isFinite(value) || value < 30 || value > 45) {
      setTError('体温需为 30–45°C 之间的数值，请检查后保存');
      return;
    }
    const syncMed = tSync === true;

    // 收集有效药物条目：药名或剂量任一非空视为填写意图
    const medEntries = tMeds
      .map((item, index) => ({
        index,
        medId: typeof item.medId === 'string' ? item.medId : '',
        name: item.name.trim(),
        manufacturer: item.manufacturer.trim(),
        doseText: item.dose.trim(),
        unitIndex: item.unitIndex,
        note: item.note.trim(),
      }))
      .filter(entry => entry.name !== '' || entry.doseText !== '');
    const invalidEntry = medEntries.find(entry => entry.name === '');
    if (invalidEntry) {
      setTError(`第 ${invalidEntry.index + 1} 条药物已填写剂量但缺少药名：请补充药名，或移除该条`);
      return;
    }
    if (syncMed && medEntries.length === 0) {
      setTError('开启同步用药时请至少填写一种药物，或关闭同步用药');
      return;
    }

    const measuredAt = dateTimeToTs(tDate, tTime);
    const tempPayload = {
      value,
      measuredAt,
      method: MEASURE_METHODS[tMethodIndex] || MEASURE_METHODS[0],
      note: tNote.trim(),
    };

    setTempSubmitting(true);
    setTError('');

    const tempResult = await tempStore.update(editingTempId, tempPayload);
    if (tempResult.error) {
      setTError(tempResult.error.message || '保存失败，请稍后重试');
      setTempSubmitting(false);
      return;
    }

    const finishTempSave = (text: string) => {
      setTempEditorOpen(false);
      setTempSubmitting(false);
      setSyncHint('');
      syncAutoShownRef.current = false;
      toast.show(text, 'success');
      void loadData();
    };

    if (!syncMed) {
      // 关闭同步：解除关联标记，已有用药记录保留
      await tempStore.update(editingTempId, { medicationId: '' });
      finishTempSave('已更新体温记录');
      return;
    }

    // 增量同步：有 medId 的条目更新，无 medId 的新建，被移除的旧关联记录删除
    type OpResult = { data: unknown; error: StoreError | null };
    const ops: Array<{ type: 'update' | 'create' | 'remove'; medId: string; run: Promise<OpResult> }> = [];
    medEntries.forEach(entry => {
      const payload = {
        profileId: activeProfileIdRef.current || '',
        name: entry.name,
        manufacturer: entry.manufacturer,
        dose: doseToNumber(entry.doseText),
        unit: MED_UNITS[entry.unitIndex] || MED_UNITS[0],
        takenAt: measuredAt,
        note: entry.note,
        source: 'temp-link' as const,
        tempId: editingTempId,
        batchId,
      };
      if (entry.medId !== '') {
        ops.push({ type: 'update', medId: entry.medId, run: medStore.update(entry.medId, payload) });
      } else {
        ops.push({ type: 'create', medId: '', run: medStore.create(payload) });
      }
    });
    // 初始关联但本次被移除的用药记录
    const keepIds = medEntries.filter(entry => entry.medId !== '').map(entry => entry.medId);
    linkedMedIdsRef.current.forEach(medId => {
      if (!keepIds.includes(medId)) {
        ops.push({ type: 'remove', medId, run: medStore.remove(medId) });
      }
    });

    const opResults = await Promise.all(ops.map(op => op.run));
    const failedIndex = opResults.findIndex(item => item.error);
    if (failedIndex >= 0) {
      const error = opResults[failedIndex].error;
      // 个别记录已被外部删除，容忍并继续维护关联
      if (error && error.code !== 'NOT_FOUND_OR_FORBIDDEN') {
        setTError(error.message || '保存失败，请稍后重试');
        setTempSubmitting(false);
        return;
      }
    }

    // 重建第一关联：体温的 medicationId 指向当前条目列表中的第一条用药
    let firstMedId = '';
    const createIndex = ops.findIndex(op => op.type === 'create');
    if (createIndex >= 0) {
      const created = opResults[createIndex].data as MedRecord | null;
      if (created?.id) {
        firstMedId = created.id;
      }
    }
    if (firstMedId === '') {
      const updateOp = ops.find(op => op.type === 'update' && op.medId !== '');
      if (updateOp) {
        firstMedId = updateOp.medId;
      }
    }
    await tempStore.update(editingTempId, { medicationId: firstMedId });
    rememberMedNames(medEntries.map(entry => ({ name: entry.name, manufacturer: entry.manufacturer })));
    finishTempSave('已更新体温记录');
  };

  const removeTempOnly = async (tempId: string) => {
    const result = await tempStore.remove(tempId);
    if (result.error) {
      toast.show(result.error.message || '删除失败', 'error');
      return;
    }
    toast.show('已删除', 'success');
    void loadData();
  };

  const removeTempAndMed = async (tempId: string, medId: string) => {
    await medStore.remove(medId);
    const result = await tempStore.remove(tempId);
    if (result.error) {
      toast.show(result.error.message || '删除失败', 'error');
      return;
    }
    toast.show('已删除体温及关联用药', 'success');
    void loadData();
  };

  const handleTempDelete = async (tempId: string) => {
    const raw = rawTempsRef.current.find(item => item.id === tempId);
    if (!raw) {
      return;
    }
    const hasLink = typeof raw.medicationId === 'string' && raw.medicationId !== '';
    const confirmed = await confirm({
      title: '确认删除',
      content: hasLink
        ? '这条体温记录关联了一条用药记录。删除后不可恢复，如何处理？'
        : '删除后不可恢复，是否继续？',
      confirmText: hasLink ? '都删除' : '删除',
      cancelText: hasLink ? '仅体温' : '取消',
      danger: true,
    });
    if (hasLink && !confirmed) {
      await removeTempOnly(tempId);
      return;
    }
    if (!confirmed) {
      return;
    }
    if (hasLink) {
      await removeTempAndMed(tempId, raw.medicationId);
    } else {
      await removeTempOnly(tempId);
    }
  };

  // ---- 用药编辑 ----

  const openMedEdit = (medId: string) => {
    const raw = rawMedsRef.current.find(item => item.id === medId);
    if (!raw) {
      return;
    }
    const takenAt = new Date(toNumber(raw.takenAt));
    setEditingMedRecId(raw.id);
    setMName(typeof raw.name === 'string' ? raw.name : '');
    setMManufacturer(typeof raw.manufacturer === 'string' ? raw.manufacturer : '');
    setMDose(Number.isFinite(Number(raw.dose)) && Number(raw.dose) > 0 ? String(raw.dose) : '');
    setMUnitIndex(Math.max(0, (MED_UNITS as readonly string[]).indexOf(raw.unit)));
    setMDate(`${takenAt.getFullYear()}-${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())}`);
    setMTime(`${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`);
    setMNote(typeof raw.note === 'string' ? raw.note : '');
    setMError('');
    setMedSubmitting(false);
    setMedEditorOpen(true);
  };

  const handleMedSave = async () => {
    if (medSubmitting) {
      return;
    }
    const name = mName.trim();
    if (name === '') {
      setMError('请填写药名');
      return;
    }
    const dose = Number(mDose);
    const payload = {
      name,
      manufacturer: mManufacturer.trim(),
      dose: Number.isFinite(dose) && dose > 0 ? dose : 0,
      unit: MED_UNITS[mUnitIndex] || MED_UNITS[0],
      takenAt: dateTimeToTs(mDate, mTime),
      note: mNote.trim(),
    };

    setMedSubmitting(true);
    setMError('');
    const result = await medStore.update(editingMedRecId, payload);
    if (result.error) {
      setMError(result.error.message || '保存失败，请稍后重试');
      setMedSubmitting(false);
      return;
    }
    rememberMedNames([{ name: payload.name, manufacturer: payload.manufacturer }]);
    setMedEditorOpen(false);
    setMedSubmitting(false);
    toast.show('已更新用药记录', 'success');
    void loadData();
  };

  const handleMedDelete = async (medId: string) => {
    const raw = rawMedsRef.current.find(item => item.id === medId);
    if (!raw) {
      return;
    }
    const confirmed = await confirm({ title: '确认删除', content: '删除后不可恢复，是否继续？', danger: true });
    if (!confirmed) {
      return;
    }
    const result = await medStore.remove(medId);
    if (result.error) {
      toast.show(result.error.message || '删除失败', 'error');
      return;
    }
    // 该用药由体温联动创建时，解除对应体温记录的关联标记
    const tempId = typeof raw.tempId === 'string' ? raw.tempId : '';
    if (tempId !== '' && rawTempsRef.current.some(item => item.id === tempId)) {
      await tempStore.update(tempId, { medicationId: '' });
    }
    toast.show('已删除', 'success');
    void loadData();
  };

  if (viewState === 'loading') {
    return (
      <main className="page">
        <StateCard kind="loading" title="正在加载" description="请稍候。" />
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

  if (viewState === 'empty') {
    return (
      <main className="page">
        <StateCard
          kind="empty"
          title="批次不存在或已删除"
          description="可能已在批次管理中删除，去批次页查看当前列表。"
          actionLabel="去批次管理"
          onAction={() => navigate(ROUTES.batchManage)}
        />
      </main>
    );
  }

  return (
    <main className="page batch-detail-page">
      <header className="md-head">
        <p className="md-head-eyebrow">BATCH DETAIL</p>
        <h1 className="md-head-title">{batchName}</h1>
        <p className="md-head-sub">
          所属档案：{profileName} · 体温 {tempCount} 次 · 用药 {medCount} 次
        </p>
      </header>

      <section className="md-card">
        <div className="section-head">
          <div className="section-lead">
            <span className="section-emoji">🕒</span>
            <span className="section-title">记录时间线</span>
          </div>
          <span className="section-hint">体温与用药按时间合并 · 正序</span>
        </div>

        {timeline.length === 0 ? (
          <div className="mini-empty">
            <p className="mini-empty-text">该批次暂无记录，点下方「快速记录」开始。</p>
          </div>
        ) : null}

        {timeline.map((item, index) => (
          <div className="tl-row" key={item.id}>
            <div className="tl-axis">
              <span className={item.kind === 'med' ? 'tl-dot tl-dot-med' : 'tl-dot'} />
              {index < timeline.length - 1 ? <span className="tl-line" /> : null}
            </div>
            <div className="tl-main">
              {item.showDateHead ? <span className="tl-date">{item.dateText}</span> : null}
              <span className="tl-time">{item.timeText}</span>
              {item.kind === 'temp' ? (
                <>
                  <div className="temp-line">
                    <span className="temp-value" style={{ color: item.levelColor }}>
                      {item.valueText}°C
                    </span>
                    <span className="level-badge" style={{ background: item.levelColor }}>
                      {item.levelLabel}
                    </span>
                    <span className="tl-method">{item.methodText}</span>
                    {item.hasMed ? <span className="med-tag">含用药</span> : null}
                  </div>
                  {item.noteText !== '' ? <p className="item-note">{item.noteText}</p> : null}
                </>
              ) : (
                <>
                  <div className="med-line">
                    <span className="med-name">{item.name}</span>
                    <span className="med-dose">{item.doseText}</span>
                    {item.manufacturer !== '' ? (
                      <span className="tl-method">{item.manufacturer}</span>
                    ) : null}
                    {item.sourceLabel !== '' ? <span className="med-tag">{item.sourceLabel}</span> : null}
                  </div>
                  {item.noteText !== '' ? <p className="item-note">{item.noteText}</p> : null}
                </>
              )}
            </div>
            <div className="row-actions">
              {item.kind === 'temp' ? (
                <>
                  <button
                    type="button"
                    className="action-button btn-tonal"
                    onClick={() => void openTempEdit(item.id)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="action-button btn-error"
                    onClick={() => void handleTempDelete(item.id)}
                  >
                    删除
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="action-button btn-tonal"
                    onClick={() => openMedEdit(item.id)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="action-button btn-error"
                    onClick={() => void handleMedDelete(item.id)}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <div className="manage-link">
        <Link className="manage-link-text" to={ROUTES.batchManage}>
          重命名 / 删除批次，请前往批次管理 ›
        </Link>
      </div>

      <div className="floating-row">
        <Link className="floating-action" to={recordPath(batchId)}>
          <span className="floating-action-text">＋ 快速记录</span>
          <span className="floating-action-sub">新记录将自动归入「{batchName}」</span>
        </Link>
        <button
          type="button"
          className="floating-export"
          onClick={() => void handleExportPdf()}
          disabled={exporting}
          aria-busy={exporting}
        >
          <span className="floating-export-text">{exporting ? '导出中' : '导出'}</span>
          <span className="floating-export-sub">{exporting ? '请稍候' : 'PDF 文件'}</span>
        </button>
      </div>

      {/* 体温编辑弹层 */}
      <Sheet
        open={tempEditorOpen}
        title="编辑体温记录"
        onClose={() => {
          if (tempSubmitting) {
            return;
          }
          setTempEditorOpen(false);
          setTError('');
          setSyncHint('');
        }}
        footer={
          <>
            <Button
              variant="tonal"
              onClick={() => {
                if (tempSubmitting) {
                  return;
                }
                setTempEditorOpen(false);
                setTError('');
                setSyncHint('');
              }}
            >
              取消
            </Button>
            <Button onClick={() => void handleTempSave()} loading={tempSubmitting}>
              {tempSubmitting ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        {tError !== '' ? <p className="sheet-error">{tError}</p> : null}
        {syncHint !== '' ? <p className="sheet-hint">{syncHint}</p> : null}

        <div className="field-group first">
          <MdField
            label="体温（°C）"
            placeholder="如 36.8"
            inputMode="decimal"
            maxLength={4}
            value={tValue}
            onChange={handleTValueInput}
          />
        </div>

        <div className="field-group">
          <div className="field-row">
            <DateTimeField
              label="测量日期"
              type="date"
              value={tDate}
              onChange={value => {
                setTDate(value);
                setTError('');
              }}
            />
            <DateTimeField
              label="测量时间"
              type="time"
              value={tTime}
              onChange={value => {
                setTTime(value);
                setTError('');
              }}
            />
          </div>
        </div>

        <div className="field-group">
          <p className="field-label">测量方式</p>
          <div className="chip-row">
            {MEASURE_METHODS.map((method, index) => (
              <Chip
                key={method}
                label={method}
                selected={tMethodIndex === index}
                onClick={() => setTMethodIndex(index)}
              />
            ))}
          </div>
        </div>

        <div className="field-group">
          <div className="switch-card">
            <div className="switch-row">
              <span className="field-label">同步记录用药</span>
              <button
                type="button"
                role="switch"
                aria-checked={tSync}
                aria-label="同步记录用药"
                className={tSync ? 'switch is-on' : 'switch'}
                onClick={handleSyncChange}
              />
            </div>
            <p className="md-field-hint">
              开启后为这条体温补充关联用药（服药时间与测量时间一致），可录入多种药物，两边保持关联。
            </p>
          </div>
        </div>

        {tSync ? (
          <div>
            {tMeds.map((item, index) => (
              <div className={index > 0 ? 'med-entry med-entry-gap' : 'med-entry'} key={item.key}>
                <div className="med-entry-head">
                  <span className="med-entry-title">药物 {index + 1}</span>
                  {tMeds.length > 1 ? (
                    <button
                      type="button"
                      className="med-entry-remove"
                      onClick={() => removeTempMedItem(index)}
                    >
                      移除
                    </button>
                  ) : null}
                </div>

                <div className="field-group first">
                  <MdField
                    label="药名"
                    placeholder="如 布洛芬混悬液"
                    maxLength={40}
                    value={item.name}
                    onChange={value =>
                      updateTempMedItem(index, { name: value, manufacturer: '' })
                    }
                  />
                  {medSuggestions.length > 0 ? (
                    <div className="med-suggest-row">
                      {medSuggestions.map(suggestion => (
                        <button
                          type="button"
                          className="med-suggest-chip"
                          key={suggestion.label}
                          onClick={() =>
                            updateTempMedItem(index, {
                              name: suggestion.name,
                              manufacturer: suggestion.manufacturer,
                            })
                          }
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="field-group">
                  <p className="field-label">剂量</p>
                  <DoseStepper
                    value={item.dose}
                    onChange={value => updateTempMedItem(index, { dose: value })}
                    ariaLabel={`药物 ${index + 1} 剂量`}
                  />
                </div>

                <div className="field-group">
                  <p className="field-label">单位</p>
                  <div className="chip-row">
                    {MED_UNITS.map((unit, unitIndex) => (
                      <Chip
                        key={unit}
                        label={unit}
                        selected={item.unitIndex === unitIndex}
                        onClick={() => updateTempMedItem(index, { unitIndex })}
                      />
                    ))}
                  </div>
                </div>

                <div className="field-group">
                  <MdTextArea
                    label="备注"
                    placeholder="可选，补充说明信息"
                    maxLength={200}
                    value={item.note}
                    onChange={value => updateTempMedItem(index, { note: value })}
                  />
                </div>
              </div>
            ))}

            <button type="button" className="med-add" onClick={addTempMedItem}>
              ＋ 添加药物
            </button>

            <p className="md-field-hint">
              服药时间与测量时间相同；可添加多种药物，保存后各自生成一条用药记录。
            </p>
          </div>
        ) : null}

        <div className="field-group">
          <MdTextArea
            label="备注"
            placeholder="可选，补充说明信息"
            maxLength={200}
            value={tNote}
            onChange={setTNote}
          />
        </div>
      </Sheet>

      {/* 用药编辑弹层 */}
      <Sheet
        open={medEditorOpen}
        title="编辑用药记录"
        onClose={() => {
          if (medSubmitting) {
            return;
          }
          setMedEditorOpen(false);
          setMError('');
        }}
        footer={
          <>
            <Button
              variant="tonal"
              onClick={() => {
                if (medSubmitting) {
                  return;
                }
                setMedEditorOpen(false);
                setMError('');
              }}
            >
              取消
            </Button>
            <Button onClick={() => void handleMedSave()} loading={medSubmitting}>
              {medSubmitting ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        {mError !== '' ? <p className="sheet-error">{mError}</p> : null}

        <div className="field-group first">
          <MdField
            label="药名"
            placeholder="如 布洛芬混悬液"
            maxLength={40}
            value={mName}
            onChange={value => {
              setMName(value);
              setMManufacturer('');
              setMError('');
            }}
          />
          {medSuggestions.length > 0 ? (
            <div className="med-suggest-row">
              {medSuggestions.map(suggestion => (
                <button
                  type="button"
                  className="med-suggest-chip"
                  key={suggestion.label}
                  onClick={() => {
                    setMName(suggestion.name);
                    setMManufacturer(suggestion.manufacturer);
                    setMError('');
                  }}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field-group">
          <MdField
            label="厂商名称（选填）"
            placeholder="如 XX制药（可从快捷药名带入）"
            maxLength={40}
            value={mManufacturer}
            onChange={setMManufacturer}
          />
        </div>

        <div className="field-group">
          <p className="field-label">剂量</p>
          <DoseStepper value={mDose} onChange={setMDose} ariaLabel="用药剂量" />
        </div>

        <div className="field-group">
          <p className="field-label">单位</p>
          <div className="chip-row">
            {MED_UNITS.map((unit, unitIndex) => (
              <Chip
                key={unit}
                label={unit}
                selected={mUnitIndex === unitIndex}
                onClick={() => setMUnitIndex(unitIndex)}
              />
            ))}
          </div>
        </div>

        <div className="field-group">
          <div className="field-row">
            <DateTimeField
              label="服药日期"
              type="date"
              value={mDate}
              onChange={value => {
                setMDate(value);
                setMError('');
              }}
            />
            <DateTimeField
              label="服药时间"
              type="time"
              value={mTime}
              onChange={value => {
                setMTime(value);
                setMError('');
              }}
            />
          </div>
        </div>

        <div className="field-group">
          <MdTextArea
            label="备注"
            placeholder="可选，补充说明信息"
            maxLength={200}
            value={mNote}
            onChange={setMNote}
          />
        </div>
      </Sheet>
    </main>
  );
}
