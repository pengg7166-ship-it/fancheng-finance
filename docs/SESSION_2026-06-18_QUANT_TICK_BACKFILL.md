# Session 2026-06-18 — Quant tick intraday backfill

**Workspace:** `E:\FanchengFinance\source\fancheng-finance`  
**Data:** `E:\FanchengFinance\data`  
**Stopped for rest:** 2026-06-19 (local). Resume tomorrow.

## Completed today

- **AG stop-loss calibration:** 300 CNY/hand (20 CNY/kg); profit exempt 400 CNY/hand (unchanged vs commit `8d056e9f`).
- **Fundamental + Chan quant probe:** expanded from 3-instrument smoke test to full **72-instrument** `fundamental_chan` pool (`2023-01-01` … `2025-12-31`).
- **Tick intraday backfill:** `scripts/backfill-tick-intraday.js` — zip discovery, atomic progress, worker pool; **721/721** zips in range flushed (`failed=0`); progress preserved for resume.
- **ZCE / missing-cache fix pass:** second pass for symbols missing `tick-zips-sync` 5m on disk (ZCE grains: `cf,sr,ta,oi,ma,fg,rm,sf,sm,ap,cj,ur,sa,pf,pk,sh,px,pr,cy,rs,wh,pm,ri,lr,jr,zc`); force run completed (`_backfill-tick-zce-missing-force-run.txt`, status `done: true`).
- **Pool tick coverage (latest follow-up JSON):** 72/72 instruments with tick intraday 5m cache; probe baselines captured before/after backfill and post–ZCE-fix.

## Key metrics timeline (return %, daily-proxy vs real tick)

| Stage | Scope | Return % | Notes |
|-------|--------|----------|--------|
| Early daily-proxy | 3 inst (`au,ag,rb`) | **+168.26%** | `_probe-fundamental-chan-quant-summary-pre-tick-backfill.json` |
| Regression check | (intraday path bug / partial data) | **−2.34%** | session milestone (see probe run logs) |
| Pre-backfill full pool | 72 inst, mostly daily-proxy | **+2078.18%** | `_probe-fundamental-chan-quant-summary-prior-daily-proxy.json` |
| After full zip flush | 72 inst, mixed tick + proxy | **+399.00%** | `_probe-fundamental-chan-quant-post-backfill-run.txt` |
| Post–ZCE-fix real tick path | 72 inst | **+292.26%** | `_probe-post-zce-fix-run.txt` → `_probe-fundamental-chan-quant-summary.json` |

Common probe stats at 72-inst scale: ~12,757 trades, ~45.9% win rate, vs legacy baseline 22 trades / +3.55% / 73% win.

## Major files changed / added

| Area | Paths |
|------|--------|
| Backfill | `scripts/backfill-tick-intraday.js` (new), `scripts/convert-tick-zips-to-daily.js` |
| Probe | `scripts/probe-fundamental-chan-quant.js` (new) |
| Quant sim | `services/quant-trading-simulator.js`, `services/quant-trading-margin.js` |
| Catalog / data | `services/commodities-catalog.js`, `services/data-fetcher.js`, `services/config.js` |
| npm | `package.json` — `backfill-tick-intraday`, `convert-tick-zips`, `audit-tick-inventory`, `sync-tick-klines` |
| Docs touched (related) | `docs/TRADING_DATA_IMPORT.md` |

## Artifacts on disk (do not delete)

### Probe summaries (repo root)

- `E:\FanchengFinance\source\fancheng-finance\_probe-fundamental-chan-quant-summary.json`
- `E:\FanchengFinance\source\fancheng-finance\_probe-fundamental-chan-quant-summary-pre-tick-backfill.json`
- `E:\FanchengFinance\source\fancheng-finance\_probe-fundamental-chan-quant-summary-prior-daily-proxy.json`
- `E:\FanchengFinance\source\fancheng-finance\_tick-intraday-backfill-probe-followup-summary.json`
- `E:\FanchengFinance\source\fancheng-finance\_tick-intraday-backfill-probe-followup-summary.txt`

### Progress (required for resume)

