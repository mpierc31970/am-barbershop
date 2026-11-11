# Unattended GSD runner for the CDS Platform, milestone v1.0.
# One fresh headless Claude session per phase. Checks plan usage before every session
# and waits for the reset when usage is at or over the start limit (session 85%, weekly 93%).
# Sessions stop themselves near 95%, so the runner doesn't start one with less headroom than that.
#
#   powershell -ExecutionPolicy Bypass -File scripts/runner/run.ps1            # run to the end
#   powershell -ExecutionPolicy Bypass -File scripts/runner/run.ps1 -Once      # one session only
#   powershell -ExecutionPolicy Bypass -File scripts/runner/run.ps1 -DryRun    # show what it would do
#
# Stop it any time with Ctrl+C; the next start resumes from the files on disk.
# watchdog.ps1 (scheduled task) restarts it if it dies; create scripts/runner/STOP to keep it down.
param(
  [int]$Limit = 95,
  # A session is only started below this. Sessions quit on their own at about 90-92% (limit raised to 95% on 2026-10-16),
  # so starting one too close just burns an attempt (2026-10-06: phase 8 blocked that way).
  [int]$StartLimit = 85,
  [int]$WeeklyLimit = 93,
  [int]$MaxAttemptsPerPhase = 3,
  [switch]$Once,
  [switch]$DryRun,
  # Git bundles of the whole repo land here after each session. OneDrive syncs them off
  # this PC, so the unpushed build survives a disk failure.
  [string]$BackupDir = $(if ($env:OneDrive) { Join-Path $env:OneDrive 'Backups\cds-platform' } else { Join-Path $env:USERPROFILE 'Backups\cds-platform' }),
  [int]$KeepBackups = 20
)

# Continue, not Stop: Windows PowerShell 5.1 turns a native tool's normal stderr output
# (git progress, 'bundle is okay') into a fatal error under Stop. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$runLog = Join-Path $logDir 'runner.log'

function Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $runLog -Value $line -Encoding utf8
}

# Writes a git bundle (every branch, tag and commit in one file) when HEAD has moved since
# the last backup. Restore with: git clone <file>.bundle cds-website
function Backup-Repo($tag) {
  New-Item -ItemType Directory -Force $BackupDir | Out-Null
  $head = (& git rev-parse HEAD).Trim()
  $marker = Join-Path $BackupDir 'last-head.txt'
  if ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $head)) {
    Log "backup skipped: no new commits"
    return
  }
  $file = Join-Path $BackupDir ("cds-platform-{0}-{1}.bundle" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $tag)
  if ($DryRun) { Log "dry run, would back up to $file"; return }
  & git bundle create $file --all 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $file)) { Log "BACKUP FAILED: $file"; return }
  & git bundle verify $file 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Log "BACKUP FAILED verification: $file"; return }
  Set-Content -Path $marker -Value $head -Encoding ascii
  Log ("backup written: {0} ({1} MB)" -f [IO.Path]::GetFileName($file), [math]::Round((Get-Item $file).Length / 1MB, 1))
  Get-ChildItem $BackupDir -Filter 'cds-platform-*.bundle' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepBackups | Remove-Item -Force
}

function Get-Usage {
  $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'usage.ps1') -Limit $StartLimit -WeeklyLimit $WeeklyLimit -Json
  try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

function Wait-ForUsage {
  while ($true) {
    $u = Get-Usage
    if ($null -eq $u -or -not $u.over) { return }
    $reset = [datetime]$u.resets_at
    $wait = [math]::Max(60, ($reset.ToUniversalTime() - (Get-Date).ToUniversalTime()).TotalSeconds + 120)
    Log ("usage session {0}% weekly {1}% is over {2}%/{3}%; sleeping {4} min until reset" -f $u.session, $u.weekly, $StartLimit, $WeeklyLimit, [math]::Round($wait / 60))
    if ($DryRun) { return }
    Start-Sleep -Seconds ([int]$wait)
  }
}

