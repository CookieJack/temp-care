// 用药历史页：只读查看，按批次卡片分组摆放（未归组记录收在「未归组」卡片）。
// 记录的编辑与删除在「批次详情」内进行，本页不提供任何修改入口。

const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    formatDose,
    formatDateTime,
    getActiveProfile,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });
const batchStore = createListStore({ storageKey: BATCH_STORE_KEY, sortKey: 'updatedAt' });

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        profileName: '',
        groups: [],
        hasGroups: false,
    },

    onShow() {
        this.loadItems();
    },

    handleRetry() {
        this.loadItems();
    },

    loadItems() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        Promise.all([profileStore.list(), medStore.list(), batchStore.list()]).then(results => {
            const profileResult = results[0];
            const medResult = results[1];
            const batchResult = results[2];
            if (profileResult.error || medResult.error || batchResult.error) {
                const failed = [profileResult, medResult, batchResult].find(item => item.error);
                this.setData({
                    viewState: 'error',
                    errorMessage: (failed && failed.error && failed.error.message) || '加载失败，请稍后重试',
                });
                return;
            }

            const activeProfile = getActiveProfile(profileResult.data);
            if (!activeProfile) {
                this.setData({ viewState: 'empty', profileName: '', groups: [], hasGroups: false });
                return;
            }

            // 先为当前档案的每个批次建组（批次按更新时间倒序），未归组固定在最后
            const groups = [];
            const groupMap = {};
            (batchResult.data || [])
                .filter(item => item.profileId === activeProfile.id)
                .forEach(batch => {
                    const group = { id: batch.id, name: batch.name, items: [] };
                    groups.push(group);
                    groupMap[batch.id] = group;
                });
            const ungrouped = { id: '', name: '未归组', items: [] };
            groups.push(ungrouped);
            groupMap[''] = ungrouped;

            const meds = (medResult.data || []).filter(item => item.profileId === activeProfile.id);
            meds.forEach(item => {
                const key = typeof item.batchId === 'string' ? item.batchId : '';
                const group = groupMap[key] || ungrouped;
                group.items.push(mapMedItem(item));
            });

            const visibleGroups = groups.filter(group => group.items.length > 0);
            this.setData({
                profileName: activeProfile.name,
                groups: visibleGroups,
                hasGroups: visibleGroups.length > 0,
                viewState: visibleGroups.length === 0 ? 'empty' : 'ready',
            });
        });
    },

    openBatchDetail(event) {
        const batchId = event.currentTarget.dataset.id;
        if (!batchId) {
            return;
        }
        wx.navigateTo({ url: '/pages/batch-detail/batch-detail?id=' + batchId });
    },
});

function mapMedItem(item) {
    return {
        id: item.id,
        name: typeof item.name === 'string' && item.name !== '' ? item.name : '未命名药品',
        manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : '',
        doseText: formatDose(item.dose, item.unit),
        timeText: formatDateTime(item.takenAt),
        noteText: typeof item.note === 'string' && item.note !== '' ? item.note : '',
        sourceLabel: item.source === 'temp-link' ? '体温联动' : '',
    };
}
