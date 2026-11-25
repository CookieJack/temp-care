# 微信小程序 → PWA 迁移方案（分阶段）

> 状态：已确认，实施中 —— P0 已完成（工程基线 / 设计令牌 / 路由表 / 数据模型冻结）；P1 已完成（存储适配器 / store+common 移植 / PWA 外壳 / 基础组件 / 单测）
> 适用范围：当前仓库 `/Users/jackwu/Documents/obstant-mini-app`（原生微信小程序）
> 结论先行：建议**直接重写为 React + Vite 的 PWA**（方案 A），不采用 Taro / uni-app 跨端方案。

---

## 一、现状盘点

### 1.1 工程形态

- 原生微信小程序，无 `package.json`、无构建链、无 npm 依赖、无 `node_modules`。
- 无任何网络请求、无云开发、无登录/支付/订阅消息，**数据 100% 存于 `wx.*StorageSync`**。
- 总代码量约 6.8k 行：JS ≈ 2.7k、WXML ≈ 1.0k、WXSS ≈ 2.9k、JSON 少量。
- 设计系统：Material Design 3（`app.wxss` 913 行，primary `#6750A4`、surface `#FEF7FF`、error `#B3261E`，全局卡片/按钮/弹层/输入框/spinner/弹层动画）。

### 1.2 页面清单（9 页）

| # | 路由 | 标题 | JS/WXML/WXSS 行数 | 职责 |
|---|---|---|---|---|
| 1 | `pages/index/index` | 体温用药记录 | 260 / 95 / 163 | 当前档案卡 + 今日统计 + 批次列表 + 首页内嵌新建批次弹层 + 4 个横切入口 |
| 2 | `pages/record/record` | 快速记录 | 556 / 174 / 58 | 体温 + 多药物双区块选填、药名快捷芯片、剂量步进器、保存后返回批次详情 |
| 3 | `pages/batch-manage/batch-manage` | 记录批次 | 274 / 61 / 61 | 批次列表、新建/重命名/级联删除 |
| 4 | `pages/batch-detail/batch-detail` | 批次详情 | 873 / 278 / 208 | 温药合并时间线、体温编辑（含同步用药增量同步）、用药编辑、删除、PDF 导出、底部悬浮操作条 |
| 5 | `pages/temp-record/temp-record` | 体温历史 | 110 / 50 / 32 | 只读、按批次分组 |
| 6 | `pages/med-record/med-record` | 用药历史 | 107 / 51 / 39 | 只读、按批次分组 |
| 7 | `pages/chart-report/chart-report` | 体温图表 | 386 / 104 / 205 | Canvas 2D 折线图（7/30/90 天）、统计卡、用药时间线 |
| 8 | `pages/profile-manage/profile-manage` | 档案管理 | 271 / 75 / 81 | 档案 CRUD + 当前档案切换 |
| 9 | `pages/med-name-manage/med-name-manage` | 药名库 | 220 / 83 / 81 | 药名库 CRUD（厂商/效期/过期标红） |

### 1.3 复用资产

| 文件 | 行数 | 可复用度 | 说明 |
|---|---|---|---|
| `utils/common.js` | 308 | **高（≈90%）** | 纯 JS 无 `wx` 依赖（仅 `getActiveProfileId/setActiveProfileId/ensureDefaultProfile` 触碰 storage），体温分级、时间格式化、剂量格式化、药名建议/去重可几乎原样移植 |
| `utils/store.js` | 179 | **高（≈85%）** | `createListStore` 的 `{ data, error }` 契约与 CRUD/replace 逻辑完整保留，只需替换 `wx.getStorageSync/setStorageSync` 为注入式 storage 适配器 |
| `utils/pdf-export.js` | 357 | **中（≈60%）** | 分块/分页/绘制指令可复用；PDF 字节拼装与文件写入改用 jsPDF + Blob 后大幅简化 |
| `app.wxss` + 各页 WXSS | 2.9k | **中高（≈75%）** | 类名与布局可平移，`rpx→px/rem`、`view/text→div/span`、`hover-class→:active`、`@keyframes` 原样可用 |
| 各页 WXML | 1.0k | 中（≈50%） | 结构语义清晰，但需改写为 JSX、`wx:for→map`、`wx:if→条件渲染` |
| 各页 JS 业务逻辑 | 2.7k | **中高（≈70%）** | 加载/校验/联动/增量同步逻辑可平移，`setData` 改 React state |

### 1.4 `wx.*` API 使用清单（迁移面）

