// 批次详情页：查看批次内全部体温与用药记录，并提供每条记录的编辑与删除。
// 体温编辑沿用「同步记录用药」联动逻辑；用药删除时会解除关联体温的标记。

const { createListStore } = require('../../utils/store');
const { exportBatchToPdf } = require('../../utils/pdf-export');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    MED_NAME_STORE_KEY,
    MEASURE_METHODS,
    MED_UNITS,
    feverLevel,
    formatDose,
    formatDateTime,
    getActiveProfile,
    sortByTimeAsc,
    dateTimeToTs,
    collectMedNameSuggestions,
    collectNewMedNames,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const batchStore = createListStore({ storageKey: BATCH_STORE_KEY, sortKey: 'updatedAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });
const medNameStore = createListStore({ storageKey: MED_NAME_STORE_KEY, sortKey: 'createdAt' });

function pad(value) {
    return value < 10 ? '0' + String(value) : String(value);
}

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        batchName: '',
        profileName: '',
        createdText: '',
        tempCount: 0,
        medCount: 0,
        timeline: [],
        temps: [],
        meds: [],
        hasTemp: false,
        hasMed: false,

        // 体温编辑弹层（同步用药支持多种药物）
        showTempEditor: false,
        editorClosing: false,
        editingTempId: '',
        tMeds: [],
        medKeySeed: 1,
        tFormValue: '',
        tFormDate: '',
        tFormTime: '',
        tFormMethodIndex: 0,
        tFormNote: '',
        tFormSyncMed: false,
        syncHint: '',
        tFormError: '',
        tempSubmitting: false,

        // 用药编辑弹层
        showMedEditor: false,
        editingMedRecId: '',
        mFormName: '',
        mFormManufacturer: '',
        mFormDose: '',
        mFormUnitIndex: 0,
        mFormDate: '',
        mFormTime: '',
        mFormNote: '',
        mFormError: '',
        medSubmitting: false,

        methods: MEASURE_METHODS,
        units: MED_UNITS,
        focusField: '',
        medSuggestions: [],
        exporting: false,
    },

    onLoad(options) {
        this.batchId = typeof options.id === 'string' ? options.id : '';
    },

    onShow() {
        this.loadData();
    },

    handleRetry() {
        this.loadData();
    },

    // 输入框聚焦态（两个弹层共用，字段名区分）
    handleFieldFocus(event) {
        const field = event.currentTarget.dataset.field;
        if (typeof field === 'string' && field !== '') {
            this.setData({ focusField: field });
        }
    },

    handleFieldBlur() {
        this.setData({ focusField: '' });
    },

    loadData() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        Promise.all([profileStore.list(), batchStore.list(), tempStore.list(), medStore.list(), medNameStore.list()]).then(results => {
            const profileResult = results[0];
            const batchResult = results[1];
            const tempResult = results[2];
            const medResult = results[3];
            const libraryResult = results[4];
            if (profileResult.error || batchResult.error || tempResult.error || medResult.error || libraryResult.error) {
                const failed = results.find(item => item.error);
                this.setData({
                    viewState: 'error',
                    errorMessage: (failed && failed.error && failed.error.message) || '加载失败，请稍后重试',
                });
                return;
            }
            const medNameLibrary = libraryResult.data || [];

            const activeProfile = getActiveProfile(profileResult.data);
            const batches = (batchResult.data || []);
            let batch = null;
            for (let i = 0; i < batches.length; i += 1) {
                if (batches[i].id === this.batchId) {
                    batch = batches[i];
                    break;
                }
            }

            // 批次可能已被删除或不存在
            if (!batch || !activeProfile || batch.profileId !== activeProfile.id) {
                this.setData({
                    viewState: 'empty',
                    batchName: '',
                });
                return;
            }

            this.activeProfileId = activeProfile.id;
            const temps = sortByTimeAsc(
                (tempResult.data || []).filter(item => item.batchId === this.batchId),
                'measuredAt'
            );
            const meds = sortByTimeAsc(
                (medResult.data || []).filter(item => item.batchId === this.batchId),
                'takenAt'
            );
            this.rawTemps = temps;
            this.rawMeds = meds;

            // 合并时间轴：体温与用药按时间正序统一排列（供页面时间线与 PDF 导出共用）
            const timeline = temps.map(item => Object.assign({ kind: 'temp' }, mapTempItem(item)))
                .concat(meds.map(item => Object.assign({ kind: 'med' }, mapMedItem(item))))
                .sort((left, right) => toNumber(left.ts) - toNumber(right.ts));
            // 日期头标记：日期变化的第一条显示日期分隔
            let lastDate = '';
            timeline.forEach(item => {
                item.showDateHead = item.dateText !== lastDate;
                lastDate = item.dateText;
            });

            // 药名快捷建议：药名库（用户维护+自动记忆）优先，历史用药按频次补充
            const medSuggestions = collectMedNameSuggestions(
                medNameLibrary || [],
                (medResult.data || []).filter(item => item.profileId === activeProfile.id),
                8
            );

            this.setData({
                viewState: 'ready',
                batchName: batch.name,
                profileName: activeProfile.name,
                createdText: formatDateTime(batch.createdAt),
                tempCount: temps.length,
                medCount: meds.length,
                timeline,
                temps: temps.map(mapTempItem),
                meds: meds.map(mapMedItem),
                hasTemp: temps.length > 0,
                hasMed: meds.length > 0,
                medSuggestions,
            });
        });
    },

    goBatchManage() {
        wx.navigateTo({ url: '/pages/batch-manage/batch-manage' });
    },

    // 从批次内发起快速记录：批次自动锁定
    goRecord() {
        wx.navigateTo({ url: '/pages/record/record?batchId=' + this.batchId });
    },

    // 导出批次记录为 PDF：Canvas 分页绘制 → 图片嵌入 PDF → 写文件 → 预览/分享
    handleExportPdf() {
        if (this.data.exporting || this.data.viewState !== 'ready') {
            return;
        }
        this.setData({ exporting: true });
        exportBatchToPdf({
            batchName: this.data.batchName,
            profileName: this.data.profileName,
            exportTimeText: formatDateTime(Date.now()),
            temps: this.data.temps,
            meds: this.data.meds,
            timeline: this.data.timeline,
        }).then(result => {
            this.setData({ exporting: false });
            wx.showActionSheet({
                itemList: ['打开预览', '分享给好友（可下载）'],
                success: res => {
                    if (res.tapIndex === 0) {
                        wx.openDocument({
                            filePath: result.filePath,
                            fileType: 'pdf',
                            showMenu: true,
                            fail: () => {
                                wx.showToast({ title: '预览失败', icon: 'none' });
                            },
                        });
                    } else if (res.tapIndex === 1) {
                        wx.shareFileMessage({
                            filePath: result.filePath,
                            fileName: (this.data.batchName || '批次记录') + '.pdf',
                            fail: () => {},
                        });
                    }
                },
            });
        }).catch(err => {
            this.setData({ exporting: false });
            wx.showToast({ title: (err && err.message) || '导出失败，请稍后重试', icon: 'none' });
        });
    },

    findRawTemp(tempId) {
        const list = this.rawTemps || [];
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === tempId) {
                return list[i];
            }
        }
        return null;
    },

    findRawMed(medId) {
        const list = this.rawMeds || [];
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === medId) {
                return list[i];
            }
        }
        return null;
    },

    // ---- 体温编辑 ----

    openTempEdit(event) {
        const tempId = event.currentTarget.dataset.id;
        const raw = this.findRawTemp(tempId);
        if (!raw) {
            return;
        }
        const measuredTs = toNumber(raw.measuredAt);
        const measuredDate = new Date(measuredTs);
        this.tempSyncAutoShown = false;
        this.medKeySeed = 1;

        const editingMedId = typeof raw.medicationId === 'string' ? raw.medicationId : '';

        // 列出该体温关联的全部用药记录（med.tempId 匹配；兼容旧数据仅 medicationId 关联的单条）
        medStore.list().then(result => {
            const allMeds = result.data || [];
            let linkedMeds = allMeds.filter(item => item.tempId === raw.id);
            if (linkedMeds.length === 0 && editingMedId !== '') {
                const med = allMeds.find(item => item.id === editingMedId);
                if (med) {
                    linkedMeds = [med];
                }
            }
            this.editingLinkedMedIds = linkedMeds.map(item => item.id);
            const tMeds = linkedMeds.map(item => {
                this.medKeySeed += 1;
                return {
                    key: this.medKeySeed,
                    medId: item.id,
                    name: typeof item.name === 'string' ? item.name : '',
                    manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : '',
                    dose: Number.isFinite(Number(item.dose)) && Number(item.dose) > 0 ? String(item.dose) : '',
                    unitIndex: Math.max(0, MED_UNITS.indexOf(typeof item.unit === 'string' ? item.unit : '')),
                    note: typeof item.note === 'string' ? item.note : '',
                };
            });
            if (tMeds.length === 0) {
                this.medKeySeed += 1;
                tMeds.push({ key: this.medKeySeed, medId: '', name: '', manufacturer: '', dose: '', unitIndex: 0, note: '' });
            }

            this.setData({
                showTempEditor: true,
                editingTempId: raw.id,
                tMeds,
                tFormValue: Number.isFinite(Number(raw.value)) ? String(raw.value) : '',
                tFormDate: measuredDate.getFullYear() + '-' + pad(measuredDate.getMonth() + 1) + '-' + pad(measuredDate.getDate()),
                tFormTime: pad(measuredDate.getHours()) + ':' + pad(measuredDate.getMinutes()),
                tFormMethodIndex: Math.max(0, MEASURE_METHODS.indexOf(typeof raw.method === 'string' ? raw.method : '')),
                tFormNote: typeof raw.note === 'string' ? raw.note : '',
                tFormSyncMed: linkedMeds.length > 0,
                syncHint: '',
                tFormError: '',
                tempSubmitting: false,
            });
        });
    },

    closeTempEditor() {
        if (this.data.tempSubmitting || this.data.editorClosing) {
            return;
        }
        this.tempSyncAutoShown = false;
        this.setData({ editorClosing: true });
        setTimeout(() => {
            this.setData({ showTempEditor: false, editorClosing: false, tFormError: '', syncHint: '' });
        }, 180);
    },

    handleTempValueInput(event) {
        const text = typeof event.detail.value === 'string' ? event.detail.value : '';
        const patch = { tFormValue: text, tFormError: '' };
        const num = Number(text);
        // 实时上限提示：体温不可能超过 45°C
        if (Number.isFinite(num) && num > 45) {
            patch.tFormError = '体温上限为 45°C，请检查输入';
            this.setData(patch);
            return;
        }
        // 体温 ≥ 38.5°C 自动提示并展开同步用药
        if (Number.isFinite(num) && num >= 38.5 && !this.data.tFormSyncMed && !this.tempSyncAutoShown) {
            patch.tFormSyncMed = true;
            patch.syncHint = '体温 ≥ 38.5°C，已自动开启同步记录用药';
            this.tempSyncAutoShown = true;
        }
        this.setData(patch);
    },

    handleTempDateChange(event) {
        this.setData({ tFormDate: event.detail.value, tFormError: '' });
    },

    handleTempTimeChange(event) {
        this.setData({ tFormTime: event.detail.value, tFormError: '' });
    },

    handleMethodChip(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (Number.isFinite(index) && index >= 0) {
            this.setData({ tFormMethodIndex: index });
        }
    },

    handleTempNoteInput(event) {
        this.setData({ tFormNote: event.detail.value });
    },

    handleSyncChange(event) {
        const checked = event.detail.value === true;
        const patch = { tFormSyncMed: checked, tFormError: '' };
        if (!checked) {
            patch.syncHint = '';
            this.tempSyncAutoShown = false;
        }
        this.setData(patch);
    },

    updateTempMedItem(index, patch) {
        const meds = this.data.tMeds.slice();
        if (!Number.isFinite(index) || !meds[index]) {
            return;
        }
        meds[index] = Object.assign({}, meds[index], patch);
        this.setData({ tMeds: meds, tFormError: '' });
    },

    addTempMedItem() {
        this.medKeySeed += 1;
        const meds = this.data.tMeds.concat([{ key: this.medKeySeed, medId: '', name: '', manufacturer: '', dose: '', unitIndex: 0, note: '' }]);
        this.setData({ tMeds: meds, tFormError: '' });
    },

    removeTempMedItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isFinite(index) || this.data.tMeds.length <= 1) {
            return;
        }
        const meds = this.data.tMeds.slice();
        meds.splice(index, 1);
        this.setData({ tMeds: meds, tFormError: '' });
    },

    handleTempMedNameInput(event) {
        // 手动编辑药名时清空厂商（重新点快捷芯片可再选）
        this.updateTempMedItem(Number(event.currentTarget.dataset.index), { name: event.detail.value, manufacturer: '' });
    },

    handleTempDoseInput(event) {
        this.updateTempMedItem(Number(event.currentTarget.dataset.index), { dose: event.detail.value });
    },

    // 剂量步进：±1，空值按 + 从 1 起，减到 0 视为未记录（清空显示）
    handleTempDoseStep(event) {
        const index = Number(event.currentTarget.dataset.index);
        const op = event.currentTarget.dataset.op;
        const current = Number(this.data.tMeds[index] ? this.data.tMeds[index].dose : '');
        let value = Number.isFinite(current) && current > 0 ? current : 0;
        if (op === 'plus') {
            value += 1;
            if (value > 10000) {
                value = 10000;
            }
        } else {
            value -= 1;
        }
        this.updateTempMedItem(index, { dose: value >= 1 ? String(value) : '' });
    },

    handleUnitChip(event) {
        const entryIndex = Number(event.currentTarget.dataset.entry);
        const unitIndex = Number(event.currentTarget.dataset.index);
        if (Number.isFinite(unitIndex) && unitIndex >= 0) {
            this.updateTempMedItem(entryIndex, { unitIndex });
        }
    },

    handleTempMedNoteInput(event) {
        this.updateTempMedItem(Number(event.currentTarget.dataset.index), { note: event.detail.value });
    },

    // 快捷药名选择：体温编辑弹层内点击芯片填充药名并携带厂商
    handleTempSuggestPick(event) {
        const index = Number(event.currentTarget.dataset.index);
        const name = event.currentTarget.dataset.name;
        const manufacturer = event.currentTarget.dataset.manu;
        if (typeof name === 'string' && name !== '' && Number.isFinite(index)) {
            this.updateTempMedItem(index, { name, manufacturer: typeof manufacturer === 'string' ? manufacturer : '' });
        }
    },

    // 快捷药名选择：用药编辑弹层填充药名并携带厂商
    handleMedSuggestPick(event) {
        const name = event.currentTarget.dataset.name;
        const manufacturer = event.currentTarget.dataset.manu;
        if (typeof name === 'string' && name !== '') {
            this.setData({ mFormName: name, mFormManufacturer: typeof manufacturer === 'string' ? manufacturer : '', mFormError: '' });
        }
    },

    // 自动记忆：把提交且药名库未收录的药名写入库（静默，失败不打扰用户）
    rememberMedNames(entries) {
        medNameStore.list().then(result => {
            const fresh = collectNewMedNames(entries, result.data || []);
            if (fresh.length === 0) {
                return;
            }
            Promise.all(fresh.map(item => medNameStore.create({ name: item.name, manufacturer: item.manufacturer })));
        });
    },

    handleTempSave() {
        if (this.data.tempSubmitting) {
            return;
        }
        const value = Number(this.data.tFormValue);
        if (!Number.isFinite(value) || value < 30 || value > 45) {
            this.setData({ tFormError: '体温需为 30–45°C 之间的数值，请检查后保存' });
            return;
        }
        const syncMed = this.data.tFormSyncMed === true;

        // 收集有效药物条目：药名或剂量任一非空视为填写意图
        const medEntries = [];
        (this.data.tMeds || []).forEach((item, index) => {
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            const doseText = typeof item.dose === 'string' ? item.dose.trim() : '';
            if (name === '' && doseText === '') {
                return;
            }
            medEntries.push({
                index,
                medId: typeof item.medId === 'string' ? item.medId : '',
                name,
                manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '',
                doseText,
                unitIndex: item.unitIndex,
                note: typeof item.note === 'string' ? item.note.trim() : '',
            });
        });
        const invalidEntry = medEntries.find(entry => entry.name === '');
        if (invalidEntry) {
            this.setData({
                tFormError: '第 ' + (invalidEntry.index + 1) + ' 条药物已填写剂量但缺少药名：请补充药名，或移除该条',
            });
            return;
        }
        if (syncMed && medEntries.length === 0) {
            this.setData({ tFormError: '开启同步用药时请至少填写一种药物，或关闭同步用药' });
            return;
        }

        const tempPayload = {
            value,
            measuredAt: dateTimeToTs(this.data.tFormDate, this.data.tFormTime),
            method: MEASURE_METHODS[this.data.tFormMethodIndex] || MEASURE_METHODS[0],
            note: typeof this.data.tFormNote === 'string' ? this.data.tFormNote.trim() : '',
        };

        this.setData({ tempSubmitting: true, tFormError: '' });

        tempStore.update(this.data.editingTempId, tempPayload).then(result => {
            if (result.error) {
                this.tempSaveError(result.error);
                return;
            }

            if (!syncMed) {
                // 关闭同步：解除关联标记，已有用药记录保留
                tempStore.update(this.data.editingTempId, { medicationId: '' }).then(() => {
                    this.finishTempSave('已更新体温记录');
                });
                return;
            }

            // 增量同步：有 medId 的条目更新，无 medId 的新建，被移除的旧关联记录删除
            const ops = [];
            const opMeta = []; // 与 ops 顺序对应：{ type: 'update'|'create', entry }
            medEntries.forEach(entry => {
                const payload = {
                    profileId: this.activeProfileId || '',
                    name: entry.name,
                    manufacturer: entry.manufacturer,
                    dose: this.doseToNumber(entry.doseText),
                    unit: MED_UNITS[entry.unitIndex] || MED_UNITS[0],
                    takenAt: tempPayload.measuredAt,
                    note: entry.note,
                    source: 'temp-link',
                    tempId: this.data.editingTempId,
                    batchId: this.batchId,
                };
                if (entry.medId !== '') {
                    ops.push(medStore.update(entry.medId, payload));
                    opMeta.push({ type: 'update', entry });
                } else {
                    ops.push(medStore.create(payload));
                    opMeta.push({ type: 'create', entry });
                }
            });
            // 初始关联但本次被移除的用药记录
            const keepIds = medEntries.filter(entry => entry.medId !== '').map(entry => entry.medId);
            (this.editingLinkedMedIds || []).forEach(medId => {
                if (keepIds.indexOf(medId) === -1) {
                    ops.push(medStore.remove(medId));
                    opMeta.push({ type: 'remove', entry: null });
                }
            });

            Promise.all(ops).then(opResults => {
                const failed = opResults.find(item => item.error);
                if (failed && failed.error && failed.error.code === 'NOT_FOUND_OR_FORBIDDEN') {
                    // 个别记录已被外部删除，容忍并继续维护关联
                } else if (failed && failed.error) {
                    this.tempSaveError(failed.error);
                    return;
                }

                // 重建第一关联：体温的 medicationId 指向当前条目列表中的第一条用药
                let createIdx = 0;
                let firstMedId = '';
                for (const meta of opMeta) {
                    if (meta.type !== 'create') {
                        continue;
                    }
                    const r = opResults[createIdx];
                    if (r && !r.error && r.data && r.data.id) {
                        firstMedId = r.data.id;
                        break;
                    }
                    createIdx += 1;
                }
                if (firstMedId === '') {
                    for (const meta of opMeta) {
                        if (meta.type === 'update') {
                            firstMedId = meta.entry.medId;
                            break;
                        }
                    }
                }
                tempStore.update(this.data.editingTempId, { medicationId: firstMedId || '' }).then(() => {
                    // 自动记忆：本次提交的药名+厂商组合中未收录的写入药名库
                    this.rememberMedNames(medEntries.map(entry => ({ name: entry.name, manufacturer: entry.manufacturer })));
                    this.finishTempSave('已更新体温记录');
                });
            });
        });
    },

    doseToNumber(doseText) {
        const dose = Number(doseText);
        return Number.isFinite(dose) && dose > 0 ? dose : 0;
    },

    tempSaveError(error) {
        this.setData({
            tFormError: (error && error.message) || '保存失败，请稍后重试',
            tempSubmitting: false,
        });
    },

    finishTempSave(toastText) {
        this.setData({ showTempEditor: false, tempSubmitting: false, syncHint: '' });
        this.tempSyncAutoShown = false;
        wx.showToast({ title: toastText, icon: 'success' });
        this.loadData();
    },

    handleTempDelete(event) {
        const tempId = event.currentTarget.dataset.id;
        const raw = this.findRawTemp(tempId);
        if (!raw) {
            return;
        }
        const hasLink = typeof raw.medicationId === 'string' && raw.medicationId !== '';
        wx.showModal({
            title: '确认删除',
            content: hasLink
                ? '这条体温记录关联了一条用药记录。删除后不可恢复，如何处理？'
                : '删除后不可恢复，是否继续？',
            confirmText: hasLink ? '都删除' : '删除',
            cancelText: hasLink ? '仅体温' : '取消',
            confirmColor: '#B3261E',
            success: result => {
                if (hasLink && !result.confirm) {
                    this.removeTempOnly(tempId);
                    return;
                }
                if (!result.confirm) {
                    return;
                }
                if (hasLink) {
                    this.removeTempAndMed(tempId, raw.medicationId);
                } else {
                    this.removeTempOnly(tempId);
                }
            },
        });
    },

    removeTempOnly(tempId) {
        tempStore.remove(tempId).then(result => {
            if (result.error) {
                wx.showToast({ title: result.error.message || '删除失败', icon: 'none' });
                return;
            }
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
        });
    },

    removeTempAndMed(tempId, medId) {
        medStore.remove(medId).then(() => {
            tempStore.remove(tempId).then(result => {
                if (result.error) {
                    wx.showToast({ title: result.error.message || '删除失败', icon: 'none' });
                    return;
                }
                wx.showToast({ title: '已删除体温及关联用药', icon: 'success' });
                this.loadData();
            });
        });
    },

    // ---- 用药编辑 ----

    openMedEdit(event) {
        const medId = event.currentTarget.dataset.id;
        const raw = this.findRawMed(medId);
        if (!raw) {
            return;
        }
        const takenDate = new Date(toNumber(raw.takenAt));
        this.setData({
            showMedEditor: true,
            editingMedRecId: raw.id,
            mFormName: typeof raw.name === 'string' ? raw.name : '',
            mFormManufacturer: typeof raw.manufacturer === 'string' ? raw.manufacturer : '',
            mFormDose: Number.isFinite(Number(raw.dose)) && Number(raw.dose) > 0 ? String(raw.dose) : '',
            mFormUnitIndex: Math.max(0, MED_UNITS.indexOf(typeof raw.unit === 'string' ? raw.unit : '')),
            mFormDate: takenDate.getFullYear() + '-' + pad(takenDate.getMonth() + 1) + '-' + pad(takenDate.getDate()),
            mFormTime: pad(takenDate.getHours()) + ':' + pad(takenDate.getMinutes()),
            mFormNote: typeof raw.note === 'string' ? raw.note : '',
            mFormError: '',
            medSubmitting: false,
        });
    },

    closeMedEditor() {
        if (this.data.medSubmitting || this.data.editorClosing) {
            return;
        }
        this.setData({ editorClosing: true });
        setTimeout(() => {
            this.setData({ showMedEditor: false, editorClosing: false, mFormError: '' });
        }, 180);
    },

    handleMedNameInput(event) {
        this.setData({ mFormName: event.detail.value, mFormManufacturer: '', mFormError: '' });
    },

    handleMedManufacturerInput(event) {
        this.setData({ mFormManufacturer: event.detail.value });
    },

    handleMedDoseInput(event) {
        this.setData({ mFormDose: event.detail.value, mFormError: '' });
    },

    // 剂量步进：±1，空值按 + 从 1 起，减到 0 视为未记录（清空显示）
    handleMedDoseStep(event) {
        const op = event.currentTarget.dataset.op;
        const current = Number(this.data.mFormDose);
        let value = Number.isFinite(current) && current > 0 ? current : 0;
        if (op === 'plus') {
            value += 1;
            if (value > 10000) {
                value = 10000;
            }
        } else {
            value -= 1;
        }
        this.setData({ mFormDose: value >= 1 ? String(value) : '', mFormError: '' });
    },

    handleMedDateChange(event) {
        this.setData({ mFormDate: event.detail.value, mFormError: '' });
    },

    handleMedTimeChange(event) {
        this.setData({ mFormTime: event.detail.value, mFormError: '' });
    },

    handleMedNoteInput(event) {
        this.setData({ mFormNote: event.detail.value });
    },

    handleMedSave() {
        if (this.data.medSubmitting) {
            return;
        }
        const name = typeof this.data.mFormName === 'string' ? this.data.mFormName.trim() : '';
        if (name === '') {
            this.setData({ mFormError: '请填写药名' });
            return;
        }
        const dose = Number(this.data.mFormDose);
        const payload = {
            name,
            manufacturer: typeof this.data.mFormManufacturer === 'string' ? this.data.mFormManufacturer.trim() : '',
            dose: Number.isFinite(dose) && dose > 0 ? dose : 0,
            unit: MED_UNITS[this.data.mFormUnitIndex] || MED_UNITS[0],
            takenAt: dateTimeToTs(this.data.mFormDate, this.data.mFormTime),
            note: typeof this.data.mFormNote === 'string' ? this.data.mFormNote.trim() : '',
        };

        this.setData({ medSubmitting: true, mFormError: '' });
        medStore.update(this.data.editingMedRecId, payload).then(result => {
            if (result.error) {
                this.setData({
                    mFormError: result.error.message || '保存失败，请稍后重试',
                    medSubmitting: false,
                });
                return;
            }
            // 自动记忆：药名+厂商组合未收录的写入药名库
            this.rememberMedNames([{ name: payload.name, manufacturer: payload.manufacturer }]);
            this.setData({ showMedEditor: false, medSubmitting: false });
            wx.showToast({ title: '已更新用药记录', icon: 'success' });
            this.loadData();
        });
    },

    handleMedDelete(event) {
        const medId = event.currentTarget.dataset.id;
        const raw = this.findRawMed(medId);
        if (!raw) {
            return;
        }
        wx.showModal({
            title: '确认删除',
            content: '删除后不可恢复，是否继续？',
            confirmColor: '#B3261E',
            success: result => {
                if (!result.confirm) {
                    return;
                }
                medStore.remove(medId).then(medResult => {
                    if (medResult.error) {
                        wx.showToast({ title: medResult.error.message || '删除失败', icon: 'none' });
                        return;
                    }
                    // 该用药由体温联动创建时，解除对应体温记录的关联标记
                    const tempId = typeof raw.tempId === 'string' ? raw.tempId : '';
                    if (tempId !== '' && this.findRawTemp(tempId)) {
                        tempStore.update(tempId, { medicationId: '' });
                    }
                    wx.showToast({ title: '已删除', icon: 'success' });
                    this.loadData();
                });
            },
        });
    },
});

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function mapTempItem(item) {
    const level = feverLevel(item.value);
    const ts = toNumber(item.measuredAt);
    return {
        id: item.id,
        kind: 'temp',
        ts,
        dateText: formatDateLabel(ts),
        valueText: Number.isFinite(Number(item.value)) ? Number(item.value).toFixed(1) : '--',
        levelLabel: level.label,
        levelColor: level.color,
        timeText: formatDateTime(item.measuredAt),
        methodText: typeof item.method === 'string' && item.method !== '' ? item.method : '未记录方式',
        noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
        hasMed: typeof item.medicationId === 'string' && item.medicationId !== '',
    };
}

function mapMedItem(item) {
    const ts = toNumber(item.takenAt);
    return {
        id: item.id,
        kind: 'med',
        ts,
        dateText: formatDateLabel(ts),
        timeText: formatDateTime(item.takenAt),
        name: typeof item.name === 'string' && item.name !== '' ? item.name : '未命名药品',
        manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : '',
        doseText: formatDose(item.dose, item.unit),
        noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
        sourceLabel: item.source === 'temp-link' ? '体温联动' : '',
    };
}

function formatDateLabel(ts) {
    const d = new Date(toNumber(ts));
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
