# 跨资产因子 — 贵金属 × 原油 × 美股（v1.32.3）

> **用户观察**：美股与贵金属近期常同涨同跌；原油与贵金属常负相关（油涨金跌），但**不能一概而论**——须按 **regime** 动态切换，而非固定符号。

## 一、Regime 分类表

| Regime ID | 中文标签 | 识别条件（5d 动量 + 20/60d 相关） | 对 AU/AG 哲学分 |
|-----------|----------|-----------------------------------|-----------------|
| `risk_on_sync` | 风险偏好同步（股金同涨） | SP↑ + AU↑，AU-SP 20d 相关 > 0.1 | **+0.03~0.10**「美股贵金属同向·风险偏好」 |
| `inflation_oil_drag` | 通胀油压（油涨金跌） | 油↑ + 金↓，AU-SC 20d 负相关 | **−0.04~0.20**「原油强势压制贵金属」 |
| `safe_haven_sync` | 避险同步（股跌金涨） | SP↓ + AU↑ | **+0.05~0.08**「避险同步·股跌金涨」 |
| `dual_risk_off` | 双杀流动性（股金同跌） | SP↓ + AU↓（2020-03 类） | **收缩 composite×0.14** |
| `oil_gold_decouple` | 油金弱相关/脱钩 | \|corr20 AU-SC\| < 0.18 | **不调整**（不做固定负相关） |
| `macro_regime_shift` | 宏观范式切换（2026 油金分化） | ≥2026-01-28 且油金分轨/弱相关 | **弱化油压金** 或零调整 |

## 二、历史统计（2019-01-01 ~ 2025-12-31）

数据源：`E:\FanchengFinance\data\history\trading\{au,sc,fu}.json` + `klines/index-sp500-day.json`

### Regime 日数分布（对齐样本 **1639** 日）

| Regime | 天数 | 占比 |
|--------|------|------|
| 油金弱相关/脱钩 | 1106 | **67.5%** |
| 风险偏好同步 | 242 | 14.8% |
| 避险同步 | 123 | 7.5% |
| 通胀油压 | 99 | 6.0% |
| 双杀流动性 | 69 | 4.2% |
| 2026 宏观切换 | 0 | 0%（探针窗口止于 2025-12-31） |

> **解读**：约 2/3 交易日处于弱相关/脱钩——印证「不能固定油金负相关」；仅 ~28% 日落在四类可交易 regime。

### 时代平均 20 日滚动相关系数

| 时代 | AU-SC (20d) | AU-SP500 (20d) | 样本日 |
|------|-------------|----------------|--------|
| **2019** 贸易战/疫前 | **−0.22** | +0.03 | 236 |
| **2020 COVID** | +0.12 | +0.02 | 235 |
| **2022 通胀/加息** | **+0.27** | −0.08 | 233 |
| **2023-2024** 高利率 | +0.06 | +0.00 | 371 |
| **2025** | +0.03 | +0.04 | 228 |

**要点**：
- 2019 油金负相关最明显（AU-SC ≈ −0.22）
- 2022 通胀期油金**同向**（+0.27）——「油涨→通胀→金涨」链条占主导，与 `inflation_oil_drag` 互斥
- AU-SP 相关始终较弱（|r| < 0.1），股金同步更多靠 **5d 同向动量** 而非长期高相关

## 三、代码接线

| 模块 | 职责 |
|------|------|
| `services/commodity-cross-asset-regime.js` | `classifyCrossAssetRegime` · 滚动 20/60d 相关 · `computePreciousCrossAssetAdjustment` |
| `services/commodity-outlook-philosophy.js` | AU/AG 评估后叠加 `crossAsset.delta` → `compositeScore` · `logicSummary` 追加跨资产 rationale |
| `services/commodity-outlook-backtest.js` | `predictAtBarIndexHistorical(..., { skipCrossAsset })` 供 A/B 探针 |
| `scripts/probe-cross-asset-regime.js` | Regime 分布 + 哲学方向探针 |
| `scripts/_probe-cross-fast.js` | 独立基线快速命中率对比 |

### 调用示例

```javascript
const crossAsset = require('./services/commodity-cross-asset-regime');

const regime = crossAsset.classifyCrossAssetRegime('2022-06-15', {
  auChangePct: 0.3,
  oilChangePct: 1.8,
  spChangePct: -0.5,
});
// regime.id → 'inflation_oil_drag' | 'safe_haven_sync' | ...

const adj = crossAsset.computePreciousCrossAssetAdjustment(regime, {
  compositeScore: 0.25,
  oilScore: 0.35,
});
// adj.delta → 方向微调 · adj.rationale → UI 文案
```

## 四、探针命中率（AU T+1 方向）

**独立基线探针**（油/股 5d 动量 + regime 微调 vs 基线 alone，`scripts/_probe-cross-fast.js`）：

| 口径 | 命中 | 样本 | 命中率 |
|------|------|------|--------|
| **有跨资产因子** | 367 | 785 | **46.8%** |
| **无跨资产因子** | 354 | 751 | **47.1%** |
| **Δ** | — | — | **−0.4pp** |