| API | 次数 | 用途 | PWA 替代 |
|---|---|---|---|
| `wx.showToast` | 23 | 保存成功/失败提示 | 自研 `toast()` 组件（保留中文文案与 MD3 样式） |
| `wx.navigateTo` | 11 | 页面跳转 | React Router `navigate()` |
| `wx.showModal` | 5 | 删除确认（含双按钮语义：都删除/仅体温） | 自研 `confirm()` 弹层（**不能用原生 `confirm()`**，无法定制按钮文案与颜色） |
| `wx.setStorageSync/getStorageSync` | 4 | 本地持久化 | Storage 适配器（localStorage → IndexedDB） |
| `wx.showActionSheet` | 1 | PDF 预览/分享二选一 | 自研底部 ActionSheet |
| `wx.navigateBack` | 1 | 保存后返回 | `navigate(-1)` |
| `wx.getWindowInfo/getSystemInfoSync` | 3 | 取 pixelRatio | `window.devicePixelRatio` |
| `wx.createSelectorQuery` | 1 | 取 canvas 节点与尺寸 | `ref` + `ResizeObserver` |
| `wx.createOffscreenCanvas` | 2 | 图表/PDF 绘制 | `document.createElement('canvas')` / `OffscreenCanvas` |
| `wx.getFileSystemManager` / `wx.env` | 2 | 写 PDF 文件 | `Blob` + `URL.createObjectURL` + `<a download>` |
| `wx.openDocument` | 2 | PDF 预览 | `window.open(blobURL)` 或内置 `<iframe>` 预览 |
| `wx.shareFileMessage` | 2 | PDF 分享 | `navigator.share({ files })`（降级为下载） |

**标签面**：`view / text / input / textarea / block / picker / scroll-view / switch / canvas`；无自定义组件、无第三方 UI 库、无 `wx:for` 之外的复杂模板能力。

### 1.5 数据模型（需 1:1 保留）

| 集合 | Storage Key | 关键字段 | 排序键 |
|---|---|---|---|
| 档案 | `ob_health_profiles` | `id, name, relation, note, createdAt, updatedAt` | `createdAt` |
| 当前档案 | `ob_health_active_profile` | 字符串 id | — |
| 体温 | `ob_temp_records` | `id, profileId, batchId, value, measuredAt, method, note, medicationId, createdAt, updatedAt` | `measuredAt` |
| 用药 | `ob_med_records` | `id, profileId, batchId, name, manufacturer, dose, unit, takenAt, note, source('manual'|'temp-link'), tempId` | `takenAt` |
| 批次 | `ob_health_batches` | `id, profileId, name, note, createdAt, updatedAt` | `updatedAt` |
| 药名库 | `ob_med_name_library` | `id, name, manufacturer, expiryDate, createdAt, updatedAt` | `createdAt` |

> 关键：`id` 为 `时间戳-自增序号` 字符串；`createListStore` 内部 `unshift + 按 sortKey 倒序`。这套语义必须保持，否则排序、分组、时间线会出现回归。

---

## 二、迁移目标与非目标

### 2.1 目标

1. 功能等价：9 个页面、批次主线录入、温药合并时间线、图表、PDF 导出全部可用。
2. 可安装：Android/iOS/桌面浏览器均可「添加到主屏幕」，独立窗口启动，有图标与启动色。
3. 离线可用：断网后仍可打开、录入、查看、导出（本应用天然纯本地，离线成本很低）。
4. 本地数据不丢：刷新/关闭/系统回收后数据仍在；提供手动备份导出/导入。
5. 移动端体验对齐：安全区、滚动、输入弹起、触控反馈、无 `hover` 残留。

### 2.2 非目标（本次不做）

- 不做账号体系、云同步、多人协作（无后端）。
- 不迁移微信生态能力（本项目未使用登录/支付/订阅消息/客服，无能力阻塞）。
- 不做小程序与 PWA 双端共用一套模板（除非确认要长期双维护，见「待确认决策」）。

---

## 三、技术选型建议

### 3.1 路线对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. 直接重写为 React PWA** | Vite + React + TS，页面/组件按 Web 语义重写 | 无框架黑盒、包体最小、PWA 能力（SW/manifest）完全可控、与现有 MD3 CSS 平移成本低、后续接后端最自然 | 需要重写 WXML/JS 绑定（约 3.7k 行） | **推荐** |
| B. Taro / uni-app 跨端 | 改写成 JSX/Vue SFC，输出 H5 | 理论上一套代码多端 | 现有代码是原生的，迁移等于重写；引入重型编译层与运行时；H5 端路由/SW/文件下载仍需单独适配；后续调试链路变长 | 不推荐 |
| C. 保留 WXML + 容器（kbone/web-view） | 套壳运行 | 改动小 | 无法真正成为合规 PWA，性能与离线差，属于伪方案 | 排除 |

