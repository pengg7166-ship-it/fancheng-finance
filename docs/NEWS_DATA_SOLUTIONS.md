# 按日新闻数据 — 四套方案（回测用）

> 目标：为 2019+ 长周期 walk-forward 回测提供 **按日标注新闻/政策**，弥补当前「新闻冲击 = 0」的方向误判。  
> 数据文件：`E:\FanchengFinance\data\history\news-tagged.csv`（与仓库 `data/history/news-tagged.csv` 同步）

---

## 快速开始（今晚就能跑）

```bash
# 1. 生成种子新闻（约 50+ 条重大事件 + FOMC 决议日）
node scripts/seed-news-from-events.js --force

# 2. （可选）导出桌面版近期缓存头条
node scripts/export-news-from-cache.js

# 3. 合并您手工补充的 CSV
node scripts/merge-user-news-csv.js 您的补充.csv

# 4. 重跑长周期回测
node scripts/tune-sector-weights-longrun.js
```

回测引擎会自动读取 `news-tagged.csv`；摘要里会显示 `newsTagged: N rows from news-tagged.csv`。

---

## CSV 格式

| 列名 | 说明 | 示例 |
|------|------|------|
| `date` | 发布/生效日 YYYY-MM-DD | `2022-02-24` |
| `title` | 标题（简短） | `俄罗斯对乌克兰发动特别军事行动` |
| `commodity_tags` | 关联合约，分号分隔 | `sc;fu;c;m` |
| `direction` | `bullish` / `bearish` / `neutral` | `bullish` |
| `stars` | 重要度 1–5 | `5` |
| `source_tier` | `policy` / `geo` / `climate` / `commodity` / `macro` | `geo` |
| `event_id` | 可选，便于去重 | `ru_ukraine_invade` |
| `notes` | 备注 | `能源/粮食供应冲击` |

模板文件：`data/history/news-tagged.template.csv`

**不必每天一条**：8 年约 **200–400 个重大事件日** 即可显著改善命中率；普通交易日可留空。

---

## Tier A — 零成本·程序自动生成（今晚就能用）

### 已有缓存

桌面版刷新后，以下 JSON 在 `FanchengFinance/data/cache/`（或 `userData/cache/`）：

| 文件 | 内容 |
|------|------|
| `policy-radar.json` | 中美政策雷达 |
| `geopolitics-radar.json` | 地缘情报 |
| `climate-radar.json` | 气候/灾害 |
| `news-fast.json` / `news-global.json` | 商品快讯 |

### 脚本

| 命令 | 作用 |
|------|------|
| `node scripts/export-news-from-cache.js` | 把缓存头条导出为 CSV 起步文件 |
| `node scripts/seed-news-from-events.js --force` | 从 `HISTORICAL_EVENTS` + 关键日生成种子 |

种子已包含（可扩展）：

- **2020-03** COVID 冲击、Fed 零利率、负油价  
- **2022-02** 俄乌冲突  
- **2022–2023** Fed 加息周期（FOMC 决议日）  
- **2025** 反内卷政策  
- **2016** 供给侧改革  
- **2020 / 2022** 印尼镍出口管制  

约 **50+ 行**，可直接进回测；精度随您补充而提升。

---

## Tier B — 半自动·公开源抓取（无需付费 API）

| 来源 | 说明 | 历史深度 |
|------|------|----------|
| 新华社 / 人民网 RSS | 已在 `policy-sources.js` | 通常 **30–90 天** |
| 东方财富 / 新浪 | 页面滚动，非完整归档 | 近期为主 |
| FRED / Fed 官网 | FOMC 决议日 | 2019+ 完整（已写入种子） |
| 维基 / 央行年报 | 重大事件时间表 | 需手工复制几行到 CSV |

```bash
node scripts/backfill-news-headlines.js --days 90        # 抓取近 90 天
node scripts/backfill-news-headlines.js --days 90 --merge  # 抓取并合并
```

**诚实限制**：免费 RSS 几乎无法覆盖 8 年逐日头条；Tier B 适合「补最近几个月」，8 年靠 Tier A 种子 + Tier C 手工。

---

## Tier C — 用户手工补关键日（推荐配合 8 年交易数据）

### 工作流

1. 用 Excel 打开 `data/history/news-tagged.template.csv` 或种子 CSV  
2. **只标注您记得或查得到的重大日**（政策、地缘、供需突变）  
3. 另存为新 CSV，运行 `merge-user-news-csv.js` 合并  

### 示例行（可直接复制）

```csv
date,title,commodity_tags,direction,stars,source_tier,event_id,notes
2020-03-09,全球疫情恐慌原油暴跌,sc;fu,bearish,5,geo,covid_crash,
2022-02-24,俄乌冲突爆发,sc;fu;c;m,bullish,5,geo,ru_ukraine,
2025-07-01,中央反内卷政策表述,FG;ps;jm,bullish,4,policy,anti_involution,
2016-02-04,钢铁去产能意见发布,rb;i;jm,bullish,4,policy,supply_side_2016,
2020-01-01,印尼镍矿出口禁令,ni,bullish,5,policy,indonesia_nickel_2020,
```

### Excel 提示

- 日期列设为「文本」或 `YYYY-MM-DD`，避免变成 `2020/3/9`  
- `commodity_tags` 用英文合约代码：`cu` 铜、`sc` 原油、`FG` 玻璃、`ni` 镍  
- 方向拿不准可先填 `neutral`，stars 仍可提高（表示「重要但方向未定」）

---

## Tier D — 付费 / 积分（可选）

| 服务 | 优点 | 成本 / 门槛 |
|------|------|-------------|
| **Tushare** `news` 接口 | A 股/宏观新闻结构化 | 需积分；历史深度因接口而异 |
| **Wind / 同花顺 iFinD** | 期货资讯全、可导出 | 机构年费，个人难负担 |
| **彭博 / Refinitiv** | 全球覆盖最好 | 昂贵 |

**性价比建议**：先用 Tier A+C（种子 + 200 个关键日）跑一版回测，看板块 gap；若某板块仍差再考虑 Tushare 补该板块新闻。**70% 命中率更依赖标注质量而非新闻条数。**

---

## 与回测的关系

```
news-tagged.csv
       ↓
news-tagged-loader.js  →  scoreNewsForInstrumentAtDate()
       ↓
commodity-outlook-backtest.js  (predictAtBarIndexHistorical)
       ↓
longrun-2019-summary.json  →  dataSources.newsTagged
```

新闻冲击会进入：哲学层、自适应层、因子分解、次日区间预测。

---

## 常见问题

**Q：必须 8 年每天一条吗？**  
A：不需要。重大事件日 + FOMC/政策日足够；其余日引擎仍用 FRED、OI、K 线技术因子。

**Q：文件放哪？**  
A：运行时优先 `E:\FanchengFinance\data\history\news-tagged.csv`；仓库内 `data/history/` 为版本管理副本，合并脚本写运行时路径。

**Q：和 `HISTORICAL_EVENTS` 重复吗？**  
A：事件日历管 **权重乘数**；新闻 CSV 管 **方向冲击**。两者互补，种子脚本已从日历生成起步行。

---

更多历史数据说明见 `docs/HISTORY_DATA_GUIDE.md`；8 年交易数据导入见 `docs/TRADING_DATA_IMPORT.md`。
