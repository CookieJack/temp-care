const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    RELATIONS,
    getActiveProfileId,
    setActiveProfileId,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        items: [],
        relations: RELATIONS,
        showEditor: false,
        editorClosing: false,
        editorMode: 'create',
        editorTitle: '新建档案',
        editingId: '',
        formName: '',
        formRelationIndex: 0,
        formNote: '',
        formError: '',
        submitting: false,
        focusField: '',
    },

    onShow() {
        this.loadItems();
    },

    handleRetry() {
        this.loadItems();
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

    loadItems() {
        this.setData({ viewState: 'loading', errorMessage: '' });

        Promise.all([profileStore.list(), tempStore.list(), medStore.list()]).then(results => {
            const profileResult = results[0];
            const tempResult = results[1];
            const medResult = results[2];
            if (profileResult.error || tempResult.error || medResult.error) {
                const failed = [profileResult, tempResult, medResult].find(item => item.error);
                this.setData({
                    viewState: 'error',
                    errorMessage: (failed && failed.error && failed.error.message) || '加载失败，请稍后重试',
                });
                return;
            }

            this.rawTempAll = tempResult.data || [];
            this.rawMedAll = medResult.data || [];
            this.rawProfiles = profileResult.data || [];
            const activeId = getActiveProfileId();
            const items = (profileResult.data || []).map(profile => ({
                id: profile.id,
                name: profile.name,
                relation: profile.relation,
                isActive: profile.id === activeId,
                count: countRecords(profile.id, this.rawTempAll, this.rawMedAll),
            }));
            this.setData({
                items,
                viewState: 'ready',
            });
        });
    },

    openCreate() {
        this.setData({
            showEditor: true,
            editorMode: 'create',
            editorTitle: '新建档案',
            editingId: '',
            formName: '',
            formRelationIndex: 0,
            formNote: '',
            formError: '',
            submitting: false,
        });
    },

    openEdit(event) {
        const itemId = event.currentTarget.dataset.id;
        const raw = this.findRawById(itemId);
        if (!raw) {
            return;
        }
        this.setData({
            showEditor: true,
            editorMode: 'edit',
            editorTitle: '编辑档案',
            editingId: raw.id,
            formName: typeof raw.name === 'string' ? raw.name : '',
            formRelationIndex: Math.max(0, RELATIONS.indexOf(typeof raw.relation === 'string' ? raw.relation : '')),
            formNote: typeof raw.note === 'string' ? raw.note : '',
            formError: '',
            submitting: false,
        });
    },

    closeEditor() {
        if (this.data.submitting || this.data.editorClosing) {
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

    handleRelationChip(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (Number.isFinite(index) && index >= 0) {
            this.setData({ formRelationIndex: index });
        }
    },

    handleNoteInput(event) {
        this.setData({ formNote: event.detail.value });
    },

    handleSave() {
        if (this.data.submitting) {
            return;
        }
        const name = typeof this.data.formName === 'string' ? this.data.formName.trim() : '';
        if (name === '') {
            this.setData({ formError: '请填写称呼' });
            return;
        }
        const payload = {
            name,
            relation: RELATIONS[this.data.formRelationIndex] || RELATIONS[0],
            note: typeof this.data.formNote === 'string' ? this.data.formNote.trim() : '',
        };

        const request = this.data.editorMode === 'edit'
            ? profileStore.update(this.data.editingId, payload)
            : profileStore.create(payload);

        this.setData({ submitting: true, formError: '' });
        request.then(result => {
            if (result.error) {
                this.setData({
                    formError: result.error.message || '保存失败，请稍后重试',
                    submitting: false,
                });
                return;
            }
            const created = !result.error && result.data ? result.data : null;
            // 新建第一个档案或当前档案缺失时，把新档案设为当前
            if (this.data.editorMode === 'create') {
                const hasActive = this.data.items.some(item => item.isActive);
                if (!hasActive && created) {
                    setActiveProfileId(created.id);
                }
            }
            this.setData({ showEditor: false, submitting: false });
            wx.showToast({
                title: this.data.editorMode === 'edit' ? '已更新档案' : '已创建档案',
                icon: 'success',
            });
            this.loadItems();
        });
    },

    handleSwitch(event) {
        const itemId = event.currentTarget.dataset.id;
        if (!itemId) {
            return;
        }
        setActiveProfileId(itemId);
        wx.showToast({ title: '已切换当前档案', icon: 'success' });
        this.loadItems();
    },

    handleDelete(event) {
        const itemId = event.currentTarget.dataset.id;
        const raw = this.findRawById(itemId);
        if (!raw) {
            return;
        }
        const count = countRecords(itemId, this.rawTempAll || [], this.rawMedAll || []);
        wx.showModal({
            title: '确认删除档案',
            content: count > 0
                ? '删除「' + raw.name + '」将同时删除其 ' + count + ' 条体温与用药记录，不可恢复。'
                : '删除「' + raw.name + '」后不可恢复，是否继续？',
            confirmColor: '#d4380d',
            success: result => {
                if (!result.confirm) {
                    return;
                }
                this.deleteProfile(itemId);
            },
        });
    },

    deleteProfile(profileId) {
        const keepTemps = (this.rawTempAll || []).filter(item => item.profileId !== profileId);
        const keepMeds = (this.rawMedAll || []).filter(item => item.profileId !== profileId);
        Promise.all([
            tempStore.replace(keepTemps),
            medStore.replace(keepMeds),
            profileStore.remove(profileId),
        ]).then(results => {
            const failed = results.find(item => item.error);
            if (failed && failed.error) {
                wx.showToast({ title: failed.error.message || '删除失败', icon: 'none' });
                this.loadItems();
                return;
            }
            const wasActive = getActiveProfileId() === profileId;
            const remaining = this.data.items.filter(item => item.id !== profileId);
            if (wasActive && remaining.length > 0) {
                setActiveProfileId(remaining[0].id);
            }
            wx.showToast({ title: '已删除档案', icon: 'success' });
            this.loadItems();
        });
    },

    findRawById(itemId) {
        const list = this.rawProfiles || [];
        for (let i = 0; i < list.length; i += 1) {
            if (list[i].id === itemId) {
                return list[i];
            }
        }
        return null;
    },
});

function countRecords(profileId, temps, meds) {
    let count = 0;
    (temps || []).forEach(item => {
        if (item.profileId === profileId) {
            count += 1;
        }
    });
    (meds || []).forEach(item => {
        if (item.profileId === profileId) {
            count += 1;
        }
    });
    return count;
}
