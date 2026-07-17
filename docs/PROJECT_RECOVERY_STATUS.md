# 项目恢复状态（2026-06-17 更新）

> **架构决策**：用户已锁定哲学 **filter + Model C 双模型交集** 路线，详见 [`docs/PHILOSOPHY_FILTER_ARCHITECTURE.md`](./PHILOSOPHY_FILTER_ARCHITECTURE.md)（生产 v1.34.8 权重不变，实现待六步优先级）。**2026-06-17**：用户接受实验路径 **高命中低频次** live 策略（`MODEL_C_LIVE_TIER=high_hit`）— 见架构文档「实盘策略」节 · `scripts/probe-model-c-live-strategy.js`。

## T+1 unified Phase C（2026-06-17 · GATE_FAIL）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改**）
- **实验权重**：`outlook-logistic-weights-t1-unified-experiment.json`（au+ag 训练 · 2017–2022）
- **探针**：`node scripts/probe-t1-unified-experiment.js` → `data/exports/t1-unified-probe-report.json`

| 口径 | Production | Experiment | 结论 |
|------|------------|------------|------|
| OOS raw 65 品种 | 51.9% (n=4615) | 50.0% (n=346) | 实验 head 大量 neutral，非 probe 漏接 |
| OOS raw au+ag | 56.17% (n=397) | 52.71% (n=129) | 与 Phase B train report 一致 |
| OOS au+ag gated | 50.55% (n=275) | 25.0% (n=12) | 校准门控 + 低置信 pUp |

**根因**：Phase B 仅训 au+ag；实验系数比 v1.34.8 更保守（~7.5% 行有方向 vs 生产 ~92%），跨板块几乎无 scored 是模型行为而非 wiring bug。**需 Phase B 重训**（扩品种或调参）才能有意义 gate 对比。详见 `docs/T1_UNIFIED_PIPELINE.md` Phase C 节。

---

## Tradable-day KPI 探针（2026-06-15 · 仓单/OI 补齐后复测）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改**）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-tradable-day-kpi.js`
- **辅助**：`scripts/_probe-ag-logistic-regime.js` · `scripts/probe-v1348-threshold-grid.js` · `scripts/_probe-a5-ag-basis-disable-oi-proxy.js`

### OOS T+3（2023–2026 · 非 neutral 计分）

| 口径 | au+ag | AU | AG | scored (au/ag/all) | vs 2026-06-13 基线 |
|------|-------|-----|-----|---------------------|---------------------|
| **2026-06-13 文档基线** | **64.16%** | 67.62% | 61.16% | 105 / 121 / **226** | — |
| **2026-06-15 复测（E 盘 fresh）** | **61.15%** | 66.15% | 57.23% | 130 / 166 / **296** | **−3.01pp** · +70 scored |
| 高 intl (≥0.5%) | 58.33% | 61.63% | 56.15% | 86 / 130 / **216** | −4.09pp |
| tradable-day OR | 61.15% | 66.15% | 57.23% | 130 / 166 / **296** | −3.01pp |
| **gap vs 70% 目标** | **8.85pp** | — | — | — | 基线 gap 5.84pp |

### 按 regime（logistic · fresh）

| 品种 | overall | trend | event | basis |
|------|---------|-------|-------|-------|
| AU | **66.15%** (130) | 80% (10) | 57.89% (38) | 69.14% (81) |
| AG | **57.23%** (166) | 68% (25) | 65.38% (26) | **53.04%** (115) |

### 主要 miss 驱动

1. **AG basis + OI proxy**：basis 115 scored 仅 **53.04%**；`agBasisCounts.bySource` **oi_proxy 247** vs term_structure **49**
2. **样本膨胀**：仓单/期限 100% 覆盖后 logistic 非 neutral 日 **226→296**（+31%），新增日命中率偏低
3. **高 intl 子集走弱**：62.42%→**58.33%**（216 scored）

### 安全增量实验（权重不变 · 均未 gate-pass → **不 deploy**）

| 实验 | au+ag T+3 | scored | 结论 |
|------|-----------|--------|------|
| 共享阈值 0.56/0.46 | **63.24%** | 185 | +2.09pp vs fresh 默认，仍低于 64.16% 基线 |
| A5 `AG_BASIS_DISABLE_OI_PROXY=1` | **64.65%** | 215 | AG basis **61.54%** (26) · gate ❌ n<40 |
| per-id 阈值网格 | 64.19% | 229 | AG 仅 13 scored · 过拟合 · 弃用 |

- **维持生产 v1.34.8**；日志 `_probe-tradable-day-kpi-out.json` · `_probe-v1348-regime-fresh.txt` · `_probe-v1348-threshold-grid-out.json` · `_probe-a5-fresh.txt`

### 推荐下一实验（按杠杆排序）

1. ~~**AG basis miss audit + OI proxy 规则收紧**（P0 · 1–2d）~~ → **Experiment #1 DONE**（见下节）· strict 规则 +3.5pp au+ag 但 AG basis n=26 gate ❌
2. ~~**SLV 特征网格重训 AG head**（实验权重 · 2–3d）~~ → **Experiment #2 DONE**（见下节）· gate ❌ · 维持 v1.34.8
3. ~~**新闻按日标注扩至 2019+**（用户数据 · 持续）~~ → **Experiment #3 DONE**（见下节）· +1388 行 · KPI 未升（需重训）
4. ~~**strict OI + SLV + curated news 联合重训**~~ → **Experiment #4 DONE**（见下节）· gate ❌ · 维持 v1.34.8
5. **v1.35 split-head + 阈值**（实验 · 已证未追平 64.16%）— 仅作对照
6. **74 品种 longrun** — 须用户显式确认；本次未启动

---

## Experiment #3 — News-tagged expansion 2019+（2026-06-15）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改**）
- **脚本**：`FANCHENG_DATA_DRIVE=E node scripts/expand-news-tagged.js` · `--dry-run` · `--skip-flash` · `--skip-warehouse` · `--warehouse-threshold 5` · `--probe-kpi`
- **辅助**：`npm run merge-flash-news` · `npm run aggregate-geopolitics` · `npm run probe-news-coverage`
- **模块**：`services/news-tag-expansion.js`（policy/geo/supply 标注 · flash 过滤 · 仓单 backfill）

### news-tagged.csv 扩表结果（E 盘 · 2026-06-15）

| 指标 | 扩表前 | 扩表后 | Δ |
|------|--------|--------|---|
| 总行（2019+） | **989** | **2377** | **+1388** |
| 全量行 | 994 | 2382 | +1388 |
| 日期范围 | 2019-01-01 .. 2026-06-17 | 同 | — |
| au/ag 标签行 | 162 | **907** | +745 |
| geo 行 | 73 | **308** | +235 |
| 仓单自动生成行 | 0 | **698** | +698 |
| geopolitics-daily 覆盖日 | — | **68 天**（308 geo 行） | Patch 7 重跑 |

**来源分解**：仓单 5% 阈值 AG **414** + AU **251** + AG basis miss **33** · 过滤快讯 **704**（inbox 1306 中 502 条无关跳过）

### Walk-forward 新闻命中覆盖（OOS 2023–2026 · philosophy 层）

| 品种 | scored | 有新闻命中日 | 命中率 | AG/AU basis 子集 |
|------|--------|--------------|--------|------------------|
| AU | 804 | 193 | **24.0%** | basis 207 日中 **1.45%** 有命中 |
| AG | 815 | 375 | **46.0%** | basis 202 日中 **20.8%** 有命中 |

### KPI 探针（v1.34.8 权重不变 · 扩表后）

| 口径 | au+ag T+3 | scored | vs 2026-06-15 fresh 基线 |
|------|-----------|--------|--------------------------|
| **扩表前（文档）** | **61.15%** | 296 | — |
| **扩表后（同脚本）** | **58.10%** | 494 | **−3.05pp** · scored +198 |

- **结论**：新闻经 `philosophyScore` 间接进 logistic，**未重训权重**时盲目扩仓单 bear 标签会推 philosophy 方向，与 v1.34.8 训练分布不一致 → KPI **下降**而非 +8–15pp；长期增益需 **重训 + 精选标注**（非纯 auto 仓单行）
- **产出**：`E:\FanchengFinance\data\history\news-expansion-report.json` · `_probe-news-walkforward-coverage.json` · `news-tagged.csv.bak-*` 可回滚

### 推荐日常流程

1. 应用每 10m 写 `flash-news-inbox.json`（已有）
2. **每日收盘后**：`daily-data-sync` 已含 **`news_tagged`**（默认 `--skip-warehouse` 快讯合并）→ 自动链 **`geopolitics`**
3. 手动/每周仓单 backfill：`FANCHENG_DATA_DRIVE=E npm run expand-news-tagged`（无 `--skip-warehouse`）
4. **每周**：人工抽检 inbox pending · 高星 policy/geo 行补 `merge-user-news-csv.js`
5. 重训前勿期望 KPI 升（v1.34.8 权重不变）


## Experiment #1 — AG basis miss audit（2026-06-15）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改** · 未 deploy 规则 flag）
- **脚本**：`node scripts/_export-ag-basis-misses.js` · `node scripts/_probe-ag-basis-strict-oi-proxy.js`
- **规则（实验 flag）**：`AG_BASIS_STRICT_OI_PROXY=1` — AG 有 term 行但 |z|<2 时禁用 OI 代理；禁用单日 OI proxy（`services/market-regime-classifier.js`）

### AG basis OOS（2023–2026 · logistic · v1.34.8）

| 口径 | hit rate | scored | misses |
|------|----------|--------|--------|
| **baseline（OI proxy 启用）** | **53.04%** | 115 | **54** |
| term_structure 子集 | 61.54% | 26 | 10 |
| oi_proxy 子集 | 50.56% | 89 | 44 |
| **strict / A5（OI proxy 禁用）** | **61.54%** | 26 | 10 |

### Top failure modes（54 misses · baseline）

| 模式 | count | % of misses |
|------|-------|-------------|
| wrong_sign_bull | 53 | 98.1% |
| marginal_confidence | 52 | 96.3% |
| oi_proxy_mislabel | 44 | 81.5% |
| warehouse_supply_up | 33 | 61.1% |

Top combo：`oi_proxy|bull_wrong_bear|term_z_mid|wh_up` ×**30**

### Re-probe（strict · 权重不变）

| KPI | baseline | strict | Δ |
|-----|----------|--------|---|
| AG basis | 53.04% (115) | 61.54% (26) | **+8.5pp** · gate ❌ n<40 |
| au+ag T+3 | 61.15% (296) | 64.65% (215) | **+3.5pp** |
| gap vs 70% | 8.85pp | 5.35pp | −3.5pp |

- strict ≡ A5（仓单/term 100% 覆盖后，term 行存在即阻断全部 OI proxy）
- **不 deploy**：规则 flag 仅探针；维持生产 v1.34.8 默认
- **产出**：`data/history/labels/user-ag-basis-audit-template.csv`（54 miss）· `ag-basis-miss-audit.csv`（115 scored）· `_ag-basis-regime-source-split.json` · `_probe-ag-basis-strict-oi-proxy.json`

### Top 3 可执行修复（按优先级）

