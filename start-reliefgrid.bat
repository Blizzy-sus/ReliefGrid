@echo off
rem ReliefGrid launcher for Windows: double-click to install (first run), load demo data (first run),
rem start the server and open the app in your browser. Close this window to stop the server.
setlocal
title ReliefGrid
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

node --disable-warning=ExperimentalWarning -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo This Node.js version is too old: ReliefGrid needs Node.js 22.13 or newer ^(built-in SQLite^).
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist data\reliefgrid.db (
  echo Loading the demo incident ^(first run only^)...
  call npm run seed
  if errorlevel 1 (
    echo Seeding failed.
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000
echo.
echo ReliefGrid will open at http://localhost:%PORT%
echo Demo accounts are listed on the sign-in page. Close this window to stop the server.
echo.

if not defined RELIEFGRID_NO_BROWSER start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

call npm start
echo.
echo The server has stopped.
pause
