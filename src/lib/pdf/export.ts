// 批次记录导出 PDF（Web 版）：
// 1. 与小程序一致：时间线 → 分块 → 分页 → 逐页 Canvas 绘制（A4 595×842pt，2x）；
// 2. 每页导出 JPEG，交给 jsPDF 以图片页拼装，删除手写 PDF 字节拼装与文件系统写入；
// 3. 返回 Blob，由调用方负责预览 / 下载 / 系统分享。

const PAGE_W = 595; // A4 宽（pt）
const PAGE_H = 842; // A4 高（pt）
const SCALE = 2; // 2x 分辨率，保证清晰度
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 34;
const HEAD_H = 104;
/** 图片型 PDF 体积较大，页数上限按迁移方案下调为 30 页 */
export const MAX_PAGES = 30;

const COLOR_TEXT = '#1C1B1F';
const COLOR_SUB = '#49454F';
const COLOR_MUTED = '#79747E';
const COLOR_PRIMARY = '#6750A4';
const COLOR_LINE = '#E7E0EC';

export interface PdfTimelineItem {
  kind: 'temp' | 'med';
  dateText: string;
  timeText: string;
  showDateHead: boolean;
  noteText?: string;
  valueText?: string;
  levelLabel?: string;
  levelColor?: string;
  methodText?: string;
  hasMed?: boolean;
  name?: string;
  doseText?: string;
  manufacturer?: string;
  sourceLabel?: string;
}

export interface PdfExportOptions {
  batchName: string;
  profileName: string;
  exportTimeText: string;
  tempCount: number;
  medCount: number;
  timeline: PdfTimelineItem[];
}

export interface PdfExportResult {
  blob: Blob;
  fileName: string;
  pageCount: number;
}

interface PdfBlock {
  height: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void;
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number
): string {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(clipped + '…').width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return clipped + '…';
}

// 分块：时间线纵排——日期头（日期变化时）+ 条目块（轴点 + 竖线 + 内容）
export function buildBlocks(options: PdfExportOptions): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const timeline = options.timeline || [];

  timeline.forEach((item, index) => {
    if (item.showDateHead) {
      blocks.push({
        height: 30,
        draw(ctx, x, y) {
          ctx.fillStyle = COLOR_TEXT;
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(item.dateText, x, y + 13);
          ctx.fillStyle = COLOR_LINE;
          ctx.fillRect(x, y + 21, CONTENT_W, 1);
        },
      });
    }
    const isLast = index === timeline.length - 1;
    const hasNote = typeof item.noteText === 'string' && item.noteText !== '';
    blocks.push({
      height: hasNote ? 52 : 42,
      draw(ctx, x, y) {
        // 时间轴：圆点 + 向下竖线（最后一条截断）
        const ax = x + 8;
        ctx.fillStyle = item.kind === 'med' ? '#188038' : '#6750A4';
        ctx.beginPath();
        ctx.arc(ax, y + 15, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLOR_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, y + 21);
        ctx.lineTo(ax, y + (isLast ? 26 : hasNote ? 49 : 39));
        ctx.stroke();

        // 内容主行：时间 + 内容（体温数值/等级 或 药名/剂量）
        const cx = x + 24;
        let px = cx;
        const parts =
          item.kind === 'temp'
            ? [
                { text: item.timeText, font: '10px sans-serif', color: COLOR_MUTED },
                {
                  text: '  ' + (item.valueText ?? '--') + '°C',
                  font: 'bold 14px sans-serif',
                  color: item.levelColor || COLOR_TEXT,
                },
                {
                  text: '（' + (item.levelLabel ?? '') + '）',
                  font: '11px sans-serif',
                  color: item.levelColor || COLOR_TEXT,
                },
                {
                  text: '  ' + (item.methodText ?? ''),
                  font: '10px sans-serif',
                  color: COLOR_SUB,
                },
              ]
            : [
                { text: item.timeText, font: '10px sans-serif', color: COLOR_MUTED },
                {
                  text: '  ' + (item.name ?? ''),
                  font: 'bold 13px sans-serif',
                  color: COLOR_TEXT,
                },
                {
                  text: '  ' + (item.doseText ?? ''),
                  font: '11px sans-serif',
                  color: COLOR_SUB,
                },
              ];
        if (item.kind === 'med' && item.manufacturer) {
          parts.push({
            text: '  · ' + item.manufacturer,
            font: '10px sans-serif',
            color: COLOR_SUB,
          });
        }
        if (item.kind === 'temp' && item.hasMed) {
          parts.push({ text: '  · 含用药', font: '9px sans-serif', color: COLOR_PRIMARY });
        }
        if (item.kind === 'med' && item.sourceLabel) {
          parts.push({
            text: '  · ' + item.sourceLabel,
            font: '9px sans-serif',
            color: COLOR_PRIMARY,
          });
        }
        parts.forEach(part => {
          ctx.fillStyle = part.color;
          ctx.font = part.font;
          ctx.fillText(part.text, px, y + 19);
          px += ctx.measureText(part.text).width;
        });
        if (hasNote) {
          ctx.fillStyle = COLOR_MUTED;
          ctx.font = '10px sans-serif';
          ctx.fillText(
            truncateText(ctx, '备注：' + (item.noteText ?? ''), '10px sans-serif', CONTENT_W - 24),
            cx,
            y + 36
          );
        }
      },
    });
  });

  if (blocks.length === 0) {
    blocks.push({
      height: 26,
      draw(ctx, x, y) {
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '10px sans-serif';
        ctx.fillText('该批次暂无记录', x, y + 12);
      },
    });
  }

  return blocks;
}

