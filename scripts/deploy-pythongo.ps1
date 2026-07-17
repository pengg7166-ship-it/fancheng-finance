# Deploy Fancheng PythonGO strategy to InfiniTrader pyStrategy/demo (same layout as official demos).

# Usage: powershell -ExecutionPolicy Bypass -File scripts/deploy-pythongo.ps1



$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'infinitrader-pythongo'

$demoFiles = @('DemoFanchengOutbox.py', 'DemoMaCross1020.py', 'DemoFlattenAll.py', 'TROUBLESHOOT.md')

$legacyDemoFiles = @('signal_loader.py')

$legacyRootFiles = @('signal_loader.py', 'fancheng_outbox_strategy.py', 'DemoFanchengOutbox.py')



$targets = @(

    (Join-Path $env:APPDATA 'InfiniTrader_SimulationBetaX64\pyStrategy'),

    (Join-Path $env:APPDATA 'InfiniTrader_QhFangzhengzhongqi\pyStrategy')

)



$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$logLines = @(

    'Fancheng x InfiniTrader PythonGO deploy log',

    '==========================================',

    "deployedAt: $stamp",

    "host: $env:COMPUTERNAME",

    "user: $env:USERNAME",

    '',

    "source: $src",

    ''

)



foreach ($dest in $targets) {

    if (-not (Test-Path $dest)) {

        $logLines += "[skip] missing: $dest"

        continue

    }



    $demoDir = Join-Path $dest 'demo'

    if (-not (Test-Path $demoDir)) {

        New-Item -ItemType Directory -Path $demoDir -Force | Out-Null

    }



    $logLines += "[target] $demoDir"

    foreach ($f in $demoFiles) {

        $from = Join-Path $src $f

        if (-not (Test-Path $from)) { continue }

        $to = Join-Path $demoDir $f

        Copy-Item -Path $from -Destination $to -Force

        $logLines += "  copied demo/$f"

    }



    foreach ($f in $legacyDemoFiles) {

        $legacy = Join-Path $demoDir $f

        if (Test-Path $legacy) {

            Remove-Item -Path $legacy -Force

            $logLines += "  removed legacy demo/$f (helper must not live in demo/)"

        }

    }



    foreach ($f in $legacyRootFiles) {

        $legacy = Join-Path $dest $f

        if (Test-Path $legacy) {

            Remove-Item -Path $legacy -Force

            $logLines += "  removed legacy $f (pyStrategy root)"

        }

    }

    $logLines += ''

    $instancesSrc = Join-Path $src 'instances'
    $instancesDest = Join-Path $dest 'instance_files'
    if ((Test-Path $instancesSrc) -and (Test-Path $instancesDest)) {
        Get-ChildItem -Path $instancesSrc -Filter '*.json' | ForEach-Object {
            $to = Join-Path $instancesDest $_.Name
            Copy-Item -Path $_.FullName -Destination $to -Force
            $logLines += "  synced instance_files/$($_.Name)"
        }
    }

    $dataDrive = if ($env:FANCHENG_DATA_DRIVE) { $env:FANCHENG_DATA_DRIVE } else { 'E' }
    $mainManifest = Join-Path "${dataDrive}:\FanchengFinance\data" 'main-contracts-pythongo.json'
    if ((Test-Path $mainManifest) -and (Test-Path $instancesDest)) {
        $manifestDest = Join-Path $instancesDest 'main-contracts-pythongo.json'
        Copy-Item -Path $mainManifest -Destination $manifestDest -Force
        $logLines += '  synced instance_files/main-contracts-pythongo.json'
    } elseif (-not (Test-Path $mainManifest)) {
        $logLines += "  [warn] missing $mainManifest — run: node scripts/export-ma-cross-instruments.js"
    }

}



$logLines += @(

    'Next: InfiniTrader -> PythonGO -> Strategy Manager -> Reload -> demo/DemoFanchengOutbox, DemoMaCross1020, or DemoFlattenAll',

    'Only strategy .py files belong in demo/ (no signal_loader.py — PythonGO scans every .py).',

    'Outbox params: outboxPath=E:\FanchengFinance\data\outbox\signals dryRun=0 maxLots=1 runtime_mode=1',

    'Export: OUTBOX_RUNTIME_MODE=on_bar_touch (default) — intent signals; fixed_limit for legacy entryHint.price',

    'Strategy: K线触价模式=1 on_bar_touch (5m/15m/1h KLineGenerator); =0 fixed_limit',

    'MaCross1020: leave instrument_ids empty for 74 mains (use_all_main optional); kline_period=5m, DryRun=1 first; no outbox needed',

    'FlattenAll: stop DemoFanchengOutbox first, DryRun=1 then 0, run once (auto-pause)',

    'Do NOT store broker passwords in repo or scripts.',

    ''

)



$logPath = Join-Path $src 'DEPLOYED.txt'

$text = $logLines -join [Environment]::NewLine

Set-Content -Path $logPath -Value $text -Encoding UTF8

Write-Host $text

Write-Host ""

Write-Host "Wrote $logPath"

