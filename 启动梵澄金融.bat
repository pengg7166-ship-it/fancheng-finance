@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "EXE="
if exist "%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe" set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%FANCHENG_APP_ROOT%\app\win-unpacked\梵澄金融.exe" set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\梵澄金融.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-build\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-out\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-out\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\FanchengFinance.exe" set "EXE=%~dp0dist-new\win-unpacked\FanchengFinance.exe"
if not defined EXE if exist "%~dp0dist-build\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-build\win-unpacked\梵澄金融.exe"
if not defined EXE if exist "%~dp0dist-new\win-unpacked\梵澄金融.exe" set "EXE=%~dp0dist-new\win-unpacked\梵澄金融.exe"

if not defined EXE (
  echo 未找到已打包程序，请运行「一键更新并启动.bat」或「更新梵澄金融.bat」
  pause
  exit /b 1
)
start "" "%EXE%"
exit /b 0
