// 批次记录导出 PDF（纯前端方案）：
// 1. 批次数据排版绘制到 OffscreenCanvas（A4 比例，2x 分辨率，自动分页）；
// 2. 每页导出 JPEG，按 PDF 规范拼装为二进制（图片型 PDF，无需内嵌中文字体）；
// 3. 写入用户文件目录，调用方可用 wx.openDocument 预览 / wx.shareFileMessage 分享下载。

const PAGE_W = 595;   // A4 宽（pt）
const PAGE_H = 842;   // A4 高（pt）
const SCALE = 2;      // 2x 分辨率，保证清晰度
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 34;
const HEAD_H = 104;
const MAX_PAGES = 60;

const COLOR_TEXT = '#1C1B1F';
const COLOR_SUB = '#49454F';
const COLOR_MUTED = '#79747E';
const COLOR_PRIMARY = '#6750A4';
const COLOR_LINE = '#E7E0EC';

function pad(value) {
    return value < 10 ? '0' + String(value) : String(value);
}

function truncateText(ctx, text, font, maxWidth) {
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
function buildBlocks(data) {
    const blocks = [];
    const timeline = data.timeline || [];

    timeline.forEach((item, index) => {
        if (item.showDateHead) {
            blocks.push({
                height: 30,
                draw(ctx, x, y) {
                    ctx.fillStyle = COLOR_TEXT;
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillText(item.dateText + (item.kind === 'temp' ? '' : ''), x, y + 13);
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
                ctx.lineTo(ax, y + (isLast ? 26 : (hasNote ? 49 : 39)));
                ctx.stroke();

                // 内容主行：时间 + 内容（体温数值/等级 或 药名/剂量）
                const cx = x + 24;
                let px = cx;
                const parts = item.kind === 'temp' ? [
                    { text: item.timeText, font: '10px sans-serif', color: COLOR_MUTED },
                    { text: '  ' + item.valueText + '°C', font: 'bold 14px sans-serif', color: item.levelColor },
                    { text: '（' + item.levelLabel + '）', font: '11px sans-serif', color: item.levelColor },
                    { text: '  ' + item.methodText, font: '10px sans-serif', color: COLOR_SUB },
                ] : [
                    { text: item.timeText, font: '10px sans-serif', color: COLOR_MUTED },
                    { text: '  ' + item.name, font: 'bold 13px sans-serif', color: COLOR_TEXT },
                    { text: '  ' + item.doseText, font: '11px sans-serif', color: COLOR_SUB },
                ];
                if (item.kind === 'med' && item.manufacturer !== '') {
                    parts.push({ text: '  · ' + item.manufacturer, font: '10px sans-serif', color: COLOR_SUB });
                }
                if (item.kind === 'temp' && item.hasMed) {
                    parts.push({ text: '  · 含用药', font: '9px sans-serif', color: COLOR_PRIMARY });
                }
                if (item.kind === 'med' && item.sourceLabel !== '') {
                    parts.push({ text: '  · ' + item.sourceLabel, font: '9px sans-serif', color: COLOR_PRIMARY });
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
                    ctx.fillText(truncateText(ctx, '备注：' + item.noteText, '10px sans-serif', CONTENT_W - 24), cx, y + 36);
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
function paginateBlocks(blocks) {
    const pages = [[]];
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

function drawHead(ctx, data) {
    let y = MARGIN;
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(truncateText(ctx, data.batchName || '批次记录', 'bold 20px sans-serif', CONTENT_W), x0(), y);
    y += 30;
    ctx.fillStyle = COLOR_SUB;
    ctx.font = '10px sans-serif';
    ctx.fillText('所属档案：' + (data.profileName || '--') + ' · 导出时间：' + (data.exportTimeText || '--'), x0(), y);
    y += 18;
    ctx.fillStyle = COLOR_PRIMARY;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('体温 ' + (data.temps || []).length + ' 次 · 用药 ' + (data.meds || []).length + ' 次', x0(), y);
    y += 12;
    ctx.fillStyle = COLOR_LINE;
    ctx.fillRect(x0(), y, CONTENT_W, 1);
}

function x0() {
    return MARGIN;
}

function drawFooter(ctx, pageIndex, totalPages) {
    const y = PAGE_H - 24;
    ctx.fillStyle = COLOR_LINE;
    ctx.fillRect(MARGIN, y - 12, CONTENT_W, 1);
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '9px sans-serif';
    const label = '第 ' + (pageIndex + 1) + ' / ' + totalPages + ' 页';
    ctx.fillText(label, MARGIN, y);
    ctx.fillText('体温用药记录 · 批次导出', PAGE_W - MARGIN - ctx.measureText('体温用药记录 · 批次导出').width, y);
}

function drawBlocks(ctx, pageBlocks, startY) {
    let y = startY;
    pageBlocks.forEach(block => {
        block.draw(ctx, MARGIN, y);
        y += block.height;
    });
}

// base64 → Uint8Array（小程序无 atob，手写解码）
function decodeBase64(input) {
    const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(input).replace(/[^A-Za-z0-9+/=]/g, '');
    const len = clean.length;
    const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
    const out = new Uint8Array(Math.floor(len / 4) * 3 - padding);
    let pos = 0;
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < len; i += 1) {
        const ch = clean.charAt(i);
        if (ch === '=') {
            break;
        }
        const value = table.indexOf(ch);
        if (value < 0) {
            continue;
        }
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[pos] = (buffer >> bits) & 0xff;
            pos += 1;
        }
    }
    return out;
}

// 把 JPEG 页面图拼装为 PDF 二进制（对象编号：1 Catalog、2 Pages、每页 3 个对象）
function assemblePdf(jpegList, pixelW, pixelH) {
    const pageCount = jpegList.length;
    const chunks = [];
    let offset = 0;
    const offsets = {};

    function pushBytes(bytes) {
        chunks.push(bytes);
        offset += bytes.length;
    }

    function pushStr(str) {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i += 1) {
            bytes[i] = str.charCodeAt(i) & 0xff;
        }
        pushBytes(bytes);
    }

    function beginObj(num) {
        offsets[num] = offset;
        pushStr(num + ' 0 obj\n');
    }

    function endObj() {
        pushStr('endobj\n');
    }

    pushStr('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');
    beginObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObj();

    const kids = [];
    for (let p = 0; p < pageCount; p += 1) {
        kids.push((3 + p * 3) + ' 0 R');
    }
    beginObj(2);
    pushStr('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageCount + ' >>\n');
    endObj();

    for (let p = 0; p < pageCount; p += 1) {
        const pageObj = 3 + p * 3;
        const contentObj = pageObj + 1;
        const imageObj = pageObj + 2;
        const jpeg = jpegList[p];

        beginObj(pageObj);
        pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + ']'
            + ' /Resources << /XObject << /Im0 ' + imageObj + ' 0 R >> /ProcSet [/PDF /ImageC] >>'
            + ' /Contents ' + contentObj + ' 0 R >>\n');
        endObj();

        const content = 'q\n' + PAGE_W + ' 0 0 ' + PAGE_H + ' 0 0 cm\n/Im0 Do\nQ\n';
        beginObj(contentObj);
        pushStr('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\n');
        endObj();

        beginObj(imageObj);
        pushStr('<< /Type /XObject /Subtype /Image /Width ' + pixelW + ' /Height ' + pixelH
            + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
        pushBytes(jpeg);
        pushStr('\nendstream\n');
        endObj();
    }

    const objectCount = 2 + pageCount * 3;
    const xrefOffset = offset;
    pushStr('xref\n0 ' + (objectCount + 1) + '\n');
    pushStr('0000000000 65535 f \n');
    for (let i = 1; i <= objectCount; i += 1) {
        const str = String(offsets[i]);
        pushStr('0000000000'.slice(0, Math.max(0, 10 - str.length)) + str + ' 00000 n \n');
    }
    pushStr('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    const out = new Uint8Array(offset);
    let pos = 0;
    chunks.forEach(bytes => {
        out.set(bytes, pos);
        pos += bytes.length;
    });
    return out;
}

// 导出主流程：数据 → 分块分页 → 逐页绘制 → PDF → 写入文件
function exportBatchToPdf(options) {
    return new Promise((resolve, reject) => {
        if (typeof wx.createOffscreenCanvas !== 'function') {
            reject({ message: '当前微信版本过低，暂不支持导出 PDF，请升级微信后重试' });
            return;
        }

        const blocks = buildBlocks(options || {});
        const pages = paginateBlocks(blocks);
        if (pages.length > MAX_PAGES) {
            reject({ message: '记录过多，导出超过 ' + MAX_PAGES + ' 页，请精简后再试' });
            return;
        }

        const pixelW = PAGE_W * SCALE;
        const pixelH = PAGE_H * SCALE;
        const jpegList = [];

        try {
            pages.forEach((pageBlocks, pageIndex) => {
                const canvas = wx.createOffscreenCanvas({ type: '2d', width: pixelW, height: pixelH });
                const ctx = canvas.getContext('2d');
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
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                jpegList.push(decodeBase64(dataUrl.split(',')[1]));
            });
        } catch (e) {
            reject({ message: '生成页面失败：' + (e && e.message ? e.message : '未知错误') });
            return;
        }

        const pdfBytes = assemblePdf(jpegList, pixelW, pixelH);
        const filePath = wx.env.USER_DATA_PATH + '/batch-pdf-' + Date.now() + '.pdf';
        const fsm = wx.getFileSystemManager();

        fsm.writeFile({
            filePath,
            data: pdfBytes.buffer,
            encoding: 'binary',
            success: () => {
                resolve({ filePath, pageCount: pages.length });
            },
            fail: err => {
                reject({ message: '写入文件失败：' + (err && err.errMsg ? err.errMsg : '未知错误') });
            },
        });
    });
}

module.exports = {
    exportBatchToPdf,
};