- `E:\FanchengFinance\data\history\trading\tick-intraday-progress.json` — **721 processed**, pending 0, failed 0 (last write 2026-06-19)

### Backfill / probe logs (repo root, `_backfill-tick-*`, `_probe-*`)

- `_backfill-tick-intraday-all-run.txt` — full 721-zip pass
- `_backfill-tick-intraday-resume.txt`, `resume2.txt`, `resume3.txt`
- `_backfill-tick-zce-missing-run.txt`, `_backfill-tick-zce-missing-force-run.txt`
- `_backfill-tick-zce-missing-force-status.json`
- `_probe-fundamental-chan-quant-out.txt`, `_probe-fundamental-chan-quant-post-backfill-run.txt`, `_probe-post-zce-fix-run.txt`

## Jobs stopped (end of session)

- Checked `node.exe` / WMIC / `tasklist`: **no Node processes running** (backfill and probe already finished or previously stopped).
- **Did not delete or modify** `tick-intraday-progress.json`.

## Tomorrow — resume steps

### 1. Optional: verify tick cache / inventory

```powershell
cd E:\FanchengFinance\source\fancheng-finance
npm run audit-tick-inventory
node scripts/backfill-tick-intraday.js --inventory
```

### 2. Continue ZCE / missing intraday cache (if audit shows gaps)

Script auto-retries instruments **missing tick 5m files on disk** (skips already-flushed zips unless `--force`):

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
node scripts/backfill-tick-intraday.js --from 2023-01-01 --to 2025-12-31 `
  --instruments cf,sr,ta,oi,ma,fg,rm,sf,sm,ap,cj,ur,sa,pf,pk,sh,px,pr,cy,rs,wh,pm,ri,lr,jr,zc `
  2>&1 | Tee-Object -FilePath _backfill-tick-zce-missing-run.txt
```

Re-run full zip pass only if needed:

```powershell
node scripts/backfill-tick-intraday.js --from 2023-01-01 --to 2025-12-31 --force `
  2>&1 | Tee-Object -FilePath _backfill-tick-intraday-all-run.txt
```

**Note:** `npm run backfill-tick-intraday` defaults to `--instruments au` only — use the `node` command above for pool/ZCE work.

### 3. Re-probe fundamental_chan baseline

Snapshot current summary before overwriting:

```powershell
Copy-Item _probe-fundamental-chan-quant-summary.json _probe-fundamental-chan-quant-summary-pre-rerun.json -ErrorAction SilentlyContinue
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy `
  2>&1 | Tee-Object -FilePath _probe-fundamental-chan-quant-out.txt
```

### 4. Related npm scripts

| Script | Command |
|--------|---------|
| Tick zip → daily + sync | `npm run convert-tick-zips` / `npm run sync-tick-klines` |
| Tick inventory audit | `npm run audit-tick-inventory` |
| Default AU-only backfill | `npm run backfill-tick-intraday` |

## 2026-06-21 resume

- **Tick backfill:** `tick-intraday-progress.json` still **721/721** zips processed, pending 0, failed 0 (unchanged since 2026-06-19).
- **Fundamental + Chan probe (resume, `--compare-legacy`):** full 72-inst pool `2023-01-01` … `2025-12-31` completed; summary written to `_probe-fundamental-chan-quant-summary.json` (`generatedAt` 2026-06-21).
- **New baseline:** **+56.74%** return, **12,907** trades, 45.91% win (vs legacy same-window 103 trades / +2.46% / 53.4% win).
- **Exit code 1:** probe finished backtest + JSON write but hit **EBUSY** writing `_probe-fundamental-chan-quant-out.txt` while PowerShell `Tee-Object` held the file open; fixed in `scripts/probe-fundamental-chan-quant.js` (temp + rename with retry/skip).
- **Prior post–ZCE-fix baseline** (+292.26%, ~12,757 trades) superseded by this resume run after further tick/cache alignment.

## Open items for next session

- Confirm all 72 pool symbols use **real tick 5m/15m** (not `5m15m-cache` fallback) where Baidu zips allow; sparse symbols (`pm`, `ri`, `lr`, `jr`, `zc`, etc.) may still be thin.
- Reconcile return drift (+2078% proxy → +399% / +292% → **+56.74%** tick-realistic) before tuning weights or live gates.
- No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" this session (user request).

## 2026-06-21 pause (40亿 filter · 57 instruments)

- **Deposit filter (40亿):** fundamental_chan pool runs at **57 instruments** (72 raw minus excluded low-OI / deposit-threshold names). See `docs/QUANT_TRADING_FUNDAMENTAL_CHAN.md` and probe log `[deposit-filter]` / summary `depositFilter`.
- **Probe status:** `probe-fundamental-chan-quant.js` **interrupted mid-run** (session paused for rest). No `node.exe` left running at pause time.
- **Partial output:** `_probe-fundamental-chan-quant-summary.json` was touched **2026-06-22 01:34** (`generatedAt` 2026-06-21T17:34:46Z) but contains only **3** instruments (`au`, `ag`, `rb`) on window **2024-01-01 → 2024-03-31** (~4.6 KB) — **not** a finished 57-inst / 2023–2025 summary. Last full-window snapshot on disk: `_probe-fundamental-chan-quant-summary-pre-rerun.json` (72 inst, 2023-01-01 → 2025-12-31, ~88 KB, 2026-06-19). Do not delete partial files; re-run will overwrite summary when complete.

### Tomorrow — resume full probe (no Tee-Object)

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy
```

