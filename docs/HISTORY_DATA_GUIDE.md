# 梵澄金融 — 历史数据获取指南 (v1.28)

> 一键命令：`node scripts/fetch-all-history-data.js`  
> 缓存根目录：`E:\FanchengFinance\data\`（E 盘 `FanchengFinance/data`）

---

## 自动获取（无需 API Key）

| 数据 | 来源 | 缓存路径 | 2019+ 用途 |
|------|------|----------|------------|
| 联邦基金利率 DFF | FRED 公开 CSV | `history/fred-dff-daily.json` | 哲学层金融环境 |
| VIX | FRED CSV | `history/fred-vixcls-daily.json` | 风险偏好评分 |
| 10年实际利率 | FRED `REAINTRATREARAT10Y` | `history/fred-real10y-daily.json` | 紧缩/宽松判断 |
| M2 货币供应 | FRED `M2SL` 月频→日频前填 | `history/fred-m2sl-monthly.json` | M2 YoY 代理 |
| 广义美元指数 | FRED `DTWEXBGS` | `history/fred-dxy-daily.json` | DXY 日变化 |
| 国内 74 期货日 K | 新浪 / 东方财富 | `klines/commodity-{id}-day.json` | walk-forward 价格 |
| 国内期货持仓 OI | 东方财富期货主连 API | K 线 `openInterest` + `history/oi/{id}.json` | 资金/库存因子 |
| 国际主要指数日 K | 东方财富 / Stooq | `klines/index-{id}-day.json` | 宏观 risk-on/off |
| 宏观时代事件 | 内置日历 | `commodity-outlook-event-calendar.js` | 2019+ 分段权重 |

**东方财富期货 secid 格式**（v1.28 修正）：`113.CUM`（主连），非旧版 `113.cu888`。  
**OI 字段**：K 线 CSV 第 13 列（`f63`），写入每根 K 线的 `openInterest`。

**GitHub 备用**（Eastmoney 缺口时）：  
`https://raw.githubusercontent.com/commodity-exchange-zh/commodity-exchange-zh/main/data/{year}/{id}.csv`

---

## 可选增强（需您配置）

| 服务 | 是否必须 | 获取方式 | 配置 |
|------|----------|----------|------|
| FRED CSV | 否（已实现） | 免费直链 | 自动 |
| FRED API | 可选 | [fred.stlouisfed.org](https://fred.stlouisfed.org/) 注册 API Key | `FRED_API_KEY` 环境变量或 userData `config.json` → `fredApiKey` |
| Stooq | 可选 | [stooq.com](https://stooq.com/) API Key | `STOOQ_API_KEY` |
| Tushare | 可选 | [tushare.pro](https://tushare.pro/) 积分 | `TUSHARE_TOKEN`（**未接入运行时**，可 side script） |
| AKShare | 不适用 | Python 专用 | 仅可选 side script，**应用内不依赖 Python** |

---

## 仍需您协助（无法自动爬全）

| 数据 | 说明 | 建议路径 |
|------|------|----------|
| **按日标注新闻/政策** | walk-forward 新闻冲击仍为 0；方向误判主因 | `data/history/news-tagged.csv` |
| 中国 PMI / 社融月频 | 黑色/化工板块宏观权重 | `data/history/china-macro-monthly.csv` |
| LME/COMEX 库存周频 | 有色 inventory 因子 | `data/history/inventory/` |
| 印尼出口政策事件日 | 镍/锡/棕榈 | `data/history/events/indonesia-export.csv` |
| 主产区天气日度 | 农产品 weather 权重 | `data/history/weather/` |

### 新闻 CSV 格式示例

```csv
date,title,commodity_tags,direction,source_tier
2019-05-10,发改委调控煤价,zc;energy,bearish,policy
```

---

## 脚本说明

| 命令 | 作用 |
|------|------|
| `npm run fetch-all-history` | FRED + 国际指数 + OI 一键拉取 |
| `npm run backfill-klines-2019` | 仅回填 74 品种日 K |
| `npm run backfill-commodity-oi` | 仅回填 OI（含 GitHub 备用） |
| `node scripts/tune-sector-weights-longrun.js` | 长周期回测 + 板块命中率 |

拉取摘要写入：`data/history/fetch-summary.json`

---

## 回测数据流 (v1.28)

```
fetch-all-history-data.js
  → history/fred-*.json
  → klines/commodity-*-day.json (+ openInterest)
  → klines/index-*-day.json
       ↓
commodity-outlook-historical-context.js  (DFF/VIX/M2/DXY @ date T)
commodity-technical-analyzer.js          (OI delta @ date T)
commodity-outlook-backtest.js            (walk-forward 2019+)
```

---

## 诚实预期

补齐 FRED + OI + 指数后，长周期整体命中率预计从 **~46.7%** 提升 **约 2–6pp**（板块不一）。  
**70%** 目标仍依赖按日新闻/政策标注（上表「仍需您协助」第一项）。

详见：`docs/DATA_NEEDED_FOR_70_HITRATE.md`
