@echo off
setlocal
cd /d "%~dp0"

set "LOG=%~dp0import.log"
chcp 65001 >nul 2>&1

rem ---------- find Node.js: always absolute paths, never relative ----------
set "NODE="

rem 0) manual override: put the full node.exe path in node-path.txt (highest priority)
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"

rem 1) resolve node.exe from PATH (a bare "node" would fail an exist check)
if not defined NODE for %%I in (node.exe) do set "NODE=%%~$PATH:I"

rem 2) common install locations
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%APPDATA%\npm\node.exe" set "NODE=%APPDATA%\npm\node.exe"

rem 3) portable: put node.exe next to this file
if not defined NODE if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"

if not defined NODE (
  echo.
  echo   Node.js not found.
  echo.
  echo   Install Node 22 or newer: https://nodejs.org/
  echo   Or drop node.exe next to this file.
  echo   Or create node-path.txt with the full path to node.exe.
  echo.
  pause
  exit /b 1
)

rem version check: built-in zstd requires Node 22+
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is too old:
  "%NODE%" -v
  echo   Node 22 or newer is required - session compression uses built-in zstd.
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   DeepSeek chat import into DeepSeek Harness
echo   Node: %NODE%
echo ============================================
echo.

"%NODE%" "%~dp0dsh-import.mjs" %*
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo [FAILED] exit code %CODE%, see import.log
) else (
  echo [DONE] see import.log
)
pause
