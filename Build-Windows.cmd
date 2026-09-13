@echo off
setlocal
cd /d "%~dp0"
set "FRAMECRAFT_BUILD_NODE=node.exe"
if exist "%~dp0.runtime\node\node.exe" set "FRAMECRAFT_BUILD_NODE=%~dp0.runtime\node\node.exe"
"%FRAMECRAFT_BUILD_NODE%" "%~dp0scripts\build-desktop.mjs" %*
set "FRAMECRAFT_EXIT=%ERRORLEVEL%"
if not "%FRAMECRAFT_EXIT%"=="0" (
  echo Build prerequisites: Node.js 22+, Rust MSVC, Visual Studio C++ Build Tools and Windows SDK.
  echo See https://v2.tauri.app/start/prerequisites/
  pause
)
exit /b %FRAMECRAFT_EXIT%
