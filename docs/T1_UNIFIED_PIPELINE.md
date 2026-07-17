# T+1 Unified Pipeline

Single specification for the T+1 experimental retrain (2026-06). Production **v1.34.8** remains unchanged unless the experiment passes gate and deploy is explicitly approved.

## Manifest

| Item | Path |
|------|------|
| Unified config | `E:/FanchengFinance/data/outlook-models/t1-unified-config.json` |
| Production weights | `E:/FanchengFinance/data/outlook-models/outlook-logistic-weights.json` |
| Experiment weights | `E:/FanchengFinance/data/outlook-models/outlook-logistic-weights-t1-unified-experiment.json` |
| T+1 scoring calibration | `E:/FanchengFinance/data/outlook-models/direction-t1-75-calibration.json` |
| News labels | `E:/FanchengFinance/data/history/news-tagged.csv` (~2462 rows) |
| Basis overrides | `E:/FanchengFinance/data/history/labels/basis-regime-overrides.csv` |

## Unified rules

1. **Horizon:** T+1 everywhere (archive `horizon:1`, train labels `actualDir`, probe KPI, UI audit).
2. **Session anchor:** CN futures `21:00→15:00` (via `cn-futures-session-calendar`).
3. **Train / OOS split:**
   - Train: `2017-01-01` → `2022-12-31` (or earliest K-line if later)
   - OOS: `2023-01-01` → `2025-12-31` (or latest data)
4. **Regime:** `AG_BASIS_STRICT_OI_PROXY=1` + per-date `basis-regime-overrides.csv` wired into `market-regime-classifier.js`.
5. **Scoring:** Single calibration file `direction-t1-75-calibration.json` for gated KPI.
6. **Experiment isolation:** Retrain writes **only** to `outlook-logistic-weights-t1-unified-experiment.json`.

## Gate criteria

| Check | Threshold |
|-------|-----------|
| OOS T+1 raw overall | ≥ baseline + 2pp (**52.11%** → **54.11%**) with n ≥ 200 |
| OR OOS T+1 raw overall | ≥ **75%** with n ≥ 200 |
| OR OOS au+ag gated | ≥ **54.28%** + 2pp with n ≥ 100 |

## Reproduce full pipeline

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

# Phase A — sync basis overrides + write manifest
node scripts/sync-basis-regime-overrides.js
node -e "const c=require('./services/t1-unified-config'); c.saveConfig(c.defaultConfig()); console.log('manifest', c.getConfigPath())"

# Phase B — T+1 retrain (au/ag logistic head; ~5–15 min)
node scripts/train-outlook-logistic-t1-unified.js

# Phase C — unified probe (all ~65 instruments; ~20–40 min)
node scripts/probe-t1-unified-experiment.js --oos-from 2023-01-01 --oos-to 2025-12-31
```

Optional: direction archive comparison rows with experiment tag:

```powershell
$env:DIRECTION_ARCHIVE_MODEL_VERSION = "t1-unified-experiment"
node scripts/backfill-direction-walkforward-archive.js --sector precious --from 2023-01-01 --force
```

## Code touchpoints

| Component | T+1 unified behavior |
|-----------|---------------------|
| `services/market-regime-classifier.js` | `basis-regime-overrides` + strict OI proxy |
| `services/direction-prediction-archive.js` | `horizon:1`, optional `DIRECTION_ARCHIVE_MODEL_VERSION` |
| `services/direction-t1-scoring.js` | Loads unified calibration |
| `scripts/train-outlook-logistic-t1-unified.js` | T+1 labels, experiment weights only |
| `scripts/probe-t1-unified-experiment.js` | 65-instrument raw + gated vs v1.34.8 |

## Production vs experiment

- **Do not** overwrite `outlook-logistic-weights.json` from this pipeline.
- Patch `app.asar` only after code changes and explicit deploy approval.

See also: `docs/DIRECTION_T1_75_OPTIMIZATION.md`, `docs/PROJECT_RECOVERY_STATUS.md`, **`docs/PHILOSOPHY_FILTER_ARCHITECTURE.md`**（用户确认的哲学 filter + Model C 目标架构；T1 实验未达 gate，后续方向预测 refactor 以该文档为准）。

## Phase C results (2026-06-17 · GATE_FAIL)

| Metric | Production v1.34.8 | Experiment t1-unified | Notes |
|--------|-------------------|----------------------|-------|
| OOS raw overall | 51.9% (n=4615) | 50.0% (n=346) | 65-instrument walk-forward |
| OOS raw train scope (au+ag) | 56.17% (n=397) | 52.71% (n=129) | Matches Phase B train report |
| OOS au+ag gated | 50.55% (n=275) | 25.0% (n=12) | Calibration minConfidence 0.07 |
| Directional rate (all label rows) | ~92% | ~7.5% | Experiment emits far more neutral |

**Diagnosis (not a probe wiring bug):**

1. Phase B trains **au+ag only** (`trainHyperparams.instruments`); experiment weights file lists `"instruments": ["au", "ag"]` — metadata only, not an inference filter.
2. Probe applies experiment weights to all ~65 instruments (same `buildFlatRow` + `predictFromWeights` path as production). au+ag OOS raw **n=129** matches `train-outlook-logistic-t1-unified.js` validation exactly.
3. Sparse cross-sector coverage (black/chemical/agriculture ≈ 0 scored) is because the retrained head is **more conservative**: most rows get `pUp` in the neutral band (0.45–0.55). Only au, ag, cu, sc produce enough directional calls. Production v1.34.8 uses the same feature vector but different coefficients and stays directional on ~92% of label rows.
4. Gated au+ag collapse (n=12) is **calibration gating** on low-confidence experiment `pUp`, not env filtering (`AG_BASIS_STRICT_OI_PROXY` / basis overrides apply equally to both models in the probe loop).

**Retrain needed:** Yes, for any deploy path — current experiment underperforms production on au+ag raw (−3.5pp) and fails all gate checks. Options: (a) retrain with expanded instrument list, (b) tune hyperparams / feature set on au+ag, (c) adjust direction thresholds before re-gating.

**Report:** `data/exports/t1-unified-probe-report.json` · `_t1-unified-probe-out.txt`