Optional before re-run: `Copy-Item _probe-fundamental-chan-quant-summary.json _probe-fundamental-chan-quant-summary-pre-57inst-pause.json -ErrorAction SilentlyContinue`

## 2026-06-23 resume (57-inst full probe)

- **Partial backup:** `_probe-fundamental-chan-quant-summary-pre-57inst-pause.json` saved (3 inst `au,ag,rb`, Q1 2024 only, 4.6 KB) before re-run.
- **Run command (no Tee-Object):** `node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy` with `FANCHENG_DATA_DRIVE=E`, `QUANT_MODE=fundamental_chan`; console captured to `_probe-fundamental-chan-quant-57inst-run.txt`.
- **Deposit filter confirmed:** 57 kept / 15 excluded at 40亿 threshold (log in run file).
- **Result: FAILED** — exit code **1** after **~12.3 h** (`2026-06-23 09:24` → `13:41` local). `_probe-fundamental-chan-quant-summary.json` **unchanged** (still partial Q1 2024 snapshot). No new trades archive. Stdout redirect buffered logs; error not captured in run file.
- **72-inst baseline (compare target):** **+56.74%** return, **12,907** trades, 45.91% win (`2026-06-21` resume run in session notes above).
- **Retry 1 (2026-06-23 ~13:52):** no stdout redirect + 8 GB heap — **killed** after ~32 min (exit `4294967295`), summary still partial. Likely parent shell/session termination, not backtest error.
- **Retry 2:** detached via `ProcessStartInfo` with explicit `FANCHENG_DATA_DRIVE=E`, `QUANT_MODE=fundamental_chan`, 8 GB heap (PID **24120**); prior `Start-Process` attempt lacked env → 56 inst — killed.
- No git commit this session.


## 2026-06-23 pause (52-inst probe, user rest)

- **Stopped:** `probe-fundamental-chan-quant.js` node processes **PID 14900**, **PID 21724** (both `--from 2023-01-01 --to 2025-12-31 --compare-legacy`). **PID 25540** not running at stop time.
- **Logs preserved:** `_probe-57-run.log` (931 B, deposit-filter + probe header only), `_probe-57-run.err` (empty), `_probe-fundamental-chan-quant-summary.json` unchanged partial (**2026-06-22**, Q1 2024 `au/ag/rb` only, 4.6 KB).
- **Partial progress:** Latest run log shows **52 instruments kept** / 14 excluded (40万 deposit filter), window **2023-01-01 → 2025-12-31**; no per-instrument completion lines in log before pause.
- **Baseline (72-inst):** `_probe-fundamental-chan-quant-summary-pre-rerun.json` **+56.74%** return, 12,907 trades (compare target for `--compare-legacy`).
- No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>".

### Tomorrow — resume full probe