### 3.2 推荐技术栈（版本在实施首日锁定为当时最新稳定版）

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | **Vite**（latest） | 零配置、SW 生态成熟、产物小 |
| 框架 | **React + TypeScript**（latest） | 与用户既有技术栈一致；类型约束能承接 6 组数据模型 |
| 路由 | **React Router**（`createBrowserRouter`） | 9 条路由 + 参数（`?id=`、`?batchId=`），需 SPA fallback |
| 样式 | **原生 CSS + CSS 变量**（可选 CSS Modules） | 直接平移现有 2.9k 行 WXSS，避免引入 Tailwind 造成二次改写；设计令牌抽为 `:root` 变量 |
| 状态 | **不引入全局状态库**；store 单例 + 页面 hooks | 数据源单一（本地存储），引入 Redux/Zustand 属于过度设计 |
| 持久化 | **Storage 适配器**：Phase 1 用 `localStorage`，Phase 3 切 `IndexedDB`（`idb`） | 保持 `{ data, error }` 契约，页面无感；IndexedDB 容量/结构化更稳 |
| PWA | **vite-plugin-pwa**（Workbox，`generateSW`） | 预缓存 + 更新提示 + 离线兜底，配置量最小 |
| 图表 | **保留原生 Canvas 2D 手绘**（`chart-report.js` 的绘制代码可平移 ≈80%） | 视觉零偏差、无新依赖；`ResizeObserver` + DPR 替代 `createSelectorQuery` |
| PDF | **jsPDF**（图片页模式） | 现有「分块→分页→Canvas 绘制→JPEG」流程保留，删掉手写 PDF 字节拼装（`assemblePdf`）与 `FileSystemManager` |
| 交互组件 | 自研 `Toast / ConfirmDialog / ActionSheet / DateField / TimeField / Switch / Chip / Stepper` | 需要保留 MD3 视觉与「都删除 / 仅体温」这类中文按钮语义；各组件体量都很小 |
| 测试 | **Vitest**（store / common / 分页算法）+ Playwright 冒烟（可选） | 业务规则密集，纯函数最值得测 |
| 部署 | 任意静态托管（IGA Pages / Vercel / Netlify / Cloudflare Pages），**必须 HTTPS + SPA fallback** | Service Worker 与安装能力的前置条件 |

### 3.3 目标目录结构

```
obstant-mini-app/
├─ docs/pwa-migration-plan.md      # 本方案
├─ index.html
├─ vite.config.ts                  # 含 VitePWA 配置
├─ tsconfig.json
├─ package.json
├─ public/
│  ├─ icons/ (192/512/maskable/apple-touch)
│  └─ manifest.webmanifest         # 由插件生成或静态维护
└─ src/
   ├─ main.tsx
   ├─ App.tsx                      # Router + 全局 Toast/Dialog Provider
   ├─ styles/
   │  ├─ tokens.css                # MD3 色板/圆角/间距（源自 app.wxss）
   │  ├─ base.css                  # reset + safe-area + 100dvh
   │  └─ components.css            # 卡片/按钮/弹层/输入/chip/stepper/spinner
   ├─ lib/
   │  ├─ storage.ts                # 适配器：get/set/remove（localStorage|idb）
   │  ├─ store.ts                  # createListStore（移植 utils/store.js）
   │  ├─ common.ts                 # 移植 utils/common.js
   │  ├─ pdf/export.ts             # 移植 utils/pdf-export.js（jsPDF 版）
   │  └─ backup.ts                 # 全量导出/导入 JSON
   ├─ hooks/                       # useProfiles / useBatches / useRecords / useToast
   ├─ components/                  # Toast / ConfirmDialog / ActionSheet / Field / Chip / Stepper / TimelineRow
   └─ pages/
      ├─ Home/ BatchManage/ BatchDetail/ Record/
      ├─ TempHistory/ MedHistory/ ChartReport/
      └─ ProfileManage/ MedNameManage/
```

---

## 四、分阶段迁移计划

> 阶段粒度按「每阶段结束都有可运行、可验收的产物」切分；阶段内不改数据模型。
> P0 只做工程基线，不写业务页面；P1 结束即可安装；P2 结束主链路闭环。

