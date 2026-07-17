# 自适应校准报告

> 生成：2026-06-07 12:05:54 · 版本 v1.32.2

## 本次命中率

| 指标 | 数值 |
|------|------|
| 全量 longrun | **56.5%** |
| 回测区间 | 2019-01-01 → 2026-06-07 |
| 回测时间 | 2026-06-07 |
| Performance gate | 时代 < 全量 − 5pp |

## 拖累板块 / 时代

- **2025-2026 反内卷/地缘** 51.9%（-4.6pp）— 时代偏弱 -4.6pp，需审视板块分权
- **有色新能源** 53.9%（-2.6pp）— 板块 有色新能源 长周期 53.9% 拖累全量

## 原因分析

- 供需×金融矩阵格「supplyStrong×loose」仅 42.0%，哲学锲合规则可能不适配
- 贵金属板块偏弱，买预期卖事实（priced_in）可能对 FOMC/地缘利好过于激进；沪金 AU 命中率 51.1%
- 2026-01-28 后油金分化（油涨金跌），固定负相关链条失效；应弱化 inflation_oil_drag 对贵金属压制

**拖累品种（样本≥80）**
- 线材 47.1%
- 氧化铝 48.1%

## 建议调整

- [可安全应用] **epoch-2025_2026-philosophy-gate**：2025-2026 反内卷/地缘：哲学分权 0.6→0.54，乘数×0.92（最差时代）
- [可安全应用] **precious-priced-in-soften**：贵金属 priced_in 卖事实略软化（0.7→0.85），避免 FOMC 落地后过度翻空
- [可安全应用] **oil-gold-decouple-post-2026**：2026-01-28 后油金脱钩：inflation_oil_drag 压制系数 1.0→0.35
- [待确认] **inst-wr**：单品种阈值/流动性标记需人工确认，不自动改写
- [待确认] **matrix-supplyStrong×loose**：矩阵格观望规则或主矛盾阈值需哲学层单独验证
- [待确认] **inst-ao**：单品种阈值/流动性标记需人工确认，不自动改写

## 已应用 / 待确认

### 已自动应用（安全项）
- ✅ epoch-2025_2026-philosophy-gate：2025-2026 反内卷/地缘：哲学分权 0.6→0.54，乘数×0.92（最差时代）
- ✅ precious-priced-in-soften：贵金属 priced_in 卖事实略软化（0.7→0.85），避免 FOMC 落地后过度翻空
- ✅ oil-gold-decouple-post-2026：2026-01-28 后油金脱钩：inflation_oil_drag 压制系数 1.0→0.35

### 待用户确认
- ⏳ inst-wr：单品种阈值/流动性标记需人工确认，不自动改写
- ⏳ matrix-supplyStrong×loose：矩阵格观望规则或主矛盾阈值需哲学层单独验证
- ⏳ inst-ao：单品种阈值/流动性标记需人工确认，不自动改写

### 已确认策略（用户决策）
- **AU priced_in era_split**：2019–2024 时代可强 flip 偏空（卖事实）；2025_2026 仅观望 neutral、不翻空。实现见 `commodity-outlook-philosophy.js` → `assessMacroFedPricedIn`（2025_2026 `directionFlip=neutral`）+ `skipPmPricedIn`（2023_2024/2025_2026 跳过 PM 卖事实乘数）。
- **75% KPI 核心流动性**：计分排除 pt/pd/wr（walk-forward 仍保留），报告 `coreOverall%` / `corePrecious%`。
- **KPI 目标 sector_balanced**：六板块各 ≥70%，longrun 输出 per-sector gap。

---
*反测 → 找原因 → 调整；避免一套逻辑用到底。*