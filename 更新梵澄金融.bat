@echo off
chcp 65001 >nul
title 梵澄金融 - 更新打包
cd /d "%~dp0"

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APPVER=%%V"

echo ========================================
echo   梵澄金融 v%APPVER% 更新打包
echo ========================================
echo.

set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "FANCHENG_ROOT=%FANCHENG_APP_ROOT%"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

echo [1/4] 关闭运行中的实例...
taskkill /F /IM "FanchengFinance.exe" >nul 2>&1
taskkill /F /IM "梵澄金融.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
call npx electron-builder --win --dir
if errorlevel 1 (
  echo 打包失败，请关闭应用后重试。
  pause
  exit /b 1
)

echo.
echo [2/4] 同步 dist-out 到 %FANCHENG_APP_ROOT%\app\win-unpacked ...
node scripts/sync-dist-out.js
if errorlevel 1 (
  echo 同步失败，请检查磁盘空间与权限。
  pause
  exit /b 1
)

echo.
echo [3/4] 更新快捷方式...
powershell -ExecutionPolicy Bypass -File "%~dp0update-shortcuts.ps1"

echo.
echo [4/4] 启动应用...
set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe"
if not exist "%EXE%" set "EXE=%~dp0dist-out\win-unpacked\FanchengFinance.exe"
if not exist "%EXE%" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not exist "%EXE%" (
  echo 未找到 FanchengFinance.exe，请先完成打包。
  pause
  exit /b 1
)
start "" "%EXE%"

echo.
echo 更新完成，已启动梵澄金融 v%APPVER%
echo 程序路径: %FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe
pause
