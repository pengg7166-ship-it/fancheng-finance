# 新闻 / Basis 标注辅助指南

目标：通过人工/semi-auto 补标提升 **T+1 方向命中率**（当前 gated ~52%，目标 75%）。本工作流 **不修改 v1.34.8 生产权重**。

## 文件一览

| 文件 | 说明 |
|------|------|
| `data/history/labels/labeling-queue-priority.csv` | 优先标注队列（AG basis miss × 方向 archive miss 交叉） |
| `data/history/labels/user-news-basis-label-template.csv` | **用户填写主模板** |
| `data/history/labels/ag-basis-label-review.csv` | AG basis regime 复核（term vs oi_proxy） |
| `data/history/labels/user-ag-basis-audit-template.csv` | 54 条 AG basis T+3 miss（已有） |
| `data/history/labels/basis-regime-overrides.csv` | 可选：basis regime 覆盖（**尚未接入生产**） |

## 快速开始

```powershell
# 1. 生成/刷新队列与模板（E 盘数据）
$env:FANCHENG_DATA_DRIVE = "E"
node scripts/build-labeling-assistance.js

# 2. 用 Excel 编辑模板（保留表头，删说明行或留空 title 的行不会合并）
#    data/history/labels/user-news-basis-label-template.csv

# 3. 合并到 news-tagged.csv
node scripts/merge-user-news-basis-labels.js

# 4. 可选：探针 KPI（权重不变，主要看 philosophy 层变化）
node scripts/probe-tradable-day-kpi.js
```

## 模板列说明

| 列 | 必填 | 取值 |
|----|------|------|
| `date` | 是 | `YYYY-MM-DD` |
| `instrumentId` | 是 | `ag` / `au` |
| `eventType` | 是 | `policy` / `geo` / `supply` / `basis` / `warehouse` |
| `direction` | 是 | `bull` / `bear` / `neutral`（合并时映射为 bullish/bearish） |
| `title` | **合并必填** | 新闻标题或事件简述 |
| `notes` | 否 | 备注、来源 |
| `source_tier` | 否 | `policy` / `geo` / `commodity` / `macro`（默认同 eventType） |
| `stars` | 否 | 1–5，默认 3 |
| `commodities` | 否 | `ag;au` 分号分隔 |

**不会合并的行**：`title` 为空，或 `[待确认]` 开头且未改写的 flash 占位行。

## 填写示例

```csv
date,instrumentId,eventType,direction,title,notes,source_tier,stars,commodities
2023-01-03,ag,warehouse,bear,沪银仓单5日增4.51%压制银价,AG basis miss复核；仓单供应上行,commodity,4,ag
2024-07-11,ag,policy,bear,国务院常务会研究加大逆周期调节,宏观偏空压制贵金属,policy,4,ag;au
2023-02-10,ag,basis,bear,AG basis OI代理误标日,term_z=0.67 未达±2；见 ag-basis-label-review,commodity,3,ag
```

## AG Basis Regime 复核

编辑 `ag-basis-label-review.csv` 的 `user_confirm` 列：

| suggestedRegime | 含义 |
|-----------------|------|
| `skip_oi_proxy` | term_z 未达 ±2，不应走 OI 代理（A5/strict 规则） |
| `term_structure` | 保留 term basis 分类 |

`user_confirm` 填 `yes` / `no` / 留空。Regime override **尚未接入** `market-regime-classifier`；合并脚本加 `--basis-overrides` 仅写入 `basis-regime-overrides.csv` 供后续实验。

## Semi-auto 预填逻辑

`build-labeling-assistance.js` 会自动：

1. **warehouse_supply_up** → 预填 `warehouse` + `bear` + 仓单增幅标题
2. **flash-inbox 政策日** → 预填 `[待确认]` + flash 标题（需人工改 title 后合并）
3. **oi_proxy_mislabel** → 预填 `basis` 类型 + 指向 regime 复核表

## 合并后 KPI 路径

| 阶段 | 效果 |
|------|------|
| 仅合并 news-tagged | `philosophyScore` / `newsImpact.shock` 在标注日变化；**logistic 特征权重不变** → T+1 提升通常 **< 1pp** |
| + 重训 T+1 head | 新标签进入 walk-forward 训练集 → 目标 **+3–8pp**（取决于标注质量与 overlap 天数） |
| + basis strict 规则 deploy | AG basis 子集 **+8.5pp**（样本 115→26，需政策决策） |

推荐顺序：**补 warehouse/policy 标签 → merge → probe → 积累 30+ 高质量行后重训**。

## 与 expand-news-tagged 的关系

- `expand-news-tagged.js`：自动仓单/backfill + flash 批量扩展
- 本工作流：**人工精标 miss 日**，优先级由 `labeling-queue-priority.csv` 驱动
- 两者可并存；用户模板 merge 使用相同 `news-tagged.csv` schema

## 故障排查

- **模板 0 行有效**：检查是否只保留了 `#说明` 行或未填 `title`
- **重复跳过**：同 date+title 已存在于 news-tagged；改 title 或 notes 增星
- **geo 未更新**：merge 默认重跑 `aggregate-geopolitics`；加 `--skip-geo` 可跳过
