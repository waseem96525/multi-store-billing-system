@echo off
REM ============================================================
REM  Retail Billing System - development launcher
REM  Runs the API server (5000) + Vite dev server (5173).
REM  Use this while you are editing the code (hot reload).
REM ============================================================
cd /d "%~dp0"

echo Starting Retail Billing System (dev mode)...
start "Retail Billing - Server" cmd /k "npm --prefix server start"
start "Retail Billing - Client" cmd /k "npm --prefix client run dev"

timeout /t 6 >nul
start "" "http://localhost:5173"

echo.
echo Server : http://localhost:5000  (API)
echo Client : http://localhost:5173  (dev, hot reload)
echo Close the two server windows to stop.
pause