### 阶段总览

| 阶段 | 主题 | 交付物 | 依赖 |
|---|---|---|---|
| P0 | 基线确认 | 工程脚手架、设计令牌、路由表、数据模型与验收清单冻结 | 本方案确认 |
| P1 | 骨架 + 数据层 + PWA 外壳 | 可安装、离线可打开的空壳 + 存储层单测 | P0 |
| P2 | 主链路 | 首页 / 批次管理 / 批次详情（时间线、编辑、删除）/ 快速记录 | P1 |
| P3 | 次链路 + 图表 | 体温历史 / 用药历史 / 档案管理 / 药名库 / Canvas 图表 | P2 |
| P4 | PDF 与系统交互收口 | PDF 导出下载/分享、Toast/Confirm/ActionSheet 统一、备份导入导出 | P3 |
| P5 | 兼容、验收、发布 | iOS 安全区/安装引导、离线回归、Lighthouse、部署上线 | P4 |

---

### P0 工程基线与方案冻结（1–1.5 人天）

**范围**

1. 初始化 `package.json` + Vite + React + TS + ESLint/Prettier（不引入 UI 框架）。
2. 把 `app.wxss` 的设计令牌抽成 `tokens.css`：色板、圆角（`rpx→px`，以 375 设计宽为基准，`1rpx = 0.5px`）、字号、阴影、间距节奏、动画时长。
3. 建立路由表（9 条）与页面骨架文件，确定 `?id` / `?batchId` 参数约定。
4. 冻结数据模型与 `{ data, error }` 契约（见 1.5），写入 `src/lib/types.ts`。
5. 冻结回归验收清单（见第六节），后续每阶段末尾逐条对照。

**改动模块**：新增全部工程文件；**不触碰**现有小程序代码（保留原目录以便对照）。

**验收**：`npm run dev` 起得来，路由可互相跳转（空页面），设计令牌与现有界面对照色值一致。

---

### P1 骨架 + 数据层 + PWA 外壳（2–3 人天）

**范围**

1. `storage.ts`：统一 `get/set/remove`，内部可切换 localStorage / IndexedDB；异常转成 `{ code: 'CLIENT_EXCEPTION', message }`。
2. 移植 `utils/store.js → src/lib/store.ts`：`list / create / update / remove / replace` 与 `id` 生成规则逐行对齐。
3. 移植 `utils/common.js → src/lib/common.ts`（`wx` 相关 3 个函数改为调用 `storage`）。
4. App 启动逻辑：`ensureDefaultProfile` 等价移植（首次进入自动建「本人」档案并设为当前）。
5. 全局布局壳：`max-width: 560px` 居中、`100dvh`、`env(safe-area-inset-*)`、页面切换滚动复位。
6. PWA 外壳：`manifest`（`name/short_name/start_url/scope/display: standalone/theme_color:#6750A4/background_color:#FEF7FF/icons 192+512+maskable`）、`apple-touch-icon`、`theme-color` meta、`viewport-fit=cover`；`vite-plugin-pwa` 预缓存全部构建产物，`registerType: 'prompt'` + 「有新版本，点击刷新」提示；离线兜底页。
7. 基础组件：`Toast`、`ConfirmDialog`、`ActionSheet`、`Button/Field/Chip/Stepper` 的样式与受控 API。
8. 单测：store 的 CRUD/排序/`replace`、common 的 `feverLevel/dateTimeToTs/collectMedNameSuggestions/collectNewMedNames`。

**改动模块**：`src/lib/*`、`src/components/*`、`vite.config.ts`、`index.html`、`public/*`。

**验收**

- 断网刷新仍能打开并显示首页空态。
- Chrome DevTools → Application 显示 manifest 可安装、SW 已激活。
- `ensureDefaultProfile` 首次启动生成 1 条「本人」档案且为当前档案。
- 单测全绿；store 行为与小程序版逐条对照一致（含 `NOT_FOUND_OR_FORBIDDEN`、`INVALID_ID` 错误码）。

---

### P2 主链路：首页 / 批次 / 详情 / 录入（4–6 人天）

**范围（按页面）**

1. **首页 Home**（`index.js` 260 行）
   - 当前档案卡（今日体温/今日用药/最近体温）、批次列表（记录数、起始时间）、首页内嵌「新建批次」弹层、4 个横切入口。
   - 逻辑平移：`countBatchRecords`、`formatBatchStart`、`latestTemp` 分级取色。
