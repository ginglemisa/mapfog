@echo off
setlocal

cd /d "%~dp0"

set "PORT=8765"
set "HOST=127.0.0.1"

echo Starting MapFog local server...
echo.
echo Open:
echo   http://%HOST%:%PORT%/index.html
echo   http://%HOST%:%PORT%/gm.html
echo   http://%HOST%:%PORT%/pl.html
echo.
echo Press Ctrl+C to stop the server, then close this window.
echo.

py -m http.server %PORT% --bind %HOST%

if errorlevel 1 (
  echo.
  echo Failed to start with py. Trying python...
  python -m http.server %PORT% --bind %HOST%
)

pause
