# Registers the 'CDS Runner Watchdog' scheduled task: runs watchdog.ps1 at logon and every
# 15 minutes, as the current user, only while logged on (the runner needs a desktop window).
#   powershell -ExecutionPolicy Bypass -File scripts/runner/watchdog-install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/runner/watchdog-install.ps1 -Remove
param([switch]$Remove)

$name = 'CDS Runner Watchdog'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  "removed '$name'"
  return
}

$script = Join-Path $PSScriptRoot 'watchdog.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $every, $logon -Principal $principal `
  -Settings $settings -Force | Out-Null
"registered '$name' (every 15 min + at logon)"
