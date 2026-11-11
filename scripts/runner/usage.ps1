# Prints current Claude plan usage. Exit code 0 = below limit, 3 = at/over limit.
# Usage: powershell -File scripts/runner/usage.ps1 [-Limit 95] [-WeeklyLimit 93] [-Json]
# -Limit caps the 5-hour session window; -WeeklyLimit caps the 7-day window.
param([int]$Limit = 95, [int]$WeeklyLimit = 93, [switch]$Json)

$cred = Get-Content "$env:USERPROFILE\.claude\.credentials.json" -Raw | ConvertFrom-Json
$token = $cred.claudeAiOauth.accessToken
$headers = @{ Authorization = "Bearer $token"; 'anthropic-beta' = 'oauth-2025-04-20' }
try {
  $u = Invoke-RestMethod -Uri 'https://api.anthropic.com/api/oauth/usage' -Headers $headers -TimeoutSec 30
} catch {
  Write-Output "usage: unavailable ($($_.Exception.Message))"
  exit 0
}

$session = [double]$u.five_hour.utilization
$weekly  = [double]$u.seven_day.utilization
$over = ($session -ge $Limit) -or ($weekly -ge $WeeklyLimit)
# The reset that matters is the latest one among the limits that are over.
$resets = @()
if ($session -ge $Limit) { $resets += [datetime]$u.five_hour.resets_at }
if ($weekly  -ge $WeeklyLimit) { $resets += [datetime]$u.seven_day.resets_at }
$resetAt = if ($resets) { ($resets | Sort-Object)[-1].ToUniversalTime().ToString('o') } else { '' }

if ($Json) {
  [pscustomobject]@{ session = $session; weekly = $weekly; limit = $Limit; weeklyLimit = $WeeklyLimit; over = $over; resets_at = $resetAt } | ConvertTo-Json -Compress
} else {
  Write-Output ("usage: session {0}% (limit {2}%)  |  weekly {1}% (limit {3}%)  |  {4}" -f $session, $weekly, $Limit, $WeeklyLimit, $(if ($over) { "OVER, resets $resetAt" } else { 'ok' }))
}
if ($over) { exit 3 } else { exit 0 }
