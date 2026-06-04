@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "DIR="
if exist "dist-build\win-unpacked\FanchengFinance.exe" set "DIR=%~dp0dist-build\win-unpacked"
if not defined DIR if exist "dist-new\win-unpacked\FanchengFinance.exe" set "DIR=%~dp0dist-new\win-unpacked"
if not defined DIR if exist "dist-build\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist-build\win-unpacked"
if not defined DIR if exist "dist-new\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist-new\win-unpacked"
if not defined DIR if exist "dist\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist\win-unpacked"

if not defined DIR (
  echo 未找到程序，请先运行「更新梵澄金融.bat」
  pause
  exit /b 1
)

cd /d "%DIR%"
if exist "FanchengFinance.exe" (
  start "" "FanchengFinance.exe"
) else (
  start "" "梵澄金融.exe"
)
