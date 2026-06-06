# 新闻标注历史校验报告

> 生成时间：2026-06-06  
> 工具：`node scripts/merge-all-user-news-final.js` + `services/news-history-verifier.js`  
> 输出：`E:\FanchengFinance\data\history\news-tagged.csv`  
> 报告 JSON：`E:\FanchengFinance\data\history\news-verification-report.json`

## 概要（Batch 1–6  canonical 合并）

| 指标 | 数量 |
|------|------|
| 种子行 (seeds) | 58 |
| Batch1 import | 119 |
| Batch2 | 35（与 batch1 重叠，净增 0） |
| Batch3 | 46（净增 45） |
| Batch4 | 17（净增 17） |
| Batch5 | 24（净增 23） |
| Batch6 | 32（净增 32） |
| 合并后（校验前） | 293 |
| **最终行数（校验后）** | **289** |
| Levenshtein/同日落去重 | 1 |
| 校验删除 | 5 |
| 校验修正 | 34 |

## Batch6 专项处理

| 处理项 | 说明 |
|--------|------|
| `2026-03-06-10` → `2026-03-10` | 布伦特峰值窗口，与氨价跳涨同日 |
| `2026-03-17` FOMC → `2026-03-18` | FOMC 2026-03-18/19，声明日 3-18 |
| 山西沁源 2026-05-22 | batch5/6 合并为 **1 行** |
| 美伊升级链 | 保留 2026-02-28 / 03-01 / batch5-03-08 / 03-18 全品种上移 |
| 2026-06-16 Fed | 保留 3 行（FOMC 按兵不动 + CME 降息归零 + 加息概率 38%） |
| 标签 | LPG→pg，W/XT 无合约已剔除（国储行 notes 保留） |
| 哈梅内伊身亡 | 保留 geo 事件，notes 标注 **待核实** |
| Gold $4500 | 保留用户 notes，标注 **用户情景价/待核实** |

## 日期修正（batch4/5/6 样本）

| 原标题 | 原日期 | 修正日期 | 依据 |
|--------|--------|----------|------|
| 布伦特原油冲高至108美元 | 2026-03-06-10 | **2026-03-10** | 用户指定 Brent 峰值窗口 |
| 美联储3月FOMC维持利率不变 | 2026-03-17 | **2026-03-18** | FOMC Mar 18–19 2026 |
| 红海危机爆发 | 2023-12-14 | **2023-12-15** | 胡塞首次重大袭击约 12-15 |
| 远兴能源纯碱一线投产 | 2023-08-01 | **2023-06-28** | 一线投产日更准确 |
| 美联储年内最后一次降息 | 2025-12-12 | **2025-12-18** | FOMC 声明日 |
| 美联储12月第三次降息 (batch4) | 2025-12-01 | **2025-12-18** | 同上 |

## 删除/合并行（未静默删除）

| 标题 | 日期 | 操作 | 原因 |
|------|------|------|------|
| 山西沁源煤矿瓦斯爆炸事故 | 2026-05-22 | **合并** | 与「事故调查升级」同日落，合并 notes |
| 反内卷政策预期 | 2025-07-15 | **删除** | 与 2025-07-01 财经委重复 |
| 2026-01-23 对外开放 (batch4×4) | 2026-01-23 | **合并** | 四条重复 → 单行 LC;NI;PF;PR;PX;NR;LU;BC;TA |
| 碳酸锂减产联盟成立 (batch4) | 2025-01-01 | **跳过** | batch2 已有 2025-07-15 |

##  sensational / 待核实 claims（保留于 CSV）

| 事件 | 处理 |
|------|------|
| 哈梅内伊遇袭身亡 (2026-02-28) | 保留 bullish geo；notes 加「待核实」 |
| 现货黄金突破 $4500 (2025-12-24) | 保留；notes 注明用户情景价 vs 现货 ~2650 量级 |
| 金价跌破 $4500 (2026-06-03) | 保留 bearish；notes 加「待核实」 |

## 长周期回测

- **合并前基线**：overall **47.0%**（19515/41495）
- **合并后回测**：289 行 news 已写入；全量 walk-forward 已启动（74 品种，耗时数小时）；完成前命中率暂按基线 **47%** 计

## 复现

```bash
# 1. 保存 batch6 并 canonical 合并
FANCHENG_HISTORY_DIR=E:\FanchengFinance\data\history node scripts/merge-all-user-news-final.js

# 2. 单独校验
npm run verify-news

# 3. 长周期回测
FANCHENG_DATA_DRIVE=E node scripts/tune-sector-weights-longrun.js
```

## 历史批次（batch1–5 摘要）

见上文表格。Batch1=`user-news-import.csv`，Batch2–6=`user-news-batch{N}.csv`，均位于 `E:\FanchengFinance\data\history\`。
