@echo off
title SpeakUp Reading Coach v4
echo.
echo ======================================================
echo  SpeakUp Reading Coach v4
echo ======================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node.js 20+ first.
  pause
  exit /b 1
)
if not exist .env (
  echo ERROR: .env does not exist.
  echo Copy .env.example to .env and fill Gemini + Supabase values.
  echo Read SETUP_SUPABASE.md.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (pause & exit /b 1)
)
echo Starting http://localhost:3000
call npm start
pause
