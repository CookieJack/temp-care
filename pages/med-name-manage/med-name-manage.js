// 药名库维护页：查看 / 添加 / 编辑 / 删除快捷药名。
// 条目含厂商名称与过期时间（均选填）；保存记录时未收录的药名会自动加入此库。

const { createListStore } = require('../../utils/store');
const {
    MED_NAME_STORE_KEY,
    formatDateTime,
} = require('../../utils/common');

const medNameStore = createListStore({ storageKey: MED_NAME_STORE_KEY, sortKey: 'createdAt' });

function pad(value) {
    return value < 10 ? '0' + String(value) : String(value);
}

function todayText() {
    const now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        items: [],
        showEditor: false,
        editorClosing: false,
        editorMode: 'create',
        editorTitle: '添加药品名称',
        editingId: '',
        formName: '',
        formManufacturer: '',
        formExpiryDate: '',
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

        medNameStore.list().then(result => {
            if (result.error) {
                this.setData({
                    viewState: 'error',
                    errorMessage: result.error.message || '加载失败，请稍后重试',
                });
                return;
            }
            const today = todayText();
            const items = (result.data || []).map(item => {
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
            this.setData({
                viewState: items.length === 0 ? 'empty' : 'ready',
                items,
            });
        });
    },

    openEditor() {
        this.setData({
            showEditor: true,
            editorMode: 'create',
            editorTitle: '添加药品名称',
            editingId: '',
            formName: '',
            formManufacturer: '',
            formExpiryDate: '',
            formError: '',
            submitting: false,
        });
    },

    openEdit(event) {
        const itemId = event.currentTarget.dataset.id;
        const target = this.data.items.find(item => item.id === itemId);
        if (!target) {
            return;
        }
        this.setData({
            showEditor: true,
            editorMode: 'edit',
            editorTitle: '编辑药品名称',
            editingId: target.id,
            formName: target.name,
            formManufacturer: target.manufacturer,
            formExpiryDate: target.expiryDate,
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

    handleManufacturerInput(event) {
        this.setData({ formManufacturer: event.detail.value });
    },

    handleExpiryChange(event) {
        this.setData({ formExpiryDate: event.detail.value });
    },

    clearExpiry() {
        this.setData({ formExpiryDate: '' });
    },

    handleSave() {
        if (this.data.submitting) {
            return;
        }
        const name = typeof this.data.formName === 'string' ? this.data.formName.trim() : '';
        if (name === '') {
            this.setData({ formError: '请填写药品名称' });
            return;
        }
        // 重复校验：编辑时排除自身
        // 重复校验：同名同厂商才算重复（同名不同厂商是不同药，允许并存）
        const manufacturer = typeof this.data.formManufacturer === 'string' ? this.data.formManufacturer.trim() : '';
        const duplicated = this.data.items.some(item =>
            item.name === name && (item.manufacturer || '') === manufacturer && item.id !== this.data.editingId
        );
        if (duplicated) {
            this.setData({ formError: '同名同厂商的药品已在库中，请换一个名称或修改厂商' });
            return;
        }

        const payload = {
            name,
            manufacturer: typeof this.data.formManufacturer === 'string' ? this.data.formManufacturer.trim() : '',
            expiryDate: this.data.formExpiryDate || '',
        };

        this.setData({ submitting: true, formError: '' });
        const request = this.data.editorMode === 'edit'
            ? medNameStore.update(this.data.editingId, payload)
            : medNameStore.create(payload);

        request.then(result => {
            if (result.error) {
                this.setData({
                    formError: result.error.message || '保存失败，请稍后重试',
                    submitting: false,
                });
                return;
            }
            this.setData({ showEditor: false, submitting: false });
            wx.showToast({ title: this.data.editorMode === 'edit' ? '已更新' : '已加入药名库', icon: 'success' });
            this.loadItems();
        });
    },

    handleDelete(event) {
        const itemId = event.currentTarget.dataset.id;
        const target = this.data.items.find(item => item.id === itemId);
        if (!target) {
            return;
        }
        wx.showModal({
            title: '确认移除',
            content: '从药名库移除「' + target.name + '」后，录入页的快捷选择中将不再出现；已有用药记录不受影响。',
            confirmColor: '#B3261E',
            success: result => {
                if (!result.confirm) {
                    return;
                }
                medNameStore.remove(itemId).then(removeResult => {
                    if (removeResult.error) {
                        wx.showToast({ title: removeResult.error.message || '删除失败', icon: 'none' });
                        return;
                    }
                    wx.showToast({ title: '已移除', icon: 'success' });
                    this.loadItems();
                });
            },
        });
    },
});