```powershell
cd E:\FanchengFinance\source\fancheng-finance
$env:FANCHENG_DATA_DRIVE = "E"
$env:QUANT_MODE = "fundamental_chan"
node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy
```

## 2026-06-24 resume (57-inst full probe — complete)

- **Launch:** `Start-Process` with stdout/stderr to `_probe-57-run.log` / `_probe-57-run.err`; PID **6544**; `FANCHENG_DATA_DRIVE=E`, `QUANT_MODE=fundamental_chan`.
- **Runtime:** ~12.9 h (`2026-06-24 08:46` → `21:41` local); monitored every 3 min via `_probe-57-monitor-status.txt`.
- **Deposit filter:** **57 kept** / **15 excluded** at 40亿 threshold (includes `b`, `ad`, `br`, … `lr`; see summary `depositFilter.excluded`).
- **Result: SUCCESS** — exit **0**; summary `_probe-fundamental-chan-quant-summary.json` (~78 KB, `generatedAt` 2026-06-24T13:39:14Z).

### Metrics (2023-01-01 → 2025-12-31)

| Pool | Return % | Trades | Win % |
|------|----------|--------|-------|
| **57-inst (deposit-filtered)** | **+25.90%** | **10,566** | **47.86%** |
| 72-inst baseline (2026-06-21) | +56.74% | 12,907 | 45.91% |
| Legacy same-window (`--compare-legacy`) | −0.04% | 94 | 53.19% |

- **Δ vs 72-inst baseline:** return **−30.84 pp**, trades **−2,341**, win rate **+1.95 pp**.
- **Exit breakdown (57-inst):** stop_loss 8152, take_profit 1178, trail_support_break 762, session_close 474; avg hold ~1566 min.
- **Logs:** `_probe-57-run.log`, `_probe-57-run.err` (empty), `_probe-57-monitor-status.txt`.
- No git commit this session.


## 2026-06-24 — 57-inst full probe complete (PID 6544)

- **Monitored:** probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy (PID **6544**, started **2026-06-24 ~08:46** local); no duplicate probe started.
- **Logs:** _probe-57-run.log, _probe-57-run.err (stderr empty); stdout flushed at end (~12.9 h wall, finished **~21:41** local).
- **Deposit filter (40亿):** **57 kept** / **15 excluded** / 72 raw pool (depositFilter in summary JSON).
- **Result (57 inst, 2023-01-01 → 2025-12-31):** **+25.90%** return, **10,566** trades, **47.86%** win, max DD **12.57%**; generatedAt **2026-06-24T13:39:14Z** in _probe-fundamental-chan-quant-summary.json.
- **vs 72-inst baseline (session compare target):** **+56.74%** / **12,907** trades / 45.91% win → **Δ return −30.84 pp**, **Δ trades −2,341** (57-inst run lower return, fewer trades, slightly higher win%).
- **--compare-legacy same window:** legacy sim **94 trades / −0.037% / 53.19%** win; model_c_gate label baseline **22 trades / +3.55% / 73%** win (in JSON).
- No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>".


## 2026-06-25 — 56-inst probe complete (ec blacklisted, 5m exit path)

- **Monitored:** `probe-fundamental-chan-quant.js` PID **17480**; stdout/stderr `_probe-5m-exit-run.log` / `_probe-5m-exit-run.err` (stderr empty); poll `_probe-5m-exit-monitor-status.txt`.
- **Config:** deposit filter **57 kept** / 15 excluded (40亿); **blacklist `ec`** → **56 instruments**; **5m exit path** (log: per-instrument `fallback=5m15m-cache`); window **2023-01-01 → 2025-12-31**.
- **Runtime:** ~**47 min** wall from monitor start (`2026-06-25 13:46` → exit **~14:33** local); finished **SUCCESS** (summary written, log footer OK).
- **Result:** `_probe-fundamental-chan-quant-summary.json` (`generatedAt` **2026-06-25T06:33:00Z**).

### Metrics (2023-01-01 → 2025-12-31)

| Run | Return % | Trades | Win % | Max DD % |
|-----|----------|--------|-------|----------|
| **56-inst (ec out, 5m exit)** | **+97.96%** | **10,212** | **47.09%** | **1.50%** |
| 57-inst baseline (with ec, prior path) | +25.90% | 10,566 | 47.86% | 12.57% |
| 57-inst counterfactual (no ec, session note) | +43.80% | — | — | — |

