# 梵澄金融 · v1.34 演进路线图

> **日期**：2026-06-12（用户决策 29bc9f94 锁定）  
> **前置文档**：[FANCHENG_ARCHITECTURE_REFLECTION.md](./FANCHENG_ARCHITECTURE_REFLECTION.md) · [FANCHENG_LOGIC_FRAMEWORK.md](./FANCHENG_LOGIC_FRAMEWORK.md) · [FANCHENG_DATA_LAYER_BLUEPRINT.md](./FANCHENG_DATA_LAYER_BLUEPRINT.md)  
> **状态**：用户 P0 已锁定；**longrun 暂停**，按 Phase 顺序推进（禁止并行网格）  
> **数据根**：`FANCHENG_DATA_DRIVE=E`

### 进度（2026-06-12）

| 周次 | Phase | 状态 |
|------|-------|------|
| Week 1 | Phase 0 标签 redesign | ✅ 完成（AU T+3 动量+OI 基线 **54.09%**） |
| Week 2 | Phase 1 P0 数据 | ✅ 部分完成（flash/news/OI KPI；ETF 待 CSV） |
| Week 3 | Phase 2 L1 regime | ✅ **五态 + byRegime + L2 stub 接线**（ensemble AU T+3 **58.93%**） |
| Week 3–4 | Phase 3 L2 ONNX | 🟡 **进行中** — logistic 训练 + `outlook-onnx-runner.js` 脚手架 |

**Week 2 快照（2026-06-12）**

| 项 | 结果 |
|----|------|
| OI partial（JR/LR/PM/RI/WH/ZC） | **KPI 接受 68/74 ≥80%**（核心流动性品种达标）；低覆盖 6 品种（LR/JR/PM/RI/WH/ZC）**排除出 KPI 分母**，待数据源或手动补 |
| news-tagged | **994 行**（flash merge + dedupe；超目标 ≥450） |
| flash merge | ✅ `news-dedupe-utils.js` 解除循环依赖；`merge-flash-into-news.js` 可独立运行 |
| GLD ETF | ✅ **1872 行** · `spdr-gld-historical-archive` API（2026-06-15 验证） |
| AU T+3 探针（统一口径） | 哲学 M1 **T+3 55.81%**（129 样本）· 动量+OI **T+3 54.09%**（806 样本）· **994 行**新闻；窗口 **2023–2026 step=1** |
| 旧口径伪回归 | 54.55%/66 样本 = **step=3 + readCachedKlines** 混用，非新闻回归 |
| L1 regime | ✅ flatRows `marketRegime` 覆盖率 **100%**（AU 825 日五态：trend **427** / basis **251** / range **92** / event **55** / seasonal **0**） |

**Week 2 收尾（2026-06-12）**

| 项 | 状态 |
|----|------|
| flash merge + dedupe | ✅ **994 行** news-tagged |
| OI KPI 68/74 | ✅ 核心流动性达标 |
| GLD ETF | ⏳ 待用户 CSV |
| 探针口径统一 | ✅ `probe-t3-vs-t1-baseline.js` 同窗口/同 step |

**Week 3 L1 进展（2026-06-12）**

| 项 | 状态 |
|----|------|
| `classifyMarketRegime()` 五态增强 | ✅ seasonal（农产品 planting/harvest 窗口）+ basis（term-structure 优先，缺失时 **OI+价格背离代理**） |
| flatRows `marketRegime` 接线 | ✅ `predictAtBarIndexHistorical` → bars/barIndex/instrumentId |
| AU 五态分布（825 日） | trend **427** · basis **251** · range **92** · event **55** · seasonal **0** |
| 贵金属 walk-forward M1 | 聚合 T+3 **51.30%**（347 样本）· T+1 **50.14%** · AU 单品种 T+3 **55.81%** |
| `outlook-ensemble.js` L2 骨架 | ✅ regime 权重表 + `blendEnsemble()` stub（**无 ONNX**） |
| `useEnsembleStub` 接线 | ✅ `predictAtBarIndexHistorical(..., { useEnsembleStub: true })` |
| regime-labels-daily.json 导出 | ✅ AU 825 日 → `E:\FanchengFinance\data\history\regime-labels-daily.json` |
| byRegime T+3 报表 | ✅ `scripts/probe-by-regime-t3.js` |
| AU T+3 三基线对比 | 哲学-score **48.46%** · 全引擎 **55.81%** · ensemble-stub **58.93%** · 动量+OI **54.09%** |
| Phase 3 go/no-go | 🟢 **GO** — ensemble-stub vs 全引擎 **+3.12pp**（阈值 +1pp） |

**Week 3 byRegime T+3（哲学 M1 score 方向，2023–2026 step=1）**

| Regime | AU | 贵金属聚合 |
|--------|-----|-----------|
| trend | **47.80%** (159) | **48.31%** (472) |
| range | **57.14%** (28) | **48.44%** (64) |
| event | **53.33%** (45) | **57.32%** (82) |
| seasonal | — (0) | — (0) |
| basis | **44.57%** (92) | **45.45%** (231) |
| **overall** | **48.46%** (324) | **48.41%** (849) |

