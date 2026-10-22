@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul || (echo Install Node.js first. & exit /b 1)
where cargo >nul 2>nul || (echo Install Rust and C++ Build Tools first. & exit /b 1)
where ffmpeg >nul 2>nul || (echo Add FFmpeg to PATH first. & exit /b 1)
where ffprobe >nul 2>nul || (echo Add FFprobe to PATH first. & exit /b 1)
if not exist node_modules call npm ci
if errorlevel 1 exit /b 1
call npm run desktop