2. **批次管理 BatchManage**（274 行）
   - 列表（记录数/起始）、新建、重命名、级联删除（有记录时「全部删除」确认文案）。
   - `replace()` 批量删除语义必须保留。
3. **批次详情 BatchDetail**（873 行，最大工作量）
   - 温药合并时间线（`kind/ts/dateText/showDateHead`，同日首条显示日期头，末条竖线截断）。
   - 体温编辑弹层：≥38.5 自动开启同步用药、多药物条目、增量同步（`medId` 有则 update、无则 create、被移除则 remove）、`medicationId` 重建、关闭同步仅解绑。
   - 用药编辑弹层（药名/厂商/剂量步进/单位 chip/时间/备注）。
   - 删除：体温「都删除 / 仅体温」双选、删除联动用药时回清体温 `medicationId`。
   - 底部悬浮双按钮（快速记录 + 导出占位，P4 接 PDF）。
4. **快速记录 Record**（556 行）
   - 双区块选填、至少一项校验、体温 30–45°C 与 `maxlength=4` 实时提示、测量方式 chips。
   - 多药物动态条目、药名快捷芯片（药名库优先 + 历史频次补足，`collectMedNameSuggestions`）、剂量步进器（空值 +1、减到 0 清空、上限 10000）。
   - 服药时间默认跟随测量时间，手动修改后独立（`medTimeTouched`）。
   - 保存链路：体温 → 多用药 → 回填第一条 `medicationId` → 静默写入药名库 → toast → 返回批次详情。
   - 必须处理 `?batchId` 缺失/批次被删/批次不属当前档案的 `no-batch` 空态。

**改动模块**：`src/pages/Home|BatchManage|BatchDetail|Record`、`src/components/FormField|Chip|Stepper|Sheet|TimelineRow`、`src/hooks/useStoreQuery`。

**验收**

- 从首页新建批次 → 进详情 → 快速记录（体温+2 种药）→ 时间线顺序、条数、关联标记正确。
- 编辑体温把 38.0 改成 39.0 触发同步用药 → 保存后用药条数/内容正确；关闭同步后关联解除但用药记录保留。
- 删除批次后其体温/用药一并消失，其他批次不受影响。
- 删除关联体温时「仅体温」与「都删除」两种路径结果符合预期。
- 刷新页面数据不丢；排序与小程序版一致（时间倒序/正序分别对应页面）。

---

### P3 次链路 + 图表（4–5 人天）

**范围**

1. **体温历史 / 用药历史**：只读、按批次分组（批次按 `updatedAt` 倒序，「未归组」固定最后、空组隐藏）、分组头跳详情。
2. **档案管理**：CRUD、当前档案切换、删除档案级联删记录、删除当前档案后自动切到剩余第一个。
3. **药名库**：CRUD、`name+manufacturer` 组合判重（编辑时排除自身）、效期与过期标红、编辑/移除。
4. **体温图表**
   - 平移 `drawChart`：Y 轴动态域（`min(36,min)-0.3` ~ `max(38.6,max)+0.3`，步长 0.5/1）、37.3/38.5 虚线参考线、面积填充、数据点分级配色、≥38.5 加粗标值、横轴最多 5 个日期刻度。
   - 画布就绪策略替换：`ResizeObserver` + `devicePixelRatio` 缩放，替代 `createSelectorQuery` 的 20 次重试；容器从 `hidden` 改为始终布局（或用可见性而非 `display:none`）避免尺寸 0。
   - 时间范围切换仅显示卡内 loading，不销毁画布（复刻现有 `rangeLoading` 行为）。
   - 统计卡（次数/≥38.5 次数/最高/最低/平均）与用药时间线。
5. 可选：存储从 localStorage 切 IndexedDB（一次性迁移脚本 + 版本号），并调用 `navigator.storage.persist()`。

**改动模块**：`src/pages/TempHistory|MedHistory|ProfileManage|MedNameManage|ChartReport`、`src/lib/chart.ts`、`src/lib/storage.ts`。

**验收**

- 图表 7/30/90 天切换无空白、无重复绘制；窗口缩放后自动重绘且清晰。
- 只读页无任何编辑入口；分组顺序与空态文案一致。
- 药名库同名不同厂商可并存；过期项标红；移除后快捷芯片不再出现但历史记录不受影响。
- 切档案后所有页面数据同步切换（首页统计、历史分组、图表）。

---

### P4 PDF 导出与系统交互收口（2–3 人天）

**范围**

