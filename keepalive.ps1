# keepalive.ps1 - Windows native keepalive (T2, 2026-09-08; aligned with keepalive.sh)
# Usage: keepalive.cmd [--check-only|--once] [--pid-file <p>] [--cmd <c>]
#                     [--log-file <l>] [--interval <sec>] [--max-restarts <N>] [--help]
# Exit codes: 0=alive/ok 1=dead 2=no pid file 3=restart limit hit 4=no restart command
#
# NOTE: args are parsed manually from $args (PowerShell 5.1 does not bind "--xxx"
# double-dash parameters), so every flag is matched as a literal string.

$PidFile = "logs\agent-runner.pid"
$Cmd = ""
$LogFile = "logs\keepalive.log"
$Interval = 30
$MaxRestarts = 5
$CheckOnly = $false
$Once = $false
$Help = $false

$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    "--check-only"   { $CheckOnly = $true }
    "--once"         { $Once = $true }
    "--help"         { $Help = $true }
    "--pid-file"     { $i++; if ($i -lt $args.Count) { $PidFile = $args[$i] } }
    "--cmd"          { $i++; if ($i -lt $args.Count) { $Cmd = $args[$i] } }
    "--log-file"     { $i++; if ($i -lt $args.Count) { $LogFile = $args[$i] } }
    "--interval"     { $i++; if ($i -lt $args.Count) { $Interval = [int]$args[$i] } }
    "--max-restarts" { $i++; if ($i -lt $args.Count) { $MaxRestarts = [int]$args[$i] } }
  }
  $i++
}

if ($Help) {
  Write-Host "keepalive - Windows native watchdog for agent-runner"
  Write-Host "  --check-only     check only (0=alive 1=dead 2=no pid file)"
  Write-Host "  --once           check + restart at most once, then exit (test/manual)"
  Write-Host "  --pid-file <p>   pid file (default logs\agent-runner.pid)"
  Write-Host "  --cmd <c>        restart command (default: <pid file>.cmd)"
  Write-Host "  --log-file <l>   log file (default logs\keepalive.log)"
  Write-Host "  --interval <sec> check interval (default 30)"
  Write-Host "  --max-restarts <N> consecutive restart limit (default 5)"
  exit 0
}

function Log([string]$msg) {
  try {
    $dir = Split-Path $LogFile -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $msg) -Encoding UTF8
  } catch { }
  Write-Host $msg
}

function Check-Alive([string]$pf) {
  if (-not (Test-Path $pf)) { return 2 }
  try { $id = [int]((Get-Content $pf -Raw).Trim()) } catch { return 2 }
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) { return 0 }
  return 1
}

function Restart-Once([string]$cmdLine) {
  if (-not $cmdLine) { return $false }
  if (Test-Path $cmdLine) {
    Start-Process -FilePath $cmdLine -WorkingDirectory (Split-Path $cmdLine -Parent) -WindowStyle Hidden | Out-Null
    return $true
  }
  return $false
}

$rc = Check-Alive $PidFile
if ($CheckOnly) { exit $rc }

# Restart command: explicit --cmd or <pid file>.cmd (same convention as keepalive.sh)
if (-not $Cmd) {
  $candidate = [System.IO.Path]::ChangeExtension($PidFile, ".cmd")
  if (Test-Path $candidate) { $Cmd = $candidate }
}

$restarts = 0
while ($true) {
  $rc = Check-Alive $PidFile
  if ($rc -eq 0) {
    if ($Once) { exit 0 }
    Start-Sleep -Seconds $Interval
    continue
  }
  if ($rc -eq 2) {
    Log "WARN no pid file $PidFile"
    if ($Once) { exit 2 }
    Start-Sleep -Seconds $Interval
    continue
  }
  # rc=1: process dead -> restart
  if ($restarts -ge $MaxRestarts) { Log "ERROR restart limit hit ($MaxRestarts), stop"; exit 3 }
  Log "WARN process exited, restart #$($restarts + 1)"
  if (-not (Restart-Once $Cmd)) {
    Log "ERROR no restart command (--cmd or $PidFile.cmd)"
    exit 4
  }
  $restarts++
  if ($Once) { exit 0 }
  # Exponential backoff: interval * 2^(n-1), capped at 300s
  $backoff = [int][Math]::Min($Interval * [Math]::Pow(2, $restarts - 1), 300)
  Start-Sleep -Seconds $backoff
}
