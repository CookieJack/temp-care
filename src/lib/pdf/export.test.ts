import { describe, expect, it } from 'vitest';
import { buildBlocks, MAX_PAGES, paginateBlocks } from './export';
import type { PdfExportOptions, PdfTimelineItem } from './export';

function makeOptions(count: number): PdfExportOptions {
  const timeline: PdfTimelineItem[] = Array.from({ length: count }, (_, index) => ({
    kind: 'temp',
    dateText: '11月25日',
    timeText: '10:00',
    showDateHead: index === 0,
    valueText: '36.8',
    levelLabel: '正常',
    levelColor: '#1A73E8',
    methodText: '腋下',
    noteText: '',
    hasMed: false,
  }));
  return {
    batchName: '测试批次',
    profileName: '本人',
    exportTimeText: '2026-11-25 10:00',
    tempCount: count,
    medCount: 0,
    timeline,
  };
}

describe('PDF 分页', () => {
  it('20 条记录分页且每页不超出正文高度', () => {
    const pages = paginateBlocks(buildBlocks(makeOptions(20)));
    expect(pages).toHaveLength(2);
    pages.forEach((page, index) => {
      const limit = 842 - 92 - (index === 0 ? 104 : 0) - 34;
      const used = page.reduce((sum, block) => sum + block.height, 0);
      expect(used).toBeLessThanOrEqual(limit);
    });
  });

  it('空记录也生成一页占位块', () => {
    const pages = paginateBlocks(buildBlocks(makeOptions(0)));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });

  it('页数上限为 30，超长记录会超过上限', () => {
    expect(MAX_PAGES).toBe(30);
    expect(paginateBlocks(buildBlocks(makeOptions(700))).length).toBeGreaterThan(MAX_PAGES);
  });
});
