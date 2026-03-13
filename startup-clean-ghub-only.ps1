param(
  [switch]$Restore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  throw "Run PowerShell as Administrator."
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = Join-Path $PSScriptRoot "startup-backup"
$latestFile = Join-Path $backupRoot "latest.txt"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

function Test-AllowByName {
  param([string]$Text)
  if (-not $Text) { return $false }
  $patterns = @(
    "ghub",
    "g hub",
    "logitech",
    "lghub"
  )
  $lower = $Text.ToLowerInvariant()
  foreach ($p in $patterns) {
    if ($lower -like "*$p*") { return $true }
  }
  return $false
}

function Get-RunEntries {
  $keys = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
  )
  $all = @()
  foreach ($key in $keys) {
    if (-not (Test-Path $key)) { continue }
    $props = Get-ItemProperty -Path $key
    foreach ($prop in $props.PSObject.Properties) {
      if ($prop.Name -in "PSPath", "PSParentPath", "PSChildName", "PSDrive", "PSProvider") { continue }
      $all += [PSCustomObject]@{
        KeyPath = $key
        Name = [string]$prop.Name
        Value = [string]$prop.Value
      }
    }
  }
  return $all
}

function Disable-RunEntries {
  param(
    [Parameter(Mandatory = $true)][string]$BackupId
  )

  $backupKey = "HKCU:\Software\StartupCleaner\Backup\$BackupId\RunEntries"
  New-Item -Path $backupKey -Force | Out-Null

  $entries = Get-RunEntries
  foreach ($e in $entries) {
    $markText = "$($e.Name) $($e.Value)"
    if (Test-AllowByName -Text $markText) { continue }

    $safeName = ($e.KeyPath -replace "[:\\]", "_") + "__" + $e.Name
    New-ItemProperty -Path $backupKey -Name $safeName -PropertyType String -Value "$($e.KeyPath)||$($e.Name)||$($e.Value)" -Force | Out-Null
    Remove-ItemProperty -Path $e.KeyPath -Name $e.Name -ErrorAction SilentlyContinue
    Write-Host "Disabled Run entry: $($e.Name)"
  }
}

function Disable-StartupFolderItems {
  param(
    [Parameter(Mandatory = $true)][string]$BackupId
  )

  $folders = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
  )

  $metaDir = Join-Path $backupRoot $BackupId
  New-Item -ItemType Directory -Force -Path $metaDir | Out-Null
  $mapFile = Join-Path $metaDir "startup-folder-map.csv"

  $rows = @()
  foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) { continue }
    $disabledDir = Join-Path $folder "DisabledByStartupCleaner"
    New-Item -ItemType Directory -Force -Path $disabledDir | Out-Null

    Get-ChildItem -Path $folder -Force | Where-Object {
      $_.Name -ne "DisabledByStartupCleaner"
    } | ForEach-Object {
      if (Test-AllowByName -Text $_.Name) { return }
      $dest = Join-Path $disabledDir $_.Name
      if (Test-Path $dest) {
        $dest = Join-Path $disabledDir ("{0}_{1}" -f ([IO.Path]::GetFileNameWithoutExtension($_.Name)), (Get-Random))
      }
      Move-Item -Path $_.FullName -Destination $dest -Force
      $rows += [PSCustomObject]@{
        Source = $_.FullName
        Destination = $dest
      }
      Write-Host "Moved startup item: $($_.Name)"
    }
  }

  if ($rows.Count -gt 0) {
    $rows | Export-Csv -Path $mapFile -NoTypeInformation -Encoding UTF8
  }
}

