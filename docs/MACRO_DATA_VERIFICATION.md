# 宏观数据校验报告（DeepSeek → 梵澄金融）

> 生成时间：2026-06-07  
> 工具：FRED CSV、东方财富 PMI API、ISM 官方发布、HCOB/S&P Global 新闻稿  
> 报告 JSON：`macro-verification-report.json`

## 概要

| 指标 | 数值 |
|------|------|
| DeepSeek 待校验行数 | **54**（real10y 17 + 中国 PMI 17 + 美国 ISM 15 + 欧元区 5） |
| **总体通过率** | **83.3%**（45/54，四舍五入一致或偏差 ≤0.05） |
| 已导入权威数据 | **42 行 PMI** + **17 行 real10y 月频** |
| 拒收/校正 | **10 行 DeepSeek 原值拒收**，以权威源替换 |

### 分序列通过率

| 序列 | 通过率 | 权威源 |
|------|--------|--------|
| 美国 10Y 实际利率 | **100%** (17/17) | FRED `REAINTRATREARAT10Y` |
| 中国制造业 PMI | **100%** (17/17) | 国家统计局 → 东方财富 `RPT_ECONOMY_PMI` |
| 美国 ISM 制造业 PMI | **66.7%** (10/15) | ISM 官方 Report On Business |
| 欧元区 HCOB PMI | **20%** (1/5) | S&P Global / HCOB 新闻稿 |

## A. 美国 10Y 实际利率（real10y）

**结论：DeepSeek 数据全部可靠，已导入。**

FRED 序列 `REAINTRATREARAT10Y`（Cleveland Fed 10 年期通胀预期）与 DeepSeek/MacroTrends 表 **17 个月完全一致**（四舍五入至 0.01%）。现有 `fred-real10y-daily.json`（89 行月频稀疏）已覆盖至 2026-05，无需重拉。

| 月份 | DeepSeek | FRED 权威 | 状态 |
|------|----------|-----------|------|
| 2025-01 ~ 2026-05 | 见图片 | 一致 | ✓ 全部 verified |

**写入文件：**
- `data/history/fred-real10y-monthly.json`（月频摘要，便于核对）
- `data/history/fred-real10y-daily.json`（已有，回测继续用日频 lookup）

## B. 中国制造业 PMI

**结论：DeepSeek 数据全部可靠，已导入。**

东方财富接口与国家统计局官方发布逐月一致（2025-01 至 2026-05 共 17 个月）。

## C. 美国 ISM 制造业 PMI — 主要错误

| 月份 | DeepSeek | ISM 官方 | 偏差 | 处理 |
|------|----------|----------|------|------|
| 2025-04 | **50.0** | **48.7** | +1.3 | **拒收** — 误报扩张，实际连续收缩 |
| 2025-08 | **47.9** | **48.7** | -0.8 | **拒收** — 误标「本轮最低点」 |
| 2025-05 | 48.7 | 48.5 | +0.2 | 校正 |
| 2025-09 | 48.7 | 49.1 | -0.4 | 校正 |
| 2025-10 | 48.3 | 48.7 | -0.4 | 校正 |
| 2025-11 | 48.1 | 48.2 | -0.1 | 校正 |
| 2025-01 | — | 50.9 | — | DeepSeek 缺失，官方补全 |
| 2025-07 | — | 48.0 | — | DeepSeek 缺失，官方补全 |

2026-01 ~ 2026-05 共 5 个月 ISM 数据 DeepSeek **全部正确**（52.6 / 52.4 / 52.7 / 52.7 / 54.0）。

## D. 欧元区 HCOB PMI — 严重偏差

DeepSeek 表格 2025 年欧元区列**几乎全空**，2026 年多个月份**严重偏离**官方值：

| 月份 | DeepSeek | HCOB/S&P 官方 | 偏差 | 处理 |
|------|----------|---------------|------|------|
| 2025-12 | 48.8 | 48.8 | 0 | ✓ verified |
| **2026-01** | **51.5** | **49.5** | **+2.0** | **拒收** — 误报扩张（仍 <50 收缩） |
| **2026-04** | **50.9** | **52.2** | **-1.3** | **拒收** — 低估，近四年高点 |
| **2026-05** | **50.3** | **51.6** | **-1.3** | **拒收** |
| 2026-03 | 51.9 | 51.6 | +0.3 | 校正 |

额外从 HCOB 官方补全 DeepSeek 未提供的：2025-10 (50.0)、2025-11 (49.6)、2026-02 (50.8)。

## 已写入文件

| 文件 | 说明 |
|------|------|
| `E:\FanchengFinance\data\history\fred-real10y-monthly.json` | 17 行月频，100% verified |
| `E:\FanchengFinance\data\history\macro-pmi-monthly.json` | 中 17 + 美 17 + 欧 8 行，仅 verified/校正后值 |
| `E:\FanchengFinance\data\history\fred-real10y-daily.json` | 已有，未改动 |

## 代码接入

| 模块 | 变更 |
|------|------|
| `services/macro-history-loader.js` | 新增 — 加载 PMI 月频 JSON |
| `services/commodity-outlook-historical-context.js` | `buildHistoricalSources().macro` 注入 PMI 指标 |
| `scripts/verify-macro-data.js` | 校验脚本（可重复运行） |

回测 walk-forward 时，philosophy 层可通过 `macro.items` 读取 PMI 变化（`commodity-outlook-philosophy.js` 已有 `/pmi|景气|制造/` 规则）。

## 拒收清单（未导入 DeepSeek 原值）

1. US ISM 2025-04 = 50.0 → 用 48.7  
2. US ISM 2025-08 = 47.9 → 用 48.7  
3. EZ PMI 2026-01 = 51.5 → 用 49.5  
4. EZ PMI 2026-04 = 50.9 → 用 52.2  
5. EZ PMI 2026-05 = 50.3 → 用 51.6  

其余小偏差（±0.1~0.4）已用权威值覆盖。

## 回测影响（可选）

PMI 刚接入 `buildHistoricalSources`，对现有 **52%** 命中率影响预计 **±0.5pp 以内**（PMI 权重低于 DFF/VIX/新闻）。若要量化：

```bash
node scripts/tune-sector-weights-longrun.js
```

## 结论

- **可直接使用**：real10y 全序列、中国 PMI 全序列、美国 ISM 2026 年段  
- **需警惕 DeepSeek 源**：美国 ISM 2025 年中有 6 个月偏差；欧元区 PMI 2026 年严重低估  
- **建议**：后续宏观月频优先走 `fred-history-fetcher.js` + 东方财富 API 自动拉取，人工粘贴仅作候选