- 因子生效日（\|delta\| > 0）：**476** 日 / 1639
- 全哲学 walk-forward（AU+AG 2019-2025）因 `evaluateInstrumentPhilosophy` 重计算，建议 batch 离线跑 `probe-cross-asset-regime.js`

> v1.32.3 设计偏**保守**：67% 脱钩日零调整；有效日微调幅度 ≤0.22。独立基线 Δ≈0 符合预期——主要价值在 **regime 条件化**（避免 2022 误用 2019 油金负相关），而非 brute-force 抬命中率。

## 五、与 v1.31.4 / 哲学层关系

- 合并于 **v1.32.3**（哲学 + 引擎 + cross-asset 模块）
- 与 v1.31.x **软锲合**（`philosophyFit` / `postShockPullback`）正交：跨资产在 `buildPhilosophyComposite` 之后、`philosophyFit` 之前注入
- 2026-01-28 起 `macro_regime_shift` + `outlook-adaptive-calibration.getOilGoldCouplingScale` 弱化油压金乘数

## 六、沪金溢价（AU spot + CNH · v1.32.4）

> **用户实用交易哲学**：建议以国际现货黄金定方向，结合离岸人民币中间价判断沪金溢价。

| 层级 | 信号 | 数据源 | 对 AU 哲学分 |
|------|------|--------|--------------|
| **门控** | 国际金 5d 方向 | 伦敦金 / AU 代理 | \|intl_chg_5d\|≥0.35% 才允许溢价/CNH 修正（不单独叠方向分） |
| **辅** | 沪金溢价走阔/收窄 | `溢价% = (AU×31.1/CNH)/伦敦金 − 1` | \|premium_chg_5d\|≥0.4% 且与国际金同向 → ±0.008~0.022 |
| **辅** | CNH 5d 变动 | Eastmoney 收盘代理等 | \|cnh_chg_5d\|≥0.35% 且与国际金同向 → ±0.015 |
| **实时** | 当日 CNH 变动 | `forex.usdcnh` / `usdcny` | 仅在国际金同向时 ±0.02 |

**溢价解读**：
- **溢价走阔** + 国际金上行 → 沪金滞后/补涨，偏多
- **溢价收窄** + 国际金平盘 → 沪金相对偏弱，偏谨慎
- 与 `user-au-events-pending.csv`（FOMC 等）及跨资产 regime **叠加**，不替代事件哲学

**代码**：`commodity-cross-asset-regime.computeAuSpotCnhOverlay` → `commodity-outlook-philosophy`（仅 `au`）→ `commodity-outlook-engine` 预测依据行「沪金溢价：…」

**数据缺口与 CNH 数据源说明**：
- 离岸 CNH **CFETS 中间价**无公开历史 API / FRED 序列 → `scripts/fetch-cnh-midrate.js`（`--import=` CSV 或占位）
- **东方财富 USDCNH 日收盘**（`eastmoney-usdcnh` → `cnh-midrate-daily.json`，`kind=cnh_spot_close`）为**行情收盘代理**，**不是** CFETS 离岸中间价；日频 spot 波动会放大「沪金溢价」噪声
- overlay 对 spot 代理自动降权（`overlayScale≈0.32`），溢价/CNH 修正仅在 `|premium_chg_5d|≥0.3%` 且与国际金方向一致时触发
- **回测默认** `skipAuSpotCnh=true`（`predictAtBarIndexHistorical`）；实盘引擎仍计算 overlay 并写入 rationale
- 可选在岸代理：`fred-dexchus-daily.json`（DEXCHUS，标注「用在岸代理」）
- 伦敦金：`node -e "require('./services/fred-history-fetcher').fetchAndCacheSeries('GOLDAMGBD228NLBM')"`

```bash
node scripts/probe-au-spot-cnh.js   # 2023-2026 AU T+1 基线 vs overlay
node scripts/fetch-cnh-midrate.js   # CNH 占位/导入
```

输出：`docs/au-spot-cnh-probe.json`

**探针修复前后**（2023-2026 AU T+1，Eastmoney USDCNH 1938 行，`kind=cnh_spot_close`）：

| 口径 | 命中 | 样本 | 命中率 | Δ |
|------|------|------|--------|---|
| 基线（动量+regime） | 183 | 363 | **50.41%** | — |
| overlay **修复前** | 203 | 481 | 42.20% | **−8.21pp** |
| overlay **修复后** | 184 | 366 | **50.27%** | **−0.14pp** |

## 七、复现

```bash
node scripts/_probe-cross-fast.js          # Regime 分布 + 快速命中率
node scripts/probe-cross-asset-regime.js   # 完整 Regime 统计（哲学 walk-forward 较慢）
node scripts/probe-au-spot-cnh.js          # 沪金 spot+CNH overlay 探针
```

输出：`docs/cross-asset-regime-stats.json` · `docs/au-spot-cnh-probe.json`
