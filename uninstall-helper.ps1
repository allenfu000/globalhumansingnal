param(
  [string[]]$Keywords = @(
    "MSPCManager",
    "PC Manager",
    "Armoury Crate",
    "ExpressVPN",
    "Wallpaper",
    "clash",
    "verge"
  ),
  [switch]$IncludeAll,
  [switch]$Uninstall,
  [string]$Selection,
  [switch]$CleanupLeftovers,
  [switch]$DisableStartup,
  [switch]$CreateRestorePoint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-UninstallEntries {
  $paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  $result = foreach ($p in $paths) {
    Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object {
      $_.PSObject.Properties.Match("DisplayName").Count -gt 0 -and
      $_.PSObject.Properties.Match("UninstallString").Count -gt 0 -and
      $_.DisplayName -and $_.UninstallString
    } | Select-Object `
      DisplayName,
      DisplayVersion,
      Publisher,
      InstallLocation,
      QuietUninstallString,
      UninstallString,
      PSPath
  }

  $result | Sort-Object DisplayName -Unique
}

function Filter-Entries {
  param(
    [Parameter(Mandatory = $true)]$Entries,
    [string[]]$ByKeywords,
    [switch]$All
  )

  if ($All) {
    return $Entries
  }

  return $Entries | Where-Object {
    $name = $_.DisplayName
    foreach ($k in $ByKeywords) {
      if ($name -like "*$k*") {
        return $true
      }
    }
    return $false
  }
}

function Parse-Selection {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [int]$MaxIndex
  )

  $set = New-Object "System.Collections.Generic.HashSet[int]"
  foreach ($partRaw in ($Text -split ",")) {
    $part = $partRaw.Trim()
    if (-not $part) { continue }

    if ($part -match "^\d+\-\d+$") {
      $a, $b = $part -split "-"
      $start = [int]$a
      $end = [int]$b
      if ($start -gt $end) {
        throw "Invalid range: $part"
      }
      for ($i = $start; $i -le $end; $i++) {
        if ($i -lt 1 -or $i -gt $MaxIndex) {
          throw "Out of range: $i (1-$MaxIndex)"
        }
        [void]$set.Add($i)
      }
    } elseif ($part -match "^\d+$") {
      $n = [int]$part
      if ($n -lt 1 -or $n -gt $MaxIndex) {
        throw "Out of range: $n (1-$MaxIndex)"
      }
      [void]$set.Add($n)
    } else {
      throw "Cannot parse selection token: $part"
    }
  }

  return ($set.ToArray() | Sort-Object)
}

function Get-CommandPathFromUninstallString {
  param([string]$UninstallString)

  if (-not $UninstallString) { return $null }

  if ($UninstallString -match '^\s*"([^"]+)"') {
    return $matches[1]
  }

  return ($UninstallString -split "\s+")[0]
}

function Invoke-Uninstall {
  param(
    [Parameter(Mandatory = $true)]$Entry
  )

  $display = $Entry.DisplayName
  $quiet = $Entry.QuietUninstallString
  $normal = $Entry.UninstallString
  $cmdText = if ($quiet) { $quiet } else { $normal }

  if (-not $cmdText) {
    Write-Warning "[$display] no uninstall command. Skipped."
    return
  }

  Write-Host "Start uninstall: $display" -ForegroundColor Cyan
  Write-Host "Command: $cmdText"

  # Use cmd /c to avoid argument quoting issues across installers.
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmdText" -Wait
}

function Get-CandidateCleanupPaths {
  param(
    [Parameter(Mandatory = $true)]$Entry
  )

  $candidates = New-Object "System.Collections.Generic.List[string]"

  if ($Entry.InstallLocation -and (Test-Path $Entry.InstallLocation)) {
    $candidates.Add($Entry.InstallLocation)
  }

  $cmdPath = Get-CommandPathFromUninstallString -UninstallString $Entry.UninstallString
  if ($cmdPath -and (Test-Path $cmdPath)) {
    $parent = Split-Path -Parent $cmdPath
    if ($parent -and (Test-Path $parent)) {
      $candidates.Add($parent)
    }
  }

  $display = $Entry.DisplayName
  $tokens = $display -split "[^a-zA-Z0-9]+" | Where-Object { $_.Length -ge 4 } | Select-Object -First 2
  $baseDirs = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:ProgramData,
    $env:LOCALAPPDATA,
    $env:APPDATA
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($base in $baseDirs) {
    foreach ($token in $tokens) {
      Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -like "*$token*"
      } | ForEach-Object {
        $candidates.Add($_.FullName)
      }
    }
  }

  return ($candidates | Sort-Object -Unique)
}

function Disable-StartupByName {
  param([Parameter(Mandatory = $true)][string]$Name)

  $runKeys = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
  )

  foreach ($rk in $runKeys) {
    if (-not (Test-Path $rk)) { continue }
    $props = Get-ItemProperty -Path $rk
    foreach ($prop in $props.PSObject.Properties) {
      if ($prop.Name -in "PSPath", "PSParentPath", "PSChildName", "PSDrive", "PSProvider") { continue }
      if ($prop.Name -like "*$Name*" -or [string]$prop.Value -like "*$Name*") {
        Remove-ItemProperty -Path $rk -Name $prop.Name -ErrorAction SilentlyContinue
        Write-Host "Removed startup entry: $($prop.Name) ($rk)"
      }
    }
  }
}

if (-not (Test-IsAdmin)) {
  Write-Warning "Run as administrator for best uninstall/cleanup result."
}

Write-Host "Scanning installed apps..." -ForegroundColor Yellow
$allEntries = Get-UninstallEntries
$targetEntries = Filter-Entries -Entries $allEntries -ByKeywords $Keywords -All:$IncludeAll

if (-not $targetEntries -or $targetEntries.Count -eq 0) {
  Write-Host "No matched apps. Use -IncludeAll to show all entries."
  exit 0
}

$indexed = for ($i = 0; $i -lt $targetEntries.Count; $i++) {
  [PSCustomObject]@{
    ID = $i + 1
    Name = $targetEntries[$i].DisplayName
    Version = $targetEntries[$i].DisplayVersion
    Publisher = $targetEntries[$i].Publisher
  }
}

$indexed | Format-Table -AutoSize

if (-not $Uninstall) {
  Write-Host ""
  Write-Host "Scan-only mode complete." -ForegroundColor Green
  Write-Host "Uninstall example:"
  Write-Host ".\uninstall-helper.ps1 -Uninstall -Selection ""1,3-5"" -CleanupLeftovers -DisableStartup -CreateRestorePoint"
  exit 0
}

if (-not $Selection) {
  $Selection = Read-Host "Enter app IDs to uninstall (example: 1,3-5)"
}

$selectedIdx = Parse-Selection -Text $Selection -MaxIndex $targetEntries.Count
$selected = foreach ($n in $selectedIdx) { $targetEntries[$n - 1] }

Write-Host ""
Write-Host "Apps selected for uninstall:" -ForegroundColor Yellow
$selected | ForEach-Object { Write-Host "- $($_.DisplayName)" }
$confirm = Read-Host "Type YES to continue"
if ($confirm -ne "YES") {
  Write-Host "Cancelled."
  exit 0
}

if ($CreateRestorePoint) {
  try {
    Write-Host "Creating restore point..." -ForegroundColor Yellow
    Checkpoint-Computer -Description "Before-Uninstall-Helper" -RestorePointType "MODIFY_SETTINGS"
    Write-Host "Restore point created."
  } catch {
    Write-Warning "Restore point failed: $($_.Exception.Message)"
  }
}

foreach ($app in $selected) {
  try {
    Invoke-Uninstall -Entry $app
    Write-Host "Uninstall command completed: $($app.DisplayName)" -ForegroundColor Green
  } catch {
    Write-Warning "Uninstall failed: $($app.DisplayName) -> $($_.Exception.Message)"
  }
}

if ($DisableStartup) {
  Write-Host "Removing related startup entries..." -ForegroundColor Yellow
  foreach ($app in $selected) {
    Disable-StartupByName -Name $app.DisplayName
  }
}

if ($CleanupLeftovers) {
  foreach ($app in $selected) {
    $paths = Get-CandidateCleanupPaths -Entry $app | Where-Object { Test-Path $_ }
    if (-not $paths -or $paths.Count -eq 0) { continue }

    Write-Host ""
    Write-Host "Possible leftover paths for [$($app.DisplayName)]:" -ForegroundColor Yellow
    $paths | ForEach-Object { Write-Host "  $_" }
    $doRemove = Read-Host "Type DELETE to remove these paths"
    if ($doRemove -ne "DELETE") { continue }

    foreach ($p in $paths) {
      try {
        Remove-Item -Path $p -Recurse -Force -ErrorAction Stop
        Write-Host "Removed: $p"
      } catch {
        Write-Warning "Failed to remove: $p -> $($_.Exception.Message)"
      }
    }
  }
}

Write-Host ""
Write-Host "Done. A reboot is recommended." -ForegroundColor Green
