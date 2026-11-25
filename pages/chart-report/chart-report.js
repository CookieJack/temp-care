const { createListStore } = require('../../utils/store');
const {
    PROFILE_STORE_KEY,
    TEMP_STORE_KEY,
    MED_STORE_KEY,
    FEVER_BURST,
    feverLevel,
    formatDose,
    formatDateTime,
    formatShortDate,
    daysRangeStart,
    getActiveProfile,
    sortByTimeAsc,
} = require('../../utils/common');

const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
const tempStore = createListStore({ storageKey: TEMP_STORE_KEY, sortKey: 'measuredAt' });
const medStore = createListStore({ storageKey: MED_STORE_KEY, sortKey: 'takenAt' });

const RANGES = [
    { days: 7, label: '近7天' },
    { days: 30, label: '近30天' },
    { days: 90, label: '近90天' },
];

Page({
    data: {
        profileName: '',
        viewState: 'loading',
        errorMessage: '',
        ranges: RANGES,
        rangeIndex: 0,
        rangeLoading: false,
        stats: null,
        medTimeline: [],
        hasMedData: false,
    },

    onReady() {
        this.ensureChart();
    },

    onShow() {
        this.loadAndRender();
    },

    handleRetry() {
        this.loadAndRender();
    },

    handleRangeChange(event) {
        const raw = event.currentTarget.dataset.index;
        const index = Number(raw);
        if (!Number.isFinite(index) || index < 0 || index === this.data.rangeIndex) {
            return;
        }
        // 上一次切换还在加载中时忽略新的点击
        if (this.data.rangeLoading) {
            return;
        }
        // 切换时间范围：不翻转页面状态，在图表卡片上显示加载动画
        this.setData({ rangeIndex: index, rangeLoading: true });
        this.refreshData().then(() => {
            this.setData({ rangeLoading: false });
        });
    },

    // canvas 节点恒渲染（hidden 只隐藏不销毁），初始化带重试：
    // 首次进入时 canvas 可能仍处于 hidden（尺寸为 0）或渲染尚未完成，
    // 每隔 100ms 重查一次，最多 20 次；成功后绘制上下文终身有效，
    // 切换时间范围不再出现节点销毁导致的空白图。
    ensureChart(retryCount) {
        if (this.chartReady) {
            if (this.pendingPoints) {
                const cached = this.pendingPoints;
                this.pendingPoints = null;
                this.drawChart(cached);
            }
            return;
        }
        const attempt = typeof retryCount === 'number' ? retryCount : 0;
        wx.createSelectorQuery().select('#tempChart').fields({ node: true, size: true }).exec(res => {
            if (this.chartReady) {
                return;
            }
            if (!res || !res[0] || !res[0].node || !res[0].width || !res[0].height) {
                if (attempt < 20) {
                    setTimeout(() => {
                        this.ensureChart(attempt + 1);
                    }, 100);
                }
                return;
            }
            const node = res[0].node;
            const width = res[0].width;
            const height = res[0].height;
            let dpr = 2;
            try {
                if (typeof wx.getWindowInfo === 'function') {
                    dpr = wx.getWindowInfo().pixelRatio || 2;
                } else {
                    dpr = wx.getSystemInfoSync().pixelRatio || 2;
                }
            } catch (e) {
                dpr = 2;
            }
            node.width = Math.round(width * dpr);
            node.height = Math.round(height * dpr);
            const ctx = node.getContext('2d');
            ctx.scale(dpr, dpr);

            this.chartCtx = ctx;
            this.chartWidth = width;
            this.chartHeight = height;
            this.chartReady = true;

            const cached = this.pendingPoints;
            this.pendingPoints = null;
            this.drawChart(cached === undefined ? [] : cached);
        });
    },

    loadAndRender() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        return this.refreshData();
    },

    // 拉取数据并渲染图表/统计/时间线（首次进入与切换时间范围共用），返回 Promise
    refreshData() {
        const rangeDays = RANGES[this.data.rangeIndex] ? RANGES[this.data.rangeIndex].days : 7;
        return Promise.all([profileStore.list(), tempStore.list(), medStore.list()]).then(results => {
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

            const activeProfile = getActiveProfile(profileResult.data);
            if (!activeProfile) {
                this.setData({ viewState: 'empty', profileName: '', stats: null, medTimeline: [], hasMedData: false });
                this.renderChart([]);
                return;
            }

            const profileId = activeProfile.id;
            const rangeStart = daysRangeStart(rangeDays);
            const tempsInRange = (tempResult.data || [])
                .filter(item => item.profileId === profileId && toNumber(item.measuredAt) >= rangeStart);
            const medsInRange = (medResult.data || [])
                .filter(item => item.profileId === profileId && toNumber(item.takenAt) >= rangeStart);

            const points = sortByTimeAsc(tempsInRange, 'measuredAt').map(item => {
                const level = feverLevel(item.value);
                return {
                    ts: toNumber(item.measuredAt),
                    value: Number(item.value),
                    color: level.color,
                    burst: level.burst === true || (Number.isFinite(Number(item.value)) && Number(item.value) >= FEVER_BURST),
                };
            });

            const stats = buildStats(points);
            const medTimeline = sortByTimeAsc(medsInRange, 'takenAt').map(item => ({
                id: item.id,
                timeText: formatDateTime(item.takenAt),
                name: typeof item.name === 'string' && item.name !== '' ? item.name : '未命名药品',
                doseText: formatDose(item.dose, item.unit),
                sourceLabel: item.source === 'temp-link' ? '体温联动' : '',
            }));

            this.setData({
                viewState: 'ready',
                profileName: activeProfile.name,
                stats,
                medTimeline,
                hasMedData: medTimeline.length > 0,
            });
            this.renderChart(points);
        });
    },

    renderChart(points) {
        this.lastPoints = points;
        if (this.chartReady) {
            this.drawChart(this.lastPoints);
            return;
        }
        // canvas 尚未就绪：暂存数据，由 ensureChart 初始化完成后绘制
        this.pendingPoints = points;
        this.ensureChart();
    },

    // 原生 canvas 2d 折线图：体温趋势 + 发热参考线 + ≥38.5°C 红色高亮
    drawChart(points) {
        const ctx = this.chartCtx;
        const width = this.chartWidth;
        const height = this.chartHeight;
        if (!ctx || !width || !height) {
            return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.font = '10px sans-serif';

        if (!points || points.length === 0) {
            ctx.fillStyle = '#49454F';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('该时间段内暂无体温数据', width / 2, height / 2);
            return;
        }

        const padL = 46;
        const padR = 16;
        const padT = 18;
        const padB = 28;
        const plotW = width - padL - padR;
        const plotH = height - padT - padB;
        const plotBottom = padT + plotH;

        let dataMin = points[0].value;
        let dataMax = points[0].value;
        points.forEach(point => {
            if (point.value < dataMin) dataMin = point.value;
            if (point.value > dataMax) dataMax = point.value;
        });
        const vMin = Math.floor(Math.min(36, dataMin) - 0.3);
        const vMax = Math.ceil(Math.max(38.6, dataMax) + 0.3);
        const domain = vMax - vMin;
        const yOf = value => padT + (vMax - value) / domain * plotH;

        const t0 = points[0].ts;
        const t1 = points[points.length - 1].ts;
        const timeSpan = Math.max(t1 - t0, 60 * 1000);
        const xOf = ts => (t1 === t0 ? padL + plotW / 2 : padL + (ts - t0) / timeSpan * plotW);

        // 横向网格与纵轴标签
        const step = domain <= 4 ? 0.5 : 1;
        const nSteps = Math.round(domain / step);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= nSteps; i += 1) {
            const value = vMin + i * step;
            const y = yOf(value);
            ctx.strokeStyle = '#E7E0EC';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(width - padR, y);
            ctx.stroke();
            ctx.fillStyle = '#49454F';
            ctx.fillText(value.toFixed(1), padL - 6, y);
        }

        // 发热参考线：37.3 低热阈值、38.5 高热阈值
        this.drawRefLine(ctx, width, padR, yOf, 37.3, vMin, vMax, '#E8710A');
        this.drawRefLine(ctx, width, padR, yOf, 38.5, vMin, vMax, '#B3261E');

        // 面积填充
        ctx.beginPath();
        points.forEach((point, index) => {
            const x = xOf(point.ts);
            const y = yOf(point.value);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.lineTo(xOf(t1), plotBottom);
        ctx.lineTo(xOf(t0), plotBottom);
        ctx.closePath();
        ctx.fillStyle = 'rgba(103, 80, 164, 0.08)';
        ctx.fill();

        // 折线
        ctx.beginPath();
        points.forEach((point, index) => {
            const x = xOf(point.ts);
            const y = yOf(point.value);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.strokeStyle = '#6750A4';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 数据点：正常蓝、发热橙红；≥38.5 加大并标数值（爆表高亮）
        points.forEach(point => {
            const x = xOf(point.ts);
            const y = yOf(point.value);
            const radius = point.burst ? 5 : 3.5;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = point.burst ? '#B3261E' : point.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            if (point.burst) {
                ctx.fillStyle = '#B3261E';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillText(point.value.toFixed(1), x, y - radius - 3);
                ctx.font = '10px sans-serif';
            }
        });

        // 横轴日期标签：最多 5 个均匀刻度
        const tickCount = Math.min(5, points.length);
        ctx.fillStyle = '#49454F';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (points.length === 1) {
            ctx.fillText(formatShortDate(points[0].ts), xOf(points[0].ts), height - padB + 8);
        } else {
            for (let k = 0; k < tickCount; k += 1) {
                const idx = Math.round(k * (points.length - 1) / (tickCount - 1));
                const point = points[idx];
                ctx.fillText(formatShortDate(point.ts), xOf(point.ts), height - padB + 8);
            }
        }
    },

    drawRefLine(ctx, width, padR, yOf, value, vMin, vMax, color) {
        if (value < vMin || value > vMax) {
            return;
        }
        const y = yOf(value);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(46, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(value), width - padR - 30, y - 3);
    },
});

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function buildStats(points) {
    if (!points || points.length === 0) {
        return null;
    }
    let maxPoint = points[0];
    let minPoint = points[0];
    let sum = 0;
    let burstCount = 0;
    points.forEach(point => {
        if (point.value > maxPoint.value) maxPoint = point;
        if (point.value < minPoint.value) minPoint = point;
        sum += point.value;
        if (point.burst) {
            burstCount += 1;
        }
    });
    return {
        count: points.length,
        burstCount,
        maxText: maxPoint.value.toFixed(1),
        maxTimeText: formatDateTime(maxPoint.ts),
        minText: minPoint.value.toFixed(1),
        minTimeText: formatDateTime(minPoint.ts),
        avgText: (sum / points.length).toFixed(1),
    };
}
