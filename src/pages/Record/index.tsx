import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { DoseStepper } from '../../components/DoseStepper';
import { DateTimeField, MdField, MdTextArea } from '../../components/MdField';
import { StateCard } from '../../components/StateCard';
import { useToast } from '../../components/Toast';
import { bootstrapApp } from '../../lib/bootstrap';
import {
  collectMedNameSuggestions,
  collectNewMedNames,
  dateTimeToTs,
  feverLevel,
  formatDateTime,
  getActiveProfile,
  getActiveProfileId,
} from '../../lib/common';
import type { MedNameSuggestion } from '../../lib/common';
import { ROUTES } from '../../lib/routes';
import { batchStore, medNameStore, medStore, profileStore, tempStore } from '../../lib/store';
import { MEASURE_METHODS, MED_UNITS } from '../../lib/types';
import type { MedRecord, StoreError, TempRecord } from '../../lib/types';
import './index.css';

type RecordViewState = 'loading' | 'ready' | 'empty' | 'error' | 'no-batch';

interface MedEntry {
  key: number;
  name: string;
  manufacturer: string;
  dose: string;
  unitIndex: number;
  note: string;
}

function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function nowDateText(): string {
  const now = new Date();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function nowTimeText(): string {
  const now = new Date();
  return pad(now.getHours()) + ':' + pad(now.getMinutes());
}

function newMedEntry(key: number): MedEntry {
  return { key, name: '', manufacturer: '', dose: '', unitIndex: 0, note: '' };
}

function computeMedDirty(meds: MedEntry[]): boolean {
  return meds.some(item => item.name.trim() !== '' || item.dose.trim() !== '');
}

function doseToNumber(doseText: string): number {
  const dose = Number(doseText);
  return Number.isFinite(dose) && dose > 0 ? dose : 0;
}

export default function RecordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const batchId = searchParams.get('batchId') ?? '';

  const [viewState, setViewState] = useState<RecordViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [batchName, setBatchName] = useState('');
  const [refText, setRefText] = useState('');
  const [medSuggestions, setMedSuggestions] = useState<MedNameSuggestion[]>([]);

  const [formValue, setFormValue] = useState('');
  const [formDate, setFormDate] = useState(nowDateText);
  const [formTime, setFormTime] = useState(nowTimeText);
  const [formMethodIndex, setFormMethodIndex] = useState(0);
  const [formTempNote, setFormTempNote] = useState('');

  const [formMeds, setFormMeds] = useState<MedEntry[]>(() => [newMedEntry(1)]);
  const [formMedDate, setFormMedDate] = useState(nowDateText);
  const [formMedTime, setFormMedTime] = useState(nowTimeText);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeProfileIdRef = useRef('');
  const medTimeTouchedRef = useRef(false);
  const medKeySeedRef = useRef(1);

  const resetTimes = () => {
    const dateText = nowDateText();
    const timeText = nowTimeText();
    setFormDate(dateText);
    setFormTime(timeText);
    setFormMedDate(dateText);
    setFormMedTime(timeText);
    medTimeTouchedRef.current = false;
  };

  const loadContext = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');

    // 未从批次进入：不提供脱离批次的录入
    if (batchId === '') {
      setViewState('no-batch');
      setBatchName('');
      setRefText('');
      return;
    }

    await bootstrapApp();
    const profileResult = await profileStore.list();
    if (profileResult.error) {
      setViewState('error');
      setErrorMessage(profileResult.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, await getActiveProfileId());
    if (!active) {
      activeProfileIdRef.current = '';
      setViewState('empty');
      setProfileName('');
      setRefText('');
      setBatchName('');
      return;
    }
    activeProfileIdRef.current = active.id;

    const batchResult = await batchStore.list();
    const lockedBatch = (batchResult.data || []).find(item => item.id === batchId) ?? null;
    if (!lockedBatch || lockedBatch.profileId !== active.id) {
      // 批次已被删除或档案不匹配：引导回批次入口
      setViewState('no-batch');
      setBatchName('');
      setRefText('');
      return;
    }

    const [tempResult, libraryResult, medResult] = await Promise.all([
      tempStore.list(),
      medNameStore.list(),
      medStore.list(),
    ]);

    let latestRef = '';
    if (!tempResult.error && Array.isArray(tempResult.data)) {
      const temps = tempResult.data.filter(item => item.profileId === active.id);
      if (temps.length > 0) {
        const latest = temps[0];
        const level = feverLevel(latest.value);
        const valueNum = Number(latest.value);
        if (Number.isFinite(valueNum)) {
          latestRef =
            '最近一次体温 ' +
            valueNum.toFixed(1) +
            '°C ' +
            level.label +
            ' · ' +
            formatDateTime(latest.measuredAt) +
            '（仅供参考，不会自动填入）';
        }
      }
    }

    const suggestions = collectMedNameSuggestions(
      !libraryResult.error && Array.isArray(libraryResult.data) ? libraryResult.data : [],
      !medResult.error && Array.isArray(medResult.data)
        ? medResult.data.filter(item => item.profileId === active.id)
        : [],
      8
    );

    setProfileName(active.name);
    setBatchName(lockedBatch.name);
    setRefText(latestRef);
    setMedSuggestions(suggestions);
    setViewState('ready');
  }, [batchId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  // ---- 体温区块 ----

  const handleValueInput = (text: string) => {
    setFormValue(text);
    setFormError('');
    const num = Number(text);
    // 实时上限提示：体温不可能超过 45°C（保存时仍校验 30–45°C）
    if (Number.isFinite(num) && num > 45) {
      setFormError('体温上限为 45°C，人的体温不可能到这个数值，请检查输入');
    }
  };

  const handleDateChange = (dateText: string) => {
    setFormError('');
    if (!medTimeTouchedRef.current) {
      setFormDate(dateText);
      setFormMedDate(dateText);
      return;
    }
    setFormDate(dateText);
  };

  const handleTimeChange = (timeText: string) => {
    setFormError('');
    if (!medTimeTouchedRef.current) {
      setFormTime(timeText);
      setFormMedTime(timeText);
      return;
    }
    setFormTime(timeText);
  };

  const clearTempBlock = () => {
    const dateText = nowDateText();
    const timeText = nowTimeText();
    setFormDate(dateText);
    setFormTime(timeText);
    setFormValue('');
    setFormMethodIndex(0);
    setFormTempNote('');
    setFormError('');
  };

  // ---- 用药区块（多种药物） ----

  const updateMedItem = (index: number, patch: Partial<MedEntry>) => {
    setFormMeds(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setFormError('');
  };

  const addMedItem = () => {
    medKeySeedRef.current += 1;
    const entry = newMedEntry(medKeySeedRef.current);
    setFormMeds(prev => prev.concat([entry]));
    setFormError('');
  };

  const removeMedItem = (index: number) => {
    setFormMeds(prev => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((_, i) => i !== index);
    });
    setFormError('');
  };

  const handleMedNameInput = (index: number, value: string) => {
    // 手动编辑药名时清空厂商（重新点快捷芯片可再选）
    updateMedItem(index, { name: value, manufacturer: '' });
  };

  const handleMedSuggestPick = (index: number, suggestion: MedNameSuggestion) => {
    updateMedItem(index, { name: suggestion.name, manufacturer: suggestion.manufacturer });
  };

  const clearMedBlock = () => {
    medKeySeedRef.current += 1;
    const dateText = nowDateText();
    const timeText = nowTimeText();
    setFormMedDate(dateText);
    setFormMedTime(timeText);
    medTimeTouchedRef.current = false;
    setFormMeds([newMedEntry(medKeySeedRef.current)]);
    setFormError('');
  };

  const handleResetAll = () => {
    if (submitting) {
      return;
    }
    medKeySeedRef.current += 1;
    resetTimes();
    setFormValue('');
    setFormMethodIndex(0);
    setFormTempNote('');
    setFormMeds([newMedEntry(medKeySeedRef.current)]);
    setFormError('');
  };

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

  const handleSaveError = (error: StoreError | null) => {
    setFormError(error?.message || '保存失败，请稍后重试');
    setSubmitting(false);
  };

  const resetForm = () => {
    medKeySeedRef.current += 1;
    setFormValue('');
    setFormMethodIndex(0);
    setFormTempNote('');
    setFormMeds([newMedEntry(medKeySeedRef.current)]);
    setFormError('');
    setSubmitting(false);
    resetTimes();
    void loadContext();
  };

  // ---- 保存 ----

  const handleSave = async () => {
    if (submitting) {
      return;
    }

    const valueText = formValue.trim();
    const hasTemp = valueText !== '';

    // 收集有效药物条目：药名或剂量任一非空视为填写意图
    const medEntries = formMeds
      .map((item, index) => ({
        index,
        name: item.name.trim(),
        manufacturer: item.manufacturer.trim(),
        doseText: item.dose.trim(),
        unitIndex: item.unitIndex,
        note: item.note.trim(),
      }))
      .filter(entry => entry.name !== '' || entry.doseText !== '');
    const hasMed = medEntries.length > 0;

    if (!hasTemp && !hasMed) {
      setFormError('请至少记录体温或用药信息');
      return;
    }

    let value = 0;
    if (hasTemp) {
      value = Number(valueText);
      if (!Number.isFinite(value) || value < 30 || value > 45) {
        setFormError('体温需为 30–45°C 之间的数值，请检查后保存');
        return;
      }
    }

    const invalidEntry = medEntries.find(entry => entry.name === '');
    if (invalidEntry) {
      setFormError(
        `第 ${invalidEntry.index + 1} 条药物已填写剂量但缺少药名：请补充药名，或移除该条后再保存`
      );
      return;
    }

    const profileId = activeProfileIdRef.current || '';
    const measuredAt = dateTimeToTs(formDate, formTime);

    setSubmitting(true);
    setFormError('');

    let temp: TempRecord | null = null;
    if (hasTemp) {
      const tempResult = await tempStore.create({
        profileId,
        value,
        measuredAt,
        method: MEASURE_METHODS[formMethodIndex] || MEASURE_METHODS[0],
        note: formTempNote.trim(),
        medicationId: '',
        batchId,
      });
      if (tempResult.error) {
        handleSaveError(tempResult.error);
        return;
      }
      temp = tempResult.data;
    }

    let medList: MedRecord[] = [];
    if (hasMed) {
      const medResults = await Promise.all(
        medEntries.map(entry =>
          medStore.create({
            profileId,
            name: entry.name,
            manufacturer: entry.manufacturer,
            dose: doseToNumber(entry.doseText),
            unit: MED_UNITS[entry.unitIndex] || MED_UNITS[0],
            takenAt: dateTimeToTs(formMedDate, formMedTime),
            note: entry.note,
            source: 'manual',
            tempId: temp ? temp.id : '',
            batchId,
          })
        )
      );
      const failedMed = medResults.find(item => item.error);
      if (failedMed?.error) {
        handleSaveError(failedMed.error);
        return;
      }
      medList = medResults
        .map(item => item.data)
        .filter((item): item is MedRecord => item !== null);
    }

    // 多种药物时，体温记录关联第一条用药
    if (temp && medList.length > 0) {
      const linkResult = await tempStore.update(temp.id, { medicationId: medList[0].id });
      if (linkResult.error) {
        handleSaveError(linkResult.error);
        return;
      }
    }

    rememberMedNames(medEntries.map(entry => ({ name: entry.name, manufacturer: entry.manufacturer })));

    const medCount = medList.length;
    const toastText =
      temp && medCount > 0
        ? `已记录体温与 ${medCount} 种用药`
        : temp
          ? '已记录体温'
          : `已记录 ${medCount} 种用药`;
    toast.show(toastText, 'success');

    // 保存成功后返回批次详情（详情页重新加载时间线），不再停留在录入页
    window.setTimeout(() => {
      if (location.key !== 'default') {
        navigate(-1);
      } else {
        resetForm();
      }
    }, 600);
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
          onAction={() => void loadContext()}
        />
      </main>
    );
  }

  if (viewState === 'empty') {
    return (
      <main className="page">
        <StateCard
          kind="empty"
          title="还没有档案"
          description="先创建档案，再开始记录。"
          actionLabel="去创建档案"
          onAction={() => navigate(ROUTES.profileManage)}
        />
      </main>
    );
  }

  if (viewState === 'no-batch') {
    return (
      <main className="page">
        <StateCard
          kind="empty"
          title="未关联批次"
          description="快速记录需要在批次内发起：先在首页选择或创建一个批次，再从批次详情进入。"
          actionLabel="去批次管理"
          onAction={() => navigate(ROUTES.batchManage)}
        />
      </main>
    );
  }

  const medDirty = computeMedDirty(formMeds);

  return (
    <main className="page">
      <header className="md-head">
        <p className="md-head-eyebrow">QUICK RECORD</p>
        <h1 className="md-head-title">快速记录</h1>
        <p className="md-head-sub">当前档案：{profileName} · 体温与用药至少填写一项</p>
      </header>

      <div className="ref-bar">
        <span className="ref-text">当前批次：{batchName}（新记录将自动归入）</span>
      </div>

      {refText !== '' ? (
        <div className="ref-bar">
          <span className="ref-text">{refText}</span>
        </div>
      ) : null}

      <section className="md-card">
        <div className="section-head">
          <p className="section-title">
            体温信息 <span className="optional">选填</span>
          </p>
          {formValue !== '' ? (
            <button type="button" className="clear-link" onClick={clearTempBlock}>
              清空
            </button>
          ) : null}
        </div>

        <div className="field-group first">
          <MdField
            big
            label="体温"
            placeholder="36.8"
            inputMode="decimal"
            maxLength={4}
            suffix="°C"
            value={formValue}
            onChange={handleValueInput}
          />
        </div>

        <div className="field-group">
          <div className="field-row">
            <DateTimeField label="测量日期" type="date" value={formDate} onChange={handleDateChange} />
            <DateTimeField label="测量时间" type="time" value={formTime} onChange={handleTimeChange} />
          </div>
        </div>

        <div className="field-group">
          <p className="field-label">测量方式</p>
          <div className="chip-row">
            {MEASURE_METHODS.map((method, index) => (
              <Chip
                key={method}
                label={method}
                selected={formMethodIndex === index}
                onClick={() => setFormMethodIndex(index)}
              />
            ))}
          </div>
        </div>

        <div className="field-group">
          <MdTextArea
            label="备注"
            placeholder="可选，如测量状态、身体感受"
            maxLength={200}
            value={formTempNote}
            onChange={setFormTempNote}
          />
        </div>
      </section>

      <section className="md-card">
        <div className="section-head">
          <p className="section-title">
            用药信息 <span className="optional">选填 · 可添加多种药物</span>
          </p>
          {medDirty ? (
            <button type="button" className="clear-link" onClick={clearMedBlock}>
              清空
            </button>
          ) : null}
        </div>

        {formMeds.map((item, index) => (
          <div className={index > 0 ? 'med-entry med-entry-gap' : 'med-entry'} key={item.key}>
            <div className="med-entry-head">
              <span className="med-entry-title">药物 {index + 1}</span>
              {formMeds.length > 1 ? (
                <button type="button" className="med-entry-remove" onClick={() => removeMedItem(index)}>
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
                onChange={value => handleMedNameInput(index, value)}
              />
              {medSuggestions.length > 0 ? (
                <div className="med-suggest-row">
                  {medSuggestions.map(suggestion => (
                    <button
                      type="button"
                      className="med-suggest-chip"
                      key={suggestion.label}
                      onClick={() => handleMedSuggestPick(index, suggestion)}
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
                onChange={value => updateMedItem(index, { dose: value })}
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
                    onClick={() => updateMedItem(index, { unitIndex })}
                  />
                ))}
              </div>
            </div>

            <div className="field-group">
              <MdTextArea
                label="备注"
                placeholder="可选，如服药原因、注意事项"
                maxLength={200}
                value={item.note}
                onChange={value => updateMedItem(index, { note: value })}
              />
            </div>
          </div>
        ))}

        <button type="button" className="med-add" onClick={addMedItem}>
          ＋ 添加药物
        </button>

        <div className="field-group">
          <div className="field-row">
            <DateTimeField
              label="服药日期"
              type="date"
              value={formMedDate}
              onChange={value => {
                medTimeTouchedRef.current = true;
                setFormMedDate(value);
                setFormError('');
              }}
            />
            <DateTimeField
              label="服药时间"
              type="time"
              value={formMedTime}
              onChange={value => {
                medTimeTouchedRef.current = true;
                setFormMedTime(value);
                setFormError('');
              }}
            />
          </div>
          <p className="md-field-hint">本次服用的多种药物共用服药时间；默认与测量时间一致，可单独修改。</p>
        </div>
      </section>

      {formError !== '' ? <p className="sheet-error">{formError}</p> : null}

      <p className="rule-hint">
        体温与用药至少填写一项；体温与用药时间按实际分别记录，多种药物将各自生成一条用药记录。
      </p>

      <div className="save-actions">
        <Button variant="tonal" onClick={handleResetAll}>
          重置
        </Button>
        <Button onClick={() => void handleSave()} loading={submitting}>
          {submitting ? '保存中…' : '保存记录'}
        </Button>
      </div>
    </main>
  );
}
