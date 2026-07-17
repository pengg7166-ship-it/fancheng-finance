# 更新日志

## v1.39.0-cleanup — 2026-07-02

### 移除量化交易模块 · 对齐长线指导愿景

- **UI**：移除「量化交易」标签页与相关样式/IPC
- **服务**：删除 sim/daemon/archive/outbox/forward-export 等量化执行链路；保留 `trading-rules-quant-gate.js` 供 outlook posture 使用
- **版本**：引擎/UI/指导层统一 `v1.39.0-cleanup`

---

## v1.35.9 — 2026-06-29

### 梵澄哲学全产品落盘

- **Canonical manifest**：`services/fancheng-philosophy.js` + `data/fancheng-philosophy-v1.json` + `docs/FANCHENG_PHILOSOPHY.md`
- **六原则**：变化优先 · 研判为纲 · 缠论为术 · 时段校正 · 实证对照 · 审慎 gate
- **研判详情 · 哲学锚点**：品种对齐六原则 + Phil gate 状态；研判逻辑增加时效性与 filter 说明
- **全局 UI**：页脚/设置「梵澄哲学」模态 · outlook epigraph · 量化 tab 免责声明 · 政策 Phil·契/异 · 宏观汇入提示
- **引擎**：`philosophyAnchor` 随 outlook 品种输出；`PHILOSOPHY_FILTER_V2=1` Electron 默认开启
- **UI 版本**：`OUTLOOK_UI_VERSION=1.35.9`

---

## v1.35.8 — 2026-06-29

### 预测校验三时段分栏 + 研判详情动态刷新

- **预测校验 · 区间/方向**：详情面板改为 **20:55 / 08:55 / 13:25 三列并排**，每列独立命中率与近 5 日 session 行
- **三时段快照对照**：点击品种后展示当日三槽预测中心/区间/方向并排对比
- **动态研判详情**：行情推送、时段快照、存档回填时自动刷新选中品种详情；各节显示 **更新时间** 与 **较上次更新** 标记
- **后端**：`rangeAuditStatsBySlot` / `directionAuditStatsBySlot` 按槽统计
- **UI 版本**：`OUTLOOK_UI_VERSION=1.35.8`

---

## v1.35.7 — 2026-06-29

### 固定时段三联预测（提升命中率对照）

- **三个固定时段**：20:55 夜盘前 · 08:55 日盘前 · 13:25 午盘前（Asia/Shanghai）
- **存档**：`outlook-history/slot-snapshots/{sessionDate}/{slotId}.json`，方向/区间 archive 带 `predictionSlot` / `predictionSlotLabel`
- **调度**：应用运行期间每分钟检查；晚启动会补抓当日已过期槽位（需应用曾运行）
- **UI**：品种行时段 badge · 校验表「预测时段」列 · 时段筛选 tabs · CSV 导出含预测时段
- **分析**：`node scripts/analyze-slot-hit-rates.js` 按槽对比方向/区间命中率
- **手动测试**：`node scripts/capture-outlook-slot.js --slot pre-day [--date YYYY-MM-DD] [--force]`

---

## v1.35.6 — 2026-06-28

### 区间预测平衡校准（命中率 ≥75% + MAE 可控）

