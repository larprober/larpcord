<#
    Larpcord, a Discord client mod
    Copyright (c) 2026 Larpcord contributors
    SPDX-License-Identifier: GPL-3.0-or-later

    Installs Larpcord into the Discord desktop app on this PC, or removes it again.
    Normally started by "Install Larpcord.cmd" / "Uninstall Larpcord.cmd".

      install.ps1               install into every Discord branch found (Stable, PTB, Canary)
      install.ps1 -Uninstall    put back what was there before
#>
param(
    [switch]$Uninstall,
    # The options below exist for testing against a fake Discord folder.
    [string]$DiscordRoot = $env:LOCALAPPDATA,
    [string]$InstallDir = (Join-Path $env:APPDATA "Larpcord\dist"),
    [switch]$NoProcessCheck,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$Marker = "larpcord-shim"
$BackupName = "app.asar.before-larpcord"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Branches = @("Discord", "DiscordPTB", "DiscordCanary")

function Say($text) { Write-Host "  $text" }

# Newest app-x.y.z folder whose resources are complete (a half-downloaded update has none)
function Get-LatestAppDir($base) {
    Get-ChildItem -Path $base -Directory -Filter "app-*" |
        Where-Object {
            $_.Name -match '^app-\d+\.\d+\.\d+$' -and (
                (Test-Path (Join-Path $_.FullName "resources\app.asar")) -or
                (Test-Path (Join-Path $_.FullName "resources\_app.asar")))
        } |
        Sort-Object { [version]$_.Name.Substring(4) } |
        Select-Object -Last 1
}

# Mod loaders are a few hundred bytes; Discord's real app.asar is megabytes.
function Test-Loader($path) {
    (Test-Path $path) -and ((Get-Item $path).Length -lt 65536)
}

function Get-LoaderTarget($path) {
    $text = [IO.File]::ReadAllText($path, $Utf8)
    $m = [regex]::Match($text, 'require\(("(?:[^"\\]|\\.)*")\)')
    if (-not $m.Success) { return $null }
    try { return ($m.Groups[1].Value | ConvertFrom-Json) } catch { return $null }
}

function Test-OurLoader($path) {
    (Test-Loader $path) -and ([IO.File]::ReadAllText($path, $Utf8).Contains($Marker))
}

# A minimal asar archive holding index.js + package.json (Chromium Pickle framing).
function New-LoaderBytes($patcherPath) {
    $index = "// $Marker`nrequire(" + (ConvertTo-Json $patcherPath) + ");`n"
    $files = [ordered]@{
        "index.js"     = $Utf8.GetBytes($index)
        "package.json" = $Utf8.GetBytes('{"name":"discord","main":"index.js"}')
    }
    $offset = 0
    $entries = @()
    foreach ($name in $files.Keys) {
        $entries += ('"{0}":{{"size":{1},"offset":"{2}"}}' -f $name, $files[$name].Length, $offset)
        $offset += $files[$name].Length
    }
    $json = $Utf8.GetBytes('{"files":{' + ($entries -join ",") + '}}')
    $padded = [int]([math]::Ceiling($json.Length / 4) * 4)
    $head = New-Object byte[] (16 + $padded)
    [BitConverter]::GetBytes([uint32]4).CopyTo($head, 0)
    [BitConverter]::GetBytes([uint32](8 + $padded)).CopyTo($head, 4)
    [BitConverter]::GetBytes([uint32](4 + $padded)).CopyTo($head, 8)
    [BitConverter]::GetBytes([uint32]$json.Length).CopyTo($head, 12)
    $json.CopyTo($head, 16)
    $out = New-Object System.IO.MemoryStream
    $out.Write($head, 0, $head.Length)
    foreach ($name in $files.Keys) { $out.Write($files[$name], 0, $files[$name].Length) }
    return $out.ToArray()
}

function Stop-DiscordIfRunning {
    if ($NoProcessCheck) { return @() }
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $Branches -contains $_.ProcessName })
    if ($running.Count -eq 0) { return @() }
    $names = @($running | Select-Object -ExpandProperty ProcessName -Unique)
    Write-Host ""
    $answer = Read-Host "  Discord is open and has to close for this. Close it now? [Y/n]"
    if ($answer -and $answer.Trim().ToLower().StartsWith("n")) {
        Say "Okay, nothing was changed. Close Discord from the tray icon and run this again."
        exit 1
    }
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
    return $names
}

