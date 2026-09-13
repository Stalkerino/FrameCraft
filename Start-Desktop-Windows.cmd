@echo off
setlocal
cd /d "%~dp0"
set "FRAMECRAFT_DESKTOP_NODE=node.exe"
if exist "%~dp0.runtime\node\node.exe" set "FRAMECRAFT_DESKTOP_NODE=%~dp0.runtime\node\node.exe"
"%FRAMECRAFT_DESKTOP_NODE%" "%~dp0scripts\start-desktop.mjs"
set "FRAMECRAFT_EXIT=%ERRORLEVEL%"
if not "%FRAMECRAFT_EXIT%"=="0" pause
exit /b %FRAMECRAFT_EXIT%
