import { useCallback, useEffect, useRef, useState } from 'react';
import { StateCard } from '../../components/StateCard';
import { bootstrapApp } from '../../lib/bootstrap';
import {
  daysRangeStart,
  FEVER_BURST,
  feverLevel,
  formatDateTime,
  formatDose,
  formatShortDate,
  getActiveProfile,
  getActiveProfileId,
  sortByTimeAsc,
} from '../../lib/common';
import { medStore, profileStore, tempStore } from '../../lib/store';
import type { ViewState } from '../../lib/types';
import './index.css';

const RANGES = [
  { days: 7, label: '近7天' },
  { days: 30, label: '近30天' },
  { days: 90, label: '近90天' },
];

interface ChartPoint {
  ts: number;
  value: number;
  color: string;
  burst: boolean;
}

interface Stats {
  count: number;
  burstCount: number;
  maxText: string;
  maxTimeText: string;
  minText: string;
  minTimeText: string;
  avgText: string;
}

interface MedTimelineItem {
  id: string;
  timeText: string;
  name: string;
  doseText: string;
  sourceLabel: string;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildStats(points: ChartPoint[]): Stats | null {
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

// 原生 canvas 2d 折线图：体温趋势 + 发热参考线 + ≥38.5°C 红色高亮（逐段对齐小程序实现）
function drawChart(canvas: HTMLCanvasElement, points: ChartPoint[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) {
    return;
  }
  const dpr = window.devicePixelRatio || 2;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
  const yOf = (value: number) => padT + ((vMax - value) / domain) * plotH;

  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const timeSpan = Math.max(t1 - t0, 60 * 1000);
  const xOf = (ts: number) => (t1 === t0 ? padL + plotW / 2 : padL + ((ts - t0) / timeSpan) * plotW);

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
  const drawRefLine = (value: number, color: string) => {
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
  };
  drawRefLine(37.3, '#E8710A');
  drawRefLine(38.5, '#B3261E');

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
      const idx = Math.round((k * (points.length - 1)) / (tickCount - 1));
      const point = points[idx];
      ctx.fillText(formatShortDate(point.ts), xOf(point.ts), height - padB + 8);
    }
  }
}

