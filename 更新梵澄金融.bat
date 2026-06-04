@echo off
chcp 65001 >nul
title 梵澄金融 - 更新并启动
cd /d "%~dp0"

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APPVER=%%V"

echo ========================================
echo   梵澄金融 v%APPVER% 更新程序
echo ========================================
echo.

set "PATH=C:\Program Files\nodejs;%PATH%"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

echo [1/3] 正在打包最新版本...
taskkill /F /IM "FanchengFinance.exe" >nul 2>&1
taskkill /F /IM "梵澄金融.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
call npx electron-builder --win --dir
if errorlevel 1 (
  echo 打包失败，请完全退出梵澄金融后重试
  pause
  exit /b 1
)

echo.
echo [2/4] 同步到 dist-out（快捷方式目标）...
node scripts/sync-dist-out.js
if errorlevel 1 (
  echo 同步失败，请完全退出梵澄金融后重试
  pause
  exit /b 1
)

echo.
echo [3/4] 更新快捷方式...
powershell -ExecutionPolicy Bypass -File "%~dp0update-shortcuts.ps1"

echo.
echo [4/4] 启动应用...
set "EXE="
if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
start "" "%EXE%"

echo.
echo 更新完成！窗口底部应显示 v%APPVER%
pause
