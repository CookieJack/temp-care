// 业务工具：时间格式化、体温分级、剂量格式化、档案选择等。
// 所有函数返回纯数据，供页面 JS 组装后 setData，WXML 内不做复杂计算。

const PROFILE_STORE_KEY = 'ob_health_profiles';
const ACTIVE_PROFILE_KEY = 'ob_health_active_profile';
const TEMP_STORE_KEY = 'ob_temp_records';
const MED_STORE_KEY = 'ob_med_records';
const BATCH_STORE_KEY = 'ob_health_batches';
const MED_NAME_STORE_KEY = 'ob_med_name_library';

const FEVER_LOW = 37.3;   // 低热阈值
const FEVER_BURST = 38.5; // 联动用药 / 图表“爆表”高亮阈值

const MEASURE_METHODS = ['腋下', '口腔', '耳温', '额温', '肛温'];
const MED_UNITS = ['mg', 'ml', '片', '粒', '支', '袋', '滴'];
const RELATIONS = ['本人', '家人', '朋友', '其他'];

const LEVEL_COLORS = {
    normal: '#00b42a',
    lowTemp: '#2b7de9',
    lowFever: '#ff9a2e',
    midFever: '#f77a2f',
    highFever: '#e64531',
    superFever: '#a9170f',
};

// 体温分级：<35.5 偏低，<37.3 正常，<38.1 低热，<39.1 中度发热，≤41 高热，>41 超高热
function feverLevel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return { key: 'normal', label: '未知', color: LEVEL_COLORS.normal, burst: false };
    }
    if (num < 35.5) {
        return { key: 'lowTemp', label: '体温偏低', color: LEVEL_COLORS.lowTemp, burst: false };
    }
    if (num < FEVER_LOW) {
        return { key: 'normal', label: '正常', color: LEVEL_COLORS.normal, burst: false };
    }
    if (num < 38.1) {
        return { key: 'lowFever', label: '低热', color: LEVEL_COLORS.lowFever, burst: num >= FEVER_BURST };
    }
    if (num < 39.1) {
        return { key: 'midFever', label: '中度发热', color: LEVEL_COLORS.midFever, burst: true };
    }
    if (num <= 41) {
        return { key: 'highFever', label: '高热', color: LEVEL_COLORS.highFever, burst: true };
    }
    return { key: 'superFever', label: '超高热', color: LEVEL_COLORS.superFever, burst: true };
}

function pad(value) {
    return value < 10 ? '0' + String(value) : String(value);
}