export default function ChartReportPage() {
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileName, setProfileName] = useState('');
  const [rangeIndex, setRangeIndex] = useState(0);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [medTimeline, setMedTimeline] = useState<MedTimelineItem[]>([]);
  const [hasMedData, setHasMedData] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refreshData = useCallback(async (rangeDays: number) => {
    await bootstrapApp();
    const [profileResult, tempResult, medResult, storedActiveId] = await Promise.all([
      profileStore.list(),
      tempStore.list(),
      medStore.list(),
      getActiveProfileId(),
    ]);

    const failed = [profileResult, tempResult, medResult].find(item => item.error);
    if (failed?.error) {
      setViewState('error');
      setErrorMessage(failed.error.message || '加载失败，请稍后重试');
      return;
    }

    const active = getActiveProfile(profileResult.data, storedActiveId);
    if (!active) {
      setProfileName('');
      setStats(null);
      setPoints([]);
      setMedTimeline([]);
      setHasMedData(false);
      setViewState('empty');
      return;
    }

    const profileId = active.id;
    const rangeStart = daysRangeStart(rangeDays);
    const tempsInRange = (tempResult.data || []).filter(
      item => item.profileId === profileId && toNumber(item.measuredAt) >= rangeStart
    );
    const medsInRange = (medResult.data || []).filter(
      item => item.profileId === profileId && toNumber(item.takenAt) >= rangeStart
    );

    const nextPoints = sortByTimeAsc(tempsInRange, 'measuredAt').map(item => {
      const level = feverLevel(item.value);
      return {
        ts: toNumber(item.measuredAt),
        value: Number(item.value),
        color: level.color,
        burst:
          level.burst === true ||
          (Number.isFinite(Number(item.value)) && Number(item.value) >= FEVER_BURST),
      };
    });

    const nextTimeline = sortByTimeAsc(medsInRange, 'takenAt').map(item => ({
      id: item.id,
      timeText: formatDateTime(item.takenAt),
      name: typeof item.name === 'string' && item.name !== '' ? item.name : '未命名药品',
      doseText: formatDose(item.dose, item.unit),
      sourceLabel: item.source === 'temp-link' ? '体温联动' : '',
    }));

    setProfileName(active.name);
    setStats(buildStats(nextPoints));
    setPoints(nextPoints);
    setMedTimeline(nextTimeline);
    setHasMedData(nextTimeline.length > 0);
    setViewState('ready');
  }, []);

  const loadAndRender = useCallback(async () => {
    setViewState('loading');
    setErrorMessage('');
    await refreshData(RANGES[0].days);
  }, [refreshData]);

  useEffect(() => {
    void loadAndRender();
  }, [loadAndRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewState !== 'ready') {
      return;
    }
    const draw = () => drawChart(canvas, points);
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [points, viewState]);

  const handleRangeChange = async (index: number) => {
    if (index < 0 || index === rangeIndex || rangeLoading) {
      return;
    }
    // 切换时间范围：不翻转页面状态，只在图表卡片上显示加载动画
    setRangeIndex(index);
    setRangeLoading(true);
    await refreshData(RANGES[index].days);
    setRangeLoading(false);
  };

  return (
    <main className="page">
      {viewState === 'loading' ? (
        <StateCard kind="loading" title="正在加载" description="请稍候，图表马上准备好。" />
      ) : null}

      {viewState === 'empty' ? (
        <StateCard
          kind="empty"
          title="还没有档案"
          description="先创建档案并记录体温后，这里会生成趋势折线图。"
        />
      ) : null}

      {viewState === 'error' ? (
        <StateCard
          kind="error"
          title="加载失败"
          description={errorMessage}
          actionLabel="重试"
          onAction={() => void loadAndRender()}
        />
      ) : null}

      {viewState === 'ready' ? (
        <>
          <header className="md-head">
            <p className="md-head-eyebrow">CHART REPORT</p>
            <h1 className="md-head-title">体温图表</h1>
            <p className="md-head-sub">当前档案：{profileName} · 折线随记录自动更新</p>
          </header>

          <div className="segment" role="tablist" aria-label="时间范围">
            {RANGES.map((range, index) => (
              <button
                type="button"
                key={range.days}
                role="tab"
                aria-selected={rangeIndex === index}
                className={rangeIndex === index ? 'segment-item segment-active' : 'segment-item'}
                onClick={() => void handleRangeChange(index)}
              >
                {range.label}
              </button>
            ))}
          </div>

          <section className="chart-card">
            {rangeLoading ? (
              <div className="chart-loading">
                <div className="spinner" />
                <p className="chart-loading-text">正在生成图表…</p>
              </div>
            ) : null}
            <canvas ref={canvasRef} className="chart-canvas" />
            <div className="legend">
              <div className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: '#6750A4' }} />
                <span className="legend-text">正常（&lt;37.3°C）</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: '#E8710A' }} />
                <span className="legend-text">发热</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: '#B3261E' }} />
                <span className="legend-text">≥38.5°C 爆表</span>
              </div>
              <div className="legend-item">
                <span className="legend-line" />
                <span className="legend-text">阈值参考线</span>
              </div>
            </div>
          </section>

          {stats !== null ? (
            <section className="stats-card">
              <div className="stat-grid">
                <div className="stat-cell">
                  <span className="stat-value">{stats.count}</span>
                  <span className="stat-label">记录次数</span>
                </div>
                <div className="stat-cell">
                  <span
                    className="stat-value"
                    style={{ color: stats.burstCount > 0 ? '#B3261E' : '#1C1B1F' }}
                  >
                    {stats.burstCount}
                  </span>
                  <span className="stat-label">≥38.5°C 次数</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-value" style={{ color: '#B3261E' }}>
                    {stats.maxText}
                  </span>
                  <span className="stat-label">最高 (°C)</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-value" style={{ color: '#1A73E8' }}>
                    {stats.minText}
                  </span>
                  <span className="stat-label">最低 (°C)</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-value">{stats.avgText}</span>
                  <span className="stat-label">平均 (°C)</span>
                </div>
              </div>
              <p className="stat-time">最高出现在 {stats.maxTimeText}</p>
            </section>
          ) : null}

          <section className="content-card">
            <div className="section-head">
              <span className="section-title">用药时间线</span>
              <span className="section-hint">与图表相同时间段</span>
            </div>
            {!hasMedData ? (
              <div className="mini-empty">
                <p className="mini-empty-text">该时间段内没有用药记录。</p>
              </div>
            ) : (
              medTimeline.map(item => (
                <div className="timeline-item" key={item.id}>
                  <span className="timeline-dot" />
                  <div className="timeline-main">
                    <span className="timeline-time">{item.timeText}</span>
                    <span className="timeline-name">
                      {item.name} <span className="timeline-dose">{item.doseText}</span>
                    </span>
                    {item.sourceLabel !== '' ? (
                      <span className="timeline-tag">{item.sourceLabel}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