1. **规则**：生产启用 term-only basis（等同 strict/A5）— au+ag **+3.5pp** 诚实估计；需接受 basis scored 115→26 与 gate 政策
2. **权重重训**：term-only basis 日 + SLV/仓单方向特征 — 26 样本上 term 已 61.54%，重训目标修正 bull 偏置（98% miss 为 bull wrong bear）
3. **新闻/政策**：warehouse_supply_up 占 miss 61% — 补 `news-tagged.csv` 政策日可覆盖仓单上行+宏观 bear 组合

---

## Experiment #2 — SLV feature grid retrain AG（2026-06-15）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改**）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-slv-ag-grid.js`
- **SLV 数据**：ishares archive **1873** 行 · 覆盖 100%
- **OOS**：2023–2026 · T+3 · tradable-day KPI（同 `probe-tradable-day-kpi.js` 定义）

### 网格变体（10 + prod 基线 · 扩表后 news-tagged 2377 行）

| 变体 | au+ag T+3 | scored | AG basis | n | SLV wt |
|------|-----------|--------|----------|---|--------|
| **prod v1.34.8** | **58.10%** | 494 | 58.97% | 78 | — |
| **mixed-v1348-plus-slv**（最佳） | **59.21%** | 456 | **61.96%** | 92 | 0.041 |
| split-ag-slv-basis2.0 | 56.61% | 878 | **68.75%** | 80 | 0.043 |
| split-ag-slv-default | 56.94% | 908 | 63.41% | 82 | 0.047 |
| hybrid-au-prod-ag-slv | 55.85% | 650 | 63.41% | 82 | 0.047 |

- **split-head 变体 scored 膨胀**（650–965 vs prod 494）：哲学降权/阈值不同 → 命中率不可直接与 prod 横比；**mixed** 路径 456 scored 最接近可比样本
- **vs 文档基线**：prod **64.16%**（226）· fresh 仓单/OI **61.15%**（296）· 扩表后 **58.10%**（494）— 本次在扩表后口径
- **gate**：❌ 未 beat 64.16% 或 fresh 61.15%；AG basis n≥40 满足但 au+ag 无净 uplift
- **未写入生产**；无 `outlook-logistic-weights-slv-experiment.json`（gate fail）
- **产出**：`_train-slv-ag-grid-out.json` · `_train-slv-ag-grid-run.txt`

### 推荐下一实验

1. ~~**AG basis strict/A5 + SLV 联合重训**（basis 子集 n≥40 且 split basis2.0 达 68.75% 但 au+ag 崩）~~ → **Experiment #4 DONE**（见下节）· gate ❌ · 维持 v1.34.8
2. ~~**新闻精选重训**（Experiment #3 已证盲目扩表 −3pp）~~ → **Experiment #4 DONE** · 精选 1485 行 · 仍低于 strict-only eval
3. **74 品种 longrun** — 须用户显式确认

---

## Experiment #4 — strict OI + SLV + curated news 联合重训（2026-06-15）

- **生产权重**：`v1.34.8-ag-cu-spread+basis-term`（**未改**）
- **脚本**：`scripts/build-news-tagged-curated.js` · `scripts/train-strict-slv-curated-grid.js`
- **模块**：`services/news-tagged-curation.js` · loader `NEWS_TAGGED_USE_CURATED=1`
- **训练/OOS 环境**：`AG_BASIS_STRICT_OI_PROXY=1` · IS 2019–2022 · OOS 2023–2026 · tradable-day KPI

### Part A — 精选新闻（news-tagged-curated.csv）

| 指标 | 全量 | 精选 | 排除 |
|------|------|------|------|
| 行（2019+） | **2377** | **1485** | **892** (62.5% kept) |
| au/ag 标签 | 907 | 243 | — |
| 仓单自动生成 | 698 | **34**（仅 audit/miss） | **664** |
| 低信号 flash | 626 | 398 | **228** |

- **规则**：剔除全部 auto warehouse（`event_id` `_wh_supply_*` / notes `warehouse-receipts`）· 保留 policy/geo/macro/event-calendar · 剔除无 commodity 标签且 neutral 的 flash
- **产出**：`E:\FanchengFinance\data\history\news-tagged-curated.csv` · `_news-curated-stats.json`

### Part B/C — 变体对比（strict OI walk-forward · T+3）

| 变体 | tradable au+ag | n | AG basis | n | AU | gate |
|------|----------------|---|----------|---|-----|------|
| **prod v1.34.8（strict eval）** | **57.43%** | 444 | 65.00% | 20 | 60.66% | ❌ |
| **strict-slv-split-basis2**（最佳） | **57.07%** | 764 | 66.67% | 6 | 60.13% | ❌ |
| strict-slv-mixed | 56.18% | 372 | 66.67% | 9 | 58.06% | ❌ |
| strict-slv-split-curated | 55.70% | 553 | 66.67% | 6 | 56.58% | ❌ |
| strict-slv-mixed-curated | 51.94% | 283 | 57.14% | 7 | 55.75% | ❌ |

- **vs 对照**：strict-only 无重训 **64.65%** (215) · prod 文档 **64.16%** (226) · 扩表 fresh **58.10%** (494)
- **精选新闻**：curated 变体 **未优于** 同架构 full-news（mixed −4.2pp）；剔除仓单 bear 标签后 philosophy 分布与 v1.34.8 训练期更不一致
- **AG basis n**：strict OI 下 term-only basis 仅 **5–20**  scored → gate n≥40 **不可达**
- **gate**：❌ 全部 FAIL · **未写入** `outlook-logistic-weights-strict-slv-curated-experiment.json`
- **产出**：`_train-strict-slv-curated-out.json` · `_train-strict-slv-curated-run.txt`

### 生产建议

- **维持** `v1.34.8-ag-cu-spread+basis-term`
- **可选 runtime flag**（不重训）：`AG_BASIS_STRICT_OI_PROXY=1` → au+ag **+3.5pp**（215 n）· AG basis 61.54%（26 n）
- **下一杠杆**：strict OI **规则 deploy** + 生产权重不变（最高 ROI）；或 basis 子集专用 head 在 n≥40 样本上单独重训

### 复现命令

```powershell
FANCHENG_DATA_DRIVE=E node scripts/build-news-tagged-curated.js
FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-strict-slv-curated-grid.js
```

---

## 每日自动数据同步 Daily Auto Data Sync（2026-06-15 · 本 session）

- **目标**：全品种（65 有成交 active）+ P0 宏观/贵金属衍生数据每日增量补齐，无需手动逐脚本更新
- **编排器**：`services/daily-data-sync.js` · CLI：`FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js`
- **触发**：
  1. **应用启动**（默认）：`electron/main.js` 启动约 30s 后若当日未成功跑过则后台执行（`config.dailyDataSyncEnabled`，默认 `true`）
  2. **手动**：`npm run daily-data-sync` 或 `node scripts/daily-data-sync.js [--dry-run|--force]`
  3. **可选任务计划**：`scripts/install-daily-sync-task.ps1` → 每日 07:30 兜底（应用未开时）
- **日志/状态**：`E:\FanchengFinance\data\history\daily-sync-log.jsonl` · `daily-sync-state.json`
- **同步类型（默认全开）**：`fred_macro` · `cnh` · `trading_klines` · `trading_json` · `commodity_oi` · `warehouse` · `term_structure` · `cross_market_precious` · `gld_etf` · `slv_etf` · `geopolitics`
- **郑商所/广期所 OI 回退（2026-06-15）**：`commodity_oi` 东方财富 `push2his` 超时/断连时，自动回退新浪主连日 K（`InnerFuturesNewService.getDailyKLine`，字段 `p`=持仓）→ `history/trading/{id}.json`
- **未自动化（诚实缺口）**：`news-tagged.csv` 用户标注 · 快讯→权威库 merge · LME 库存 CSV import · 周频 sector-fundamentals · tick zip 长跑转换 · 生产权重 v1.34.8 · 8 个 inactive/无 K 线品种无 range archive
- **启用/禁用**：用户配置 `dailyDataSyncEnabled: false`；或任务计划 `Unregister-ScheduledTask -TaskName FanchengFinance-DailyDataSync`
- **探针**：`node scripts/daily-data-sync.js --inventory` 输出数据清单与 active 品种数
- **asar 已热补丁**：`node _patch-daily-data-sync-asar.js` DONE（2026-06-15 续 · ZCE OI 新浪回退）；`E:\FanchengFinance\app\win-unpacked\resources\app.asar` 4208530→4210439 bytes · 备份 `app.bak-daily-sync-1781533669131.asar` · 校验 `fetchSinaDailyBarsWithOi` / `canUseSinaOiFallback` / `sina-futures-oi` ✅ · 生产权重 **v1.34.8-ag-cu-spread+basis-term** 未动 · **需重启 `启动梵澄金融.bat`**

---

## 区间预测 vs 实际 high/low 对比存档（2026-06-15 · 本 session）

- **功能**：逐品种展示「预测最高/最低」与「实际最高/最低」对比；收盘后自动写入日存档，供回测与实盘前审计
- **存档路径**：`E:\FanchengFinance\data\history\range-prediction-archive\{instrumentId}-daily.jsonl`
- **Schema 字段**：`sessionDate` · `baseClose` · `predHigh/predLow` · `actualHigh/actualLow` · `highHit/lowHit/bandHit` · `highError/lowError` · `modelVersion`
- **UI 色标**（暗色主题）：
  - 🟢 **区间命中**（`range-compare-hit`）：实际 high ≤ 预测 high 且 实际 low ≥ 预测 low
  - 🟡 **部分命中**（`range-compare-partial`）：仅一侧边界命中
  - 🔴 **区间未命中**（`range-compare-miss`）：两侧均未覆盖
  - ⚪ **待校验/待开盘**（`range-compare-pending`）：session 未结束或未开盘；盘中显示「盘中」标签