1. `pdf/export.ts`：保留「块构造 → 分页 → 逐页 Canvas 绘制（A4 595×842pt，2x，页头/统计/时间线/页脚页码）」，改用 jsPDF 以 JPEG 图片页输出，删除手写 `assemblePdf`、`decodeBase64`、`FileSystemManager`。
2. 导出后交互：底部 ActionSheet（「打开预览 / 下载」）；预览用 `window.open(blobURL)`，下载用 `<a download="批次名.pdf">`；支持 `navigator.share({ files })` 时追加「系统分享」项，不支持则隐藏。
3. 统一交互组件替换：剩余 `wx.showToast/showModal/showActionSheet` 全部切到 P1 组件；日期/时间统一封装 `input[type=date]` / `input[type=time]`（移动端原生滚轮，桌面端原生日历）。
4. 数据备份：`backup.ts` 一键导出全量 JSON（6 个 key）+ 导入校验（schema、id 冲突、错误提示）。这是 PWA 侧唯一的「防丢数据」保险。

**改动模块**：`src/lib/pdf/*`、`src/components/ActionSheet`、`src/pages/BatchDetail`、`src/pages/ProfileManage`（备份入口）。

**验收**

- 20 条记录导出：分页正确、页脚页码正确、中文清晰、时间线轴点/日期头/颜色与小程序一致。
- 移动端 Chrome/Safari 下载成功且文件名正确；桌面对话框可下载。
- 60 页上限与「记录过多」提示保留；内存/耗时在 3 秒内（20 条样本）。
- 导入备份后页面数据与导出前逐条一致。

---

### P5 兼容、验收与发布（2–3 人天）

**范围**

1. iOS 专项：安全区（底部悬浮条不与 Home Indicator 重叠）、`100dvh`、输入聚焦不顶飞布局、安装引导（Safari 分享 → 添加到主屏幕）、`apple-mobile-web-app-capable`。
2. Android/桌面：Chrome 安装提示（`beforeinstallprompt`）、桌面最大宽度布局、`@media (hover: hover)` 隔离 hover 效果、键盘 Tab 可达。
3. SW 更新策略验证：发布新版本 → 旧页面提示刷新 → 刷新后数据仍在。
4. 性能：首屏 JS gzip 目标 < 150KB（不含 PDF/图表按需分包）、Lighthouse PWA 项全绿、LCP < 2.5s（模拟 4G）。
5. 部署：静态托管 + HTTPS + SPA fallback（`/* → /index.html`）+ 缓存头（`index.html` no-cache，`assets/*` immutable）。
6. 回归：第六节清单逐条走查，输出对照结论。

**改动模块**：`index.html`、`src/styles/base.css`、`vite.config.ts`、部署配置。

**验收**：第五节清单全部通过；真机（iOS Safari、Android Chrome）各完成一次「安装 → 录入 → 刷新 → 离线 → 导出」。

---

## 五、关键改造点细则

### 5.1 存储层

```ts
// 目标：页面代码不感知底层实现，契约与 utils/store.js 完全一致
type Result<T> = { data: T | null; error: { code: string; message: string } | null };
interface StorageDriver { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void>; }
```

- localStorage 版：JSON 序列化，`try/catch` 包成 `CLIENT_EXCEPTION`。
- IndexedDB 版：单库单表 `kv(key, value)`，一次事务写入整表（与现有「整表读写」模型吻合，避免重写 store）。
- 注意：`wx.setStorageSync` 是同步的，浏览器版改为异步 Promise —— `store.ts` 本来已返回 Promise，页面层无感，但 `ensureDefaultProfile` 需 `await`。

### 5.2 路由与返回语义

- 小程序 `wx.navigateTo` 有页面栈；Web 改为 `navigate('/batch-detail?id=xxx')`，返回语义用 `navigate(-1)`，需处理「直接打开深链后没有上一页」的 fallback（原 `navigateBack({ fail })` 分支）。
- 深链必须可用：`/batch-detail?id=` 直接打开时自行加载数据，不依赖首页状态。

### 5.3 Canvas 图表

- 现有 `ensureChart` 的 20×100ms 重试是微信 canvas 节点异步渲染的补丁，Web 端删除。
- 改为：`<canvas ref>` + `ResizeObserver` → 设置 `canvas.width = cssW * dpr` → `ctx.scale(dpr, dpr)` → 重绘 `lastPoints`。
- 容器不要用 `display:none`（尺寸为 0），用 `visibility`/绝对定位层叠，保留「切范围不销毁画布」的既有约束。

