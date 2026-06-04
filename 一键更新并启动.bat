@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
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

echo Syncing to dist-new ...
robocopy "%~dp0dist-build\win-unpacked" "%~dp0dist-new\win-unpacked" /MIR /R:1 /W:1 >nul

powershell -ExecutionPolicy Bypass -File "%~dp0update-shortcuts.ps1"

set "EXE="
if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
start "" "%EXE%"
echo Done. Footer should show v%APPVER%
pause
exit /b 0

:fail
echo Build failed. Close the app and retry.
pause
exit /b 1