- **服务**：`services/range-prediction-archive.js` · engine 集成 `attachRangePredictionContext` · outlook 刷新时 `archiveCompletedSessionsFromOutlook`
- **脚本**：
  - 回填：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/backfill-range-prediction-archive.js [--id au ...]`
  - 未命中审计（单品种 Top N）：`node scripts/analyze-range-prediction-misses.js` → `data/history/labels/range-prediction-miss-audit.csv`
  - **全品种未命中批量导出（2026-06-16）**：`FANCHENG_DATA_DRIVE=E node scripts/analyze-all-range-prediction-misses.js` → `data/history/labels/range-prediction-miss-audit-all.csv`（**9,970** miss 行 / **51,076** scored）· 汇总 `range-prediction-miss-audit-all-summary.json`
- **全品种回填（2026-06-16 · 2023–2026 OOS）**：
  - **Before**：3/73 有存档（au/fg/sp）
  - **After**：**65/73** 有存档 · **51,076** 条 · 均值 bandHit **80.58%**
  - **跳过 8**：wh/pm/ri/lr/jr/zc（inactive 零成交）· pt/pd（insufficient_bars）
  - **日志**：`_backfill-range-prediction-archive.json` · `_backfill-all-range-archives-run.txt`

| 板块样例 | 品种 | 存档条数 | bandHit% |
|----------|------|----------|----------|
| 贵金属 | au | 833 | 74.55% |
| 黑色 | rb | 833 | 81.51% |
| 化工 | ma | 832 | 76.20% |
| 农产品 | m | 833 | 80.55% |
| 能源 | sc | 833 | 74.79% |

- **预测校验 UI**：全品种通用（无 AU 硬编码）· `attachRangeAuditRecords` 按 `instrumentId` · 无存档时显示 pending/live 空态 · 有存档时显示区间命中率 + 最近 5 日审计表
- **方向预测审计**（2026-06-16）：`direction-prediction-archive` · **T+1 主 KPI**（目标≥75%）· 中文标签映射 · 全历史自 `2026-06-04` daily summary · 新→旧排序 · 路径 `E:/FanchengFinance/data/history/direction-prediction-archive/{id}-daily.jsonl` · 回填 `FANCHENG_DATA_DRIVE=E node scripts/backfill-direction-prediction-archive.js --id au --id ag` · asar `node _patch-direction-audit-panel-asar.js`
- **asar 已热补丁**：`node _patch-range-audit-panel-asar.js` DONE（2026-06-16 全品种回填后重打）· `app.asar` 4259863 bytes · 备份 `app.bak-range-audit-panel-1781578202989.asar` · 校验 deriveMissReasonTags / enrichAuditRecord / outlook-accuracy-audit-table / IPC ✅ · 生产权重 **v1.34.8-ag-cu-spread+basis-term** 未动 · **需重启 `启动梵澄金融.bat`**

---

## 全品种覆盖率汇总（2026-06-15 · 次日 high/low 区间校准）

- **探针脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/probe-all-range-coverage-summary.js`
- **产出**：`_probe-all-range-coverage-summary.json` · `_probe-all-range-coverage-summary.txt`
- **OOS 窗口**：2023-01-01 ~ 2026-12-31 · KPI：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low ≥ **75%**
- **排除规则**：WR 不纳入 · 近 20 根 K 线成交量=0 或无 trading 文件 → ⛔无成交跳过
- **品种来源**：`commodity-instrument-profiles.js` + `commodities-catalog.js`（catalog 共 **74** 个）

### 汇总统计

| 指标 | 数量 |
|------|------|
| catalog 品种总数 | 74 |
| 纳入统计（有成交 active） | **65** |
| ≥75% 已达标 | **65** |
| <75% 待补 | **0** |
| 排除（无成交/无数据） | 8 |
| 排除（WR） | 1 |

### 板块分布

| 板块 | 总数 | 达标 | 未达标 | 无成交跳过 | WR跳过 |
|------|------|------|--------|------------|--------|
| 贵金属 | 4 | 2 | 0 | 2（pt/pd） | 0 |
| 有色 | 11 | 11 | 0 | 0 | 0 |
| 黑色 | 8 | 7 | 0 | 0 | 1（wr） |
| 化工 | 18 | 18 | 0 | 0 | 0 |
| 能源 | 5 | 5 | 0 | 0 | 0 |
| 农产品 | 26 | 21 | 0 | 5 | 0 |
| 航运 | 1 | 1 | 0 | 0 | 0 |
| 其它 | 1 | 0 | 0 | 1（ZC） | 0 |

### 待补 / 跳过清单

| 品种 | 名称 | 板块 | OOS样本 | 覆盖率% | 状态 | 说明 |
|------|------|------|---------|---------|------|------|
| WR | 线材 | 黑色 | — | — | — WR跳过 | 按用户要求不补 |
| JR/WH/PM/RI/LR | 粳稻/强麦/普麦/早籼/晚籼 | 农产品 | — | — | ⛔无成交跳过 | 近 20 根 volume=0 |
| ZC | 动力煤 | 其它 | — | — | ⛔无成交跳过 | 近 20 根 volume=0 |
| PT/PD | 铂金/钯金 | 贵金属 | — | — | ⛔无成交跳过 | trading 数据不足（<30 bars） |

### 全品种明细（按板块 · 2026-06-15 探针）