function formatDateTime(ts) {
    const date = new Date(toTs(ts));
    if (Number.isNaN(date.getTime())) {
        return '--';
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function formatDate(ts) {
    const date = new Date(toTs(ts));
    if (Number.isNaN(date.getTime())) {
        return '--';
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function formatShortDate(ts) {
    const date = new Date(toTs(ts));
    if (Number.isNaN(date.getTime())) {
        return '--';
    }
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function formatClock(ts) {
    const date = new Date(toTs(ts));
    if (Number.isNaN(date.getTime())) {
        return '--';
    }
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// 与 iOS 兼容的时间解析：避免 new Date('YYYY-MM-DD HH:mm') 在 iOS 上返回 NaN
function dateTimeToTs(dateStr, timeStr) {
    const dateParts = typeof dateStr === 'string' ? dateStr.split('-') : [];
    const timeParts = typeof timeStr === 'string' ? timeStr.split(':') : [];
    if (dateParts.length !== 3 || timeParts.length !== 2) {
        return Date.now();
    }
    const ts = new Date(
        Number(dateParts[0]),
        Number(dateParts[1]) - 1,
        Number(dateParts[2]),
        Number(timeParts[0]),
        Number(timeParts[1])
    ).getTime();
    return Number.isFinite(ts) ? ts : Date.now();
}

function todayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 当天 0 点起往前 days 天（含今天）的时间范围起点
function daysRangeStart(days) {
    return todayStart() - (days - 1) * 24 * 60 * 60 * 1000;
}

function isSameDay(ts, baseTs) {
    const date = new Date(toTs(ts));
    const base = new Date(toTs(baseTs));
    return date.getFullYear() === base.getFullYear()
        && date.getMonth() === base.getMonth()
        && date.getDate() === base.getDate();
}

function formatDose(dose, unit) {
    const num = Number(dose);
    const unitText = typeof unit === 'string' && unit !== '' ? unit : '';
    if (!Number.isFinite(num) || num <= 0) {
        return unitText === '' ? '未记录剂量' : unitText;
    }
    return (num % 1 === 0 ? String(num) : num.toFixed(1)) + unitText;
}

function toTs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function sortByTimeAsc(items, timeKey) {
    const key = typeof timeKey === 'string' && timeKey !== '' ? timeKey : 'measuredAt';
    return items.slice().sort((a, b) => toNumber(a[key]) - toNumber(b[key]));
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// ---- 档案选择（active profile） ----

function getActiveProfileId() {
    const value = wx.getStorageSync(ACTIVE_PROFILE_KEY);
    return typeof value === 'string' && value !== '' ? value : '';
}

function setActiveProfileId(id) {
    if (typeof id === 'string' && id !== '') {
        wx.setStorageSync(ACTIVE_PROFILE_KEY, id);
    }
}

// 首次启动时创建默认档案，保证各页面开箱可用
function ensureDefaultProfile(profileStore) {
    return profileStore.list().then(result => {
        if (result.error || !Array.isArray(result.data)) {
            return null;
        }
        const profiles = result.data;
        if (profiles.length === 0) {
            return profileStore.create({ name: '本人', relation: '本人', note: '' }).then(created => {
                if (!created.error && created.data && created.data.id) {
                    setActiveProfileId(created.data.id);
                    return created.data;
                }
                return null;
            });
        }
        const activeId = getActiveProfileId();
        const exists = profiles.some(profile => profile.id === activeId);
        if (!exists) {
            setActiveProfileId(profiles[0].id);
        }
        return null;
    });
}

function getActiveProfile(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        return null;
    }
    const activeId = getActiveProfileId();
    for (let i = 0; i < profiles.length; i += 1) {
        if (profiles[i].id === activeId) {
            return profiles[i];
        }
    }
    return profiles[0];
}

// 药名快捷建议：药名库（用户维护 + 提交自动记忆）优先，历史用药按频次补充。
// 同名药可能来自不同厂商：按「药名+厂商」组合去重，返回 [{ name, manufacturer, label }]，
// label = 有厂商时显示「药名（厂商）」，用于芯片展示与选择携带。
function collectMedNameSuggestions(libraryItems, medRecords, limit) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 8;
    const seen = {};
    const suggestions = [];
    const pushSuggestion = function (name, manufacturer) {
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        const trimmedManu = typeof manufacturer === 'string' ? manufacturer.trim() : '';
        if (trimmedName === '') {
            return;
        }
        const label = trimmedManu !== '' ? trimmedName + '（' + trimmedManu + '）' : trimmedName;
        const key = trimmedName + '\u0001' + trimmedManu;
        if (seen[key] || suggestions.length >= safeLimit) {
            return;
        }
        seen[key] = true;
        suggestions.push({ name: trimmedName, manufacturer: trimmedManu, label });
    };
    (libraryItems || []).forEach(item => {
        if (item && typeof item === 'object') {
            pushSuggestion(item.name, item.manufacturer);
        } else if (typeof item === 'string') {
            pushSuggestion(item, '');
        }
    });
    const counts = {};
    const order = [];
    (medRecords || []).forEach(item => {
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name === '') {
            return;
        }
        const manufacturer = typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '';
        const key = name + '\u0001' + manufacturer;
        if (!counts[key]) {
            counts[key] = { count: 0, name, manufacturer };
            order.push(key);
        }
        counts[key].count += 1;
    });
    order
        .sort((left, right) => counts[right].count - counts[left].count)
        .forEach(key => {
            const entry = counts[key];
            pushSuggestion(entry.name, entry.manufacturer);
        });
    return suggestions;
}

// 从本次提交的药物条目中筛选出药名库里尚未收录的（按「药名+厂商」组合判重，用于自动记忆）
function collectNewMedNames(entries, libraryItems) {
    const existing = {};
    (libraryItems || []).forEach(item => {
        const name = item && typeof item.name === 'string' ? item.name.trim() : '';
        const manufacturer = item && typeof item.manufacturer === 'string' ? item.manufacturer.trim() : '';
        if (name !== '') {
            existing[name + '\u0001' + manufacturer] = true;
        }
    });
    const seen = {};
    const fresh = [];
    (entries || []).forEach(raw => {
        const name = raw && typeof raw.name === 'string' ? raw.name.trim() : '';
        const manufacturer = raw && typeof raw.manufacturer === 'string' ? raw.manufacturer.trim() : '';
        const key = name + '\u0001' + manufacturer;
        if (name === '' || existing[key] || seen[key]) {
            return;
        }
        seen[key] = true;
        fresh.push({ name, manufacturer });
    });
    return fresh;
}

module.exports = {
    PROFILE_STORE_KEY,
    ACTIVE_PROFILE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    BATCH_STORE_KEY,
    MED_NAME_STORE_KEY,
    collectMedNameSuggestions,
    collectNewMedNames,
    FEVER_LOW,
    FEVER_BURST,
    MEASURE_METHODS,
    MED_UNITS,
    RELATIONS,
    LEVEL_COLORS,
    feverLevel,
    formatDateTime,
    formatDate,
    formatShortDate,
    formatClock,
    dateTimeToTs,
    todayStart,
    daysRangeStart,
    isSameDay,
    formatDose,
    sortByTimeAsc,
    getActiveProfileId,
    setActiveProfileId,
    ensureDefaultProfile,
    getActiveProfile,
};
