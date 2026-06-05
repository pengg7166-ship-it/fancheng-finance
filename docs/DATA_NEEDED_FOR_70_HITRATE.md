# 大宗走势研判 70% 命中率 — 数据需求清单

> 当前 v1.27.0 长周期 walk-forward（2019→今）整体方向命中率约 **46–50%**，距 **70%** 目标仍有约 **20pp** 差距。以下数据按优先级排列；提供后可粘贴 CSV 或 API，路径见各节「存放位置」。

## P0 — 立即需要（预期 +8~15pp）

### 1. 74 合约历史日度持仓量（OI）2019+

| 字段 | 说明 |
|------|------|
| `date` | YYYY-MM-DD |
| `instrument_id` | 合约代码，如 `cu`, `rb`, `sc` |
| `open_interest` | 日末持仓量（手） |
| `oi_change` | 可选，日增减 |

**存放**: `E:\FanchengFinance\data\oi\daily-{id}.csv` 或合并 `oi-all-2019.csv`

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

**存放**: `data/fred/fred-{id}-daily.json`（与现有 `fred-dff-cache` 格式一致：`[{date,value}]`）

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

在补齐 P0 三项前，**纯参数优化难以稳定达到 70%**；v1.27 板块分权可将各板块命中率提升约 **2–5pp**，整体仍预计在 **48–55%** 区间。
