@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install\windows.ps1" -LaunchOnly
set "FRAMECRAFT_EXIT=%ERRORLEVEL%"
if not "%FRAMECRAFT_EXIT%"=="0" pause
exit /b %FRAMECRAFT_EXIT%
