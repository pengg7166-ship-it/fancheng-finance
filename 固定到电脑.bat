@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "FOUND="
if exist "%~dp0dist-new\win-unpacked\FanchengFinance.exe" set "FOUND=1"
if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "FOUND=1"
if exist "%~dp0dist-new\win-unpacked\梵澄金融.exe" set "FOUND=1"
if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "FOUND=1"

if not defined FOUND (
  echo 未找到程序，请先运行「更新梵澄金融.bat」
  pause
  exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%~dp0update-shortcuts.ps1"
echo.
echo 快捷方式已创建到：桌面、开始菜单、开机自启
pause
