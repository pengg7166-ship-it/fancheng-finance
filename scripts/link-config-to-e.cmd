@echo off
chcp 65001 >nul
set ROAM=%APPDATA%\fancheng-finance
set EUSER=E:\FanchengFinance\userData

if not exist "E:\" (
  echo E: drive not found.
  pause
  exit /b 1
)

if not exist "%EUSER%" mkdir "%EUSER%"

if exist "%ROAM%" (
  echo Linking %ROAM% to E: userData...
  if not exist "%ROAM%.bak" (
    move "%ROAM%" "%ROAM%.bak" >nul 2>&1
    xcopy "%ROAM%.bak\*" "%EUSER%\" /E /I /Y >nul 2>&1
  )
  if exist "%ROAM%" rmdir "%ROAM%" 2>nul
  if not exist "%ROAM%" mklink /J "%ROAM%" "%EUSER%"
)

cd /d "%~dp0.."
node scripts\create-shortcuts.js
echo.
echo Shortcuts now point to E:\FanchengFinance\app\win-unpacked
echo Config junction: %ROAM% -^> %EUSER%
pause