### 5.4 PDF

- 保留 A4 pt 坐标系与 `SCALE=2`：直接以 `595*2 × 842*2` 像素的 canvas 绘制，`jsPDF({ unit:'pt', format:'a4' })` 后 `addImage(jpeg, 'JPEG', 0, 0, 595, 842)`。
- `MAX_PAGES=60` 与超限提示保留；每页 JPEG 质量 0.92。
- 体积预警：图片型 PDF 约 150–400KB/页，60 页可能 20MB+，移动端内存吃紧 → 建议实施时把上限降到 20–30 页，或对无内容页做尺寸压缩（需产品确认）。

### 5.5 样式与视觉还原

- `1rpx = 0.5px`（375 基准）；字号/间距统一走 `tokens.css` 变量，避免逐条手改魔法数字。
- `hover-class` → CSS `:active`；hover 效果包在 `@media (hover: hover)`。
- 微信默认 `button` 样式干扰已在小程序侧用 `view` 规避；Web 端同样不使用原生 `button` 视觉，统一 `.btn` 类 + `role="button"` 可访问性属性。
- 输入框沿用现有「三区物理隔离」方案（label 固定 + 原生 placeholder + input 绝对定位），Web 端更容易做对，但需回归 iOS 聚焦缩放（`font-size >= 16px` 或 `maximum-scale=1`）。

---

## 六、验收与回归清单（功能等价基线）

| 域 | 检查项 |
|---|---|
| 启动 | 首次进入自动建「本人」档案并设为当前；已有档案时保持上次当前档案 |
| 档案 | 新建/编辑/删除；删除当前档案后自动切到剩余第一个；切换后全站数据跟随 |
| 批次 | 新建（首页弹层 + 管理页）、重命名、删除级联；记录数/起始时间/更新时间正确；删除确认文案区分有无记录 |
| 录入 | 至少一项校验；体温 30–45°C；>45 实时提示；`maxlength=4`；测量方式 chip；多药物增删；剂量步进（空值+1 / 0 清空 / 上限 10000）；服药时间默认跟随、改后独立；缺药名阻止保存并指到第 N 条 |
| 联动 | ≥38.5 自动开同步用药（每次编辑只自动一次）；编辑体温增量同步用药；关闭同步仅解绑；`medicationId` 指向第一条 |
| 时间线 | 温药合并、时间正序、同日首条日期头、体温紫点/用药绿点、末条竖线截断、含用药/体温联动标签 |
| 删除 | 体温「都删除/仅体温」；删除联动用药回清体温标记；删除药名库条目不影响历史记录 |
| 历史 | 只读、按批次分组、未归组垫底、空组隐藏 |
| 药名库 | `name+manufacturer` 判重（编辑排除自身）、效期过期标红、快捷芯片优先取库、提交自动记忆 |
| 图表 | 7/30/90 天；Y 域与步长；37.3/38.5 参考线；≥38.5 标值；5 个日期刻度；统计 5 项；空数据文案；切范围 loading 不白屏 |
| PDF | 分页、页头统计、日期头、轴点、页脚页码、文件名、预览/下载/分享降级 |
| PWA | 可安装、离线打开、更新提示、图标/主题色、安全区、深链刷新不 404 |

---

## 七、风险与对策

