@echo off
REM ============================================================
REM  Retail Billing System - single-port launcher (recommended)
REM  Builds the client once, then runs the server which serves
REM  BOTH the API and the web app on http://localhost:5000.
REM  Use this for everyday / auto-start use.
REM ============================================================
cd /d "%~dp0"

echo Building client (one time)...
call npm --prefix client run build || echo [warn] client build failed - using existing build if present

echo Starting Retail Billing System on http://localhost:5000 ...
start "Retail Billing - Server" cmd /k "npm --prefix server start"

REM Wait for the server to boot, then open the app
timeout /t 6 >nul
start "" "http://localhost:5000"

echo.
echo App is running at: http://localhost:5000
echo Close the server window to stop the app.
pause