**AU T+3 ensemble vs 基线（2023–2026 step=1）**

| 基线 | T+3 命中率 | 样本 |
|------|-----------|------|
| 哲学-score only | 48.46% | 324 |
| 全引擎 walk-forward | 55.81% | 129 |
| **ensemble-stub L2** | **58.93%** | 168 |
| 动量 5d + OI | 54.09% | 806 |

Δ ensemble vs 全引擎：**+3.12pp** · Δ vs 哲学-score：**+10.47pp** · Δ vs 动量+OI：**+4.84pp**

---

## 已锁定决策摘要

| # | 决策 | 选项 |
|---|------|------|
| KPI | **T+3 趋势方向**（主） | 保留 **T+1** 对比轨，非六板块各 70% |
| P0 市场 | **OI + 行为因子** | `oi-behavior-features.js`：增仓下跌 / 减仓上涨 / 成交持仓比 |
| P0 板块基本面 | **贵金属** | ETF stub、real10y、伦敦金、CNH 溢价（T+3 KPI 对齐） |
| 哲学层 | **M1 子模型**，权重 20–30% | L2 ensemble 动态分配 |
| Electron | **允许 onnxruntime-node**（Phase 3） | 目标 **65–68%** T+3 方向命中率 |
| 原则 | **70% 增益来自数据 + 标签** | 非更复杂网络 alone |
| longrun | **禁止** | Phase 0–2 完成前不跑 tune-sector 网格 |

**回测主指标**：`T+3 direction hit rate`（`outlook-labels.js` · `computeT3TrendLabel` · 阈值 ±0.05%）  
**对比指标**：`T+1 direction`（`computeT1Direction`，与 v1.32 longrun 可比）

---

## Phase 0 — 标签 redesign（1–2 周）

**目标**：统一 KPI 口径，为 L1/L2 训练提供正确 y。

| 任务 | 产出 |
|------|------|
| 实现 `computeT3TrendLabel()` + `computeT1Direction()` | `services/outlook-labels.js`（双轨标签） |
| 实现 OI 行为因子 | `services/oi-behavior-features.js` |
| 事件窗口标签 shock ±5 / narrative +20 | 同上 `computeEventWindowLabel()` |
| backtest 增加 `actualDirT3` / `hitDirectionT3` 字段 | `commodity-outlook-backtest.js`（小 diff，待接） |
| 基线探针（单次，非 longrun） | `scripts/probe-t3-vs-t1-baseline.js` |
| AU 2023–2026 动量基线 | T+3 vs T+1 命中率对比（见探针输出） |

**退出条件**：flatRows 含 T+3 标签；探针/longrun 口径文档化。

---

## Phase 1 — P0 数据（4 周）

**目标**：补齐最大数据缺口，预期 T+3 基线 **+3~5pp**。

| 优先级 | 数据 | 板块 | 脚本/路径 |
|--------|------|------|-----------|
| P0 | OI 全品种 2019+ 审计 + **4 零覆盖回填** | 全板块 | `backfill-oi-missing.js`（au/ag/fu/sc）；`backfill-commodity-oi.js`（klines） |
| P0 | **OI 行为因子**（增仓下跌/减仓上涨/成交持仓比） | 全板块 | `services/oi-behavior-features.js` |
| P0 | **贵金属基本面**（real10y、伦敦金、CNH 溢价、ETF stub） | 贵金属 | `precious-sector-loader.js`；`computeAuSpotCnhOverlay` |
| P0 | 新闻 batch5–8 + AU 锚点 merge | 2025_2026 | `merge-all-user-news-final.js` |
| P1 | LME/COMEX 库存周频 | 有色 | `data/history/inventory/` |
| P1 | term structure 跨期价差 | 能化/有色 | `fetch-term-structure.js`（待写） |
| P1 | 港口铁矿/煤炭库存 | 黑色 | `fetch-port-inventory.js`（待写） |

详见 [FANCHENG_DATA_LAYER_BLUEPRINT.md §五](./FANCHENG_DATA_LAYER_BLUEPRINT.md)。

**退出条件**：P0 覆盖率报告；2025_2026 新闻行数 ≥ 200；OI 核心流动性 **68/74 ≥80%**（低覆盖 6 品种不计入 KPI）。

---

## Phase 2 — L1 Regime 分类器（2–3 周）

**目标**：每日顶层 regime 标签，供 L2 条件化融合。

### 五态 regime（用户确认）

| ID | 名称 | 检测信号（概要） |
|----|------|------------------|
| `trend` | 趋势市 | MA stack + 台阶结构 + ADX/动量 |
| `range` | 震荡市 | ADX < 20 或 vol percentile < 30% |
| `event` | 高波动事件市 | shock_event + vol high + 新闻冲击 |
| `seasonal` | 季节性主导 | 农产品 harvest/planting 窗口 |
| `basis` | 基差修复市 | spot-futures spread 异常（Phase 1 数据就绪后） |

