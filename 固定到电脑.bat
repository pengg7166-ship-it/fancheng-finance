@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "FANCHENG_APP_ROOT=F:\FanchengFinance"
set "FANCHENG_DATA_DIR=F:\FanchengFinance"
set "FANCHENG_DATA_DRIVE=F"
set "EXE=%FANCHENG_APP_ROOT%\app\win-unpacked\FanchengFinance.exe"

if not exist "%EXE%" (
  echo 未找到程序: %EXE%
  echo 请先运行「更新梵澄金融.bat」完成打包。
  pause
  exit /b 1
)

set "NODE="
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe" (
  set "NODE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
)

if defined NODE (
  set "PATH=C:\Program Files\nodejs;%PATH%"
  "%NODE%" scripts\create-shortcuts.js
) else (
  echo Node 未找到，使用 PowerShell 创建桌面快捷方式...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$W=New-Object -ComObject WScript.Shell; $s=$W.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\梵澄金融.lnk'); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%FANCHENG_APP_ROOT%\app\win-unpacked'; $s.Description='梵澄金融'; $s.Save(); Write-Host 'Created desktop shortcut'"
)

echo.
echo 快捷方式已创建到：桌面、开始菜单、开机自启
pause
