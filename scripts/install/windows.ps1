param([switch]$LaunchOnly, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Runtime = Join-Path $Root '.runtime'
New-Item -ItemType Directory -Force $Runtime | Out-Null

function Download-Verified($Url, $ChecksumUrl, $Destination, $FileName) {
    Write-Host "Downloading $FileName..."
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl).Content
    $expected = $null
    foreach ($line in ($checksums -split "`n")) {
        if ($line -match '^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $FileName) { $expected = $Matches[1]; break }
        if ($line.Trim() -match '^[a-fA-F0-9]{64}$') { $expected = $line.Trim() }
    }
    if (!$expected) { throw "Missing SHA-256 for $FileName. Download was not installed." }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$Destination.part"
    if ((Get-FileHash "$Destination.part" -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch for $FileName. Delete the .part file and retry." }
    Move-Item -Force "$Destination.part" $Destination
}

try {
    Set-Location $Root
    if (![Environment]::Is64BitOperatingSystem) { throw 'Framecraft requires 64-bit Windows 10 or newer.' }
    $Node = Join-Path $Runtime 'node\node.exe'
    if (!(Test-Path $Node)) {
        $InstalledNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($InstalledNode) {
            $Major = & $InstalledNode.Source -p 'parseInt(process.versions.node)'
            if ($LASTEXITCODE -eq 0 -and [int]$Major -ge 22 -and (Get-Command npm -ErrorAction SilentlyContinue)) { $Node = $InstalledNode.Source }
        }
    }
    if (!(Test-Path $Node)) {
        # x64 runs natively on x64 Windows and through Windows x64 emulation on ARM64.
        $Base = 'https://nodejs.org/dist/latest-v24.x'
        $Manifest = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHASUMS256.txt").Content
        $Match = [regex]::Match($Manifest, '(?m)^[a-f0-9]{64}\s+(node-v24\.[0-9]+\.[0-9]+-win-x64\.zip)\s*$')
        if (!$Match.Success) { throw 'Cannot locate the official Node 24 Windows archive.' }
        $ArchiveName = $Match.Groups[1].Value
        $Archive = Join-Path $Runtime $ArchiveName
        Download-Verified "$Base/$ArchiveName" "$Base/SHASUMS256.txt" $Archive $ArchiveName
        Expand-Archive -Force $Archive $Runtime
        Move-Item (Join-Path $Runtime ($ArchiveName -replace '\.zip$', '')) (Join-Path $Runtime 'node')
        Remove-Item $Archive
        $Node = Join-Path $Runtime 'node\node.exe'
    }
    $env:PATH = "$(Split-Path $Node -Parent);$env:PATH"
    if (!$LaunchOnly -or !(Test-Path (Join-Path $Runtime 'config.json'))) {
        $FFmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
        $FFprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
        $PortableFFmpeg = Join-Path $Runtime 'ffmpeg\bin\ffmpeg.exe'
        if (!$env:FFMPEG_PATH -and !(Test-Path $PortableFFmpeg) -and (!$FFmpeg -or !$FFprobe)) {
            $Base = 'https://www.gyan.dev/ffmpeg/builds'
            $ArchiveName = 'ffmpeg-release-essentials.zip'
            $Archive = Join-Path $Runtime $ArchiveName
            Download-Verified "$Base/$ArchiveName" "$Base/$ArchiveName.sha256" $Archive $ArchiveName
            $Extract = Join-Path $Runtime 'ffmpeg-extract'
            if (Test-Path $Extract) { Remove-Item $Extract -Recurse -Force }
            Expand-Archive -Force $Archive $Extract
            $Binary = Get-ChildItem $Extract -Filter ffmpeg.exe -Recurse | Select-Object -First 1
            if (!$Binary) { throw 'FFmpeg archive did not contain ffmpeg.exe.' }
            Move-Item (Split-Path (Split-Path $Binary.FullName -Parent) -Parent) (Join-Path $Runtime 'ffmpeg')
            Remove-Item $Archive
            Remove-Item $Extract -Recurse -Force
        }
    }
    $Script = if ($LaunchOnly) { 'scripts/install/launch.mjs' } else { 'scripts/install/setup.mjs' }
    $Arguments = @()
    if ($NoLaunch) { $Arguments += '--no-launch' }
    & $Node (Join-Path $Root $Script) @Arguments
    exit $LASTEXITCODE
} catch {
    Write-Host "`nFramecraft setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix the reported problem and run Install-Windows.cmd again. Your projects are preserved.'
    exit 1
}
