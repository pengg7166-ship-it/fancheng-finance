# T+1 Direction Hit Rate — Optimization Results (2026-06-16)

## Target vs Actual

| Metric | Before | After (best gating) | Target |
|--------|--------|---------------------|--------|
| Full sample (2017–2025) | **49.46%** (6776/13699) | **52.85%** walk-forward rescoring (n=5139) | 75% |
| Archive after au/ag pUp backfill | — | **50.13%** (7299/14560) | 75% |
| OOS 2023–2025 | ~49% | **50.83%** (604 gated) | 75% |
| AU (pUp backfill) | 50.2% | **57.41%** (341/594) | 75% |
| AG (pUp backfill) | 52.34% | **53.93%** (377/699) | 75% |

**75% NOT achieved** on any meaningful sample (n≥200). Best honest full-sample lift: **+3.4pp** via confidence gating + laggard exclusion.

## Best Configuration Found

Runtime calibration: `E:/FanchengFinance/data/outlook-models/direction-t1-75-calibration.json`

```json
{
  "strategy": "combined_gate_laggard_exclude",
  "minConfidence": 0.07,
  "directionThresholds": { "bullish": 0.54, "bearish": 0.5 },
  "excludeInstruments": ["si","l","sh","lh","lg","pk","cj","ad","bc","br"]
}
```

Production weights **unchanged** (`v1.34.8-ag-cu-spread+basis-term`).

## Approaches Tried

1. **Confidence gating** (`|p_up - 0.5| > 0.07`) → 52.59% (n=5393)
2. **Per-sector direction thresholds** → 52.54% (n=16635); precious best 57.82%
3. **Strict OI-proxy** (au/ag) → 56.95% (n=374)
4. **Neutral expansion** (composite mult 2.1) → 49.89%
5. **Laggard exclusion** → 52.40% (n=1855)
6. **Combined** (gate + exclude + thresholds) → **52.85%** (best)

## Worst Laggards (<45% hit rate, n≥20)

si 36%, l 40%, SH 41%, lh 42%, PK 43%, CJ 44%

## Honest Gap

Reaching 75% on T+1 direction with current v1.34.8 features requires either:
- **Model retrain** with T+1-specific labels (experimental weights not yet beating gate)
- **Much smaller scored subset** (aggressive |p_up-0.5|>0.25 yields ~60% at n<200 — not production-viable)
- **User-assisted** news tags / manual regime labels for basis-repair days

## User Actions

1. **Restart app** to load `direction-t1-scoring.js` + UI gated display
2. **Optional deploy**: `node _patch-direction-audit-panel-asar.js` (if using packaged build)
3. **Re-export summary**: `FANCHENG_DATA_DRIVE=E node scripts/backfill-direction-walkforward-archive.js --measure-only --export-csv`
4. To pursue 75%: approve experimental retrain deploy (`outlook-logistic-weights-t1-75-experiment.json`) after OOS gate pass

## Files Changed

- `services/direction-t1-scoring.js` (new)
- `services/direction-prediction-archive.js` (gated stats)
- `scripts/optimize-t1-direction-75.js` (new)
- `scripts/backfill-direction-walkforward-archive.js` (gated report)
- `src/app.js` (UI: 高置信 hit rate line)
- `data/exports/direction-t1-75-optimization.json`
