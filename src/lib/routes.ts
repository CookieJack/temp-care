// 路由表（P0 冻结）：路径与小程序 page 一一对应，参数名保持不变
export const ROUTES = {
  home: '/',
  record: '/record',
  tempHistory: '/temp-record',
  medHistory: '/med-record',
  chartReport: '/chart-report',
  profileManage: '/profile-manage',
  batchManage: '/batch-manage',
  batchDetail: '/batch-detail',
  medNameManage: '/med-name-manage',
} as const;

/** 批次详情：/batch-detail?id=<batchId> */
export function batchDetailPath(batchId: string): string {
  return `${ROUTES.batchDetail}?id=${encodeURIComponent(batchId)}`;
}

/** 快速记录：/record?batchId=<batchId>（批次必填，由批次详情发起） */
export function recordPath(batchId: string): string {
  return `${ROUTES.record}?batchId=${encodeURIComponent(batchId)}`;
}