- **评分函数**：`range-cal-score.js` 硬约束 recent/OOS 命中率 ≥75%，在满足约束下最小化 combined MAE
- **偏差修正**：archive recent hit <75% 时跳过 bias 修正；hit >85% 且 MAE 极低才缩窄
- **参数更新**（`E:\FanchengFinance\data\outlook-models\`）：
  - AU: 1.95/2.25 · AG: 2.05/2.25 · SC: 1.95/2.3 · CU: 2.25/2.05
  - RB: downMult 1.05→1.2 · FG: 1.65/2.6
- **整体 band hit**：72.2% → **71.8%** 模拟（v1.35.5 为 63.4%）
- **重点品种 recent hit**：AU 93% · AG 84% · CU 79% · RB 84% · FG 79% · SC 84%（均 ≥75%）
- **UI**：保留 v1.35.4 导出/排序

---

## v1.35.3 — 2026-06-28

### 区间预测误差校准（2026-06 窗口）

- **近期窗口评分**：校准脚本优先 2026-06-01~27 命中率，解决 AU/SC/FU 等品种 OOS 达标但近期 miss 偏多
- **lowBiasPct**：贵金属/有色/能源区间带增加低点偏置（与 FG 化工系一致）
- **参数更新**（`E:\FanchengFinance\data\outlook-models\`）：
  - AU: upMult 1.3→1.95, downMult 1.1→2.25
  - CU/BC/AL/SN: 显著加宽（recent 63%→95% 模拟）
  - SC/FU/LU: 能源系加宽（SC recent 26%→100%）
  - 化工 V/BR/SA/EG/UR/TA/MA/PP/RU: 重新网格校准
- **FG 保持不变**：downMult 2.1 · ~77% recent（用户偏好）
- **整体 band hit**：archive 窗口 72.2% → 新参数模拟 83.7%
- **UI**：`OUTLOOK_UI_VERSION=1.35.3`

---

## v1.35.1 — 2026-06-27

### 修复：研判列表无法滚动 + 恢复次日预测校验对比

- **滚动（ definitive ）**：74 品种改用**原生 overflow 列表**（弃用 outlook 虚拟列表），wheel/滚动条均可遍历全部品种
- **次日预测列**：恢复 **实际高/低 vs 预测高/低** 并排展示，含 **Δ高/Δ低** 与 **命中/未中/待校验** 色标；数据来自 `rangeComparison` / `yesterdayArchive` / `highLowPrediction`
- **预测依据**：`buildOutlookRationaleSummary` 回退波动 regime、Gate、资讯、资金等摘要
- **详情面板**：恢复区间 high/low 审计表（`rangeAuditRecords` · 近 5 日 · 命中率）
- **UI 版本**：`OUTLOOK_UI_VERSION=1.35.1` 强制 remount

---

## v1.35.0 — 2026-06-27

### 稳定版：启动闪退 / 缓冲 / 研判完整性

- **闪退防护**：主进程记录 `render-process-gone`；渲染端 `error` / `unhandledrejection` 日志；虚拟列表行渲染 try/catch
- **启动 <1s**：缓存命中后立即 `hideLoadingOverlay`；去掉 blur 触发的 `rendererPaused`（仅 `document.hidden` 暂停，修复 idle「未响应」）
- **研判 v1.35.0**：`enrichOutlookInstrumentClientSide` 为旧磁盘缓存补全 `highLowPrediction`（元/吨）与 `rationaleSummary`；Phil/Q Gate 徽章；`OUTLOOK_UI_VERSION=1.35.0` 强制 remount
- **Gate 层**：engine `buildTechBadges` 附带 Phil/Q 标签；展示层 `renderOutlookGateBadges` 于品种名旁
- **启动**：snapshot 合并 outlook 到 sources；移除重复 `onStartupData` 全量重绘

---

## v1.34.17 — 2026-06-27

### 修复：次日预测显示旧版百分比 / 研判 Tab 缓冲过长

- **根因（UI）**：`renderOutlookPredictionBoxes` 仍用 `formatOutlookRangePct(scenarios.base)`，未读取 engine 已写入的 `highLowPrediction.predictedHigh/Low`；`getOutlookHighLow` 缺失导致 verify-asar 告警
- **次日预测**：平滑/极端双框改为 **元/吨 高低价区间**（`998.9 ~ 954.6 元/吨`）；极端未触发显示「未触发」
- **预测依据**：`renderOutlookRationaleBrief` 回退 `predictionRationale` / `rationale` 首行
- **缓冲优化**：磁盘缓存命中时跳过 skeleton、立即挂载虚拟列表；回测/长周期统计 idle 延后 2.5s/4s 且不重挂载列表；首次 live 刷新延后 8s
- **UI 版本**：`OUTLOOK_UI_VERSION=1.34.17` 强制 remount

---

## v1.34.16 — 2026-06-27

### 修复：启动全球指数永久加载 / 不读磁盘缓存

- **根因**：`bootstrapApp` 先 `showIndicesLoading()` 清屏；`startup-data` 推送早于 `waitForStartupPush` 注册导致事件丢失；`fetchIndicesQuick` 无缓存时阻塞 20s+ 等新浪 live；12s 定时器只改文案不回落缓存
- **缓存优先**：新增 `getCachedIndices()` IPC，启动时先读 `all-data.json`，有缓存即渲染卡片（无 spinner）
- **非阻塞**：live 指数 fetch 延后后台；`fetch-all` / `fetch-indices-quick` 超时返回 stale 缓存
- **重试上限**：「加载较慢，正在重试…」最多 2 次后展示缓存 + 警告

---

## v1.34.15 — 2026-06-27

### 修复：大宗走势研判 Tab 空列表 / 缓存未即时展示

- **根因**：Tab 打开时仅读内存缓存、超过 1h 会删除磁盘 `commodity-outlook-v4.json`；`force:true` 跳过磁盘直接全量重算；指数/财政部超时后返回空 `computing` stub 覆盖列表；虚拟列表在 `rendererPaused`/滚动期间 rAF 挂载被丢弃
- **磁盘优先**：`fetchCommodityOutlookLive` 始终先返回 `commodity-outlook-v4.json`（74 品种），`force:true` 亦先展示缓存并后台重算；live 源失败时从 `all-data.json` 合并 indices/treasury 等
- **Tab 激活**：`loadOutlookDiskCacheFirst()` IPC 读盘后立即 `mountOutlookPanel`；不再因缓存过期删除磁盘文件
- **空列表**：`remountOutlookInstrumentList` 增加 pending 队列 + 320ms 兜底挂载；窗口恢复/滚动结束重试
- **刷新降级**：部分源失败时 error bar 改为 warning，不清空研判列表；手动刷新 indices 超时不阻断 outlook 展示

---

## v1.34.14 — 2026-06-27

### 修复：全球指数 Tab「未响应」— 彻底停止主线程阻塞

- **根因**：`prefetchAfterStartup` / `fetch-all` 仍在 12s 后触发 `refreshAllData`（9 源并行 + 27 指数 Stooq）；`patchSourceInCache` 每次指数推送都调度 outlook 全量重算；磁盘 `persistToDisk` 同步写阻塞事件循环
- **禁用自动后台刷新**：启动仅读缓存；全量更新仅手动「刷新」按钮；推送循环延迟 60s 启动
- **`refreshAllData` 微任务化**：逐源顺序拉取 + `setImmediate` 让出；lag>100ms 日志；watchdog 可 abort 当前周期
- **指数**：批次 3 + 100ms 间隔；推送用新浪轻量报价；手动刷新才全量 27 指数
- **Outlook**：重算仅 outlook Tab 激活时；定时器走 `requestIdleCallback`；IPC `data-refreshed` 延迟投递

---

## v1.34.13 — 2026-06-27

### 修复：大宗走势研判列表无法滚动 + 首屏加速

- **滚动根因**：全局 capture 滚动监听将 `scrollInteractionActive` 置 true 后，虚拟列表 `onScroll`/`update` 提前 return，窗口不随 scrollTop 更新，仅首行可见
- **虚拟列表**：滚动期间始终更新可见窗口；滚动结束后 `refreshMountedVirtualLists` 兜底同步
- **CSS**：移除 scroll 容器上 `content-visibility`/`contain`；固定 72px 行高与显式 `height`+`overflow-y:auto`
- **性能**：列表行技术标签默认最多 3 个；首屏 skeleton + rAF 挂载；四大类参考区延后显示；回测摘要延迟 600ms 加载
- **UI 版本**：`OUTLOOK_UI_VERSION=1.34.13` 变更时强制重挂载面板（保留 v1.34.12 时间戳同步逻辑）

---

## v1.34.12 — 2026-06-27

### 修复：大宗走势研判时间戳冻结 + Tab 内实时刷新

- **根因**：v1.34.11 推送/刷新仅返回磁盘缓存，`liveRefreshedAt` 不更新；行情价通过 commodities 补丁但工具栏「研判更新」未同步
- **轻量刷新**：`fetchCommodityOutlookLive(force:false)` 现合并最新报价并刷新 `liveRefreshedAt`；研判 Tab 激活时 45s 轻量 / 5min 全量重算
- **Tab 激活**：缓存超过 1h 自动清除 `commodity-outlook-v4.json` 并后台重算；推送循环在 outlook Tab 优先、空闲时仍推送
- **渲染端**：`updateOutlookToolbarStamp` 同步工具栏时间戳；研判 Tab 不受 30s 用户空闲节流影响

---

## v1.34.11 — 2026-06-27

### 修复：大宗商品 Tab 空闲时「未响应」

- **禁用自动全量刷新**：仅手动刷新按钮触发 `loadData`；`onDataRefreshed` 不再重绘面板
- **大宗商品 Tab 推送降级**：仅 60s 指数心跳，暂停 commodities 实时推送
- **主进程**：后台刷新不再触发 outlook 全量重算；K 线磁盘读改为 async；IPC 超时 + 主线程 watchdog
- **渲染端**：用户空闲 30s 后暂停 DOM 更新；K 线切 Tab 销毁、空闲节流 1/min

---

## v1.28.2 — 2026-06-06

### 新闻标注历史校验

- **`services/news-history-verifier.js`** + **`scripts/verify-news-tagged.js`**：对照 Fed/OPEC/印尼政策/巴以冲突等公开史料校正 `news-tagged.csv` 日期与标签
- 输出 `data/history/news-verification-report.json`；详见 `docs/NEWS_VERIFICATION.md`
- 命令：`npm run verify-news`

---

## v1.28.1 — 2026-06-06

### 新增：期货 tick zip → 日 K 转换管线

- **`scripts/convert-tick-zips-to-daily.js`**：扫描百度网盘 `future_price*` zip，流式解析 TSV tick，按品种主力聚合 OHLCV+OI
- 映射 74 商品品种（跳过股指/国债），断点续跑，自动同步至 klines 缓存
- 命令：`npm run convert-tick-zips`；文档见 `docs/TRADING_DATA_IMPORT.md`

---

## v1.28.0 — 2026-06-05

### 升级：2019+ 历史数据全面回填 + 回测精度

- **FRED 宏观**：`fred-history-fetcher.js` 自动拉取 DFF/VIX/10Y实际利率/M2/广义美元指数 → `data/history/`
- **期货 OI**：修正东方财富主连 secid（`113.CUM` 等），74 品种 2019+ 持仓量写入 K 线 `openInterest`
- **国际指数**：`fetch-all-history-data.js` 拉取 SP500/道指/纳指/日经/恒指/FTSE/DAX/上证等日 K
- **回测/哲学层**：walk-forward 使用 date T 真实 DFF/VIX/M2/DXY + 历史 OI delta
- **文档**：`docs/HISTORY_DATA_GUIDE.md`（自动 vs 需用户提供）
- 一键命令：`npm run fetch-all-history`

---
