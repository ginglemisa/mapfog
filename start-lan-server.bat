@echo off
setlocal

cd /d "%~dp0"

if not defined MAPFOG_PORT set "MAPFOG_PORT=8765"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [MapFog LAN] Node.js was not found.
  echo   1. Download the LTS installer from https://nodejs.org/ and install it.
  echo   2. Close this window and run start-lan-server.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws\package.json" (
  echo [MapFog LAN] First run: installing dependencies. This step needs the internet once.
  call npm ci --omit=dev
  if errorlevel 1 call npm install --omit=dev
  if not exist "node_modules\ws\package.json" (
    echo.
    echo [MapFog LAN] Failed to install dependencies. Connect to the internet and try again.
    echo.
    pause
    exit /b 1
  )
)

echo [MapFog LAN] Starting on port %MAPFOG_PORT% ...
echo   If Windows Firewall asks, allow Node.js on "Private networks".
echo.
node lan-server.js --port %MAPFOG_PORT% %*

pause