// 分页：第一页预留头部区域，其余页只留页脚
export function paginateBlocks(blocks: PdfBlock[]): PdfBlock[][] {
  const pages: PdfBlock[][] = [[]];
  let avail = PAGE_H - MARGIN * 2 - HEAD_H - FOOTER_H;
  blocks.forEach(block => {
    if (avail - block.height < 0) {
      pages.push([]);
      avail = PAGE_H - MARGIN * 2 - FOOTER_H;
    }
    pages[pages.length - 1].push(block);
    avail -= block.height;
  });
  return pages;
}

function drawHead(ctx: CanvasRenderingContext2D, options: PdfExportOptions) {
  let y = MARGIN;
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(
    truncateText(ctx, options.batchName || '批次记录', 'bold 20px sans-serif', CONTENT_W),
    MARGIN,
    y
  );
  y += 30;
  ctx.fillStyle = COLOR_SUB;
  ctx.font = '10px sans-serif';
  ctx.fillText(
    '所属档案：' + (options.profileName || '--') + ' · 导出时间：' + (options.exportTimeText || '--'),
    MARGIN,
    y
  );
  y += 18;
  ctx.fillStyle = COLOR_PRIMARY;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(`体温 ${options.tempCount} 次 · 用药 ${options.medCount} 次`, MARGIN, y);
  y += 12;
  ctx.fillStyle = COLOR_LINE;
  ctx.fillRect(MARGIN, y, CONTENT_W, 1);
}

function drawFooter(ctx: CanvasRenderingContext2D, pageIndex: number, totalPages: number) {
  const y = PAGE_H - 24;
  ctx.fillStyle = COLOR_LINE;
  ctx.fillRect(MARGIN, y - 12, CONTENT_W, 1);
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '9px sans-serif';
  const label = `第 ${pageIndex + 1} / ${totalPages} 页`;
  ctx.fillText(label, MARGIN, y);
  const footer = '体温用药记录 · 批次导出';
  ctx.fillText(footer, PAGE_W - MARGIN - ctx.measureText(footer).width, y);
}

function drawBlocks(
  ctx: CanvasRenderingContext2D,
  pageBlocks: PdfBlock[],
  startY: number
) {
  let y = startY;
  pageBlocks.forEach(block => {
    block.draw(ctx, MARGIN, y);
    y += block.height;
  });
}

function splitFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return (cleaned !== '' ? cleaned : '批次记录') + '.pdf';
}

/**
 * 导出批次记录为 PDF。
 * 超过页数上限或绘制失败时抛出 Error，message 可直接用于提示。
 */
export async function exportBatchToPdf(options: PdfExportOptions): Promise<PdfExportResult> {
  const blocks = buildBlocks(options);
  const pages = paginateBlocks(blocks);
  if (pages.length > MAX_PAGES) {
    throw new Error(`记录过多，导出超过 ${MAX_PAGES} 页，请精简后再试`);
  }

  const pixelW = PAGE_W * SCALE;
  const pixelH = PAGE_H * SCALE;
  const jpegList: string[] = [];

  try {
    pages.forEach((pageBlocks, pageIndex) => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelW;
      canvas.height = pixelH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('当前浏览器不支持 Canvas 绘图');
      }
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, PAGE_W, PAGE_H);
      if (pageIndex === 0) {
        drawHead(ctx, options);
        drawBlocks(ctx, pageBlocks, MARGIN + HEAD_H);
      } else {
        drawBlocks(ctx, pageBlocks, MARGIN);
      }
      drawFooter(ctx, pageIndex, pages.length);
      jpegList.push(canvas.toDataURL('image/jpeg', 0.92));
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '未知错误';
    throw new Error('生成页面失败：' + message);
  }

  try {
    // PDF 依赖按需加载，避免进入首页即下载体积较大的 jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    jpegList.forEach((jpeg, index) => {
      if (index > 0) {
        doc.addPage();
      }
      doc.addImage(jpeg, 'JPEG', 0, 0, PAGE_W, PAGE_H);
    });
    const blob = doc.output('blob');
    return { blob, fileName: splitFileName(options.batchName), pageCount: pages.length };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '未知错误';
    throw new Error('生成 PDF 失败：' + message);
  }
}
