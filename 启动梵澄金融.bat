@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "EXE="
if exist "%~dp0dist-out\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-out\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "E:\FanchengFinance\app\win-unpacked\FanchengFinance.exe" set "EXE=E:\FanchengFinance\app\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-new\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-new\win-unpacked\梵澄金融.exe"

if not defined EXE (
  echo 未找到已打包程序，请运行「一键更新并启动.bat」或安装 E 盘版本
  pause
  exit /b 1
)
start "" "%EXE%"
exit /b 0

echo 未找到打包程序，请先运行「一键更新并启动.bat」
pause
exit /b 1
