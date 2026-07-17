@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "FANCHENG_ROOT=%FANCHENG_APP_ROOT%"
set CSC_IDENTITY_AUTO_DISCOVERY=false

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APPVER=%%V"

echo Building v%APPVER% ...
taskkill /F /IM "FanchengFinance.exe" >nul 2>&1
taskkill /F /IM "梵澄金融.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

call npx electron-builder --win --dir
if errorlevel 1 goto fail

echo Syncing to dist-out ...
node scripts/sync-dist-out.js
if errorlevel 1 goto fail

echo Syncing to %FANCHENG_APP_ROOT%\app\win-unpacked ...
robocopy "%~dp0dist-build\win-unpacked" "%FANCHENG_APP_ROOT%\app\win-unpacked" /MIR /R:1 /W:1
if errorlevel 8 goto fail

robocopy "%~dp0dist-build\win-unpacked" "%~dp0dist-new\win-unpacked" /MIR /R:1 /W:1 >nul

powershell -ExecutionPolicy Bypass -File "%~dp0update-shortcuts.ps1"

set "EXE="
if exist "%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe" set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
if not defined EXE (
  echo 未找到 FanchengFinance.exe，请先完成打包或运行「更新梵澄金融.bat」
  pause
  exit /b 1
)
start "" "%EXE%"
echo Done. Footer should show v%APPVER%
pause
exit /b 0

:fail
echo Build failed. Close the app and retry.
pause
exit /b 1
