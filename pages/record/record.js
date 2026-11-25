// 统一录入页：体温与用药双区块选填，至少填写一项；用药支持多种药物（动态条目）。
// 设计原则：
// 1. 不自动延续/复制上一条体温（避免虚构测量数据，图表与统计不失真）；
// 2. 不代用户清理或修正输入（剂量无药名时提示，由用户决定补填或移除）；
// 3. 服药时间默认跟随测量时间，手动修改后即独立，支持“先服药后补测”场景；
// 4. 批次由发起方（批次详情页）传入并锁定，录入页内不再手动选择。

const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    MED_NAME_STORE_KEY,
    MEASURE_METHODS,
    MED_UNITS,
    feverLevel,
    formatDateTime,
    getActiveProfile,
    dateTimeToTs,
    collectMedNameSuggestions,
    collectNewMedNames,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });
const batchStore = createListStore({ storageKey: BATCH_STORE_KEY, sortKey: 'updatedAt' });
const medNameStore = createListStore({ storageKey: MED_NAME_STORE_KEY, sortKey: 'createdAt' });

function pad(value) {
    return value < 10 ? '0' + String(value) : String(value);
}

function nowDateText() {
    const now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function nowTimeText() {
    const now = new Date();
    return pad(now.getHours()) + ':' + pad(now.getMinutes());
}

function newMedEntry(key) {
    return { key, name: '', manufacturer: '', dose: '', unitIndex: 0, note: '' };
}

function computeMedDirty(meds) {
    return (meds || []).some(item => (item.name || '').trim() !== '' || (item.dose || '').trim() !== '');
}

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        profileName: '',
        refText: '',
        batchName: '',
        methods: MEASURE_METHODS,
        units: MED_UNITS,
        // 体温区块（选填）
        formValue: '',
        formDate: '',
        formTime: '',
        formMethodIndex: 0,
        formTempNote: '',
        // 用药区块（选填，支持多种药物）
        formMeds: [],
        medDirty: false,
        formMedDate: '',
        formMedTime: '',
        formError: '',
        submitting: false,
        focusField: '',
        medKeySeed: 1,
        medSuggestions: [],
    },

    onLoad(options) {
        // 批次由发起方（批次详情）传入并锁定，录入页内不再手动选择
        this.lockedBatchId = typeof options.batchId === 'string' ? options.batchId : '';
        this.medKeySeed = 1;
        this.setData({ formMeds: [newMedEntry(this.medKeySeed)] });
        this.resetTimes();
    },

    onShow() {
        this.loadContext();
    },

    handleRetry() {
        this.loadContext();
    },

    // 输入框聚焦态：focusField 驱动 class 切换
    handleFieldFocus(event) {
        const field = event.currentTarget.dataset.field;
        if (typeof field === 'string' && field !== '') {
            this.setData({ focusField: field });
        }
    },

    handleFieldBlur() {
        this.setData({ focusField: '' });
    },

    resetTimes() {
        const dateText = nowDateText();
        const timeText = nowTimeText();
        this.setData({
            formDate: dateText,
            formTime: timeText,
            formMedDate: dateText,
            formMedTime: timeText,
        });
        this.medTimeTouched = false;
    },

    resetTempTime() {
        this.setData({ formDate: nowDateText(), formTime: nowTimeText() });
    },

    resetMedTime() {
        this.setData({ formMedDate: nowDateText(), formMedTime: nowTimeText() });
        this.medTimeTouched = false;
    },

    loadContext() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        // 未从批次进入：不提供脱离批次的录入
        if (typeof this.lockedBatchId !== 'string' || this.lockedBatchId === '') {
            this.setData({ viewState: 'no-batch', batchName: '', refText: '' });
            return;
        }

        profileStore.list().then(profileResult => {
            if (profileResult.error) {
                this.setData({
                    viewState: 'error',
                    errorMessage: profileResult.error.message || '加载失败，请稍后重试',
                });
                return;
            }
            const activeProfile = getActiveProfile(profileResult.data);
            if (!activeProfile) {
                this.setData({ viewState: 'empty', profileName: '', refText: '', batchName: '' });
                this.activeProfileId = '';
                return;
            }
            this.activeProfileId = activeProfile.id;

            // 校验锁定批次：存在且属于当前档案才可录入
            batchStore.list().then(batchResult => {
                let lockedBatch = null;
                if (!batchResult.error && Array.isArray(batchResult.data)) {
                    for (let i = 0; i < batchResult.data.length; i += 1) {
                        if (batchResult.data[i].id === this.lockedBatchId) {
                            lockedBatch = batchResult.data[i];
                            break;
                        }
                    }
                }
                if (!lockedBatch || lockedBatch.profileId !== activeProfile.id) {
                    // 批次已被删除或档案不匹配：引导回批次入口
                    this.setData({ viewState: 'no-batch', batchName: '', refText: '' });
                    return;
                }

                tempStore.list().then(tempResult => {
                    let refText = '';
                    if (!tempResult.error && Array.isArray(tempResult.data)) {
                        const temps = tempResult.data.filter(item => item.profileId === activeProfile.id);
                        if (temps.length > 0) {
                            const latest = temps[0];
                            const level = feverLevel(latest.value);
                            const valueNum = Number(latest.value);
                            if (Number.isFinite(valueNum)) {
                                refText = '最近一次体温 ' + valueNum.toFixed(1) + '°C ' + level.label
                                    + ' · ' + formatDateTime(latest.measuredAt) + '（仅供参考，不会自动填入）';
                            }
                        }
                    }
                    // 药名快捷建议：药名库（用户维护+自动记忆）优先，历史用药按频次补充
                    medNameStore.list().then(libraryResult => {
                        medStore.list().then(medResult => {
                            const medSuggestions = collectMedNameSuggestions(
                                (!libraryResult.error && Array.isArray(libraryResult.data)) ? libraryResult.data : [],
                                (!medResult.error && Array.isArray(medResult.data))
                                    ? medResult.data.filter(item => item.profileId === activeProfile.id)
                                    : [],
                                8
                            );
                            this.setData({
                                viewState: 'ready',
                                profileName: activeProfile.name,
                                batchName: lockedBatch.name,
                                refText,
                                medSuggestions,
                            });
                        });
                    });
                });
            });
        });
    },

    // ---- 体温区块 ----

    handleValueInput(event) {
        const text = typeof event.detail.value === 'string' ? event.detail.value : '';
        const patch = { formValue: text, formError: '' };
        const num = Number(text);
        // 实时上限提示：体温不可能超过 45°C（保存时仍校验 30–45°C）
        if (Number.isFinite(num) && num > 45) {
            patch.formError = '体温上限为 45°C，人的体温不可能到这个数值，请检查输入';
        }
        this.setData(patch);
    },

    handleDateChange(event) {
        const dateText = event.detail.value;
        // 服药时间未被手动改过时，跟随测量时间（覆盖“先服药后补测”之外的默认场景）
        if (!this.medTimeTouched) {
            this.setData({ formDate: dateText, formMedDate: dateText, formError: '' });
            return;
        }
        this.setData({ formDate: dateText, formError: '' });
    },

    handleTimeChange(event) {
        const timeText = event.detail.value;
        if (!this.medTimeTouched) {
            this.setData({ formTime: timeText, formMedTime: timeText, formError: '' });
            return;
        }
        this.setData({ formTime: timeText, formError: '' });
    },

    handleMethodChip(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (Number.isFinite(index) && index >= 0) {
            this.setData({ formMethodIndex: index });
        }
    },

    handleTempNoteInput(event) {
        this.setData({ formTempNote: event.detail.value });
    },

    clearTempBlock() {
        this.resetTempTime();
        this.setData({ formValue: '', formMethodIndex: 0, formTempNote: '', formError: '' });
    },

    // ---- 用药区块（多种药物） ----

    addMedItem() {
        this.medKeySeed += 1;
        const meds = this.data.formMeds.concat([newMedEntry(this.medKeySeed)]);
        this.setData({ formMeds: meds, medDirty: computeMedDirty(meds), formError: '' });
    },

    removeMedItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isFinite(index) || this.data.formMeds.length <= 1) {
            return;
        }
        const meds = this.data.formMeds.slice();
        meds.splice(index, 1);
        this.setData({ formMeds: meds, medDirty: computeMedDirty(meds), formError: '' });
    },

    updateMedItem(index, patch) {
        const meds = this.data.formMeds.slice();
        if (!Number.isFinite(index) || !meds[index]) {
            return;
        }
        meds[index] = Object.assign({}, meds[index], patch);
        this.setData({ formMeds: meds, medDirty: computeMedDirty(meds), formError: '' });
    },

    handleMedNameInput(event) {
        // 手动编辑药名时清空厂商（重新点快捷芯片可再选）
        this.updateMedItem(Number(event.currentTarget.dataset.index), { name: event.detail.value, manufacturer: '' });
    },

    handleMedDoseInput(event) {
        this.updateMedItem(Number(event.currentTarget.dataset.index), { dose: event.detail.value });
    },

    // 剂量步进：±1，空值按 + 从 1 起，减到 0 视为未记录（清空显示）；
    // 中间数值仍可手动输入任意值（如 mg 类大剂量）
    handleMedDoseStep(event) {
        const index = Number(event.currentTarget.dataset.index);
        const op = event.currentTarget.dataset.op;
        const current = Number(this.data.formMeds[index] ? this.data.formMeds[index].dose : '');
        let value = Number.isFinite(current) && current > 0 ? current : 0;
        if (op === 'plus') {
            value += 1;
            if (value > 10000) {
                value = 10000;
            }
        } else {
            value -= 1;
        }
        this.updateMedItem(index, { dose: value >= 1 ? String(value) : '' });
    },

    handleUnitChip(event) {
        const entryIndex = Number(event.currentTarget.dataset.entry);
        const unitIndex = Number(event.currentTarget.dataset.index);
        if (Number.isFinite(unitIndex) && unitIndex >= 0) {
            this.updateMedItem(entryIndex, { unitIndex });
        }
    },

    handleMedNoteInput(event) {
        this.updateMedItem(Number(event.currentTarget.dataset.index), { note: event.detail.value });
    },

    // 快捷药名选择：点击芯片填充药名并携带厂商
    handleMedSuggestPick(event) {
        const index = Number(event.currentTarget.dataset.index);
        const name = event.currentTarget.dataset.name;
        const manufacturer = event.currentTarget.dataset.manu;
        if (typeof name === 'string' && name !== '' && Number.isFinite(index)) {
            this.updateMedItem(index, { name, manufacturer: typeof manufacturer === 'string' ? manufacturer : '' });
        }
    },

    handleMedDateChange(event) {
        this.medTimeTouched = true;
        this.setData({ formMedDate: event.detail.value, formError: '' });
    },

    handleMedTimeChange(event) {
        this.medTimeTouched = true;
        this.setData({ formMedTime: event.detail.value, formError: '' });
    },

    // 批次由发起方锁定；批次被删除等情况下引导回批次入口
    goBatchManage() {
        wx.navigateTo({ url: '/pages/batch-manage/batch-manage' });
    },

    clearMedBlock() {
        this.medKeySeed += 1;
        this.resetMedTime();
        this.setData({
            formMeds: [newMedEntry(this.medKeySeed)],
            medDirty: false,
            formError: '',
        });
    },

    handleResetAll() {
        if (this.data.submitting) {
            return;
        }
        this.medKeySeed += 1;
        this.resetTimes();
        this.setData({
            formValue: '',
            formMethodIndex: 0,
            formTempNote: '',
            formMeds: [newMedEntry(this.medKeySeed)],
            medDirty: false,
            formError: '',
        });
    },

    // ---- 保存 ----

    handleSave() {
        if (this.data.submitting) {
            return;
        }

        const valueText = typeof this.data.formValue === 'string' ? this.data.formValue.trim() : '';
        const hasTemp = valueText !== '';

        // 收集有效药物条目：药名或剂量任一非空视为填写意图
        const medEntries = [];
        (this.data.formMeds || []).forEach((item, index) => {
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            const doseText = typeof item.dose === 'string' ? item.dose.trim() : '';
            if (name === '' && doseText === '') {
                return;
            }
            medEntries.push({
                index,
                name,
                manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '',
                doseText,
                unitIndex: item.unitIndex,
                note: typeof item.note === 'string' ? item.note.trim() : '',
            });
        });
        const hasMed = medEntries.length > 0;

        // 校验只阻止明显问题，不代用户修正
        if (!hasTemp && !hasMed) {
            this.setData({ formError: '请至少记录体温或用药信息' });
            return;
        }
        let value = 0;
        if (hasTemp) {
            value = Number(valueText);
            if (!Number.isFinite(value) || value < 30 || value > 45) {
                this.setData({ formError: '体温需为 30–45°C 之间的数值，请检查后保存' });
                return;
            }
        }
        const invalidEntry = medEntries.find(entry => entry.name === '');
        if (invalidEntry) {
            this.setData({
                formError: '第 ' + (invalidEntry.index + 1) + ' 条药物已填写剂量但缺少药名：请补充药名，或移除该条后再保存',
            });
            return;
        }

        const profileId = this.activeProfileId || '';
        const measuredAt = dateTimeToTs(this.data.formDate, this.data.formTime);
        const batchId = typeof this.lockedBatchId === 'string' ? this.lockedBatchId : '';
        this.setData({ submitting: true, formError: '' });

        let createTemp;
        if (hasTemp) {
            createTemp = tempStore.create({
                profileId,
                value,
                measuredAt,
                method: MEASURE_METHODS[this.data.formMethodIndex] || MEASURE_METHODS[0],
                note: typeof this.data.formTempNote === 'string' ? this.data.formTempNote.trim() : '',
                medicationId: '',
                batchId,
            });
        } else {
            createTemp = Promise.resolve({ data: null, error: null });
        }

        createTemp.then(tempResult => {
            if (tempResult.error) {
                this.handleSaveError(tempResult.error);
                return;
            }
            const temp = tempResult.data;

            let createMeds;
            if (hasMed) {
                const medCreates = medEntries.map(entry => medStore.create({
                    profileId,
                    name: entry.name,
                    manufacturer: entry.manufacturer,
                    dose: this.doseToNumber(entry.doseText),
                    unit: MED_UNITS[entry.unitIndex] || MED_UNITS[0],
                    takenAt: dateTimeToTs(this.data.formMedDate, this.data.formMedTime),
                    note: entry.note,
                    source: 'manual',
                    tempId: temp ? temp.id : '',
                    batchId,
                }));
                createMeds = Promise.all(medCreates).then(list => ({ data: { list }, error: null }));
            } else {
                createMeds = Promise.resolve({ data: { list: [] }, error: null });
            }

            createMeds.then(medResult => {
                if (medResult.error) {
                    this.handleSaveError(medResult.error);
                    return;
                }
                const medList = medResult.data.list || [];
                const failedMed = medList.find(item => item.error);
                if (failedMed) {
                    this.handleSaveError(failedMed.error);
                    return;
                }
                // 多种药物时，体温记录关联第一条用药
                const firstMed = medList.length > 0 ? medList[0].data : null;
                let afterLink;
                if (temp && firstMed) {
                    afterLink = tempStore.update(temp.id, { medicationId: firstMed.id });
                } else {
                    afterLink = Promise.resolve({ error: null });
                }
                afterLink.then(linkResult => {
                    if (linkResult.error) {
                        this.handleSaveError(linkResult.error);
                        return;
                    }
                    // 自动记忆：本次提交的药名+厂商组合中未收录的写入药名库
                    this.rememberMedNames(medEntries.map(entry => ({ name: entry.name, manufacturer: entry.manufacturer })));
                    const medCount = medList.length;
                    const toast = temp && medCount > 0
                        ? '已记录体温与 ' + medCount + ' 种用药'
                        : (temp ? '已记录体温' : '已记录 ' + medCount + ' 种用药');
                    wx.showToast({ title: toast, icon: 'success' });
                    // 保存成功后返回批次详情（详情页 onShow 自动刷新时间线），不再停留在录入页
                    setTimeout(() => {
                        wx.navigateBack({
                            fail: () => {
                                // 无上一页可返回时清空表单留在本页
                                this.resetForm();
                            },
                        });
                    }, 600);
                });
            });
        });
    },

    doseToNumber(doseText) {
        const dose = Number(doseText);
        return Number.isFinite(dose) && dose > 0 ? dose : 0;
    },

    handleSaveError(error) {
        this.setData({
            formError: (error && error.message) || '保存失败，请稍后重试',
            submitting: false,
        });
    },

    resetForm() {
        this.medKeySeed += 1;
        this.setData({
            formValue: '',
            formMethodIndex: 0,
            formTempNote: '',
            formMeds: [newMedEntry(this.medKeySeed)],
            medDirty: false,
            formError: '',
            submitting: false,
        });
        this.resetTimes();
        this.loadContext();
    },

    goProfileManage() {
        wx.navigateTo({ url: '/pages/profile-manage/profile-manage' });
    },

    // 自动记忆：把本次提交且药名库未收录的药名写入库（静默，失败不打扰用户）
    rememberMedNames(entries) {
        medNameStore.list().then(result => {
            const fresh = collectNewMedNames(entries, result.data || []);
            if (fresh.length === 0) {
                return;
            }
            Promise.all(fresh.map(item => medNameStore.create({ name: item.name, manufacturer: item.manufacturer })));
        });
    },
});