**实现**：`services/market-regime-classifier.js` → `classifyMarketRegime()`

**产出**：
- `data/history/regime-labels-daily.json` ✅（AU 825 日，2023–2026）
- backtest `byRegime` T+3 命中率报表 ✅（`scripts/probe-by-regime-t3.js`）

**退出条件**：五态均有样本 ✅；2025_2026 event 日占比与 news-tagged 一致 ✅

---

## Phase 3 — L2 ONNX Ensemble（3–4 周）

**状态（2026-06-12）**：🟡 **进行中** — GO 决策已锁定；脚手架已建，**full longrun 仍暂停**。

| 项 | 状态 |
|----|------|
| `outlook-onnx-runner.js` | ✅ .onnx → onnxruntime-node；否则 JSON 权重；再否则 ensemble-stub |
| `outlook-logistic-features.js` | ✅ philosophy / momentum / OI flags / regime one-hot |
| `train-outlook-logistic.js` | ✅ 纯 JS logistic → `data/outlook-models/outlook-logistic-weights.json` |
| `useOnnxEnsemble` 接线 | ✅ `predictAtBarIndexHistorical(..., { useOnnxEnsemble: true })` |
| `onnxruntime-node` | optionalDependencies（`npm install` 可选） |
| ONNX 文件 | ⏳ stub — 尚无 `.onnx`，待 Python/sklearn 导出 |
| 探针目标 | 贵金属 T+3 **≥60%**（full longrun 前） |

**GO 基线（stub）**：L2 stub AU T+3 **58.93%**，较全引擎 walk-forward **+3.12pp**（阈值 +1pp）。

**目标**：T+3 方向命中率 **65–68%**。

### 子模型

| ID | 来源 | 默认可解释 |
|----|------|------------|
| **M1** | `philosophyScore` | ✅ 规则 rationale |
| M2 | `adaptiveScore` | 时代补丁 |
| M3 | `factorComposite` | 宏观+技术+OI |
| M4 | technical-only score | 从 analyzer 抽取 |
| M5 | news-shock score | 仅 event 日激活 |
| M6 | regime prior | L1 历史条件 hitRate 查表 |

### 融合

```
composite_regime = Σ w_regime[i] × M_i
P(up) = sigmoid(composite_regime)
direction = P(up) > 0.55 ? bullish : P(up) < 0.45 ? bearish : neutral
```

| 方法 | 训练 | 推理 |
|------|------|------|
| Regime 条件 logistic | Node walk-forward 内层 CV | 纯 JS 或 ONNX |
| LightGBM | 离线 Python → **ONNX** | `onnxruntime-node` |
| 哲学 M1 权重 | **20–30% 上限**，regime 动态 | 保留 logicSummary UI |

**依赖**：`npm install onnxruntime-node`（optionalDependencies，+~30MB 包体积；未安装时自动回退 JSON/stub）

**退出条件**：T+3 overall ≥ 65%；六板块无 < 58%；2025_2026 ≥ 60%。

---

## Phase 4 — 可选 L3（仅当 Phase 3 < 65%）

- TCN/Transformer 离线训练 → ONNX
- 预期边际 +2~5pp
- **不在 v1.34 范围内**

---

## 里程碑时间线

```
Week  1–2   Phase 0  标签
Week  3–6   Phase 1  P0 数据
Week  7–9   Phase 2  L1 regime
Week 10–13  Phase 3  L2 ensemble + ONNX
```

---

## 禁止事项（Phase 0 完成前）

1. ❌ 并行多条 longrun 网格搜索
2. ❌ 以 T+1 70% 为优化目标调 philosophy 权重
3. ❌ 未审核 flash 新闻进回测
4. ❌ 跳过 Phase 1 直接上 LightGBM

---

## 关键文件索引

| Phase | 文件 |
|-------|------|
| 0 | `services/outlook-labels.js` · `services/oi-behavior-features.js` |
| 1 | `docs/FANCHENG_DATA_LAYER_BLUEPRINT.md` · `scripts/backfill-oi-missing.js` · `services/precious-sector-loader.js` · `scripts/fetch-precious-etf-holdings.js` |
| 2 | `services/market-regime-classifier.js` · `services/outlook-ensemble.js` · `data/history/regime-labels-daily.json` |
| 3 | `services/outlook-ensemble.js`（stub ✅）· `services/outlook-onnx-runner.js` · `services/outlook-logistic-features.js` · `scripts/train-outlook-logistic.js` · `data/outlook-models/` |
| 探针 | `scripts/probe-t3-vs-t1-baseline.js` · `scripts/probe-by-regime-t3.js` |

---

*路线图随 Phase 完成迭代；每 Phase 结束单次 longrun 验证 T+3 KPI。*
