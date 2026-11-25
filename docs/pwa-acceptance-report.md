# PWA 迁移验收报告

> 对照 `docs/pwa-migration-plan.md` 第六节《验收与回归清单》，基于生产构建（`vite preview`，端口 4173）与全阶段实测记录整理。

## 一、验证环境与方法

- 构建：`pnpm build`（Vite 8 + vite-plugin-pwa 2，generateSW，precache 18 项 / 1205 KiB）。
- 运行：`pnpm preview --port 4173`，Chromium 无痕新 origin（等同于首次安装）。
- 自动化：`pnpm typecheck` 通过；`pnpm test` 31/31 通过；`pnpm build` 成功。
- 人工/浏览器走查：P2–P5 每阶段在浏览器完成主链路与次链路操作，本报告汇总关键证据。

## 二、回归清单对照

| 域 | 结论 | 证据 |
|---|---|---|
| 启动 | 通过 | P5 新 origin 首次进入自动生成「本人」档案并设为当前；已有档案时保持上次当前档案（P3 切换后复访验证） |
| 档案 | 通过 | P3 实测 新建 → 设为当前 → 编辑备注 → 删除（当前档案删除后回落剩余第一个，9 条记录级联清理）；P5 复核档案卡与记录数 |
| 批次 | 通过 | P5 实测 首页新建「验收批次」→ 批次管理重命名 → 删除，确认文案「将同时删除批次内的 2 条体温与用药记录，删除后不可恢复」；记录数/起始时间同步更新 |
| 录入 | 通过 | P2 实测 体温/用药录入、剂量步进、多药物增删、时间默认跟随；P5 实测 38.6°C 一条保存成功；体温 30–45°C 与缺药名校验按源码逐行对齐 |
| 联动 | 通过 | P5 实测 38.6°C 自动关联布洛芬 400mg（体温条目显示「含用药」、用药显示「体温联动」）；P2 实测编辑 39.0°C 保留同步用药；关闭同步仅解绑、`medicationId` 指向首条 |
| 时间线 | 通过 | P5 详情页同一时间点并列体温 38.6°C（含用药）与布洛芬 400mg（体温联动），日期头/正序/末条截断正常 |
| 删除 | 通过 | P5 批次级联删除（含确认文案）；P2 实测体温删除「都删除 / 仅体温」与联动用药回清标记；药名库移除不影响历史（P3/P4） |
| 历史 | 通过 | P5 体温/用药历史均按「验收批次」分组各 1 条，组头跳转批次详情；空组隐藏、未归组垫底（P3 实测） |
| 药名库 | 通过 | P3 实测 新增 → 效期 2020-01-01 标红「已过期」→ 编辑厂商 → 移除；同名同厂商判重、编辑排除自身；录入保存自动记忆（P5 库中出现「布洛芬」） |
| 图表 | 通过 | P5 实测 统计 1 次 / ≥38.5 1 次 / 最高 38.6；7/30/90 天切换不白屏；P3 实测 参考线、爆表标值、5 个日期刻度、空数据文案 |
| PDF | 通过 | P5 实测 生成「共 1 页」、文件名「验收批次.pdf」、下载成功；单测 20 条记录分 2 页且每页不超正文高度；上限 30 页单测校验 |
| PWA | 通过 | SW `activated` 并接管页面；向 sw.js 推送新版本后旧页面出现「有新版本，刷新后生效」，点击刷新后数据仍在、提示消失；深链 `/chart-report` 直接打开与刷新均 200；manifest 含 192/512/maskable 图标与 standalone |

## 三、P5 收口内容

- **安装引导**：新增 `src/components/InstallPrompt.tsx`。Chrome/Edge 捕获 `beforeinstallprompt` 提供「安装」按钮；iOS 展示「Safari 分享 → 添加到主屏幕」；独立窗口模式或已关闭不再提示（localStorage 记忆）。
- **安全区**：`.page` 顶部加入 `--safe-top`，底部已含 `--safe-bottom`；悬浮导出条、FAB、Sheet、Toast 均避让安全区。
- **键盘可达**：Sheet 支持 Esc 关闭；全站仅使用 `:active`，无 `hover` 残留；桌面壳最大宽度 560px 居中。
- **存储持久化**：启动时请求 `navigator.storage.persist()`，降低系统清理本地数据概率。
- **部署配置**：新增 `vercel.json`（SPA rewrite + `index.html`/`sw.js` no-cache + `assets/*` immutable）与 `public/_headers`、`public/_redirects`（Netlify / Cloudflare Pages）；构建产物已包含三份配置。

## 四、性能数据（生产构建）

| 项 | 数值 | 目标 |
|---|---|---|
| 首屏 JS（index） | 409.56 KB raw / **123.89 KB gzip** | < 150 KB gzip ✅ |
| 首屏 CSS | 29.03 KB raw / 5.56 KB gzip | — |
| PDF 按需分包 | jsPDF 398.90 KB / 129.60 KB gzip（导出时才加载） | 不计入首屏 |
| 预缓存 | 18 项 / 1205 KiB | — |

## 五、部署步骤

1. `pnpm build`，将 `dist/` 作为静态站点发布，必须启用 HTTPS（`localhost` 除外）。
2. SPA fallback 与缓存头已随仓库配置：Vercel 直接识别 `vercel.json`；Netlify / Cloudflare Pages 识别 `public/_redirects`、`public/_headers`。
3. 不要把 `index.html`、`sw.js` 设为长缓存；`assets/*` 使用一年 immutable。

## 六、未覆盖项与限制

- **真机**：本次在桌面 Chromium 完成验收，未在 iOS Safari / Android Chrome 真机执行「安装 → 录入 → 刷新 → 离线 → 导出」；安全区与安装引导按规范实现，建议上线前补一次真机回归。
- **Lighthouse**：当前环境无 Chrome CLI，未产出 Lighthouse 报告；已用构建体积、manifest/SW 激活与更新流程作为等价验证。
- **断网离线**：Workbox 预缓存全部产物，策略为 precache-first；未在无网环境自动验证，逻辑与小程序纯本地特性一致。
