# 大宗走势研判 70% 命中率 — 数据需求清单

> 当前 v1.28.0 已实现 FRED 宏观 + 期货 OI + 国际指数自动回填；长周期 walk-forward（2019→今）整体方向命中率约 **46–52%**（OI/FRED 补齐后待重跑），距 **70%** 目标仍有约 **18–23pp** 差距。完整获取说明见 **`docs/HISTORY_DATA_GUIDE.md`**。

## 需您提供的 API / 数据

| 服务 | 是否必须 | 获取方式 | 配置 |
|------|----------|----------|------|
| FRED CSV | 否（已实现） | 免费直链 | 自动 |
| FRED API | 可选 | fred.stlouisfed.org 注册 | `FRED_API_KEY` in userData 或 `.env` |
| Stooq | 可选 | stooq.com | `STOOQ_API_KEY` |
| Tushare | 可选增强 | tushare.pro 积分 | `TUSHARE_TOKEN`（运行时未接入） |
| AKShare | 不适用 | Python only | 可选 side script |
| **新闻按日标注** | **扩表进行中** | 自动 pipeline + 用户 CSV | `data/history/news-tagged.csv` · `scripts/expand-news-tagged.js` |

**Experiment #3（2026-06-15）**：989→**2377** 行（2019+）· 仓单+快讯 backfill · 见 `docs/PROJECT_RECOVERY_STATUS.md` Experiment #3 节。KPI 需重训后验证；日常 `npm run expand-news-tagged -- --skip-warehouse`。

**Experiment #2（2026-06-15）**：SLV 1873 行 grid 重训 AG head · gate ❌ · 维持 v1.34.8 · 见 `PROJECT_RECOVERY_STATUS.md` Experiment #2 节 · `scripts/train-slv-ag-grid.js`。

---

## P0 — 立即需要（预期 +8~15pp）

### 1. 74 合约历史日度持仓量（OI）2019+

| 字段 | 说明 |
|------|------|
| `date` | YYYY-MM-DD |
| `instrument_id` | 合约代码，如 `cu`, `rb`, `sc` |
| `open_interest` | 日末持仓量（手） |
| `oi_change` | 可选，日增减 |

**存放**: `E:\FanchengFinance\data\history\oi\{id}.json` 或 K 线内 `openInterest` 字段（v1.28 自动回填）

**用途**: 黑色/有色/能化库存-OI 因子、资金情绪校验；当前回测 OI 多来自 K 线附带字段，覆盖不全。

### 2. 按日标注的新闻/政策情报

| 字段 | 说明 |
|------|------|
| `date` | 发布日期 |
| `title`, `summary` | 标题与摘要 |
| `commodity_tags` | 关联合约或板块，如 `sc,energy` |
| `direction` | `bullish` / `bearish` / `neutral` |
| `source_tier` | `policy` / `geo` / `climate` / `commodity` |

**存放**: `data/intel/daily-{YYYY-MM}.json` 或 CSV

**用途**:  walk-forward 回测目前新闻冲击为 0；历史政策/地缘/气候是方向误判主因之一。

### 3. FRED 日频宏观全序列 2019+

| 序列 ID | 说明 |
|---------|------|
| `DFF` | 联邦基金利率 |
| `VIXCLS` | VIX |
| `M2SL` | M2 |
| `DFII10` 或 `T10YIE` | 实际利率/通胀预期 |
| `DTWEXBGS` | 广义美元指数（可选） |

**存放**: `data/history/fred-{id}-*.json`（v1.28 `fred-history-fetcher.js` 自动拉取）

---

## P1 — 高价值（预期 +5~10pp）

### 4. 中国 PMI / 社融 月频 2019+

| 字段 | 说明 |
|------|------|
| `month` | YYYY-MM |
| `pmi_manufacturing` | 制造业 PMI |
| `social_financing` | 社融增量（亿元） |
| `m2_yoy` | M2 同比（可选） |

**存放**: `data/china-macro/monthly.csv`

**用途**: 黑色/化工/有色「中国宏观+政策」板块权重核心输入。

### 5. LME / COMEX 库存周频

| 字段 | 说明 |
|------|------|
| `week_ending` | 周五日期 |
| `metal` | `copper`, `aluminum`, `zinc`, `nickel`… |
| `inventory_tonnes` | 库存吨数 |
| `change_wow` | 周变化 |

**存放**: `data/inventory/lme-weekly.csv`, `data/inventory/comex-weekly.csv`

### 6. 印尼出口政策事件日

| 字段 | 说明 |
|------|------|
| `date` | 政策生效/宣布日 |
| `commodity` | `ni`, `sn`, `p`, `coal`… |
| `policy_type` | `export_ban`, `quota`, `tax` |
| `direction` | 对价格方向 |

**存放**: `data/events/indonesia-export.csv`

---

## P2 — 增强项

### 7. 主产区天气日度/周度

- 字段：`date`, `region`, `temp_anomaly`, `precip_anomaly`, `drought_index`
- 存放：`data/weather/china-agri-daily.csv`
- 用途：农产品板块 `weather` / `macroClimate` 权重（目标 dominant）

### 8. 港口铁矿石/煤炭库存周频

- 字段：`date`, `port`, `commodity`, `inventory_mt`
- 用途：黑色 `inventory` 因子

### 9. 按月经纪板块命中率（用于 regime 过滤）

- 字段：`month`, `sector`, `hit_rate`, `sample_n`
- 用途：v1.27 regime 过滤目前用时代整体近似，需真实月度序列

---

## CSV 粘贴格式示例

```csv
date,instrument_id,open_interest
2019-01-02,cu,412580
2019-01-02,rb,2984410
```

```csv
date,title,commodity_tags,direction,source_tier
2019-05-10,发改委调控煤价,zc;energy,bearish,policy
```

---

## 提供方式

1. **CSV 文件**: 放入上表路径，重启应用或运行 `node scripts/ingest-user-data.js`（待实现）
2. **API**: 提供 endpoint + 字段映射说明
3. **聊天粘贴**: 小样本可直接粘贴，注明合约与日期范围

---

## 当前瓶颈（诚实说明）

| 瓶颈 | 影响 |
|------|------|
| 回测无历史新闻/政策 | 哲学层与资讯冲击在 walk-forward 中为 0 |
| OI/库存数据稀疏 | 黑色/有色 inventory 因子弱 |
| 宏观仅 DFF/VIX 分段 | Fed/USD/中国宏观时变精度不足 |
| 方向标签阈值 | 提高阈值升命中率但减少有效样本 |

在补齐 **新闻按日标注** 前，**纯参数优化难以稳定达到 70%**；v1.28 FRED/OI/指数回填可将整体命中率提升约 **2–6pp**，各板块约 **+1–4pp**。

### 贵金属 tradable-day 实测（2026-06-15 · v1.34.8 · E 盘 fresh）

- au+ag OOS T+3：**61.15%**（296 scored）· 较 2026-06-13 基线 **64.16%**（226）**−3.01pp**
- 主瓶颈：**AG basis regime 53.04%**（115 scored · **54 miss**）· OI proxy 标签占 basis 日 **84%**（247/296）
- **Experiment #1 audit**：oi_proxy 50.56% vs term 61.54%；strict 规则 au+ag **+3.5pp**（64.65%）但 basis n=26 gate ❌ → 见 `docs/PROJECT_RECOVERY_STATUS.md`
- 阈值/A5/strict 实验未 gate-pass → 维持生产权重；见 `docs/PROJECT_RECOVERY_STATUS.md` Tradable-day KPI 节
