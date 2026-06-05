# 8 年交易数据 — 今晚导入指南

> 您提供的 8 年期货/商品交易数据将与现有 K 线、FRED 宏观、OI 持仓一起用于长周期回测验证。

---

## 三步清单（今晚）

| 步骤 | 您做什么 | 我们做什么 |
|------|----------|------------|
| **1** | 把 CSV/Excel 另存为 **UTF-8 CSV**，放到任意目录 | — |
| **2** | 运行导入命令（见下） | 校验列、按合约写入 `history/trading/` |
| **3** | （可选）发文件名 + 合约列表说明 | 对照 `INSTRUMENT_REGISTRY` 74 品种查缺 |

新闻标注并行进行：见 `docs/NEWS_DATA_SOLUTIONS.md`（种子已自动生成 ~50 条，您 later 补 200 个关键日即可）。

---

## 期望文件格式

### 必需列

| 列名 | 别名（任一种） | 说明 |
|------|----------------|------|
| `date` | `trade_date`, `datetime` | 交易日 `YYYY-MM-DD` |
| `instrument` | `instrument_id`, `symbol`, `code` | 合约代码，如 `cu`, `rb`, `sc` |
| `price` | `close`, `settle`, `close_price` | 收盘价或结算价 |

### 可选列

| 列名 | 别名 | 说明 |
|------|------|------|
| `volume` | `vol` | 成交量（手） |
| `oi` | `open_interest`, `hold` | 持仓量 |

### 示例

```csv
date,instrument,price,volume,oi
2018-01-02,cu,52800,123456,89012
2018-01-03,cu,53100,98765,90123
2018-01-02,rb,3450,456789,1203456
```

### 单合约文件

若整个文件只有一个品种，可省略 `instrument` 列：

```bash
node scripts/import-trading-data.js 沪铜8年.csv --instrument cu
```

---

## 导入命令

```bash
cd E:\FanchengFinance\source\fancheng-finance

# 预览（不写盘）
node scripts/import-trading-data.js "D:\您的路径\trading-8y.csv" --dry-run

# 正式导入
node scripts/import-trading-data.js "D:\您的路径\trading-8y.csv"
```

### 输出位置

```
E:\FanchengFinance\data\history\trading\
  cu.json
  rb.json
  sc.json
  ...
```

每个 JSON 结构：

```json
{
  "instrumentId": "cu",
  "source": "trading-8y.csv",
  "importedAt": "2026-06-05T...",
  "rowCount": 1950,
  "from": "2018-01-02",
  "to": "2025-12-31",
  "series": [
    { "date": "2018-01-02", "price": 52800, "volume": 123456, "openInterest": 89012 }
  ]
}
```

---

## Excel 导出注意

1. **另存为 CSV UTF-8**（Excel：文件 → 另存为 → CSV UTF-8）  
2. 日期列保持 `2018-01-02` 格式，不要 `2018/1/2`  
3. 数字不要带千分位逗号（`52,800` 会导入失败）  
4. 表头第一行必须是列名  

---

## 与现有数据的关系

| 数据 | 现有来源 | 您的文件 |
|------|----------|----------|
| 日 K 线 | `npm run backfill-klines-2019` | 可交叉验证价格 |
| OI | `npm run backfill-commodity-oi` | 若您的 CSV 含 `oi` 可补充 |
| FRED 宏观 | `npm run fetch-all-history` | 无需重复提供 |
| 新闻 | `news-tagged.csv` | 见 NEWS_DATA_SOLUTIONS.md |

导入后建议：

```bash
npm run fetch-all-history          # 若尚未拉全宏观/K线
node scripts/seed-news-from-events.js --force
node scripts/tune-sector-weights-longrun.js
```

---

## 支持的合约代码

与 app 内 74 品种一致，常用示例：

| 代码 | 品种 | 板块 |
|------|------|------|
| `cu` | 沪铜 | 有色 |
| `rb` | 螺纹钢 | 黑色 |
| `sc` | 原油 | 能化 |
| `au` | 沪金 | 贵金属 |
| `FG` | 玻璃 | 化工 |
| `ni` | 沪镍 | 有色 |
| `lc` | 碳酸锂 | 新能源 |

完整列表见 `services/commodities-catalog.js` 或 app「大宗走势」页。

---

## 常见问题

**Q：JSON 可以吗？**  
A：可以。数组或 `{ "series": [...] }` 均可，字段名同 CSV。

**Q：8 年是从 2018 还是 2019？**  
A：都支持；长周期回测默认从 `2019-01-01`（`LONG_RUN_START`）起算，更早数据用于预热指标。

**Q：导入失败？**  
A：加 `--dry-run` 看校验错误；常见原因是日期格式、缺少 `instrument`、价格为非数字。

---

有问题可把 CSV **前 20 行**（脱敏）和 `--dry-run` 输出发给我们对照列映射。
