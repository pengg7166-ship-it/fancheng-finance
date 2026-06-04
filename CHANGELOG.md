# 更新日志

## v1.23.0 — 2026-06-04

### 升级：大宗研判可读性 + 每日对照

- **预测波动**：平滑/极端双框独立 `.outlook-vol-line`（16px 粗体 `#e8edf5`），去除与区间重叠的淡色副文案
- **技术标签**：`.outlook-tech-tags` 全量换行展示（列宽 tech≥280px / pred≥220px）；MA5/10/20/60、BOLL、量比、持仓、振幅、日线、σ预测、双速标签
- **预测缘由 / 历史对照**：引擎 `historicalContext`（近60日类似波动、次日均涨跌、先例摘要）；表内「预测依据」列 + 详情「预测缘由」「历史对照」；打开自动选中首行
- **每日对照**：`outlook-history/daily/YYYY-MM-DD/summary.json` 日快照；启动 `resolveYesterdayPredictions`；工具栏「每日对照」弹窗；详情「昨日存档」行
- 页脚版本 **v1.23.0**
- 会话收尾：每日研判存档与对照 UI

---

## v1.21.1 — 2026-06-04

### 升级：大宗研判现价实时 + 边框行情盒

- **现价列**：`outlook-price-box` 大字号价格 + 单位 + 独立边框涨跌幅（红/绿）；主进程 `commodities-live` 推送与新浪缓存同源
- **DOM 增量**：`updateOutlookPriceCells` 仅补丁现价列，研判列表 hash 不再含 `price/changePct`，避免整表重绘跳过行情
- **节流**：每品种 DOM 补丁最快 1 秒；推送批次 `batch: true` 一次打完
- **推送环**：统一 push 循环新增 commodities 步；`fetch-commodities-live` 成功后亦推送

---

## v1.21.0 — 2026-06-04

### 升级：大宗研判预测双框 + 预测校验 + 版面重排

- **预测双框**：主表「次日预测」列展示平滑预测（base + ±波动）与极端预测（stress + 触发角标）；14px 高对比边框，行高 ≥72px，去除发虚小字
- **预测缘由** `predictionRationale`：引擎从 σ20 / EMA / 60日分位 / 资讯条数 / 资金关注 / 双速反射 / 盘中涨跌合成 2–3 行中文依据（非模板占位）
- **预测校验** `commodity-outlook-history.js`：快照写入 `predictedMid/Low/High` + `priceAtPredict`；下一交易日 K 线收盘或间隔现价解析 `accuracy.jsonl`；详情区「预测校验」表 + 页脚近7日方向命中率
- **版面**：宏观因子横向滚动 chips → 工具栏（板块/更新/存档/命中率）→ 主表 → 点击下方全宽 `outlook-detail-panel`（四情景 | 缘由+双速 | 校验+因子条）
- **诊断**：断言预测双框可见、`predictionRationale` 长度 >20、无「研判积累中」方向文案

---

## v1.20.0 — 2026-06-04

### 升级：双速市场反射 + 四情景 + 研判存档

- **双速通道** `commodity-market-adaptive.js`：即时(盘中/快讯/VIX) + 滞后(OI/MA/政策1–24h)；`latencyState` 同步/滞后/背离；综合分 = w即时×即时分 + w滞后×滞后分
- **四情景** `base` / `bull` / `bear` / `stress` 独立 % 区间；展开行表格展示
- **存档** `E:\FanchengFinance\data\outlook-history\YYYY-MM-DD.jsonl`：Δ分≥0.05 / 方向变 / 中心≥0.15% / regime变 / 反射状态变 → 异步 append；IPC `getOutlookHistory`
- **UI**：较上次 Δ、研判存档（最近20条）、页脚「今日存档 N 条」、双速通道说明
- 页脚版本 **v1.20.0**

---

## v1.19.0 — 2026-06-04

### 升级：大宗研判动态多情景 + 变更存档