- **Δ vs 57-inst +25.90%:** return **+72.06 pp**, trades **−354**, win **−0.77 pp**.
- **Δ vs +43.80% counterfactual (no ec):** return **+54.16 pp** (same window; counterfactual trade count not on file).
- **Exit breakdown (56-inst / 5m):** stop_loss **7023**, take_profit **2367**, trail_support_break **449**, session_close **373**; avg hold **~1126 min** (vs ~1566 min on 57-inst run).
- **`--compare-legacy` same window:** legacy sim **88 trades / +1.90% / 54.55%** win; model_c_gate label **22 / +3.55% / 73%** (in JSON).
- **Note:** reported max DD **1.50%** is far below the prior **12.57%** run — likely metric/path change with 5m exits; validate before live gates.
- No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" this session.



## 2026-06-25 — 56-inst full probe after P0 fixes (243a9d49)

- **Fixes:** night **20:55** session-close bug, S/R directional alignment, **asar** patched (commit **243a9d49**).
- **Launch:** `Start-Process` node `scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy`; env `FANCHENG_DATA_DRIVE=E`, `QUANT_MODE=fundamental_chan`; logs `_probe-p0fix-run.log` / `_probe-p0fix-run.err` (stderr empty); monitor `_probe-p0fix-monitor-status.txt`.
- **Config:** deposit filter **57 kept** / **15 excluded** (40万); **blacklist `ec`** → **56 instruments**; **5m exit path** (`fallback=5m15m-cache`).
- **Runtime:** ~**49 min** (`2026-06-25 ~15:12` → summary **~16:01** local); **SUCCESS** (exit 0, summary + archive written).

### Metrics (2023-01-01 → 2025-12-31)

| Run | Return % | Trades | Win % | Max DD % |
|-----|----------|--------|-------|----------|
| **56-inst P0-fix probe** | **+97.37%** | **10,028** | **47.00%** | **2.47%** |
| 56-inst pre-P0 baseline (same session) | +97.96% | 10,212 | 47.09% | 1.50% |

- **Δ vs +97.96% / 10,212 baseline:** return **−0.59 pp**, trades **−184** (P0 timing/S/R fixes; user note ~2162 mis-timed exits may reclassify rather than all dropping as separate trades).
- **Exit breakdown (P0):** stop_loss **6633**, take_profit **2779**, trail_support_break **351**, session_close **265** (vs pre-P0: 7023 / 2367 / 449 / 373).
- **`--compare-legacy` same window:** legacy sim **84 trades / +1.08% / 54.76%** win; model_c_gate label **22 / +3.55% / 73%** (in JSON).
- **Archive sync:** `archive.saveTrades` → `E:\FanchengFinance\data\history\quant-trading-archive\trades.jsonl` **10,028** rows (`mtime` **2026-06-25 ~16:00:55**, replaces pre-P0 **10,212** archive from 5m-exit run). Summary `_probe-fundamental-chan-quant-summary.json` (`generatedAt` **2026-06-25T08:00:55.792Z**).
- No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" this session.

## 2026-06-25 — Precious metals + trail optimization baseline

- **Config:** `QUANT_PRECIOUS_MIN_RR=2.0`, `CHAN_TRAIL_ARM_RATIO=0.67` (precious RR gate + earlier trail arming).
- **Probe (2023-01-01 → 2025-12-31):** **+102.26%** return, **9,726** trades, **47.15%** win, max DD **2.40%**; AU **+8,940** (65 trades), AG **+19,021** (71 trades).
- **Δ vs P0-fix +97.37% / 10,028:** return **+4.89 pp**, trades **−302** (precious filter trims low-RR entries; trail ratio shifts exit mix).
- **Exit breakdown:** stop_loss **6479**, take_profit **2632**, trail_support_break **351**, session_close **264**; avg hold **~85 min**.
- **Baseline sync:** `_probe-fundamental-chan-quant-summary.json` + `trades.jsonl` (**9,726** rows, mtime **~16:54**) → `_quant-trading-backtest-summary.json`; `_patch-quant-trading-asar.js` re-run (embedded summary **102.261% / 9726**).
- No git commit this session.


