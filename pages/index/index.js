const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    feverLevel,
    formatDateTime,
    formatShortDate,
    todayStart,
    getActiveProfile,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });
const batchStore = createListStore({ storageKey: BATCH_STORE_KEY, sortKey: 'updatedAt' });

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        profileName: '',
        profileRelation: '',
        hasProfile: false,
        todayTempCount: 0,
        todayMedCount: 0,
        latestTemp: null,
        batchItems: [],
        hasBatches: false,
        crossViews: [
            { key: 'temp', text: '体温历史', path: '/pages/temp-record/temp-record', emoji: '🌡️' },
            { key: 'med', text: '用药历史', path: '/pages/med-record/med-record', emoji: '💊' },
            { key: 'medNames', text: '药名库', path: '/pages/med-name-manage/med-name-manage', emoji: '📖' },
            { key: 'chart', text: '体温图表', path: '/pages/chart-report/chart-report', emoji: '📊' },
        ],
        // 首页直接新建批次
        showBatchEditor: false,
        formBatchName: '',
        formBatchError: '',
        submittingBatch: false,
        batchFocus: '',
    },

    onShow() {
        this.loadData();
    },

    handleRetry() {
        this.loadData();
    },

    // 输入框聚焦态
    handleFieldFocus() {
        this.setData({ batchFocus: 'name' });
    },

    handleFieldBlur() {
        this.setData({ batchFocus: '' });
    },

    loadData() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        Promise.all([profileStore.list(), tempStore.list(), medStore.list(), batchStore.list()]).then(results => {
            const profileResult = results[0];
            const tempResult = results[1];
            const medResult = results[2];
            const batchResult = results[3];

            if (profileResult.error || tempResult.error || medResult.error || batchResult.error) {
                const failed = results.find(item => item.error);
                this.setData({
                    viewState: 'error',
                    errorMessage: (failed && failed.error && failed.error.message) || '加载失败，请稍后重试',
                });
                return;
            }

            const profiles = profileResult.data;
            const activeProfile = getActiveProfile(profiles);
            if (!activeProfile) {
                this.setData({
                    viewState: 'empty',
                    hasProfile: false,
                    profileName: '',
                    profileRelation: '',
                });
                return;
            }

            const profileId = activeProfile.id;
            this.activeProfileId = profileId;
            const today = todayStart();
            const temps = (tempResult.data || []).filter(item => item.profileId === profileId);
            const meds = (medResult.data || []).filter(item => item.profileId === profileId);
            const todayTemps = temps.filter(item => toNumber(item.measuredAt) >= today).length;
            const todayMeds = meds.filter(item => toNumber(item.takenAt) >= today).length;

            let latestTemp = null;
            if (temps.length > 0) {
                const latest = temps[0];
                const level = feverLevel(latest.value);
                latestTemp = {
                    valueText: formatTempValue(latest.value),
                    levelColor: level.color,
                };
            }

            // 批次列表：当前档案下的批次，附记录数与起始时间
            const batches = (batchResult.data || []).filter(item => item.profileId === profileId);
            const batchItems = batches.map(batch => ({
                id: batch.id,
                name: batch.name,
                count: countBatchRecords(batch.id, temps, meds),
                startText: formatBatchStart(batch.id, temps, meds),
                updatedText: formatDateTime(batch.updatedAt),
            }));

            this.setData({
                viewState: 'ready',
                hasProfile: true,
                profileName: activeProfile.name,
                profileRelation: activeProfile.relation,
                todayTempCount: todayTemps,
                todayMedCount: todayMeds,
                latestTemp,
                batchItems,
                hasBatches: batchItems.length > 0,
            });
        });
    },

    handleCrossView(event) {
        const path = event.currentTarget.dataset.path;
        if (!path) {
            return;
        }
        wx.navigateTo({
            url: path,
            fail: () => {
                wx.showToast({ title: '页面暂未开放', icon: 'none' });
            },
        });
    },

    goProfileManage() {
        wx.navigateTo({ url: '/pages/profile-manage/profile-manage' });
    },

    goBatchManage() {
        wx.navigateTo({ url: '/pages/batch-manage/batch-manage' });
    },

    openBatchDetail(event) {
        const batchId = event.currentTarget.dataset.id;
        if (!batchId) {
            return;
        }
        wx.navigateTo({ url: '/pages/batch-detail/batch-detail?id=' + batchId });
    },

    // ---- 首页直接新建批次 ----

    openBatchEditor() {
        this.setData({
            showBatchEditor: true,
            formBatchName: '',
            formBatchError: '',
            submittingBatch: false,
        });
    },

    closeBatchEditor() {
        if (this.data.submittingBatch) {
            return;
        }
        this.setData({ showBatchEditor: false, formBatchError: '' });
    },

    handleBatchNameInput(event) {
        this.setData({ formBatchName: event.detail.value, formBatchError: '' });
    },

    handleCreateBatch() {
        if (this.data.submittingBatch) {
            return;
        }
        const name = typeof this.data.formBatchName === 'string' ? this.data.formBatchName.trim() : '';
        if (name === '') {
            this.setData({ formBatchError: '请填写批次名称' });
            return;
        }
        this.setData({ submittingBatch: true, formBatchError: '' });
        batchStore.create({
            profileId: this.activeProfileId || '',
            name,
            note: '',
        }).then(result => {
            if (result.error) {
                this.setData({
                    formBatchError: result.error.message || '保存失败，请稍后重试',
                    submittingBatch: false,
                });
                return;
            }
            this.setData({ showBatchEditor: false, submittingBatch: false });
            wx.showToast({ title: '已创建批次', icon: 'success' });
            this.loadData();
        });
    },
});

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

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

function formatTempValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '--';
    }
    return num.toFixed(1);
}