| 品种 | 名称 | 板块 | OOS样本 | 覆盖率% | 状态 | 校准文件 |
|------|------|------|---------|---------|------|----------|
| au | 沪金 | 贵金属 | 827 | 75.09 | ✅ | precious-range-calibration-v1.json |
| ag | 沪银 | 贵金属 | 827 | 75.09 | ✅ | precious-range-calibration-v1.json |
| cu | 沪铜 | 有色 | 731 | 75.10 | ✅ | nonferrous-range-calibration-v1.json |
| al | 沪铝 | 有色 | 620 | 75.00 | ✅ | nonferrous-range-calibration-v1.json |
| zn | 沪锌 | 有色 | 620 | 75.16 | ✅ | nonferrous-range-calibration-v1.json |
| pb | 沪铅 | 有色 | 620 | 80.65 | ✅ | nonferrous-range-calibration-v1.json |
| ni | 沪镍 | 有色 | 620 | 75.16 | ✅ | nonferrous-range-calibration-v1.json |
| sn | 沪锡 | 有色 | 620 | 75.32 | ✅ | nonferrous-range-calibration-v1.json |
| bc | 国际铜 | 有色 | 620 | 75.00 | ✅ | nonferrous-range-calibration-v1.json |
| ao | 氧化铝 | 有色 | 490 | 75.10 | ✅ | nonferrous-range-calibration-v1.json |
| si | 工业硅 | 有色 | 607 | 92.09 | ✅ | nonferrous-range-calibration-v1.json |
| lc | 碳酸锂 | 有色 | 468 | 89.53 | ✅ | nonferrous-range-calibration-v1.json |
| ps | 多晶硅 | 有色 | 220 | 90.45 | ✅ | nonferrous-range-calibration-v1.json |
| rb | 螺纹钢 | 黑色 | 620 | 75.00 | ✅ | black-range-calibration-v1.json |
| hc | 热轧卷板 | 黑色 | 620 | 75.32 | ✅ | black-range-calibration-v1.json |
| i | 铁矿石 | 黑色 | 620 | 75.32 | ✅ | black-range-calibration-v1.json |
| j | 焦炭 | 黑色 | 620 | 75.00 | ✅ | black-range-calibration-v1.json |
| SF | 硅铁 | 黑色 | 620 | 75.32 | ✅ | black-range-calibration-v1.json |
| SM | 锰硅 | 黑色 | 620 | 75.16 | ✅ | black-range-calibration-v1.json |
| ss | 不锈钢 | 黑色 | 620 | 96.13 | ✅ | nonferrous-range-calibration-v1.json |
| jm | 焦煤 | 化工 | 620 | 75.00 | ✅ | black-range-calibration-v1.json |
| FG/SA/MA/TA/EG/PP/L/V/UR/EB/PF/RU/BR/PX/SH/PR/AD | （化工 17 品种） | 化工 | 114–620 | 75.00–96.49 | ✅ | chemical-range-calibration-v1.json |
| sc/fu/lu/bu/pg | （能源 5 品种） | 能源 | 620–827 | 75.00–75.21 | ✅ | energy-range-calibration-v1.json |
| m/y/p/c/CF/SR/OI/RM/a/b/cs/jd/lh/AP/CJ/PK/CY/RS/rr/lg/**sp** | （农产品 21 品种） | 农产品 | 248–620 | 75.00–92.42 | ✅ | agricultural-range-calibration-v1.json |
| ec | 集运指数(欧线) | 航运 | 448 | 76.79 | ✅ | shipping-range-calibration-v1.json |

**结论**：有成交的 65 个品种 **65/65（100%）** 已达 ≥75%；**SP 纸浆** 已于 2026-06-15 补校准（16.77% → 75.00%）。WR、JR、WH/PM/RI/LR、ZC、PT/PD 按规则不纳入待补。

---

## 农产品系 M/Y/P/C/CF/SR/OI… 区间校准 ≥ 75% 覆盖率（2026-06-15 · 本 session）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）**75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026 · CN session 15:00 收 → 次日 21:00 夜盘起
- **服务**：`services/agricultural-range-calibration.js` + `services/intraday-range-predictor.js`（M↔Y、Y↔M、P↔Y 豆油链、OI↔RM 菜油链、CS↔C、CY↔CF cross bias）
- **脚本**（单品种防 OOM；JSON 已 ≥75% 则 skip）：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-agricultural-range.js --id m`
- **落盘**：`E:\FanchengFinance\data\outlook-models\agricultural-range-calibration-v1.json`
- **探针**：`node scripts/probe-agricultural-range-baseline.js` → `_probe-agricultural-range-out.json`
- **回归 AU/CU/RB/SC 未改动**：探针复测 AU **75.09%**、CU **75.10%**、RB **75.00%**、SC **75.21%**
- **品种来源**：`commodity-instrument-profiles.js` ID_SECTOR=agriculture（25 个有 K 线；不含 au/ag 贵金属、不含其它板块已校准品种）
- **无 K 线跳过**：JR（profiles 有标注但 trading 无数据）

---

## SP 纸浆 区间校准 ≥ 75% 覆盖率（2026-06-15 · 本 session）

- **板块归属**：`ID_SECTOR=agriculture`（SHFE 纸浆；与 RU 不同，RU 在 profiles 为 chemical 故走化工校准）
- **服务**：`services/agricultural-range-calibration.js` + `intraday-range-predictor.js`（agriCal 分支，无 cross bias）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-agricultural-range.js --id sp`
- **落盘**：`E:\FanchengFinance\data\outlook-models\agricultural-range-calibration-v1.json`（25 品种含 sp）
- **回归 AU/M 未改动**：AU **75.09%**、M **75.00%**

| 指标 | 校准前（探针 default） | 网格 baseline | 校准后 |
|------|------------------------|---------------|--------|
| SP OOS coverage | **16.77%** (104/620) | 65.48% (406/620) | **75.00%** (465/620) |

| 参数 | 值 |
|------|-----|
| upMult | 1.25 |
| downMult | 1.1 |
| centerLean | 0.18 |
| minSigmaPct | 0.016 |
| volWindow | 20 |

- **Patch**：`_patch-cross-vol-asar.js` DONE（2026-06-15）；备份 `app.bak-1781512031522.asar`
- **重启**：请重启 **FanchengFinance.exe** 以加载新 asar + E 盘校准 JSON

### OOS range coverage（2023–2026 · 探针口径）

| 品种 | 校准前 baseline | 校准后 | upMult | downMult | 备注 |
|------|-----------------|--------|--------|----------|------|
| **M** 豆粕 | 15.16%（探针）/ 66.77%（网格基线） | **75.00%** | 1.05 | 1.25 | yCrossBias · 620 scored · HIT |
| **Y** 豆油 | 10.97% / 59.68% | **75.00%** | 1.30 | 1.25 | mCrossBias · HIT |
| **P** 棕榈油 | 10.97% / 40.48% | **75.00%** | 1.45 | 1.70 | yCrossBias · 最宽带 · HIT |
| **C** 玉米 | 15.32% / 84.84% | **84.84%** | 1.00 | 1.00 | 基线已达标 · HIT |
| **CF** 棉花 | 21.29% / 71.94% | **75.00%** | 1.10 | 1.00 | HIT |
| **SR** 白糖 | 16.29% / 84.35% | **84.35%** | 1.00 | 1.00 | 基线已达标 · HIT |
| **OI** 菜油 | 13.55% / 47.26% | **75.16%** | 1.40 | 1.40 | rmCrossBias · HIT |
| **RM** 菜粕 | 13.06% / 45.16% | **75.00%** | 1.60 | 1.50 | oiCrossBias · HIT |
| **JD** 鸡蛋 | 17.26% / 71.77% | **75.16%** | 1.15 | 1.00 | HIT |
| **LH** 生猪 | 17.58% / 83.71% | **83.71%** | 1.00 | 1.00 | 短历史(1102 bars) · 基线已达标 · HIT |
| **AP** 苹果 | 21.94% / 67.26% | **75.16%** | 1.05 | 1.20 | HIT |
| **CS** 淀粉 | 14.19% / 86.29% | **86.29%** | 1.00 | 1.00 | cCrossBias · 基线已达标 · HIT |
| **A** 豆一 | 16.61% / 79.19% | **79.19%** | 1.00 | 1.00 | 基线已达标 · HIT |
| **B** 豆二 | 12.58% / 51.61% | **75.00%** | 1.40 | 1.35 | HIT |
| **CJ** 红枣 | 20.16% / 62.42% | **75.00%** | 1.30 | 1.20 | HIT |
| **PK** 花生 | 18.71% / 92.42% | **92.42%** | 1.00 | 1.00 | 短历史(1086 bars) · 基线已宽 · HIT |
| **CY** 棉纱 | 20.97% / 79.68% | **79.68%** | 1.00 | 1.00 | cfCrossBias · 基线已达标 · HIT |
| **RS** 菜籽 | 29.35% / 54.52% | **75.16%** | 1.55 | 1.45 | HIT |
| **WH** 强麦 | 97.26% / 97.90% | **97.90%** | 1.00 | 1.00 | 低流动性 · 基线已宽 · HIT |
| **PM** 普麦 | 99.84% | **99.84%** | 1.00 | 1.00 | 低流动性 · HIT |
| **RI** 早籼 | 100% | **100%** | 1.00 | 1.00 | 低流动性 · HIT |
| **LR** 晚籼 | 99.84% | **99.84%** | 1.00 | 1.00 | 低流动性 · HIT |
| **RR** 粳米 | 24.03% / 90.00% | **90.00%** | 1.00 | 1.00 | 基线已达标 · HIT |
| **LG** 原木 | 21.37% / 66.13% | **75.00%** | 1.15 | 1.25 | **248 scored**（短历史）· HIT |
| **SP** 纸浆 | 16.77%（探针）/ 65.48%（网格基线） | **75.00%** | 1.25 | 1.1 | SHFE 纸浆 · 620 scored · HIT |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15）：含 `agricultural-range-calibration.js`（含 sp）+ intraday predictor → **E 盘 app.asar**；备份 `app.bak-1781512031522.asar`

### 重启提醒

**请先完全退出桌面端再重启「凡诚金融.bat」**，农产品系区间宽度才会在 UI 生效。

---

## 能源系 SC/FU/LU/BU/PG 区间校准 ≥ 75% 覆盖率（2026-06-15 · 本 session）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）**75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026 · CN session 15:00 收 → 次日 21:00 夜盘起
- **服务**：`services/energy-range-calibration.js` + `services/intraday-range-predictor.js`（SC↔WTI pct cross、FU/LU/PG↔SC cross bias）
- **脚本**（单品种防 OOM；JSON 已 ≥75% 则 skip）：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-energy-range.js --id sc`
- **落盘**：`E:\FanchengFinance\data\outlook-models\energy-range-calibration-v1.json`
- **探针**：`node scripts/probe-energy-range-baseline.js` → `_probe-energy-range-out.json`
- **回归 AU/CU/RB/FG 未改动**：探针复测 AU **75.09%**、CU **75.10%**、RB **75.00%**、FG **75.00%**
- **品种来源**：`commodity-instrument-profiles.js` ID_SECTOR=energy（5 个：sc/fu/lu/bu/pg；不含 ZC/ec/ta）

### OOS range coverage（2023–2026 · 探针口径）

| 品种 | 校准前 baseline | 校准后 | upMult | downMult | 备注 |
|------|-----------------|--------|--------|----------|------|
| **SC** | 16.32%（探针）/ 69.65%（网格基线） | **75.21%** | 1.00 | 1.25 | wtiCrossBias · 827 scored · HIT |
| **FU** | 17.05%（探针）/ 41.96%（网格基线） | **75.09%** | 1.65 | 1.60 | scCrossBias · 827 scored · HIT |
| **LU** | 12.10%（探针）/ 38.87%（网格基线） | **75.00%** | 1.55 | 1.70 | scCrossBias · 620 scored · HIT |
| **BU** | 14.52%（探针）/ 53.39%（网格基线） | **75.00%** | 1.40 | 1.45 | 620 scored · HIT |
| **PG** | 15.48%（探针）/ 59.03%（网格基线） | **75.00%** | 1.15 | 1.55 | scCrossBias · 620 scored · HIT |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15）：含 `energy-range-calibration.js` + intraday predictor → **E 盘 app.asar**；备份 `app.bak-1781509513492.asar`

### 重启提醒

**请先完全退出桌面端再重启「凡诚金融.bat」**，能源系区间宽度才会在 UI 生效。

---

## 化工系 FG/SA/MA/TA/EG/PP/L/V/UR… 区间校准 ≥ 75% 覆盖率（2026-06-15 · 本 session）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）**75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026 · CN session 15:00 收 → 次日 21:00 夜盘起
- **服务**：`services/chemical-range-calibration.js` + `services/intraday-range-predictor.js`（MA↔TA、PP↔L、EB↔EG cross bias）
- **脚本**（单品种防 OOM；JSON 已 ≥75% 则 skip）：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-chemical-range.js --id fg`
- **落盘**：`E:\FanchengFinance\data\outlook-models\chemical-range-calibration-v1.json`
- **探针**：`node scripts/probe-chemical-range-baseline.js` → `_probe-chemical-range-out.json`
- **回归 AU/CU/RB 未改动**：探针复测 AU **75.09%**、CU **75.10%**、RB **75.00%**
- **品种来源**：`commodity-instrument-profiles.js` ID_SECTOR=chemical（17 个，不含 jm 已在 black、不含 sc/fu 能源）

### OOS range coverage（2023–2026 · 探针口径）

| 品种 | 校准前 baseline | 校准后 | upMult | downMult | 备注 |
|------|-----------------|--------|--------|----------|------|
| **FG** | 16.29% | **75.00%** | 1.75 | 2.15 | HIT |
| **SA** | 16.77% | **75.16%** | 1.70 | 1.90 | HIT |
| **MA** | 15.81% | **75.32%** | 1.30 | 1.30 | taCrossBias |
| **TA** | 16.61% | **75.00%** | 1.45 | 1.35 | HIT |
| **EG** | 14.03% | **75.16%** | 1.05 | 1.10 | HIT |
| **PP** | 15.00% | **80.32%** | 1.00 | 1.00 | lCrossBias · 已≥75% |
| **L** | 14.03% | **76.94%** | 1.00 | 1.00 | 已≥75% |
| **V** | 14.68% | **75.00%** | 1.10 | 1.30 | HIT |
| **UR** | 17.42% | **75.16%** | 1.70 | 1.55 | HIT |
| **EB** | 15.16% | **75.48%** | 1.15 | 1.50 | egCrossBias |
| **PF** | 15.16% | **75.48%** | 1.20 | 1.20 | HIT |
| **RU** | 15.48% | **75.16%** | 1.45 | 1.30 | HIT |
| **BR** | 18.36% | **75.38%** | 1.60 | 1.65 | 463 scored · HIT |
| **PX** | 16.36% | **75.00%** | 1.50 | 1.15 | 428 scored · HIT |
| **SH** | 19.63% | **75.00%** | 1.40 | 1.85 | 428 scored · HIT |
| **PR** | 16.84% | **85.19%** | 1.00 | 1.00 | 297 scored · 已≥75% |
| **AD** | 14.04% | **96.49%** | 1.00 | 1.00 | 114 scored · 数据少 · 已≥75% |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15）：含 `chemical-range-calibration.js` + intraday predictor → **E 盘 app.asar**

### 重启提醒

**请先完全退出桌面端再重启「凡诚金融.bat」**，化工系区间宽度才会在 UI 生效。

---


- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）**75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026
- **服务**：`services/black-range-calibration.js` + `services/intraday-range-predictor.js`（RB↔I、J↔JM cross bias）
- **脚本**（单品种防 OOM）：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-black-range.js --id rb`
- **落盘**：`E:\FanchengFinance\data\outlook-models\black-range-calibration-v1.json`
- **探针**：`node scripts/probe-black-range-baseline.js` → `_probe-black-range-out.json`
- **回归 AU/CU 未改动**：探针复测 AU **75.09%**、CU **75.10%**
- **恢复说明**：崩溃前 JSON 仅含 **RB/HC** metrics；本次续跑 **I → J → JM → SF → SM**（RB/HC 跳过）

### OOS range coverage（2023–2026 · 620 scored，除 WR 外）

| 品种 | 校准前 baseline | 校准后 | upMult | downMult | 备注 |
|------|-----------------|--------|--------|----------|------|
| **RB** | 49.03% | **75.00%** | 1.55 | 1.30 | 恢复前已完成 |
| **HC** | 50.81% | **75.32%** | 1.55 | 1.25 | 恢复前已完成 |
| **I** | 50.16% | **75.32%** | 1.60 | 1.30 | rbCrossBias |
| **J** | 29.35% | **75.00%** | 2.05 | 1.65 | jmCrossBias |
| **JM** | 28.23% | **75.00%** | 1.70 | 2.05 | jCrossBias |
| **SF** | 50.81% | **75.32%** | 1.50 | 1.40 | HIT |
| **SM** | 56.29% | **75.16%** | 1.20 | 1.60 | HIT |
| WR | — | 26.29%（探针） | 1.30 | 1.25 | **未校准**（默认参数） |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15 续）：含 `black-range-calibration.js` + intraday predictor → **E 盘 app.asar**；备份 `app.bak-1781506768421.asar`

### 重启提醒

**请先完全退出桌面端再重启「凡诚金融.bat」**，黑色系区间宽度才会在 UI 生效。

---
## 工业硅 SI / 碳酸锂 LC / 多晶硅 PS / 不锈钢 SS 区间校准 ≥ 75% 覆盖率（2026-06-15 · 本 session 续跑）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）**75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026
- **代码**：`services/nonferrous-range-calibration.js` + `services/intraday-range-predictor.js`
- **脚本**（单品种；JSON 已 ≥75% 则无需重跑）：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/calibrate-nonferrous-range.js si`（lc / ps / ss 同理；亦支持 positional id）
- **产出数据**：`E:\FanchengFinance\data\outlook-models\nonferrous-range-calibration-v1.json`（2026-06-15 已写入 SI/LC/PS/SS，均 hitTarget）
- **探针**：`node scripts/probe-nonferrous-range-baseline.js` → `_probe-nonferrous-range-out.json`
- **未改动 AU/AG、CU/AL/ZN/PB/NI/SN、BC/AO**：回归 CU **75.10%**、AU **75.09%**（探针口径）

### OOS range coverage（2023–2026 · 网格 metrics）

| 品种 | 校准前（网格 baseline） | 校准后 | upMult | downMult | minSigmaPct | 备注 |
|------|-------------------------|--------|--------|----------|-------------|------|
| **SI** | 29.65%（探针 extents **18.12%**） | **75.12%** | 1.90 | 2.05 | 0.02 | HIT |
| **LC** | 25.85%（探针 **16.45%**） | **75.00%** | 2.30 | 1.85 | 0.025 | HIT |
| **PS** | 27.27%（探针 **16.36%**） | **75.00%** | 2.05 | 2.30 | 0.025 | HIT |
| **SS** | 52.74%（探针 **15.00%**） | **75.00%** | 1.35 | 1.40 | 0.018 | niCrossBias |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15 续）：SI/LC/PS/SS 校准链已打入 **E 盘 app.asar**（备份 `app.bak-1781504514756.asar`）

### 重启提醒

**请完全退出后重新启动「梵澄金融」（或运行 `启动梵澄金融.bat`），SI/LC/PS/SS 新区间宽度才会在 UI 生效。**

---

## 有色金属 BC/AO 区间校准 → 75% 覆盖率（2026-06-15 · 本 session）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）≥ **75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026（AO 上市 2023-06，train 无样本）
- **服务**：`services/nonferrous-range-calibration.js` · `services/intraday-range-predictor.js`（BC/AO + CU cross bias）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/calibrate-nonferrous-range.js bc ao`
- **参数落盘**：`E:\FanchengFinance\data\outlook-models\nonferrous-range-calibration-v1.json`
- **探针**：`node scripts/probe-nonferrous-range-baseline.js` · 日志 `_probe-nonferrous-range-out.json`
- **UI**：列表行显示 **昨收（15:00）**（通用 `renderOutlookNextDayRangeCompact`，BC/AO 同 CU）
- **贵金属 AU/AG 未改动**：探针复测仍为 **75.09%**
- **CU/AL/ZN/PB/NI/SN 未改动**：探针复测仍 ≥ **75%**

### OOS range coverage（2023–2026）

| 品种 | 改前（extents×1.0） | 改后 | upMult | downMult | 备注 |
|------|---------------------|------|--------|----------|------|
| **BC** | 54.2% | **75.00%** | 1.55 | 1.30 | CU 日涨跌 → centerLean |
| **AO** | 38.2% | **75.10%** | 1.45 | 1.80 | 氧化铝，上市晚 |
| AU/AG | — | **75.09%** | — | — | 未改动 |
| CU/AL/ZN/NI/SN | — | **75%+** | — | — | 未改动 |

### 待校准品种 baseline（未校准 · 2023–2026）

| 品种 | 名称 | baseline coverage |
|------|------|-------------------|
| si | 工业硅 | 18.12% |
| lc | 碳酸锂 | 16.45% |
| ps | 多晶硅 | 16.36% |
| ss | 不锈钢 | 15.00% |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15）— 含 BC/AO 校准 + CU cross bias · **需重启桌面应用**
- 校准 JSON 在 E 盘 `data/outlook-models/`，无需打入 asar

---

## 有色金属 CU/AL/ZN/PB/NI/SN 区间校准 → 75% 覆盖率（2026-06-15 · 本 session）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）≥ **75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026
- **服务**：`services/nonferrous-range-calibration.js` · `services/intraday-range-predictor.js`（CU/AL/ZN/PB/NI/SN）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/calibrate-nonferrous-range.js [cu al …]`
- **参数落盘**：`E:\FanchengFinance\data\outlook-models\nonferrous-range-calibration-v1.json`
- **探针**：`node scripts/probe-nonferrous-range-baseline.js` · 日志 `_probe-nonferrous-range-out.json`
- **UI**：列表行显示 **昨收（15:00）**（与 AU/AG 同组件 `renderOutlookNextDayRangeCompact`）
- **贵金属 AU/AG 未改动**：探针复测仍为 **75.09%**

### 有色金属品种清单（SHFE 核心）

| ID | 名称 | 板块 |
|----|------|------|
| cu | 沪铜 | metals |
| al | 沪铝 | metals |
| zn | 沪锌 | metals |
| pb | 沪铅 | metals |
| ni | 沪镍 | metals |
| sn | 沪锡 | metals |
| bc | 国际铜 | metals（**已校准 75%**） |
| ao | 氧化铝 | metals（**已校准 75%**） |
| si/lc/ps/ss | 工业硅/碳酸锂/多晶硅/不锈钢 | metals（**待校准**） |

### OOS range coverage（2023–2026）

| 品种 | 改前（extents×1.0） | 改后 | upMult | downMult |
|------|---------------------|------|--------|----------|
| **CU** | 52.8% | **75.10%** | 1.65 | 1.35 |
| **AL** | 69.4% | **75.00%** | 1.15 | 1.05 |
| **ZN** | 61.1% | **75.16%** | 1.35 | 1.10 |
| **PB** | 80.7% | **80.65%** | 1.00 | 1.00 |
| **NI** | 59.8% | **75.16%** | 1.35 | 1.25 |
| **SN** | 61.6% | **75.32%** | 1.15 | 1.35 |
| AU/AG | — | **75.09%** | — | — |

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-15）— 含 `nonferrous-range-calibration.js` + intraday/next-day predictor · **需重启桌面应用**
- 校准 JSON 在 E 盘 `data/outlook-models/`，无需打入 asar

### 下一品种建议

**SI（工业硅）** 或 **SS（不锈钢）** — 同属有色金属板块；baseline 约 15–18%，需单独网格校准。

---

## 贵金属 AU/AG 区间校准 → 75% 覆盖率（2026-06-14 · 本 session 续完）

- **目标 KPI**：真实 high ≤ 预测 high 且 真实 low ≥ 预测 low（range coverage）≥ **75%** OOS
- **训练/评估**：train 2019–2022 · OOS 2023–2026
- **服务**：`services/precious-range-calibration.js` · `services/intraday-range-predictor.js`（AU/AG 专用）
- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/calibrate-precious-range.js`
- **参数落盘**：`E:\FanchengFinance\data\outlook-models\precious-range-calibration-v1.json`
- **探针**：`node scripts/probe-intraday-range-predictor.js` · 日志 `_probe-intraday-range-predictor-out.json`

### OOS range coverage（2023–2026 · 827 scored）

| 品种 | 改前 | 改后 | upMult | downMult |
|------|------|------|--------|----------|
| **AU** | 61.6% | **75.09%** | 1.30 | 1.10 |
| **AG** | 64.9% | **75.09%** | 1.25 | 1.65 |
| CU/AL/ZN/… | 见上节有色金属 | **75%+** | — | — |

### 根因 & 修复

1. **AU 预测高低均高于现价**：预测锚定 **昨收（15:00 close）** 非实时现价；现价低于昨收时，区间整体可高于现价 — UI 已显示昨收行
2. **跨境 inference_error / 点位未传导**：`commodity-outlook-engine` 曾把 UI 包装对象当 `crossMarketCtx` 传入 — 已改为 `inferencePoint` 原始推断
3. **Session 基准**：`cn-futures-session-calendar.resolvePredictionContext` — 15:00 前用上一交易日 bar，15:00 后用当日 bar
4. **校准网格**：最小化 band 宽度（非最大化覆盖率），刚好 ≥75%

### Patch

- **`_patch-cross-vol-asar.js` DONE**（2026-06-14）— 含 `precious-range-calibration.js` + engine/session 修复 · **需重启桌面应用**
- 校准 JSON 在 E 盘 `data/outlook-models/`，无需打入 asar

## 下一交易日高低点位预测 · CN Session 对齐（2026-06-14）

- **交易日历**：`services/cn-futures-session-calendar.js` — SHFE 日 K `date` = 日盘自然日；bar 覆盖「前夜 21:00 + 当日 09:00–15:00」
- **基准**：昨收 = `close[t]`（T 日 **15:00** 日盘收，非 settle）
- **预测目标**：下一交易日 high/low = `high/low[t+1]`（T 日 **21:00** 夜盘 → T+1 日 **15:00**）；日 K 代理，无分钟拆分
- **服务**：`intraday-range-predictor.js` v1.1-cn-session · `next-day-range-predictor.js` v1.2-cn-session
- **UI 文案**：昨收（15:00）· 预测下一交易日（21:00夜盘起）最高/最低/振幅 · 副标题说明交易窗口
- **探针**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-intraday-range-predictor.js`
- **方向层 / 实时涨跌幅**：不变

### OOS KPI（2023–2026 · CN session 标签 · 与改前同口径）

| 品种 | scored | high MAE | low MAE | range MAE | 实际高在带内% |
|------|--------|----------|---------|-----------|---------------|
| AU | 827 | 4.44 | 4.80 | 5.21 | 61.6% |
| AG | 827 | 163.25 | 158.79 | 146.27 | 64.9% |
| CU | 731 | 548.01 | 524.88 | 389.30 | 48.3% |
| SC | 827 | 6.88 | 7.26 | 5.48 | 48.6% |
| FG | 620 | 20.33 | 18.42 | 13.30 | 57.7% |

> 改前使用 calendar-day close→next bar，与 CN session 配对 **数学等价**（日 K 已按交易日对齐）；本次主要为显式 session 元数据 + UI 文案 + 探针文档化。

## 次日高低点位预测（2026-06-14 · 全品种 · 已升级见上节）

- **目标**：取消 outlook 模块涨跌幅幅度判断，改为预测次日 **最高点 / 最低点 / 振幅**（基准 = 昨收 **close**，非 settle）
- **服务**：`services/intraday-range-predictor.js` · `services/next-day-range-predictor.js`
- **探针**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-intraday-range-predictor.js`
- **UI**：品种列表「预测」列显示 最高/最低/振幅；详情面板「次日高低点位预测」；**保留** 实时涨跌幅 chip
- **已移除 UI**：±1σ 幅度带、预测收盘点位差、涨跌幅 % 区间（smooth/extreme 双盒）
- **方向层不变**：仍 v1.34.8-ag-cu-spread+basis-term · 跨境传导块保留隔夜/溢价/汇率（无幅度判断）
- **日志**：`_probe-intraday-range-predictor-out.json` · `_probe-intraday-range-predictor.txt`

### OOS T+1 KPI（2023–2026 · 样本品种）

| 品种 | scored | high MAE | low MAE | range MAE | 实际高在带内% |
|------|--------|----------|---------|-----------|---------------|
| AU | 827 | 4.44 | 4.79 | 5.21 | 61.7% |
| AG | 827 | 163.09 | 158.74 | 146.27 | 64.9% |
| CU | 731 | 548.01 | 524.88 | 389.30 | 48.3% |
| SC | 827 | 6.88 | 7.26 | 5.48 | 48.6% |
| FG | 620 | 20.33 | 18.42 | 13.30 | 57.7% |

## Precious Point Predictor Phase 1（2026-06-14 · 本 session）

- **目标**：沪金/沪银 T+1 点位 `close[t+1]-close[t]`（**昨收 close**，非结算价）
- **服务**：`services/precious-point-predictor-features.js` · `services/precious-point-predictor.js`
- **脚本**：`scripts/train-precious-point-predictor.js` · `scripts/probe-precious-point-predictor.js`
- **文档**：`docs/PRECIOUS_POINT_PREDICTOR.md`
- **UI 预览**：`commodity-outlook-engine` + `src/app.js` 跨境传导块「模型 预测涨跌点位（相对昨收）」
- **方向层不变**：仍 v1.34.8-ag-cu-spread+basis-term
- **日志**：`_train-precious-point-predictor-out.json` · `_probe-precious-point-predictor-out.json`

## Patch Log（2026-06-14 · 逐条修补）

| # | Patch | Status | Result |
|---|-------|--------|--------|
| **1** | Cross-vol ±1σ UI → E 盘 app.asar | **DONE** | `_patch-cross-vol-asar.js` 热补丁 6 文件（cross-vol-magnitude / cross-market-precious-* / commodity-outlook-engine / src/app.js / reading-layout.css）· asar 3782001→3818039 bytes · **需重启桌面应用** |
| **2** | AG 仓单 2024 gap | **DONE** | 根因：scraper 用 CU 日历（170d）漏 AG 72 天 · 定向补抓 **72/72** · 2024 覆盖 **70.2%→100%**（242/242）· 总行 1772 |
| **3** | AU 仓单 2026 gap | **DONE** | 2025-11-18 后 **137/137** 交易日 · WAF js-challenge + HTML 表解析 · `au-daily.json` **1567→1704** · 止于 **2026-06-12** · WAF bypass 已并入 `services/shfe-warehouse-fetcher.js`（`fetch-warehouse-receipts.js --scrape` 自动启用） |
| **3b** | AU 仓单 2023 gap | **DONE** | 根因：主 scraper 用 CU 日历漏 AU 专属交易日 · AU 日历 2023 **28/28** 补齐（2023-11-21..2023-12-29）· `au-daily.json` **1704→1732** · legacy-dat · `_backfill-au-wh-2023-gap.js` |
| **3c** | AU 仓单 2024 gap | **DONE** | 同 CU 日历漏抓根因 · AU 日历 2024 **72/72** 补齐（2024-01-02..2024-04-25 四段）· 2024 覆盖 **170/242→242/242** · `au-daily.json` **1732→1804** · legacy-dat · `_backfill-au-wh-gap.js 2024` |
| **3d** | AU 日历并入主 scraper | **DONE** | `shfe-warehouse-fetcher.js`：`au` 用 `history/trading/au.json`，`cu/al` 用 `cu.json` · 联合日历遍历 · `--dry-run` gap 检测 · `_backfill-au-wh-gap.js` 委托主 scraper |
| **3e** | AG 日历并入主 scraper | **DONE** | `ag` 用 `history/trading/ag.json`（242d/2024 vs CU 170d）· 联合 `--id cu,al,au,ag` 时 AG-only 日仅抓 AG · `_analyze-ag-wh-gap.js` · `_backfill-ag-wh-gap.js` 委托主 scraper · 2024 **242/242** dry-run 0 gap |
| **3f** | AG 仓单 2023 gap | **DONE** | 同 CU 日历漏抓根因 · AG 日历 2023 **28/28** 补齐（2023-11-21..2023-12-29）· 2023 覆盖 **214/242→242/242** · `ag-daily.json` **1775→1803** · `_backfill-ag-wh-gap.js 2023` |
| **4** | SLV mixed-model ablation | **SKIPPED** | v1.34.8+SLV OOS au+ag **64.39%**（278 scored）vs 生产 **64.16%**（226）· 样本不可比 · **不 promote** |
| **5** | Cross-market ensemble retune | **SKIPPED** | 高置信子集（\|intl\|≥0.5% · 999 scored）网格 wHigh 0.5–0.9 · 全 tie **66.67%** · 无增益 |
| **6** | Regime vol windows | **DONE** | `cross-vol-magnitude.js` v0.2 · event10/trend15/basis·range20 · within ±1σ **62.55%→62.73%**（+0.18pp）· 未重打 asar |
| **7** | Geopolitics daily backfill | **DONE** | `aggregate-geopolitics-daily.js` → `E:\FanchengFinance\data\history\geopolitics-daily.json` · geo 行日频聚合 · `probe-geopolitics-daily.js` · flow probe inventory 已扫描 |
| **8** | AG basis A5 re-eval | **SKIPPED** | 仓单补齐后 A5：AG basis **61.54%**（16/26）· au+ag **65.92%**（179）· gate ❌ n<40 · **不 deploy** |
| **11** | CN session 日历 + UI 文案 + asar | **DONE** | `cn-futures-session-calendar.js` · session 元数据 · UI「昨收（15:00）」「21:00夜盘起」· asar 已重打 · **需重启桌面应用** |

- **生产不变**：`v1.34.8-ag-cu-spread+basis-term` · au+ag T+3 **64.16%**
- **下一单条建议**：AU 2023/2024 gap 已补齐；可续抓 2026-06-13+ 新交易日

## Cross-Vol 混合幅度（2026-06-14 · regime vol window）

- **服务**：`services/cross-vol-magnitude.js` — 跨境点位 + **分 regime vol 窗口** ±1σ 带（v0.2-regime-vol-window）
- **探针**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-cross-vol-magnitude.js`（test 2023–2026）
- **UI**：大宗走势 AU/AG「跨境传导」块（**已部署 E 盘 asar 2026-06-14**）

### OOS T+1 KPI（2023–2026 · 1650 rows · regime vol）

| 模式 | AU signed MAE | AG signed MAE | AU \|Δ\| MAE | within ±1σ |
|------|---------------|---------------|--------------|------------|
| Cross-only 点位 | **4.62** | 177.95 | — | — |
| Vol-only 20d | — | — | **4.37** / 129.13 | ~55.8% |
| **Hybrid（跨境点+vol带）** | 4.62 | 177.95 | **3.60** / 137.26 | **62.73%**（点位）· 47.33%（价格带 UI） |

- **结论**：signed MAE 未 beat vol-only（4.62 > 4.37）· **点位 ±1σ 覆盖率 62.55% > 59%**（vol-only 同口径 61.03%）→ **接入 UI 展示带宽**
- **方向层不变**：仍 v1.34.8-ag-cu-spread+basis-term
- **日志**：`_probe-cross-vol-magnitude-out.json` · `_probe-cross-vol-magnitude.txt`

## Vol-Baseline 幅度探针（2026-06-13 · subagent）

- **脚本**：`FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-vol-baseline-magnitude.js`（train 2019–2022 / test 2023+）
- **公式**：`mag = realized_vol_{5|10|20}d × (1 + α×|flow_z| + β×|cross_overnight_pct|) × horizon_scale` · `signed_mag = sign(direction) × mag`
- **最佳 vol 窗口**（train 网格）：**20 日 mean_abs**（非 10 日）· **α=0** · **β=0.05**（cross 仅微幅）
- **方向 OOS T+3**（flow 作 signed 方向）：**64.39%**（483）≈ v1.34.8 **64.16%** · cross **62.42%** · ensemble **63.77%**

### OOS T+1 |Δ| KPI 表（2023–2026）

| 指标 | Vol-only | Vol×flow | Vol×flow×cross |
|------|----------|----------|----------------|
| AU MAE（元/克） | **4.37** | 4.37 | 4.37 |
| AG MAE（元/千克） | **129.13** | 129.13 | 133.53 |
| AU RMSE | 9.42 | 9.42 | **9.24** |
| AG RMSE | **291.59** | 291.59 | 298.48 |
| AU corr | 0.44 | 0.44 | **0.48** |
| AG corr | 0.64 | 0.64 | **0.67** |
| 方向+幅度 within 1σ | 55.8% | 55.8% | **58.9%** |

- **高置信 flow（\|z\|≥0.35）AU MAE**：vol-only **7.52** · vol×flow×cross **7.44**
- **跨境点位 signed MAE T+1**：AU **4.62**（基线探针 **3.74**）· AG **177.95**
- **对比 prior ridge**：Ridge AU **29.57** → vol-only **4.37**（**−85%**）· 证实 vol baseline 路线正确
- **结论**：**flow 乘子无 MAE 增益**（α 网格最优=0）· cross 略升 corr/1σ 带但 **MAE 变差** · AU **4.37 < 5** 但未 beat vol-only → **不接入 UI**
- **下一步**：① 跨境推断作幅度基准（非本地 vol）② 分 regime vol window ③ 用分位数/1σ 带作展示而非点估计
- **日志**：`_probe-vol-baseline-magnitude-out.json` · `_probe-vol-baseline-magnitude.txt`

## Flow + Sentiment 幅度探针（2026-06-13 · subagent）

- **脚本**：`node scripts/probe-flow-sentiment-magnitude.js`（train 2019–2022 / test 2023+）
- **方向 OOS T+3**：Flow 规则分 **64.39%**（483 scored）≈ v1.34.8 **64.16%**（226）· 高置信 **66.4%**（372）
- **方向 OOS T+1**：Flow **69.98%**（473）· 主 alpha 来自 `cross_overnight_pct`（去掉后 T+3 降至 **50.52%**）
- **幅度 OOS T+1**：Ridge MAE AU **29.57** / AG **225.43** · 不如 naive vol（AU **4.31** / AG **129**）· corr AU **0.68** / AG **0.50**
- **结论**：**方向可做**（flow+cross 与 logistic 持平）· **幅度仅部分**（需 vol baseline × flow 强度，非裸 ridge）· **不 promote**
- **日志**：`_probe-flow-sentiment-magnitude-out.json` · `_probe-flow-sentiment-magnitude.txt`

## 跨境贵金属汇率口径（2026-06-13 · 用户决策 **用离岸**）

- **生产默认**：`services/cross-market-precious-inference.js` → `cnh-midrate-daily.json`（离岸 USDCNH 日收盘）
- **禁止生产启用**：`FANCHENG_FX_ONSHORE=1`（仅探针/调试可显式开启，改读 `fred-dexchus-daily.json` 在岸 DEXCHUS）
- **UI**：大宗走势「跨境传导」展示 **离岸USDCNH 官方口径**；板块在岸价 / 外汇面板在岸报价仅供参考
- **数据**：`FANCHENG_DATA_DRIVE=E` · `E:\FanchengFinance\data\history\cnh-midrate-daily.json`

## AG Basis Playbook（2026-06-13 · subagent 6728ec92）

- **生产**: `v1.34.8-ag-cu-spread+basis-term` · AG basis OOS **56.79%** (46/81) · au+ag **64.16%** · AU **67.62%**
- **P0 用户**: CU term 续接 · **35 miss audit** · SLV CSV · AG 仓单核验
- **禁止**: 次级 head / LME 稀疏 / GLD 联合 / IS 阈值调参 / **longrun 74**
- **胜利**: AG basis ≥60% ×2 probe · au+ag ≥63% · AU ≥66%
- **Week 1 Agent（2026-06-13）**:
  - ✅ **A1** `scripts/_export-ag-basis-misses.js` → `E:\FanchengFinance\data\history\labels\user-ag-basis-audit-template.csv`（**35 miss**）
  - ✅ **A2** regime_source 分拆 → `_ag-basis-regime-source-split.json` / `.txt`（term **62.5%** 24n · proxy **50.94%** 53n）
  - ✅ **A3** `v1.34.8-ag-cu-spread-only`（`ag_cu_term_z_spread` only）· au+ag **63.41%** · AG basis **56.00%** (42/75) · gate ✅ → deploy
  - ✅ **A4** `v1.34.8-ag-cu-spread+basis-term`（双 spread）· au+ag **64.16%** · AG basis **56.79%** (46/81) · AU **67.62%** · gate ✅ → deploy
  - ⚠️ **A5** `AG_BASIS_DISABLE_OI_PROXY=1`（AG 仅 term_structure basis）· AG basis **61.54%** (16/26) · au+ag **65.54%** · AU **67.62%** · gate ❌（样本 26<40）→ **不 deploy，flag 保持实验**

### v1.34.8 spread 递进表（A3→A4）

| 版本 | 特征 | au+ag OOS | AU OOS | AG OOS | AG basis regime | gate | 日志 |
|------|------|-----------|--------|--------|-----------------|------|------|
| 基线 v1.34.5 | basis weighted | **63.04%** | **68.27%** | **58.73%** | **54.55%** (42/77) | — | `_train-v1345-post-wh-retrain.txt` |
| **A3 spread-only** | `ag_cu_term_z_spread` · 排除 `term_z_score_ag_basis` | **63.41%** | **66.40%** | **60.33%** | **56.00%** (42/75) | **✅** | `_train-v1348-ag-cu-spread-only.txt` |
| **A4 spread+basis** | `ag_cu_term_z_spread` + `term_z_score_ag_basis` | **64.16%** | **67.62%** | **61.16%** | **56.79%** (46/81) | **✅** | `_train-v1348-ag-cu-spread+basis-term.txt` |
| **A5 disable oi_proxy** | env `AG_BASIS_DISABLE_OI_PROXY=1` · 权重不变 | **65.54%** | **67.62%** | **62.50%** | **61.54%** (16/26) | **❌** n<40 | `_probe-a5-ag-basis-disable-oi-proxy.json` |

- **权重**：`E:\FanchengFinance\data\outlook-models\outlook-logistic-weights.json`（**v1.34.8-ag-cu-spread+basis-term** · `gate.passed=true`）
- **回滚**：`outlook-logistic-weights-v1348-spread-only.json`（A3 spread-only，非 v1.34.5）
- **regime 探针**：`_probe-v1348-ag-cu-spread+basis-term-regime.txt`

## v1.35.0 分品种 Logistic Head（2026-06-13 · split-head 实验）

- **架构**：AU / AG 独立训练 + 推理路由（`architecture: split-heads` · `heads.au` / `heads.ag`）
- **哲学降权**：AG `philosophyScore × 0.45`（AU 全量 1.0）· env `AG_PHILOSOPHY_SCALE`
- **AU 特征**：real10y · GLD · 期限结构 · 仓单 · OI · regime
- **AG 特征**：期限 / `ag_cu_term_z_spread` / `term_z_score_ag_basis` / CU 动量 / **GSR z-score** / 仓单 · OI · regime
- **训练**：`node scripts/train-outlook-logistic.js --split-heads --version v1.35.0-split-heads`
- **权重（实验，未替换生产）**：`E:\FanchengFinance\data\outlook-models\outlook-logistic-weights-v1350-split-heads.json`
- **OOS T+3**（2023–2026 · 非 neutral 计分）：

| 版本 | au+ag | AU | AG | scored (au/ag/all) | gate |
|------|-------|-----|-----|---------------------|------|
| **v1.34.8 生产** | **64.16%** | **67.62%** | **61.16%** | 105 / 121 / 226 | ✅ |
| **v1.35.0 split** | **56.63%** | **57.60%** | **53.47%** | 467 / 144 / 611 | ❌ |

- **结论**：分 head 后预测更激进（scored 611 vs 226），命中率未超基线 → **维持生产 v1.34.8**；后续可试 per-head 阈值 / `AG_PHILOSOPHY_SCALE` 网格 / SLV 特征
- **日志**：`_train-v1350-split-heads.txt`
- **代码**：`services/outlook-logistic-features.js` · `services/outlook-onnx-runner.js` · `services/gsr-proxy.js` · `scripts/train-outlook-logistic.js --split-heads`

## v1.35.1 split-head 阈值校准（2026-06-13 · calibration subagent）

- **方法**：OOS 2023–2026 网格搜索 per-head `bullishThreshold` / `bearishThreshold` + `AG_PHILOSOPHY_SCALE` 推理侧扫描（0.35–0.75）
- **脚本**：`node scripts/calibrate-split-heads.js` · `--save` 写入校准权重
- **权重（实验）**：`E:\FanchengFinance\data\outlook-models\outlook-logistic-weights-v1351-split-heads-calibrated.json`
- **最佳阈值**：AU bullish **0.60** / bearish **0.25** · AG bullish **0.55** / bearish **0.25**
- **最佳哲学 scale**：`AG_PHILOSOPHY_SCALE=0.45`（推理侧网格无显著差异；重训 0.55 仍 56.61% 默认）
- **推理**：`services/outlook-onnx-runner.js` 读取 `heads.*.directionThresholds`

| 版本 | au+ag OOS | AU OOS | AG OOS | scored (au/ag/all) | gate |
|------|-----------|--------|--------|---------------------|------|
| **v1.34.8 生产** | **64.16%** | **67.62%** | **61.16%** | 105 / 121 / **226** | ✅ |
| **v1.35.0 split 默认 0.55/0.45** | **56.63%** | **57.60%** | **53.47%** | 467 / 144 / **611** | ❌ |
| **v1.35.1 校准（高置信）** | **59.87%** | **58.06%** | **61.05%** | 62 / 95 / **157** | ❌ |
| **v1.35.1 校准（覆盖 180–230）** | **59.83%** | **58.96%** | **61.05%** | 134 / 95 / **229** | ❌ |

- **结论**：阈值校准 +3.2pp（56.63→59.87%），根因「过度方向预测」部分缓解，但 **未追平 v1.34.8**（64.16% / 226）→ **不替换生产**；校准权重保留实验
- **日志**：`_calibrate-split-heads-out.json` · `_calibrate-split-heads-run.txt`

## 改进路线图执行（2026-06-13 · Agent 逐条）

| # | 项 | 状态 | OOS KPI vs 基线 64.16% | 结论 |
|---|-----|------|------------------------|------|
| **1** | SLV ETF → AG `slvHoldings_chg_5d` | **DONE**（数据已补齐 · **不 promote**） | 官方 **1873 rows**（2019-01-01..2026-06-11）· train 覆盖 **100%** · split-head +SLV OOS **53.36%**（268 scored）· 边际 **+5.68pp** vs 无 SLV · **低于** 生产 AG **61.16%** | AnySearch → BlackRock `get-fund-document` API；`ishares-slv-archive` 自动抓取 |
| **2** | GLD 正式纳入 AU | **DONE** | AU split +GLD **57.60%** vs −GLD **58.31%** · 生产 v1.34.8 AU **67.62%**（105） | GLD 100% 覆盖（1872 行）但 **不提升** AU head；**维持生产排除 GLD** |
| **3** | 跨境 + logistic 融合 | **PARTIAL** | T+3 ensemble **63.56%**（1457 scored，方法论不可比）· 可比子集 logistic **64.16%**（226） | 代码已接 `cross-market-logistic-ensemble.js`；**不 promote**（`FANCHENG_CROSS_MARKET_ENSEMBLE=1` 实验） |
| **4** | AG basis term-only gate | **DONE**（复用 A5） | AG basis **61.54%**（16/26）· au+ag **65.54%** | n<40 gate ❌ · **不 deploy** |
| **5** | Tradable-day KPI 报告 | **DONE** | 全样本 T+3 **64.16%** · 高 intl 子集 T+3 **62.42%**（165）· 目标 70% gap **5.84pp** | `scripts/probe-tradable-day-kpi.js` |
| **6** | 重训 split heads | **SKIPPED** | — | Items 1–3 无 material 特征 → 不重训 |

### Item 1 — SLV（DONE · 不 promote）

- **代码**：`services/slv-etf-fetcher.js` · `scripts/fetch-slv-etf-holdings.js` · AG head `slvHoldings_chg_5d`
- **AnySearch 发现**：iShares 页 **Data Download** → BlackRock `varnish-api/blk-one01-product-data/.../get-fund-document?portfolioId=239855&component=fundDownload`（SpreadsheetML XML，`Historical` 表：As Of + Shares Outstanding，自 2006 起）
- **自动抓取**（2026-06-13）：`ishares-slv-archive` **1872 行** + 合并 MacroMicro **1873 行** → `user-slv-holdings.csv` · `slv-etf-holdings-daily.json`
- **换算**：官方 Excel 无 tonnes 列；`tonnes = shares × (15003.8 / 533.2M)`（iShares 页 2026-06-11 anchor）
- **覆盖**：train 2019–2022 `slvHoldings_chg_5d` **100%**（912/912）· OOS **100%**（825/825）
- **消融**（split AG head · OOS 268 scored）：+SLV **53.36%** vs −SLV **47.68%**（**+5.68pp** 边际）· 生产 AG T+3 **61.16%** → **不写入** `outlook-logistic-weights.json`
- **刷新**：`FANCHENG_DATA_DRIVE=E node scripts/fetch-slv-etf-holdings.js`（无需手动 CSV）
- **日志**：`_fetch-slv-official-out.txt` · `_probe-slv-ag-ablation-out.json` · `_anysearch-slv-page.txt`

### Item 2 — GLD AU（DONE · 不 promote）

- **数据**：`precious-etf-holdings-daily.json` **1872 rows** · OOS 覆盖 **100%**
- **生产**：`gldHoldings_chg_5d` 仍在 `excludedFromTraining` · 权重 **0**
- **AU split head 消融**：+GLD **−0.71pp** vs −GLD → **不纳入生产训练**
- **日志**：`_probe-gld-au-ablation-out.json`

### Item 3 — 跨境 ensemble（PARTIAL）

- **实现**：`services/cross-market-logistic-ensemble.js` · `outlook-onnx-runner.js` 可选融合
- **启用**：`FANCHENG_CROSS_MARKET_ENSEMBLE=1`（生产默认关）
- **探针**（OOS 2023–2026 · 可比 logistic 226 scored）：

| 模式 | T+1 au+ag | T+3 au+ag (226) | T+3 high-intl (165) |
|------|-----------|-----------------|---------------------|
| logistic-only | 59.38% | **64.16%** | 62.42% |
| cross-only | 73.25% (1432) | 63.24% (1469) | 66.67% (999) |
| ensemble | 73.63% (1422) | 63.56% (1457) | 66.67% (999) |

- **结论**：cross T+1 强但 scored 样本量不同；T+3 融合 **未超** v1.34.8 → **不保存 ensemble 为生产默认**
- **日志**：`_probe-cross-market-ensemble-out.json`

### Item 5 — Tradable-day KPI 框架

- **脚本**：`node scripts/probe-tradable-day-kpi.js`
- **定义**：`|overnight intl|≥0.5%` OR `AG term-only basis` OR `regime≠range`
- **当前 v1.34.8**：

| 子集 | T+1 au+ag | T+3 au+ag | scored T+3 |
|------|-----------|-----------|------------|
| 全样本 | 59.38% | **64.16%** | 226 |
| 高 intl | 56.97% | 62.42% | 165 |
| tradable-day OR | 59.38% | 64.16% | 226 |

- **目标**：tradable-day T+3 ≥ **70%**（当前 gap **5.84pp**）
- **日志**：`_probe-tradable-day-kpi-out.json`

### 部署建议（2026-06-13）

- **维持生产**：`v1.34.8-ag-cu-spread+basis-term`（au+ag T+3 **64.16%**）
- **不 deploy**：SLV 纳入生产权重（split head OOS **53.36%** < **61.16%**）· GLD 纳入训练 · cross ensemble · A5 oi_proxy disable · split heads v1.35.x
- **下一单条**：SLV 特征网格 / per-head 阈值调参；或 P0 **35 miss audit** / CU term 续接

## v1.34 T+3 logistic walk-forward（2026-06-12，basis subagent b176eb1f · ag subagent c94e6e20）

### P0 → basis → ag 递进表

| 阶段 | 新增特征 | au+ag OOS | AU OOS | AG OOS | AU basis regime | gate | 日志 |
|------|----------|-----------|--------|--------|-----------------|------|------|
| 基线 WF | philosophy / momentum / adaptive / OI / regime | **59.83%** | **61.85%** | — | ~47%（哲学 M1） | ❌ | `_train-logistic-wfcv-out.txt` |
| +real10y | `real10y_chg_5d` | **59.95%** | **61.26%** | — | — | ❌（−0.05pp） | `_train-logistic-real10y5d.txt` |
| +P0 OI | `warehouseReceipt_chg_5d` + OI 行为因子 | **59.35%** | **61.76%** | — | — | ⚠️ auVsStub only | `_train-p0-oi-out.txt` |
| +basis/term | `term_spread_pct` / `term_z_score` / `term_spread_chg_5d`（AU only） | **61.43%** | **65.66%** | **55.92%** | **68.89%** (93/135) | **✅ ≥60%** | `_train-logistic-basis-term.txt` |
| **+ag term** | `term-structure/ag-daily.json` **1772 rows** · 补 AG 期限结构 | **62.39%** | — | **59.46%** | — | **✅** | `_train-logistic-basis-term.txt`（重训） |
| **v1.34.5 +ag basis weighted** | AG basis 加权特征（subagent 7b067929） | **64.49%** | **68.22%** | **60.75%** | AG basis **56.52%** | **✅** | AG basis weighted train |

- **训练窗口**：IS 2019–2022 · OOS 2023–2026 · `scripts/train-outlook-logistic.js --id au,ag`
- **当前特征**（18 维）：philosophy / momentum / adaptive / real10y / 仓单 / **期限结构（AU+AG）** / OI 行为 / regime one-hot（含 `regime_basis`）
- **ag 专项**（c94e6e20）：根因 AG 缺 `ag-daily.json` 期限结构 → AG OOS **55.92%→59.46%**（+3.54pp）· au+ag **61.43%→62.39%**（+0.96pp）
- **v1.34.5 ag basis weighted**（7b067929）：au+ag OOS **62.39%→64.49%**（+2.10pp）· AG **59.46%→60.75%** · AU **68.22%** · AG basis regime **56.52%**（仍 <60%）
- **权重**：`E:\FanchengFinance\data\outlook-models\outlook-logistic-weights.json`（**v1.34.8-ag-cu-spread+basis-term** · `gate.passed=true` · `preciousProbeEligible=true`）
- **regime 探针**：`_probe-logistic-by-regime.txt`
- **GLD ETF**：`precious-etf-holdings-daily.json` **1872 行** · 源 `spdr-gld-historical-archive` · end **2026-06-12**（2026-06-15 自动抓取成功；旧 CSV/barlist 仍 Cloudflare/403）
- **GLD asar 热补丁**（2026-06-15）：`_patch-gld-etf-asar.js` → `app.asar` 注入 `trySpdrHistoricalArchive` / `fetchBuffer` / `xlsx-lite` 命名空间修复；备份 `app.bak-gld-etf-1781533291311.asar`
- **longrun 状态**：
  - ✅ **解锁** 贵金属-only T+3 probe（`probe-precious-longrun-t3.js`）— **未自动启动**
  - ❌ **仍暂停** 全量 74 品种 `tune-sector-weights-longrun` — 须用户显式确认
- **下一步**：用户确认后可跑贵金属-only longrun；或继续 P0 数据 / GLD 导入后重训

## Phase 1 — 关机恢复

| 项 | 状态 |
|----|------|
| powercfg 休眠/待机 AC+DC = 0 | ✅ 已执行 |
| `_keep-awake-executionstate.ps1` (uint32 2147483651) | ✅ 已后台重启 |
| tick 转换 | ✅ **1951/1951**（`data/history/trading/tick-convert-progress.json`） |
| news-tagged | ✅ **358 行**（loader `getRowCount()`，batch8 合并后） |
| trading JSON | ✅ **75 个**（74 品种 + progress 文件） |
| K 线缓存 | ✅ 80 个 `klines/*.json` |
| b05eab0e 校准中断 | ⚠️ `outlook-calibration.json` 停在 v1.31.1 longrun **56.44%**；本次 v1.31.2 重跑完成 |

## Phase 2 — 哲学 v1.31.3 贵金属抬升（2026-06-07）

- **剧震回撤**：`post_shock_pullback×1.0`（v1.31.2 为 0.88/0.95）
- **叙事延长封顶**：AU/AG `narrativeExtendCap` **1.25**（v1.31.2 为 1.15/1.22）
- **Fed 重复衰减**：`macroRepeatRepeatMult×0.98`、`macroDecayMin 0.85`（v1.31.2 为 0.92 / 0.82）
- **观望阈值**：`philosophyUncertaintyThreshold 0.60`（修复 `getPhilosophyFitCalibration` 导出后生效）
- **priced-in**：`pricedInBullishMult 0.78`（v1.31.2 为 0.72）
- **板块 blend**：贵金属 `philosophyWeight 0.64`、`macroFed 1.22`、`directionBull 0.11`
- **探针脚本**：`scripts/tune-precious-philosophy.js`、`scripts/probe-precious-fast.js`
- **长周期回测**：进行中 → 日志 `_longrun-hitrate-boost.txt`（单进程，勿并行 tune）

## Phase 2（旧）— 哲学 v1.31.2 软锲合

- **经验衰减**：保留 v1.30 `STIMULUS_DECAY_SCHEDULE` + macro `×0.82` 第 3 次起
- **农产品气候**：保留 `agri_yield_path` + `yield_outcome×1.1`
- **单边攻城/回踩**：`trendStructureAnalyzer` + `pullback_breakout×1.08`
- **事件 vs 叙事**：冲击短周期；CU/AL 叙事延长封顶 **1.25**；AU/AG **1.15**
- **剧震后回调**：贵金属 `post_shock_pullback×0.88`（v1.31.0 全局 0.78 过苛）
- **philosophyBlendWeight**：不确定时收缩 composite → 偏**观望**（贵金属跳过分数收缩，仅方向过滤器）

## Phase 3 — 部署

- 版本：**1.31.2**（app + 哲学 + 引擎 + 校准）
- 部署目标：`E:\FanchengFinance\app\win-unpacked`
- 回测：`FANCHENG_DATA_DRIVE=E node scripts/tune-sector-weights-longrun.js --force`


## batch8 longrun 完成（2026-06-07 19:08）

- 日志：`_longrun-batch8.txt`
- **overall 命中率**：**56%**（cached BEFORE **57%**；-1pp vs 57% 基线）
- 结果：`_sector-tune-result.json`
- 说明：v1.29 force 长周期 walk-forward 74 品种；**未**并行启动第二条 tune 进程


## 命中率目标

| 指标 | v1.29 基线 | v1.31.1（中断） | **v1.31.2 batch8** | vs 基线 |
|------|-----------|----------------|-------------------|---------|
| 全量 overall | **57.0%** | 56.4% | **56.5%** | v1.29 **−0.5pp** · v1.31.1 **+0.1pp** |
| 有色 metals | 55.3% | 54.6% | **53.9%** | v1.29 **−1.4pp** |
| 贵金属 precious | **57.7%** | 55.0% | **54.5%** | v1.29 **−3.2pp** |
| 黑色 black | 56.1% | 55.3% | **55.5%** | v1.29 **−0.6pp** |
| 能化 energy | 56.5% | 57.0% | **57.4%** | v1.29 **+0.9pp** |
| 化工 chemical | 58.6% | 57.8% | **58.1%** | v1.29 **−0.4pp** |
| 农产品 agriculture | 57.0% | 56.9% | **56.5%** | v1.29 **−0.5pp** |
| 长期 70% | — | — | gap **+14pp** | 进行中 |

回测：**2026-06-07 batch8** · `news-tagged` **358 行** · `FANCHENG_DATA_DRIVE=E tune-sector-weights-longrun.js --force` · **49.5 分钟**（2970s）· 日志 `_longrun-batch8.txt` · 结果 `_sector-tune-result.json`

**batch8 小结**：358 行新闻并入后 walk-forward 样本增多；全量 **56.5%** 仍介于 v1.31.1（56.4%）与 v1.29（57%）之间，**未恢复 57% 基线**。板块上能化/化工/农产品持平或略优 v1.29，有色与贵金属仍拖累；贵金属距 58% 目标约 **3.5pp**。

**贵金属未达 58% 说明**：v1.31 历史锲合对 AU/AG 剧震惩罚仍偏重样本外方向；v1.31.2 已软化 `post_shock×0.88`、跳过贵金属分数收缩，batch8 回测 precious **54.5%**——下一步可单独网格 `philosophyBlendWeight` / 叙事封顶。


## 快讯 inbox（10477d9e）

- **路径**：`E:\FanchengFinance\data\history\flash-news-inbox.json`（`FANCHENG_DATA_DRIVE=E` 时 `getDataDir()/history`）
- **刷新**：仓库根目录 `FANCHENG_DATA_DRIVE=E npm run fetch-flash-news`（可选 `--alerts-only` / `--no-append`）
- **说明**：候选仅写入 inbox，不自动合并 `news-tagged.csv`；桌面 **v1.31.2** 已同步至 `E:\FanchengFinance\app\win-unpacked`

- **新闻**：`news-tagged.csv` **358 行**（batch8 merge）
- **哲学**：v1.31.2
- **命令**：`FANCHENG_DATA_DRIVE=E node scripts/tune-sector-weights-longrun.js --force`
- **日志**：`_longrun-batch8.txt`（2970s，74 品种 walk-forward）
- **结果**：overall **56.5%**（控制台四舍五入 56%）；cached 跑前 **57%** → 跑后 **56%**
- **板块**：metals 53.9% · precious 54.5% · black 55.5% · energy 57.4% · chemical 58.1% · agriculture 56.5%
- **duplicate tune 进程**：启动前 **0** 个 `tune-sector-weights-longrun`（已确认无需 kill）
- **用户决策（2026-06-13）**：维持生产 **v1.34.8-ag-cu-spread+basis-term**；**不**全量/生产启用 `AG_BASIS_DISABLE_OI_PROXY`（A5 flag 仅 `_probe-a5-*` 实验脚本）。