## 2026-06-25 save checkpoint (baseline +102.26%)

**Purpose:** Preserve production quant state without git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>". One-page mirror: `docs/CHECKPOINT_2026-06-25.md`.

### Metric timeline through +102.26%

| Stage | Scope | Return % | Trades | Win % | Max DD % |
|-------|--------|----------|--------|-------|----------|
| Daily-proxy smoke | 3 inst (`au,ag,rb`) | +168.26 | — | — | — |
| Regression (intraday path bug) | session milestone | −2.34 | — | — | — |
| Pre-backfill daily-proxy | 72 inst | +2078.18 | — | — | — |
| Post full zip flush | 72 inst | +399.00 | — | — | — |
| Post ZCE-fix real tick | 72 inst | +292.26 | ~12,757 | ~45.9 | — |
| 2026-06-21 resume | 72 inst | +56.74 | 12,907 | 45.91 | — |
| Deposit ≥40亿 | 57 inst | +25.90 | 10,566 | 47.86 | 12.57 |
| 56 inst, ec out, 5m exit | 56 inst | +97.96 | 10,212 | 47.09 | 1.50 |
| P0 fixes (`243a9d49`) | 56 inst | +97.37 | 10,028 | 47.00 | 2.47 |
| **Precious + trail (CURRENT)** | 56 inst | **+102.26** | **9,726** | **47.15** | **2.40** |

**Current precious PnL:** AU **+8,940** (65 trades) · AG **+19,021** (71 trades).

### Tuning knobs (env vars)

| Variable | Value |
|----------|-------|
| `FANCHENG_DATA_DRIVE` | `E` |
| `QUANT_MODE` | `fundamental_chan` |
| `PHILOSOPHY_FILTER_V2` | `1` (probe sets) |
| `MODEL_C_LIVE_TIER` | `high_hit` |
| `MODEL_C_SIM_TIER` | `sim_relaxed` |
| `QUANT_PRECIOUS_MIN_RR` | **2.0** |
| `CHAN_TRAIL_ARM_RATIO` | **0.67** |

**Filters:**沉淀资金 ≥40亿 (57/72) · blacklist **`ec`** → 56 instruments · 5m exit path.

### Artifact verification (2026-06-25 save)

| Path | Size / rows | Status |
|------|-------------|--------|
| `_probe-fundamental-chan-quant-summary.json` | 76,169 bytes · `generatedAt` 2026-06-25T08:54:16Z | OK |
| `_quant-trading-backtest-summary.json` | 39,376 bytes · 102.261% / 9726 | OK |
| `E:\FanchengFinance\data\history\quant-trading-archive\trades.jsonl` | 10,490,759 bytes · **9726** lines · mtime ~16:54 | OK |
| `E:\FanchengFinance\data\history\trading\tick-intraday-progress.json` | 453,531 bytes · **721** processed | OK (not repo root) |
| `_analyze-trades-readthrough.json` | 25,804 bytes · **10,212** trades (stale) | Re-run analyze |
| `_analyze-quant-return-diagnosis.json` | 26,643 bytes · pre-precious | Optional re-run |

### Processes

- Stray `node` **probe** processes: **none** at checkpoint time (no kill needed).

### Tomorrow resume

1. **Audit (first):** `cd E:\FanchengFinance\source\fancheng-finance` → `npm run audit-tick-inventory`
2. **Probe:** set `FANCHENG_DATA_DRIVE`, `QUANT_MODE`, `QUANT_PRECIOUS_MIN_RR=2.0`, `CHAN_TRAIL_ARM_RATIO=0.67` → `node scripts/probe-fundamental-chan-quant.js --from 2023-01-01 --to 2025-12-31 --compare-legacy` (tee to `_probe-fundamental-chan-quant-out.txt`)
3. **App:** `$env:FANCHENG_DATA_DRIVE=E` → `npm start` (or packaged build after `_patch-quant-trading-asar.js` if needed)

No git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" this checkpoint.
