@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "DIR="
if exist "%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe" set "DIR=%FANCHENG_APP_ROOT%\app\win-unpacked"
if not defined DIR if exist "dist-build\win-unpacked\FanchengFinance.exe" set "DIR=%~dp0dist-build\win-unpacked"
if not defined DIR if exist "dist-new\win-unpacked\FanchengFinance.exe" set "DIR=%~dp0dist-new\win-unpacked"
if not defined DIR if exist "dist-build\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist-build\win-unpacked"
if not defined DIR if exist "dist-new\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist-new\win-unpacked"
if not defined DIR if exist "dist\win-unpacked\梵澄金融.exe" set "DIR=%~dp0dist\win-unpacked"

if not defined DIR (
  echo 未找到程序，请先运行「更新梵澄金融.bat」
  pause
  exit /b 1
)

if exist "%DIR%\FanchengFinance.exe" (
  start "" "%DIR%\FanchengFinance.exe"
  exit /b 0
)
if exist "%DIR%\梵澄金融.exe" (
  start "" "%DIR%\梵澄金融.exe"
  exit /b 0
)
echo 目录中未找到可执行文件
pause
exit /b 1
