# 更新日志

## v1.13.2 — 2026-06-04

### 修复：Windows「未响应」/ 界面卡顿

- **根因 1**：主进程 5 条 push loop（外汇/政策/地缘/气候/央行）与 `prefetchAfterStartup` 内 4 条 `setInterval` 重叠，同一周期内并发 `force:true` 全量网络拉取，阻塞 Electron 主线程 IPC。
- **根因 2**：渲染进程 `startAutoRefresh` 与主进程 push 重复调用 `fetchPolicyLive` / `fetchClimateLive` 等，双倍 IPC + 双倍网络。
- **根因 3**：`renderAll` 同步渲染 11 个面板（气候/地缘条目无上限），单次 innerHTML 过大阻塞 UI 线程。
- **修复**：
  - push loop 错峰启动、优先读缓存（`force:false`）、busy 防重入；移除 `cache-store` 重复后台 interval
  - 渲染端移除重复 live timer，改由主进程 push + `on*Live` 更新
  - 气候/地缘列表展示上限 80 条；`climate-fetcher` 载荷限 120 条、检索词减至 14
  - `renderAll` 使用 `requestIdleCallback` 延迟；政策/气候面板 refresh 增加 debounce
- 页脚版本号 **v1.13.2**

---

## v1.13.1 — 2026-06-04

### 修复：启动白屏 / 空白窗口

- **根因**：已安装 `app.asar` 仍为 **v1.12.2**，与源码 **v1.13**（天气气候 + `climate-fetcher` / `cache-store` 依赖）不一致；若仅热更新部分文件会导致主进程 `require` 失败或渲染端 `renderAll` 报错，窗口仅显示标题栏、内容区空白。
- **修复**：整包替换 `app.asar`（含全部 `climate-*` 服务、`main.js`、`preload.js`、`data-fetcher.js`、`src/app.js`、`index.html`）；确认 `geoFilterRegion` 已声明。
- 页脚版本号 **v1.13.1**

---

## v1.13.0 — 2026-06-04

### 天气气候板块

- 新增「天气气候」标签页：国内外 RSS + 东方财富检索，实时刷新（与政策/地缘同周期）
- 传导维度：农业产量、矿山物流、宏观政经；事件类型（干旱/洪涝/台风/ENSO 等）与 1–5 星影响评级
- 条目含传导分析（事件→传导→品种）与大宗商品标签，可跳转政策雷达大宗专区
- 新增 `climate-sources` / `scorer` / `commodity-bridge` / `fetcher`；`policy-commodity-intelligence` 增加 `climateNews` 桶

---

## v1.12.2 — 2026-06-03

### 修复：各板块无法加载

- **根因 1（v1.12.1）**：`commodities-news.js` 未导出 `getFastNewsPool` / `getGlobalNewsPoolSync`，主进程拉取政策/地缘数据报错
- **根因 2（v1.12.2）**：地缘政治模块使用 `geoFilterRegion` 但未声明，启动时 `renderAll` 抛出 `ReferenceError`，界面卡在空白/加载中
- 切换标签时若面板尚未渲染，自动补建占位面板
- 快捷方式备注同步为 **梵澄金融 v1.12.2**

---

## v1.12.0 — 2026-06-03

### 地缘深度分析 → 大宗关联同步

- 新增 `geopolitics-commodity-bridge.js`：地缘条目自动打品种标签、多空方向、影响摘要
- `policy-commodity-intelligence.js` 增加 `geoNews` 桶与 `geoNewsCount`
- 政策雷达「大宗关联」区新增 **地缘深度分析** 区块；品种芯片显示「缘」计数
- 地缘页品种标签可点击跳转政策雷达对应品种
- `policy-commodity-map.js` 扩展宏观地缘别名（中东/俄乌/台海/OPEC 等）

---

## v1.11.0 — 2026-06-03

### 地缘政治板块（四维竞争深度分析）

- 新增地缘政治标签页：五大区域、70 国影响力评级、意识形态/军事/政治/经济四维竞争
- 逻辑链分析（事件→机制→外溢）+ 22 位学者/政治家引述
- 多源抓取：RSS + 东方财富检索 + 离线中文化

---

## v1.9.0 — 2026-06-03

### 阅读体验重构（政策雷达 · 美联储 · 日本央行）

- **美联储 / 日本央行**：顶部 KPI 指标卡片一览；下方「时间线 / 官员讲话 / 公告新闻」标签切换；统一序号+日期+标题行，点击打开原文
- **政策雷达**：取消多栏分散布局，改为单列阅读列表；顶部筛选（中/美、部委、星级）；视图切换「全部 / 大宗关联 / 高影响」
- 新增 `src/reading-layout.css` 阅读专用样式

---

## v1.8.6 — 2026-06-02

### 数据迁移至 E 盘（释放 C 盘空间）

- 新增 `services/data-paths.js`：统一外置存储路径
- 运行时数据默认写入 `E:\FanchengFinance\data`（行情/K线/宏观/新闻缓存）
- 用户配置迁移至 `E:\FanchengFinance\userData`（含 FRED 密钥）
- 程序安装目录：`E:\FanchengFinance\app\win-unpacked`
- 备份目录：`E:\FanchengFinance\backups`
- 快捷方式优先指向 E 盘程序
- 提供 `迁移到E盘.bat` / `scripts/migrate-to-e-drive.ps1` 一键迁移
- 已清理 C 盘历史 `dist-v162`～`v174` 等旧打包（约 10GB+）

---

## v1.8.5 — 2026-06-02

### 美联储关键经济指标修复

- 新增 `services/fed-indicators-fetcher.js`：多数据源聚合拉取 9 项关键指标
  - 国债收益率（10年/2年/利差）→ 美国财政部 XML
  - 美元/人民币 → 新浪财经
  - 联邦基金利率、失业率、CPI、M2、VIX → FRED API / CSV
- 优化 `services/fred-client.js`：API 429/403 后 15 分钟冷却，逐条请求避免限流
- 指标独立磁盘缓存 15 分钟（`fed-indicators-v2.json`），实时刷新不再每 30 秒打爆 FRED 配额
- `fetchFedLive` 不再用空指标覆盖已有缓存
- `cache-store` 启动时从指标缓存补全空的 Fed 面板
- 前端 `ensureCentralBankData`：指标缺失时也会触发刷新

### 官员讲话模块（v1.8.0–v1.8.3 延续）

- 美联储 / 日本央行官员货币政策讲话，1–5 星评级
- 讲话标题客户端中文化（`CB_SPEECH_I18N`）
- 实时 30 秒推送

### 构建

- 最新打包：`dist-v185\win-unpacked\FanchengFinance.exe`
- 桌面快捷方式已指向 v1.8.5

---

## v1.8.4 — 2026-06-02

- FRED CSV 公开数据回退（未配置密钥时）
- 修复 Fed 面板指标缺失时不刷新

## v1.8.3

- 讲话标题客户端中文化嵌入

## v1.8.0

- 央行官员讲话模块初版