- **双轨波动** `commodity-volatility-model.js`：基线 EMA10/20 + 盘中|涨跌|/放量/高星资讯突变层 → composite σ；不削平合法同日突变，保留板块上限（如 au 1.2%）
- **四情景** `base` / `bull` / `bear` / `stress`（突变触发：≥4★ 或 shock&gt;1.5×EMA）；主行展示基准，展开显示三行情景 + %
- **环境 regime**：`riskOn` / `riskOff` / `liquidityPanic` / `supplyShock` / `weatherShock` — 由 VIX、DXY、地缘/气候、持仓放量检测；因子权重 = 档案 × regime 乘数（分解表标注 ×）
- **实时**：`data-refreshed` / push 指纹变化 → 800ms 合并重算；行内「研判更新 HH:mm:ss」
- **存档** `commodity-outlook-history.js`：`{FANCHENG_DATA}/data/outlook-history/YYYY-MM-DD.jsonl` + `outlook-snapshots/{id}/latest.json`；实质变更（Δ分≥0.05 / 方向变 / 中心≥0.15%）异步写入；IPC `getOutlookHistory` / `exportOutlookHistory`
- **UI**：较上次 Δ 分/区间、regime 变更角标、「研判存档」最近 20 条
- 页脚版本 **v1.19.0**

---

## v1.18.2 — 2026-06-04

### 升级：平滑波动纳入涨跌幅研判

- **波动模型**：σ20 / ATR14 / p90 + `volEma10`（|日收益| EMA）+ `volEma20`（20日σ EMA）；次日预测 = `0.65·volEma10 + 0.35·volEma20`；日线 5–19 根时混合盘中振幅与板块先验；日环比预测 ±15% 封顶（cache 持久化）
- **波动 regime**：相对 60 日历史分位 → 低波/常态波/高波；纳入 `compositeScore`（volLevel/volTrend/volBias）与方向阈值（高波放宽）
- **次日区间**：半宽 = 平滑σ预测 × `volMultiplier(tier)`；保留 au ±1.2% 等 v1.17.1 上限；UI 子行「平滑波动 0.38% (10/20 EMA) · 昨日参考 0.35%」
- **UI**：技术标签 低波/常态波/高波 + σ预测；展开行 σ20/EMA10/forecast；置信星按波动稳定性加权
- **诊断**：断言 au/cu `volForecastPct` 数值、au 区间 span ≤1.5%
- 页脚版本 **v1.18.2**

---

## v1.18.0 — 2026-06-04

### 升级：大宗走势研判 — 逐品种档案 + 资金关注 + 因子分解

- **品种档案** `commodity-instrument-profiles.js`：74 品种 `volatilityTier` / `macroSensitivity` / `supplyDemandType` / `tradingSession` / 差异化因子权重（如 au 美元35%+资讯15%，cu 中国宏观25%+库存20%，农产品 weather 30%）
- **资金关注 0–100**：量比5d/20d、持仓Δ、成交额代理、盘中振幅、板块内成交量排名
- **资讯冲击**：关键词+别名分桶（政策/地缘/气候/大宗快讯/宏观），relevance×星级×源权重，显示「资讯冲击 +0.18（3条命中）」
- **综合研判**：`compositeScore` 两位小数；方向 强多/偏多/震荡/偏空/强空（按波动 tier 阈值）；因子分解对象（macroUsd/capital/news/…）+ 中文 rationale 引用 top2 驱动
- **UI**：新增资金关注列；展开面板因子贡献表/条形图；方向列显示强多/偏空+综合分
- **修复**：新浪 OI 字段 fallback；持仓不再误显「持仓0%」
- 页脚版本 **v1.18.0**

---

## v1.17.0 — 2026-06-04

### 修复：大宗研判全行「研判积累中」+ 次日区间 ±0.8% 雷同

- **根因**：`outlookPending = !hasEnough && newsWeight<=0` 导致 74 品种有报价仍 pending；`computeNextDayRangePct` 无 BOLL 时固定 `baseVol=0.8`
- **引擎**：有 live 报价即输出具体方向（综合分 ±0.00 两位小数）；区间按 ATR/BOLL/实现波动/盘中振幅逐品种计算；新闻 0 命中显式「综合分 0.00」
- **技术面**：日线不足时用盘中涨跌、MA(5+)、量比、持仓Δ；标签「日线不足·用盘中+资讯」；置信星按数据完整度计算
- **K线**：outlook 计算时后台 backfill 缺失日 K cache
- **UI**：方向列显示综合分；次日区间含中心点（3 位小数）；偏多/偏空时不显示泛化「震荡」
- **诊断**：`diagnose-bootstrap` 断言前三品种区间或综合分不同、有行情时方向不含「研判积累中」
- 页脚版本 **v1.17.0**

