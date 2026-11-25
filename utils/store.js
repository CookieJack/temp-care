// 通用本地列表存储：与 list-crud 骨架的 item-store 保持一致的 { data, error } 契约。
// 页面只通过 list / create / update / remove / replace 访问存储，不直接读写 wx storage。
// 数据将来上云时，把页面里的 store 替换为 cloud-service 的 createTableAccess 返回对象即可。

const NOT_FOUND_OR_FORBIDDEN_ERROR = {
    code: 'NOT_FOUND_OR_FORBIDDEN',
    message: '没有保存成功，这条记录可能已被删除或无权修改',
};

const INVALID_ID_ERROR = {
    code: 'INVALID_ID',
    message: '缺少记录 id',
};

const INVALID_PAYLOAD_ERROR = {
    code: 'INVALID_PAYLOAD',
    message: '没有可提交的字段',
};

let idCounter = 0;

function createListStore(options) {
    const config = options || {};
    if (typeof config.storageKey !== 'string' || config.storageKey.trim() === '') {
        throw new TypeError('storageKey 不能为空');
    }
    const storageKey = config.storageKey;
    const sortKey = typeof config.sortKey === 'string' && config.sortKey !== '' ? config.sortKey : 'updatedAt';

    return {
        list() {
            return safely(() => ({ data: readItems(storageKey, sortKey), error: null }));
        },

        create(payload) {
            return safely(() => {
                if (!isPlainObject(payload) || Object.keys(payload).length === 0) {
                    return { data: null, error: INVALID_PAYLOAD_ERROR };
                }
                const now = Date.now();
                const item = Object.assign({}, payload, {
                    id: createItemId(now),
                    createdAt: now,
                    updatedAt: now,
                });
                const items = readItems(storageKey, sortKey);
                items.unshift(item);
                writeItems(storageKey, items);
                return { data: item, error: null };
            });
        },

        update(id, patch) {
            if (isInvalidId(id)) {
                return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
            }
            return safely(() => {
                if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
                    return { data: null, error: INVALID_PAYLOAD_ERROR };
                }
                const items = readItems(storageKey, sortKey);
                const index = findIndexById(items, String(id));
                if (index === -1) {
                    return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
                }
                const next = Object.assign({}, items[index], patch, { updatedAt: Date.now() });
                items[index] = next;
                writeItems(storageKey, items);
                return { data: next, error: null };
            });
        },

        remove(id) {
            if (isInvalidId(id)) {
                return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
            }
            return safely(() => {
                const itemId = String(id);
                const items = readItems(storageKey, sortKey);
                const filtered = items.filter(item => item.id !== itemId);
                if (items.length - filtered.length === 0) {
                    return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
                }
                writeItems(storageKey, filtered);
                return { data: { removed: 1 }, error: null };
            });
        },

        // 用整表替换实现批量删除等操作：调用方先 list，再过滤，最后 replace。
        replace(items) {
            return safely(() => {
                if (!Array.isArray(items)) {
                    return { data: null, error: INVALID_PAYLOAD_ERROR };
                }
                const valid = items.filter(isStoredItem).map(normalizeStoredItem);
                writeItems(storageKey, valid);
                return { data: { count: valid.length }, error: null };
            });
        },
    };
}

function safely(executor) {
    return Promise.resolve()
        .then(executor)
        .catch(error => ({ data: null, error: toClientException(error) }));
}

function toClientException(error) {
    const message = error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : '';
    return { code: 'CLIENT_EXCEPTION', message };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readItems(storageKey, sortKey) {
    const value = wx.getStorageSync(storageKey);
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(isStoredItem)
        .map(normalizeStoredItem)
        .sort((left, right) => toNumber(right[sortKey]) - toNumber(left[sortKey]));
}

function writeItems(storageKey, items) {
    wx.setStorageSync(storageKey, items);
}

function normalizeStoredItem(item) {
    const normalized = Object.assign({}, item);
    normalized.id = String(item.id);
    return normalized;
}

function findIndexById(items, itemId) {
    for (let i = 0; i < items.length; i += 1) {
        if (items[i].id === itemId) {
            return i;
        }
    }
    return -1;
}

function createItemId(timestamp) {
    idCounter = (idCounter + 1) % 1000000;
    return String(timestamp) + '-' + String(idCounter);
}

function isInvalidId(id) {
    if (typeof id === 'string') {
        return id.trim() === '';
    }
    if (typeof id === 'number') {
        return !Number.isFinite(id);
    }
    return true;
}

function isStoredItem(item) {
    return item !== null
        && typeof item === 'object'
        && !Array.isArray(item)
        && (typeof item.id === 'string' || typeof item.id === 'number');
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

module.exports = {
    createListStore,
};
