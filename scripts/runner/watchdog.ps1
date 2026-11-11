# Keeps the unattended runner (run.ps1) alive. A scheduled task runs this every 15 minutes
# and at logon; install it with watchdog-install.ps1. The runner has died twice mid-sleep with
# nothing in runner.log (2026-10-03, 2026-10-05), losing hours each time.
#
# Restarts run.ps1 in its own window when it isn't running, unless the runner is meant to be down:
#   - scripts/runner/STOP exists           (operator pause: create it to stop restarts, delete to resume)
#   - .planning/RUNNER-BLOCKED.md exists   (the runner stopped itself; a human has to look)
#   - runner.log ends with 'runner finished'
# Crash-loop guard: after $MaxRestarts restarts within $WindowHours it writes RUNNER-BLOCKED.md
# instead of restarting again.
param(
  [int]$MaxRestarts = 3,
  [int]$WindowHours = 2
)

$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$runLog = Join-Path $PSScriptRoot 'logs\runner.log'
$blocked = Join-Path $repo '.planning\RUNNER-BLOCKED.md'

function Log($msg) {
  $line = "{0}  watchdog: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $runLog -Value $line -Encoding utf8
}

# run.ps1 writes its PID here and deletes the file when its script ends. Matching command lines
# isn't enough: the runner window uses -NoExit, so it stays open (idle) after the script stops.
$pidFile = Join-Path $PSScriptRoot 'logs\runner.pid'
if (Test-Path $pidFile) {
  $runnerPid = [int](Get-Content $pidFile -Raw).Trim()
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerPid" -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -match 'run\.ps1') { exit 0 }
}

if (Test-Path (Join-Path $PSScriptRoot 'STOP')) { exit 0 }
if (Test-Path $blocked) { exit 0 }
$lines = if (Test-Path $runLog) { Get-Content $runLog -Tail 200 } else { @() }
$last = $lines | Where-Object { $_ -notmatch '  watchdog: ' } | Select-Object -Last 1
if ($last -match 'runner finished') { exit 0 }

$since = (Get-Date).AddHours(-$WindowHours)
$recent = @($lines | Where-Object { $_ -match '^(\S+ \S+)  watchdog: restarted' -and [datetime]$Matches[1] -gt $since })
if ($recent.Count -ge $MaxRestarts) {
  $msg = "The runner died $($recent.Count) times within $WindowHours h; the watchdog stopped restarting it. See scripts/runner/logs."
  Set-Content -Path $blocked -Value "# Runner stopped`n`n$msg`n" -Encoding utf8
  Log "giving up: $msg"
  exit 1
}

Start-Process powershell -WorkingDirectory $repo -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\runner\run.ps1'
Log "restarted runner (it was not running; last line: $last)"