function Disable-LogonTasks {
  param(
    [Parameter(Mandatory = $true)][string]$BackupId
  )

  $metaDir = Join-Path $backupRoot $BackupId
  New-Item -ItemType Directory -Force -Path $metaDir | Out-Null
  $tasksFile = Join-Path $metaDir "disabled-tasks.txt"

  $disabled = New-Object "System.Collections.Generic.List[string]"

  $tasks = Get-ScheduledTask | Where-Object {
    $_.TaskPath -notlike "\Microsoft\*" -and $_.State -ne "Disabled"
  }

  foreach ($t in $tasks) {
    $joined = "$($t.TaskPath)$($t.TaskName) $($t.Description) $($t.Author)"
    if (Test-AllowByName -Text $joined) { continue }

    $hasLogonTrigger = $false
    foreach ($trigger in $t.Triggers) {
      if ($trigger.CimClass.CimClassName -eq "MSFT_TaskLogonTrigger") {
        $hasLogonTrigger = $true
        break
      }
    }
    if (-not $hasLogonTrigger) { continue }

    Disable-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath | Out-Null
    $fullName = "$($t.TaskPath)$($t.TaskName)"
    $disabled.Add($fullName) | Out-Null
    Write-Host "Disabled task: $fullName"
  }

  if ($disabled.Count -gt 0) {
    $disabled | Set-Content -Path $tasksFile -Encoding UTF8
  }
}

function Restore-RunEntries {
  param([string]$BackupId)
  $backupKey = "HKCU:\Software\StartupCleaner\Backup\$BackupId\RunEntries"
  if (-not (Test-Path $backupKey)) { return }

  $props = Get-ItemProperty -Path $backupKey
  foreach ($prop in $props.PSObject.Properties) {
    if ($prop.Name -in "PSPath", "PSParentPath", "PSChildName", "PSDrive", "PSProvider") { continue }
    $parts = [string]$prop.Value -split "\|\|", 3
    if ($parts.Count -ne 3) { continue }
    $keyPath = $parts[0]
    $name = $parts[1]
    $value = $parts[2]
    if (-not (Test-Path $keyPath)) { New-Item -Path $keyPath -Force | Out-Null }
    New-ItemProperty -Path $keyPath -Name $name -PropertyType String -Value $value -Force | Out-Null
    Write-Host "Restored Run entry: $name"
  }
}

function Restore-StartupFolderItems {
  param([string]$BackupId)
  $metaDir = Join-Path $backupRoot $BackupId
  $mapFile = Join-Path $metaDir "startup-folder-map.csv"
  if (-not (Test-Path $mapFile)) { return }

  $rows = Import-Csv -Path $mapFile
  foreach ($row in $rows) {
    if (-not (Test-Path $row.Destination)) { continue }
    $srcDir = Split-Path -Parent $row.Source
    if (-not (Test-Path $srcDir)) { New-Item -ItemType Directory -Path $srcDir -Force | Out-Null }
    Move-Item -Path $row.Destination -Destination $row.Source -Force
    Write-Host "Restored startup item: $($row.Source)"
  }
}

function Restore-Tasks {
  param([string]$BackupId)
  $metaDir = Join-Path $backupRoot $BackupId
  $tasksFile = Join-Path $metaDir "disabled-tasks.txt"
  if (-not (Test-Path $tasksFile)) { return }

  Get-Content -Path $tasksFile | ForEach-Object {
    $full = $_.Trim()
    if (-not $full) { return }
    $idx = $full.LastIndexOf("\")
    if ($idx -lt 0) { return }
    $taskPath = $full.Substring(0, $idx + 1)
    $taskName = $full.Substring($idx + 1)
    Enable-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Restored task: $full"
  }
}

if ($Restore) {
  if (-not (Test-Path $latestFile)) {
    throw "No backup found."
  }
  $backupId = (Get-Content -Path $latestFile -TotalCount 1).Trim()
  if (-not $backupId) {
    throw "Invalid backup id."
  }
  Write-Host "Restoring from backup: $backupId"
  Restore-RunEntries -BackupId $backupId
  Restore-StartupFolderItems -BackupId $backupId
  Restore-Tasks -BackupId $backupId
  Write-Host "Restore complete."
  exit 0
}

$backupId = $timestamp
Set-Content -Path $latestFile -Value $backupId -Encoding UTF8
Write-Host "Backup id: $backupId"

Disable-RunEntries -BackupId $backupId
Disable-StartupFolderItems -BackupId $backupId
Disable-LogonTasks -BackupId $backupId

Write-Host "Done. Reboot to apply all changes."
