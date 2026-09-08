@echo off
REM keepalive.cmd - Windows native keepalive entry (D-69 supplement, T2)
REM Logic lives in keepalive.ps1 (PowerShell is built into Windows)
REM Usage: keepalive.cmd [--check-only|--once] [--pid-file <p>] [--cmd <c>] [--log-file <l>] [--interval <sec>] [--max-restarts <N>]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keepalive.ps1" %*
exit /b %errorlevel%