function Test-PhaseVerified($number) {
  $n = [string]$number
  $prefix = if ($n -match '^\d+$') { '{0:D2}' -f [int]$n } else { $n }
  $dirs = Get-ChildItem (Join-Path $repo '.planning/phases') -Directory -Filter "$prefix-*" -ErrorAction SilentlyContinue
  foreach ($d in $dirs) {
    if (Get-ChildItem $d.FullName -Filter "$prefix-VERIFICATION.md" -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Get-NextPhase {
  $analysis = (& gsd-sdk query roadmap.analyze) -join "`n" | ConvertFrom-Json
  foreach ($p in $analysis.phases) {
    if ($p.roadmap_complete) { continue }
    # disk_status 'complete' only means every plan has a SUMMARY. Review fixes and
    # verification still follow, so a phase is done only once its VERIFICATION.md exists.
    if ($p.disk_status -eq 'complete' -and (Test-PhaseVerified $p.number)) { continue }
    return $p
  }
  return $null
}

function Short($text, $max = 160) {
  $t = ([string]$text -replace '\s+', ' ').Trim()
  if ($t.Length -gt $max) { $t.Substring(0, $max) + '...' } else { $t }
}

# Prints one readable line per stream-json event. Subagent activity is indented.
function Show-Event([string]$line) {
  try { $e = $line | ConvertFrom-Json } catch { if ($line.Trim()) { Write-Host (Short $line) -ForegroundColor DarkGray }; return }
  $time = Get-Date -Format 'HH:mm:ss'
  $pad = if ($e.parent_tool_use_id) { '      ' } else { '  ' }
  switch ($e.type) {
    'assistant' {
      foreach ($c in $e.message.content) {
        if ($c.type -eq 'text' -and $c.text.Trim()) {
          Write-Host "$time$pad$(Short $c.text)" -ForegroundColor White
        } elseif ($c.type -eq 'tool_use') {
          $i = $c.input
          $what = @($i.description, $i.skill, $i.subagent_type, $i.file_path, $i.pattern, $i.command) |
            Where-Object { $_ } | Select-Object -First 1
          Write-Host "$time$pad> $($c.name) $(Short $what 120)" -ForegroundColor Cyan
        }
      }
    }
    'result' {
      $color = if ($e.is_error) { 'Red' } else { 'Green' }
      Write-Host ("$time  session result: {0} | {1} turns | {2} min" -f $e.subtype, $e.num_turns, [math]::Round($e.duration_ms / 60000)) -ForegroundColor $color
    }
    'system' { if ($e.subtype -eq 'init') { Write-Host "$time  session ready (model $($e.model))" -ForegroundColor DarkGray } }
  }
}

function Invoke-Session($prompt, $tag) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $log = Join-Path $logDir "$stamp-$tag.log"
  Log "session start: $tag (log $([IO.Path]::GetFileName($log)))"
  if ($DryRun) { Log "dry run, prompt: $prompt"; return 0 }
  # stream-json gives one event per line as it happens: the raw line goes to the log and a
  # short readable line goes to this window, so progress is visible live.
  $writer = [IO.StreamWriter]::new($log, $true, [Text.UTF8Encoding]::new($false))
  $writer.AutoFlush = $true
  try {
    & claude -p $prompt --permission-mode bypassPermissions --output-format stream-json --verbose 2>&1 |
      ForEach-Object { $writer.WriteLine([string]$_); Show-Event ([string]$_) }
    $code = $LASTEXITCODE
  } finally { $writer.Dispose() }
  Log "session end: $tag exit $code"
  return $code
}

$rules = "Unattended build. Follow the 'Unattended build mode' section of CLAUDE.md exactly: " +
  "never ask the user anything, pick recommended options yourself, defer human checks to " +
  ".planning/HUMAN-CHECKS.md, use stand-ins listed in .planning/GO-LIVE.md for paid services, " +
  "design all UI with the impeccable skill. Run 'powershell -File scripts/runner/usage.ps1' " +
  "between plans; if it reports OVER, or your context is past about 70%, commit, write a " +
  "handoff with 'base handoff create --project cds-platform', and exit. Commit after every plan. NEVER run git push; the only push happens in the final milestone session."

# A fresh start means the operator (or the watchdog) chose to resume, so clear an old block.
$blocked = Join-Path $repo '.planning/RUNNER-BLOCKED.md'
if (Test-Path $blocked) { Remove-Item $blocked -Force; Log 'cleared old RUNNER-BLOCKED.md' }

# The watchdog reads this to tell a live runner from an idle -NoExit window. Removed by the
# finally below on every way out (finish, BLOCKED exit, Ctrl+C); a crash leaves a dead PID.
$pidFile = Join-Path $logDir 'runner.pid'
Set-Content -Path $pidFile -Value $PID -Encoding ascii

$attempts = @{}
try {
while ($true) {
  Wait-ForUsage
  $phase = Get-NextPhase

  if ($null -eq $phase) {
    Log 'all phases complete; running milestone audit and completion'
    $prompt = "$rules Every v1.0 phase is complete. Invoke the gsd-audit-milestone skill, " +
      "close any gaps it finds, then invoke gsd-complete-milestone. Finish by writing a handoff " +
      "that tells the user the build is done and points to .planning/HUMAN-CHECKS.md and .planning/GO-LIVE.md. " +
      "Then do the ONE push of the whole build: git push --follow-tags. After it, trigger the Coolify deploy and verify it reaches the VPS; record the result in HUMAN-CHECKS.md and commit that locally."
    Invoke-Session $prompt 'milestone' | Out-Null
    Backup-Repo 'milestone'
    Log 'runner finished'
    break
  }

  $n = [string]$phase.number
  $attempts[$n] = 1 + [int]$attempts[$n]
  if ($attempts[$n] -gt $MaxAttemptsPerPhase) {
    $msg = "Phase $n ($($phase.name)) did not complete after $MaxAttemptsPerPhase sessions. See scripts/runner/logs."
    Set-Content -Path (Join-Path $repo '.planning/RUNNER-BLOCKED.md') -Value "# Runner stopped`n`n$msg`n" -Encoding utf8
    Log "BLOCKED: $msg"
    exit 1
  }

  $prompt = "$rules You are building phase $n ($($phase.name)) of milestone v1.0. First read " +
    ".planning/STATE.md and the newest file in .base/handoffs/ if it concerns phase $n, so you resume " +
    "rather than restart. Then invoke the gsd-autonomous skill with arguments '--only $n'."
  $headBefore = (& git -C $repo rev-parse HEAD).Trim()
  $code = Invoke-Session $prompt "phase$n-try$($attempts[$n])"
  $headAfter = (& git -C $repo rev-parse HEAD).Trim()
  $after = Get-NextPhase
  $done = ($null -eq $after) -or ([string]$after.number -ne $n)
  Backup-Repo $(if ($done) { "phase$n-done" } else { "phase$n-partial" })

  # Only a session that made no progress counts as a failed attempt. Sessions that
  # committed work (then stopped for context) or stopped for usage are free.
  $u = Get-Usage
  if ($headAfter -ne $headBefore) {
    Log "progress: $($headBefore.Substring(0,7))..$($headAfter.Substring(0,7)); attempt not counted"
    $attempts[$n] = [int]$attempts[$n] - 1
  } elseif ($u -and $u.over) { $attempts[$n] = [int]$attempts[$n] - 1 }

  if ($Once -or $DryRun) { break }
}
} finally { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
