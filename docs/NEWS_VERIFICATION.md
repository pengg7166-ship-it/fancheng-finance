# 新闻标注历史校验报告（Batch5 合并）

> 生成时间：2026-06-06  
> 工具：`node scripts/import-batch5-news.js` → `services/news-history-verifier.js`  
> 权威语料：`D:\FanchengFinance\data\history\news-tagged.csv`（已同步至 `E:\FanchengFinance\data\history\`）  
> JSON 报告：`D:\FanchengFinance\data\history\news-verification-report.json`

## 概要

| 指标 | 数量 |
|------|------|
| 合并前语料行数 | ~296 |
| **最终输出行数** | **287** |
| 去重删除 | 8（反内卷×3、Fed 重复×2、期货开放×4→1、远兴/红海等） |
| 日期/字段修正 | 14 |
| 校验阶段删除 | 5 |
| Batch5 新增净行 | ~6 |

## 关键去重（Batch1–5）

| 主题 | 处理 |
|------|------|
| 反内卷 | 保留 **2025-07-01** 中央财经委 + **2025-12-26** CEWC；删除 2025-07-15/重复「政策预期」「密集落地」 |
| 期货对外开放 2026-01-23 | Batch4 四条 → **单行** `LC;NI;PF;PR;PX;RU;LU;BC;TA`（NR→ru） |
| 碳酸锂 | 保留 **2025-07-15** 减产联盟 + **2026-01-13** 价格反弹（不同催化剂） |
| 美联储 2025 末次降息 | **2025-12-10** FOMC（非 12-18）；删除 12-01/12-12 重复行 |
| 美伊时间线 | 保留 **2025-10-20** 以军空袭伊朗 + **2026-03-08** 美伊升级 |

## 重要日期修正

| 原标题 | 原日期 | 修正日期 | 依据 |
|--------|--------|----------|------|
| 美联储年内最后一次降息 | 2025-12-12 | **2025-12-10** | [Fed FOMC 2025-12-10](https://www.federalreserve.gov/newsevents/pressreleases/monetary20251210a.htm) |
| 美联储9月降息 | 2025-09-01 | **2025-09-18** | FOMC 2025-09-17 声明 |
| 美联储1月暂停降息 | 2026-01-29 | **2026-01-28** | [FOMC 2026-01-28](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260128a.htm) |
| 粗钢跌破10亿吨 | 2025-08-15 | **2026-01-19** | [国家统计局 2026-01-19](https://m.caixin.com/m/2026-01-19/102405284.html)：全年 **9.61亿吨**（非 8 月预估 9.98） |
| 远兴纯碱投产 | 2023-08-01 | **2023-06-28** | 一线投产更准确 |
| 红海危机爆发 | 2023-12-14 | **2023-12-15** | 胡塞首次大规模袭击 |

## 已核实事件

| 事件 | 日期 | 结论 |
|------|------|------|
| 黄金 ATH $4500 | 2025-12-24 | ✓ [Kitco/Reuters](https://www.kitco.com/news/off-the-wire/2025-12-24/gold-tops-4500-while-silver-platinum-surge-new-peaks) 盘中 $4525 |
| 山西沁源煤矿瓦斯爆炸 | 2026-05-22 | ✓ 真实事件（留神峪煤矿 5·22 特别重大事故，[人民网 2026-05-28](http://society.people.com.cn/n1/2026/0528/c1008-40728830.html)） |
| 粗钢全年统计 | 2026-01-19 | ✓ 官方发布日；8 月行仅为前瞻估算 |

## 标签修正

- `AP`→`AP`（郑商所苹果）、`AO`→`ao`、`EC`→`ec`、`NR`→`ru`（20号胶映射天然橡胶合约）
- `PX` 保留 catalog `PX`；`LU`→`lu`、`BC`→`bc`

## 复现

```bash
# 设置数据盘（D 或 E，与 app 一致）
set FANCHENG_DATA_DRIVE=D
node scripts/import-batch5-news.js
node scripts/tune-sector-weights-longrun.js
```
