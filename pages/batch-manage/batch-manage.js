const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    formatShortDate,
    formatDateTime,
    getActiveProfile,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const batchStore = createListStore({ storageKey: BATCH_STORE_KEY, sortKey: 'updatedAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        profileName: '',
        items: [],
        showEditor: false,
        editorClosing: false,
        editorClosing: false,
        editorMode: 'create',
        editorTitle: '新建批次',
        editingId: '',
        formName: '',
        formError: '',
        submittingBatch: false,
        focusField: '',
    },

    onShow() {
        this.loadItems();
    },

    handleRetry() {
        this.loadItems();
    },

    // 输入框聚焦态
    handleFieldFocus(event) {
        const field = event.currentTarget.dataset.field;
        if (typeof field === 'string' && field !== '') {
            this.setData({ focusField: field });
        }
    },

    handleFieldBlur() {
        this.setData({ focusField: '' });
    },

    loadItems() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        Promise.all([profileStore.list(), batchStore.list(), tempStore.list(), medStore.list()]).then(results => {
            const profileResult = results[0];
            const batchResult = results[1];
            const tempResult = results[2];
            const medResult = results[3];
            if (profileResult.error || batchResult.error || tempResult.error || medResult.error) {
                const failed = results.find(item => item.error);
                this.setData({
                    viewState: 'error',
                    errorMessage: (failed && failed.error && failed.error.message) || '加载失败，请稍后重试',
                });
                return;
            }

            const activeProfile = getActiveProfile(profileResult.data);
            if (!activeProfile) {
                this.setData({ viewState: 'empty', profileName: '', items: [] });
                this.activeProfileId = '';
                return;
            }
            this.activeProfileId = activeProfile.id;
            this.rawBatches = (batchResult.data || []).filter(item => item.profileId === activeProfile.id);
            this.rawTempAll = tempResult.data || [];
            this.rawMedAll = medResult.data || [];

            const items = this.rawBatches.map(batch => ({
                id: batch.id,
                name: batch.name,
                count: countBatchRecords(batch.id, this.rawTempAll, this.rawMedAll),
                startText: formatBatchStart(batch.id, this.rawTempAll, this.rawMedAll),
                updatedText: formatDateTime(batch.updatedAt),
            }));

            this.setData({
                viewState: 'ready',
                profileName: activeProfile.name,
                items,
            });
        });
    },

    openDetail(event) {
        const batchId = event.currentTarget.dataset.id;
        if (!batchId) {
            return;
        }
        wx.navigateTo({ url: '/pages/batch-detail/batch-detail?id=' + batchId });
    },

    openCreate() {
        this.setData({
            showEditor: true,
            editorMode: 'create',
            editorTitle: '新建批次',
            editingId: '',
            formName: '',
            formError: '',
            submittingBatch: false,
        });
    },

    openRename(event) {
        const batchId = event.currentTarget.dataset.id;
        const raw = this.findRawById(batchId);
        if (!raw) {
            return;
        }
        this.setData({
            showEditor: true,
            editorMode: 'edit',
            editorTitle: '重命名批次',
            editingId: raw.id,
            formName: typeof raw.name === 'string' ? raw.name : '',
            formError: '',
            submittingBatch: false,
        });
    },

    closeEditor() {
        if (this.data.submittingBatch || this.data.editorClosing) {
            return;
        }
        this.setData({ editorClosing: true });
        setTimeout(() => {
            this.setData({ showEditor: false, editorClosing: false, formError: '' });
        }, 180);
    },

    handleNameInput(event) {
        this.setData({ formName: event.detail.value, formError: '' });
    },

    handleSave() {
        if (this.data.submittingBatch) {
            return;
        }
        const name = typeof this.data.formName === 'string' ? this.data.formName.trim() : '';
        if (name === '') {
            this.setData({ formError: '请填写批次名称' });
            return;
        }

        const request = this.data.editorMode === 'edit'
            ? batchStore.update(this.data.editingId, { name })
            : batchStore.create({
                profileId: this.activeProfileId || '',
                name,
                note: '',
            });

        this.setData({ submittingBatch: true, formError: '' });
        request.then(result => {
            if (result.error) {
                this.setData({
                    formError: result.error.message || '保存失败，请稍后重试',
                    submittingBatch: false,
                });
                return;
            }
            this.setData({ showEditor: false, submittingBatch: false });
            wx.showToast({
                title: this.data.editorMode === 'edit' ? '已重命名' : '已创建批次',
                icon: 'success',
            });
            this.loadItems();
        });
    },

    handleDelete(event) {
        const batchId = event.currentTarget.dataset.id;
        const raw = this.findRawById(batchId);
        if (!raw) {
            return;
        }
        const count = countBatchRecords(batchId, this.rawTempAll || [], this.rawMedAll || []);
        wx.showModal({
            title: '确认删除批次',
            content: count > 0
                ? '删除「' + raw.name + '」将同时删除批次内的 ' + count + ' 条体温与用药记录，删除后不可恢复！'
                : '删除「' + raw.name + '」后不可恢复，是否继续？',
            confirmText: count > 0 ? '全部删除' : '删除',
            confirmColor: '#B3261E',
            success: result => {
                if (!result.confirm) {
                    return;
                }
                this.deleteBatch(batchId);
            },
        });
    },

    // 删除批次：批次内的全部体温与用药记录一并删除
    deleteBatch(batchId) {
        const remainingTemps = (this.rawTempAll || []).filter(item => item.batchId !== batchId);
        const remainingMeds = (this.rawMedAll || []).filter(item => item.batchId !== batchId);
        Promise.all([
            tempStore.replace(remainingTemps),
            medStore.replace(remainingMeds),
            batchStore.remove(batchId),
        ]).then(results => {
            const failed = results.find(item => item.error);
            if (failed && failed.error) {
                wx.showToast({ title: failed.error.message || '删除失败', icon: 'none' });
                this.loadItems();
                return;
            }
            wx.showToast({ title: '已删除批次及内部记录', icon: 'success' });
            this.loadItems();
        });
    },

    findRawById(batchId) {
        const list = this.rawBatches || [];
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === batchId) {
                return list[i];
            }
        }
        return null;
    },
});

function countBatchRecords(batchId, temps, meds) {
    let count = 0;
    (temps || []).forEach(item => {
        if (item.batchId === batchId) {
            count += 1;
        }
    });
    (meds || []).forEach(item => {
        if (item.batchId === batchId) {
            count += 1;
        }
    });
    return count;
}

// 批次起始时间：批次内最早一条记录的时间；无记录时显示批次创建时间
function formatBatchStart(batchId, temps, meds) {
    let earliest = NaN;
    (temps || []).forEach(item => {
        const ts = Number(item.measuredAt);
        if (item.batchId === batchId && Number.isFinite(ts) && (Number.isNaN(earliest) || ts < earliest)) {
            earliest = ts;
        }
    });
    (meds || []).forEach(item => {
        const ts = Number(item.takenAt);
        if (item.batchId === batchId && Number.isFinite(ts) && (Number.isNaN(earliest) || ts < earliest)) {
            earliest = ts;
        }
    });
    if (Number.isFinite(earliest)) {
        return '起于 ' + formatShortDate(earliest);
    }
    return '';
}