| # | 风险 | 影响 | 等级 | 对策 |
|---|---|---|---|---|
| R1 | **历史数据无法自动迁移**：小程序本地存储是沙箱，不能直接被浏览器读取 | 用户旧记录带不走 | **高** | 唯一可行路径是在小程序侧加「导出 JSON」→ PWA 侧「导入 JSON」。需确认是否接受为此改小程序代码（新增 1 个工具函数 + 1 个入口） |
| R2 | iOS Safari 对 PWA 存储有清理策略（长期不使用可能被回收），且不保证持久配额 | 数据丢失 | **高** | `navigator.storage.persist()` + 引导安装到主屏 + 一键导出备份 + 首次进入提示「建议定期备份」 |
| R3 | iOS 无 `beforeinstallprompt`，安装只能手动「分享→添加到主屏幕」 | 安装率低 | 中 | 首页/设置内做 iOS 图文引导；检测 `navigator.standalone` 判断是否已安装 |
| R4 | `navigator.share({files})` 兼容性不一致（旧 iOS/部分安卓） | PDF 分享不可用 | 中 | 特性检测，降级为下载；下载再降级为 `window.open(blobURL)` |
| R5 | 视觉还原偏差（`rpx→px`、浮动标签、iOS 输入框缩放、滚动惯性） | 观感回归 | 中 | 令牌化改造 + 逐页截图对照；iOS `font-size>=16px` 避免聚焦放大 |
| R6 | 日期/时间控件跨端差异（iOS 滚轮 vs 安卓日历） | 交互不统一 | 中 | 接受系统原生差异；如需统一则自研滚轮（成本 +2 人天） |
| R7 | Service Worker 缓存导致旧版本长期驻留 | 修复不生效 | 中 | `registerType:'prompt'` + 提示刷新；`index.html` no-cache；版本号写入构建 |
| R8 | 图片型 PDF 体积/内存（60 页上限） | 移动端导出失败 | 中 | 降低页数上限/压缩尺寸；导出前显示页数与预估大小 |
| R9 | 微信内置浏览器打开链接时能力受限（安装/下载受限） | 体验落差 | 中 | 顶部提示「请用系统浏览器打开」；不做微信 JS-SDK 依赖 |
| R10 | 静态托管缺 SPA fallback / 非 HTTPS | 刷新 404、SW 不注册 | 中 | 部署清单固化；上线前用 `curl -I` 与 Lighthouse 校验 |
| R11 | 触控/滚动/hover 残留（桌面端 hover 卡住） | 观感问题 | 低 | `@media (hover:hover)`；`:active` 替代 `hover-class` |
| R12 | 大列表渲染性能（时间线/历史全量渲染） | 长病程卡顿 | 低 | 数据量级小（个人记录），先用 `key` + 分批，不上虚拟列表 |

---

## 八、工作量估算

> 口径：1 名熟悉 React 的前端，含自测；不含产品/设计评审、不含小程序侧导出改造、不含部署平台对接审批。
> 依据：约 6.8k 行存量代码，其中 JS 2.7k（≈70% 可平移）、WXSS 2.9k（≈75% 可平移）、WXML 1.0k（≈50% 需重写）。

| 阶段 | 内容 | 估算（人天） |
|---|---|---|
| P0 | 脚手架、令牌、路由/模型冻结 | 1–1.5 |
| P1 | 存储层 + store/common 移植 + PWA 外壳 + 基础组件 + 单测 | 2–3 |
| P2 | 首页、批次管理、批次详情（时间线/编辑/删除）、快速记录 | 4–6 |
| P3 | 两个历史页、档案管理、药名库、Canvas 图表 | 4–5 |
| P4 | PDF 导出 + 交互组件收口 + 备份导入导出 | 2–3 |
| P5 | 兼容/性能/回归/上线 | 2–3 |
| **合计** | | **15–21.5 人天** |

**波动项**：iOS 真机适配（+0–2）、自研日期滚轮（+2）、IndexedDB 迁移（+0.5–1）、小程序侧导出入口（+0.5）、视觉 1:1 像素级校对（+1–2）。

---

## 九、待确认决策（实施前必须确认）

1. **部署平台**：IGA Pages / Vercel / Netlify / 自有服务器？（决定 SPA fallback 与缓存头配置）
2. **是否长期双端并行**：若小程序要继续维护，是否把 `common/store` 抽成共享包？（会影响 P0 目录设计）
3. **历史数据迁移**：是否接受在小程序侧新增「导出 JSON」、在 PWA 侧做「导入 JSON」？（否则老数据无法带走，只能重录）
4. **视觉策略**：1:1 还原现有 MD3，还是借迁移做视觉升级？（直接影响 P3/P5 工时）
5. **PDF 范围**：是否必须保留「分享给好友」？是否需要把 60 页上限下调？
6. **目标浏览器**：iOS Safari 最低版本、是否需要桌面端完整体验？
7. **数据量假设**：单档案记录量级（百/千/万条），决定是否现在上 IndexedDB 与虚拟列表。
8. **是否引入后端**：当前纯本地；若未来要多设备同步，建议本次就把 `store` 的接口按「可替换数据源」设计（现已满足，只需确认）。

---

## 十、实施顺序建议（确认后）

1. P0 一次性完成后，用现有小程序逐页截图，作为后续每页的视觉对照基线。
2. 严格按 P1 → P2 → P3 → P4 → P5 推进，每阶段末执行第六节对应条目，不跨阶段并行改页面。
3. 每阶段结束提交可运行版本（含 PWA 安装/离线验证），避免「最后才发现 SW 或路由问题」。
4. 现有小程序目录在验收通过前保持不动，便于逐条行为对照与回滚。