---

## v1.16.1 — 2026-06-04

### 修复：大宗走势研判显示模糊/列空 + 全品种覆盖

- **显示根因**：`.outlook-instrument-list` 使用 `content-visibility: auto` 与 0.62–0.88rem 字号，滚动区文字发虚；列宽过窄导致重叠；现价未优先绑定 sina 实时缓存
- **修复**：移除 outlook 列表 `content-visibility`；品种/现价/区间/徽章统一 14px+ 可读字号与 52px 行高；现价绑定 `commodities` 实时报价并显示缺失原因；次日区间渲染 `low~high%` + bias；技术徽章提高对比度
- **覆盖**：`INSTRUMENT_REGISTRY` 改由 `commodities-catalog` 全量生成（~74 品种），sector tabs 自动计数；无技术面数据仍展示报价 +「研判积累中」
- **管道**：outlook 引擎合并 commodities 报价；挂载时若品种空但行情已加载则同步重算；`diagnose-bootstrap` 断言首行价格/区间与字号
- 页脚版本 **v1.16.1**

---

## v1.16.0 — 2026-06-04

### 修复：大宗走势研判空白面板 + 扩展 44 品种六板块

- **根因**：`mountOutlookPanel` 在面板已有 DOM 但无 `.outlook-instrument-row` 时不执行 `replaceSinglePanel`；`renderPanel` 增量缓存漏写 `instruments`；`executeRenderAll` 用空 outlook 覆盖已渲染表格；live 回调仅检查 `categories`
- **修复**：`outlookPanelNeedsFullMount` 强制挂载；空态/重试保留；全量渲染时保留已有 instrument 行；IPC/live 路径统一检查 instruments∨categories
- **品种扩展**：`INSTRUMENT_REGISTRY` 44 主力 — 能源/化工/黑色/有色新能源/贵金属/农产品（焦煤·玻璃·PTA·甲醇·纯碱·橡胶·PVC·塑料·PP·原油·燃油·液化气·动力煤·工业硅·多晶硅·碳酸锂·镍·锡等）
- **UI**：六板块 sector tabs 筛选；K线不足显示「指标待日线积累」仍展示新闻+宏观+现价
- **诊断**：`diagnose-bootstrap.js` 输出 registry 数、IPC instrument 数、面板可见文本
- 页脚版本 **v1.16.0**

---

## v1.15.0 — 2026-06-04

### 升级：大宗走势研判 — 逐品种多因子 + 次日波动区间

- **逐品种研判**：铜/金/银/原油/螺纹/铁矿/铝/锌/镍/燃油/棕榈/玉米/豆粕/PTA/甲醇/碳酸锂/国际铜等 17 主力品种
- **次日量化区间**：`nextDayRangePct { low, mid, high, bias }`，公式：mid=宏观×0.35+技术×0.25+新闻×0.2；区间 ± (BOLL带宽/2 + |新闻|×0.45)
- **多因子模型**：
  - 宏观七因子（按品种桶加权）
  - 新闻池 + 政策/气候/地缘条目 symbol 匹配加权
  - 技术面：`commodity-technical-analyzer.js` — SMA/EMA、BOLL(20,2)、MA5/10/20/60 排列、金叉/死叉、量比（vs 5 日均量）、持仓 Δ%
- **UI**：品种表格（区间/方向/技术徽章）+ 可展开详情（指标值/新闻命中/宏观 chip）；四大类 outlook 降为参考区
- K线来自本地 cache（≥20 根时 BOLL 完整）；持仓 Δ 为会话间快照对比
- 页脚版本 **v1.15.0**

---

## v1.14.1 — 2026-06-04

### 修复：大宗走势研判标签永久「正在加载」

- **根因**：v1.13.6 增量更新仅在面板已有 `.outlook-panel` 时刷新 DOM；首次渲染为 loading 占位后，后台 `sources.outlook` 到达不会 `replaceSinglePanel`，切 tab 时 `refreshOutlookPanelSections` 也因无数据/无容器而空操作。
- **修复**：
  - 打开 outlook 标签：`activateOutlookTab` 用缓存或 IPC `fetchOutlookLive` 计算并 `mountOutlookPanel`（无内容则 skeleton → 2s 后「数据积累中」+ 重试）
  - 增量/推送路径：无 `.outlook-panel` 时改 `replaceSinglePanel`；非激活标签缓存 + 徽章
  - 失败态显示错误信息与重试按钮
