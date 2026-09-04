@echo off
title SpeakUp Reading Coach v4 - Clean Install
if not exist .env (
  echo ERROR: .env does not exist. Copy .env.example to .env first.
  pause
  exit /b 1
)
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json
call npm install
if errorlevel 1 (pause & exit /b 1)
call npm start
pause
