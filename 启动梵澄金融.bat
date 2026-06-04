@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "EXE="
if exist "%~dp0dist-out\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-out\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-new\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-new\win-unpacked\梵澄金融.exe"

if defined EXE (
  start "" "%EXE%"
  exit /b 0
)

echo 未找到打包程序，请先运行「一键更新并启动.bat」
pause
exit /b 1