Write-Host ""
Write-Host "  Larpcord $(if ($Uninstall) { 'uninstaller' } else { 'installer' })"
Write-Host "  ------------------"

$found = @()
foreach ($branch in $Branches) {
    $base = Join-Path $DiscordRoot $branch
    if (-not (Test-Path $base)) { continue }
    $app = Get-LatestAppDir $base
    if ($app) { $found += [pscustomobject]@{ Branch = $branch; Base = $base; App = $app.FullName } }
}
if ($found.Count -eq 0) {
    Say "Couldn't find the Discord desktop app on this PC. Install it from discord.com first."
    exit 1
}

$wasRunning = Stop-DiscordIfRunning
$patcher = Join-Path $InstallDir "patcher.js"

if (-not $Uninstall) {
    $source = Join-Path $Here "Larpcord"
    if (-not (Test-Path (Join-Path $source "patcher.js"))) {
        Say "The Larpcord folder is missing next to this script. Extract the whole zip and try again."
        exit 1
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $InstallDir -Recurse -Force
    Say "Copied Larpcord to $InstallDir"
}

foreach ($d in $found) {
    $res = Join-Path $d.App "resources"
    $appAsar = Join-Path $res "app.asar"
    $original = Join-Path $res "_app.asar"
    $backup = Join-Path $res $BackupName
    $label = "$($d.Branch) $(Split-Path $d.App -Leaf)"

    if ($Uninstall) {
        if (-not (Test-Path $original) -or -not (Test-OurLoader $appAsar)) {
            Say "${label}: Larpcord isn't installed here."
            continue
        }
        $previous = if (Test-Path $backup) { Get-LoaderTarget $backup } else { $null }
        if ($previous -and (Test-Path $previous)) {
            Remove-Item $appAsar -Force
            Move-Item $backup $appAsar
            Say "${label}: put back the mod that was there before ($previous)."
        } else {
            Remove-Item $appAsar -Force
            Move-Item $original $appAsar
            if (Test-Path $backup) { Remove-Item $backup -Force }
            Say "${label}: back to plain Discord."
        }
        continue
    }

    if (Test-Loader $appAsar) {
        # Another mod (or an older Larpcord) is installed. Keep its loader for -Uninstall.
        if (-not (Test-Path $original)) {
            Say "${label}: found a mod loader without Discord's own files next to it. Reinstall Discord, then run this again."
            continue
        }
        if (-not (Test-OurLoader $appAsar) -and -not (Test-Path $backup)) {
            Move-Item $appAsar $backup
            Say "${label}: saved the existing mod loader so uninstalling can bring it back."
        }
    } elseif (Test-Path $appAsar) {
        # Discord's real code. It's the freshest copy, so any _app.asar left over is stale.
        if (Test-Path $original) { Remove-Item $original -Force }
        Move-Item $appAsar $original
    }
    [IO.File]::WriteAllBytes($appAsar, (New-LoaderBytes $patcher))
    Say "${label}: Larpcord installed."
}

if ($Uninstall -and (Test-Path $InstallDir)) {
    Remove-Item $InstallDir -Recurse -Force
    Say "Removed $InstallDir (your settings in $(Split-Path $InstallDir -Parent)\settings are kept)."
}

if (-not $NoLaunch) {
    $launch = if ($wasRunning.Count -gt 0) { $found | Where-Object { $wasRunning -contains $_.Branch } } else { $found | Select-Object -First 1 }
    foreach ($d in $launch) {
        $update = Join-Path $d.Base "Update.exe"
        if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "$($d.Branch).exe" }
    }
    Say "Starting Discord..."
}

Write-Host ""
Say "Done."