- 页脚版本 **v1.14.1**

---

## v1.14.0 — 2026-06-04

### 新功能：大宗商品走势研判面板

- **新标签「大宗走势研判」**：四大类（能源/贵金属/有色/农产品）短（1–7 日）、中（1–4 周）、长（1–3 月+）方向 outlook
- **规则加权 v1 引擎** `commodity-outlook-engine.js`：聚合现有指数/美股、DXY、政策/气候/地缘、美联储/日央行数据，无 ML
- **UI**：overview 卡片、7 路因子分解（↑↓→ + 1–5 星置信度 + 中文简评）
- 主进程 push 循环增量刷新；仅激活面板更新 DOM
- 页脚版本 **v1.14.0**

---

## v1.13.6 — 2026-06-04

### 修复：浏览仍卡顿 — 虚拟列表与后台节流

- **根因 1**：政策/地缘/气候列表仍一次性挂载 80–100 条 DOM，滚动与后台 push 叠加阻塞主线程。
- **根因 2**：主进程 5 路独立 push 定时器并行触发网络/IPC；窗口失焦时渲染端仍处理 live 更新。
- **修复**：
  - 政策/地缘/气候改**虚拟列表**（约 32 可见行 + spacer），筛选 debounce 450ms
  - 窗口 blur/最小化：主进程**单循环轮转 push**并暂停；渲染端取消 rAF/增量 DOM
  - `content-visibility: auto`、IntersectionObserver 延迟非可见面板初始化
  - fetch 载荷上限 200 条；政策卡片样式减阴影/渐变降低 layout 成本
- 页脚版本为 **v1.13.6**

---

## v1.13.5 — 2026-06-04

### 修复：浏览仍卡顿 / 响应慢

- **根因 1**：v1.13.4 增量更新仍刷新全部 11 面板 DOM；后台 push / data-refreshed 在非当前标签页同步重建大列表 innerHTML。
- **根因 2**：主进程 5 路 push 间隔过密，载荷合并不足；渲染端 idle 队列与 debounce 叠加仍触发批量重绘。
- **修复**：
  - 仅更新当前可见面板；非激活标签只缓存数据 + 导航栏轻量计数徽章
  - 政策/地缘/气候列表改 rAF 分块 append（20 条/帧）+ 输入 hash 跳过未变 DOM
  - 筛选 debounce 350–380ms；切 tab 取消 pending 渲染；rAF 队列替代 idle 回调
  - 主进程 push 最小间隔 2.5s、合并最新载荷；各 loop 间隔加大；quote 刷新下限 45s
- 页脚版本为 **v1.13.5**

---

## v1.13.4 — 2026-06-04

### 修复：浏览时频繁「未响应」/ 界面卡顿

- **根因 1**：后台 `data-refreshed` / 定时 `fetchAll` 每次触发全量 `renderAll`，同步重建 11 个面板 innerHTML，阻塞渲染主线程。
- **根因 2**：政策面板初始渲染未限制条目数；地缘/政策 fetch 载荷无上限，内存与 DOM 节点持续增长。
- **根因 3**：主进程 push 重复发送相同载荷；筛选器点击与 live 更新未 debounce，叠加 DOM 重绘。
- **修复**：
  - 面板初始化后改增量更新（indices/forex/policy/geo/climate/央行等），仅手动刷新才全量 `renderAll`
  - `renderAll` 合并排队 + idle 延迟；政策列表展示上限 100 条；政策/地缘 fetch 限 150/120 条
  - 主进程 push 去重 + 页面加载中跳过；政策/地缘/气候筛选与 live 刷新 debounce 280–320ms
- 页脚版本为 **v1.13.4**

---

## v1.13.3 — 2026-06-04

### 修复：xml2js 缺失与 Windows 批处理启动

- **根因 1**：app.asar 未包含完整 node_modules，缺少 xml2js，RSS 解析失败导致白屏
- **根因 2**：部分 .bat 在 EXE 未找到时执行 `start ""` 触发 Windows 报错
- **修复**：electron-builder 打包并 robocopy 至 E:\FanchengFinance\app\win-unpacked；启动前校验 EXE
- 页脚版本为 **v1.13.3**（延续 v1.13.2 白屏/未响应修复）

---

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
