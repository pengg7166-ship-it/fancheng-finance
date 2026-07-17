@echo off
chcp 65001 >nul
title 梵澄金融 - 安全启动
set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "ROOT=%FANCHENG_APP_ROOT%\source\fancheng-finance"
set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "FANCHENG_ROOT=%FANCHENG_APP_ROOT%"
set "PATH=C:\Program Files\nodejs;%PATH%"

rem Fundamental + Chan S/R quant (v1.35.2 weights on E: data drive)
set QUANT_MODE=fundamental_chan
set PHILOSOPHY_FILTER_V2=1
set MODEL_C_V2=1
set MODEL_C_LIVE_TIER=high_hit
set MODEL_C_SIM_TIER=sim_relaxed
set NODE_OPTIONS=--max-old-space-size=4096
set OUTLOOK_L2_LIVE=1
set OUTLOOK_L2_LIVE=1

echo 关闭已运行的旧实例...
taskkill /IM FanchengFinance.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

if not exist "%EXE%" (
  echo 未找到: %EXE%
  echo 请先运行「更新梵澄金融.bat」完成打包与同步。
  pause
  exit /b 1
)

echo 正在检查 app.asar 健康状态...
pushd "%ROOT%"
node scripts\verify-asar-health.js
set "HC=%ERRORLEVEL%"
popd

if "%HC%"=="1" (
  echo.
  echo 健康检查失败：app.asar 缺失或无法读取，已取消启动。
  echo 可尝试: cd /d "%ROOT%" ^&^& node _patch-cross-vol-asar.js
  pause
  exit /b 1
)

if "%HC%"=="2" (
  echo.
  echo 警告: 存在非致命问题（如 asar 体积偏小或备份过多），核心模块已齐全，继续启动...
  echo.
)

start "" "%EXE%"
exit /b 0
