# 更新日志

## v1.28.2 — 2026-06-06

### 新闻标注历史校验

- **`services/news-history-verifier.js`** + **`scripts/verify-news-tagged.js`**：对照 Fed/OPEC/印尼政策/巴以冲突等公开史料校正 `news-tagged.csv` 日期与标签
- 输出 `data/history/news-verification-report.json`；详见 `docs/NEWS_VERIFICATION.md`
- 命令：`npm run verify-news`

---

## v1.28.1 — 2026-06-06

### 新增：期货 tick zip → 日 K 转换管线

- **`scripts/convert-tick-zips-to-daily.js`**：扫描百度网盘 `future_price*` zip，流式解析 TSV tick，按品种主力聚合 OHLCV+OI
- 映射 74 商品品种（跳过股指/国债），断点续跑，自动同步至 klines 缓存
- 命令：`npm run convert-tick-zips`；文档见 `docs/TRADING_DATA_IMPORT.md`

---

## v1.28.0 — 2026-06-05

### 升级：2019+ 历史数据全面回填 + 回测精度

- **FRED 宏观**：`fred-history-fetcher.js` 自动拉取 DFF/VIX/10Y实际利率/M2/广义美元指数 → `data/history/`
- **期货 OI**：修正东方财富主连 secid（`113.CUM` 等），74 品种 2019+ 持仓量写入 K 线 `openInterest`
- **国际指数**：`fetch-all-history-data.js` 拉取 SP500/道指/纳指/日经/恒指/FTSE/DAX/上证等日 K
- **回测/哲学层**：walk-forward 使用 date T 真实 DFF/VIX/M2/DXY + 历史 OI delta
- **文档**：`docs/HISTORY_DATA_GUIDE.md`（自动 vs 需用户提供）
- 一键命令：`npm run fetch-all-history`

---
